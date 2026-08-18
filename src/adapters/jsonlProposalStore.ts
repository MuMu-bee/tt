import type { RequestContext } from '../application/requestContext.ts';
import type { Proposal, ProposalFilter, ProposalStatus } from '../application/contracts.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import { SerializedJsonlStore } from './serializedJsonlStore.ts';

const TERMINAL_STATUSES: ProposalStatus[] = ['rejected', 'applied', 'conflict', 'expired'];

/** JSONL-backed proposal store. Invalid rows are ignored during recovery. */
export class JsonlProposalStore extends SerializedJsonlStore<Proposal> implements ProposalStore {
	constructor(storage: JsonlTextStorage) {
		super(storage);
	}

	async save(proposal: Proposal, context: RequestContext): Promise<void> {
		if (!proposal.proposal_id || !proposal.schema_version) throw new Error('valid proposal required');
		return this.withStore(context, async () => {
			this.records.set(proposal.proposal_id, { ...proposal });
			await this.flush(context);
		});
	}

	async get(proposalId: string, context: RequestContext): Promise<Proposal | null> {
		return this.withStore(context, async () => {
			const value = this.records.get(proposalId);
			return value ? { ...value } : null;
		});
	}

	async list(filter: ProposalFilter, context: RequestContext): Promise<Proposal[]> {
		return this.withStore(context, async () => [...this.records.values()]
			.filter((proposal) => (!filter.status || proposal.status === filter.status)
				&& (!filter.target_path || proposal.target_path === filter.target_path)
				&& (!filter.request_id || proposal.request_id === filter.request_id))
			.map((proposal) => ({ ...proposal })));
	}

	async updateStatus(proposalId: string, status: ProposalStatus, context: RequestContext): Promise<void> {
		return this.withStore(context, async () => {
			const value = this.records.get(proposalId);
			if (!value) throw new Error('proposal not found');
			if (TERMINAL_STATUSES.includes(value.status) && value.status !== status) {
				throw new Error('terminal proposal cannot transition: ' + value.status);
			}
			this.records.set(proposalId, { ...value, status });
			await this.flush(context);
		});
	}

	protected keyOf(record: Proposal): string {
		return record.proposal_id;
	}

	protected validate(value: unknown): boolean {
		const candidate = value as Proposal;
		return Boolean(candidate.proposal_id && Number.isInteger(candidate.schema_version));
	}
}
