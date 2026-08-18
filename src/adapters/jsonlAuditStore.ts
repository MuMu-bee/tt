import type { RequestContext } from '../application/requestContext.ts';
import type { AuditFilter, AuditRecord, AuditWriteStatus } from '../application/contracts.ts';
import type { AuditStore } from '../ports/auditStore.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import { SerializedJsonlStore } from './serializedJsonlStore.ts';

/** JSONL-backed audit store with query and compensation retry support. */
export class JsonlAuditStore extends SerializedJsonlStore<AuditRecord> implements AuditStore {
	constructor(storage: JsonlTextStorage) {
		super(storage);
	}

	async append(event: AuditRecord, context: RequestContext): Promise<AuditWriteStatus> {
		const record: AuditRecord = {
			...event,
			audit_id: event.audit_id || event.request_id + ':' + event.created_at,
		};
		if (!record.audit_id) return 'failed';
		return this.withStore(context, async () => {
			this.records.set(record.audit_id, { ...record });
			try {
				await this.flush(context);
				return 'success';
			} catch {
				this.records.set(record.audit_id, { ...record, result: 'pending-compensation', compensation: true });
				return 'pending-compensation';
			}
		});
	}

	async query(filter: AuditFilter | Partial<AuditRecord>, context: RequestContext): Promise<AuditRecord[]> {
		return this.withStore(context, async () => [...this.records.values()]
			.filter((event) => (!filter.request_id || event.request_id === filter.request_id)
				&& (!filter.proposal_id || event.proposal_id === filter.proposal_id)
				&& (!filter.path || event.path === filter.path)
				&& (!filter.result || event.result === filter.result))
			.map((event) => ({ ...event })));
	}

	async listPendingCompensation(context: RequestContext): Promise<AuditRecord[]> {
		return this.query({ result: 'pending-compensation' }, context);
	}

	async retry(recordId: string, context: RequestContext): Promise<AuditWriteStatus> {
		return this.withStore(context, async () => {
			const event = this.records.get(recordId);
			if (!event) return 'failed';
			const previous = { ...event };
			const candidate = { ...event, result: 'success' as const, compensation: false };
			this.records.set(recordId, candidate);
			try {
				await this.flush(context);
				return 'success';
			} catch {
				this.records.set(recordId, previous);
				return 'failed';
			}
		});
	}

	/** Marks an existing record as pending compensation (e.g. secondary mirror write failed). */
	async markCompensation(auditId: string, context: RequestContext): Promise<AuditWriteStatus> {
		return this.withStore(context, async () => {
			const event = this.records.get(auditId);
			if (!event) return 'failed';
			this.records.set(auditId, { ...event, result: 'pending-compensation', compensation: true });
			try {
				await this.flush(context);
				return 'success';
			} catch {
				return 'failed';
			}
		});
	}

	protected keyOf(record: AuditRecord): string {
		return record.audit_id;
	}

	protected validate(value: unknown): boolean {
		const candidate = value as AuditRecord;
		return Boolean(candidate.audit_id && candidate.request_id && candidate.created_at);
	}
}
