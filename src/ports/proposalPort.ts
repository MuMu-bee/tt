import type { RequestContext } from '../application/requestContext.ts';
import type { Proposal, ProposalFilter, ProposalStatus } from '../application/contracts.ts';

export interface ProposalStore {
  save(proposal: Proposal, context: RequestContext): Promise<void>;
  get(proposalId: string, context: RequestContext): Promise<Proposal | null>;
  list(filter: ProposalFilter, context: RequestContext): Promise<Proposal[]>;
  updateStatus(proposalId: string, status: ProposalStatus, context: RequestContext): Promise<void>;
}
