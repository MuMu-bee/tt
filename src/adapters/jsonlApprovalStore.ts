import type { RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import { SerializedJsonlStore } from './serializedJsonlStore.ts';

/** JSONL-backed approvals, retaining the first decision for each proposal. */
export class JsonlApprovalStore extends SerializedJsonlStore<ApprovalRecord> implements ApprovalStore {
	constructor(storage: JsonlTextStorage) {
		super(storage);
	}

	async save(record: ApprovalRecord, context: RequestContext): Promise<void> {
		if (!record.approval_id || !record.proposal_id) throw new Error('valid approval required');
		return this.withStore(context, async () => {
			if (this.records.has(record.proposal_id)) return;
			this.records.set(record.proposal_id, { ...record });
			await this.flush(context);
		});
	}

	async getForProposal(proposalId: string, context: RequestContext): Promise<ApprovalRecord | null> {
		return this.withStore(context, async () => {
			const value = this.records.get(proposalId);
			return value ? { ...value } : null;
		});
	}

	async listAll(context: RequestContext): Promise<ApprovalRecord[]> {
		return this.withStore(context, async () => [...this.records.values()].map((record) => ({ ...record })));
	}

	protected keyOf(record: ApprovalRecord): string {
		return record.proposal_id;
	}

	protected validate(value: unknown): boolean {
		const candidate = value as ApprovalRecord;
		return Boolean(candidate.approval_id && candidate.proposal_id && (candidate.decision === 'approve' || candidate.decision === 'reject'));
	}
}
