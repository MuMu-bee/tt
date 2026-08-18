import type { RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord } from '../application/contracts.ts';

export interface ApprovalStore {
  save(record: ApprovalRecord, context: RequestContext): Promise<void>;
  getForProposal(proposalId: string, context: RequestContext): Promise<ApprovalRecord | null>;
  listAll(context: RequestContext): Promise<ApprovalRecord[]>;
}
