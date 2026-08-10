import type { RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();
  async save(record: ApprovalRecord, _context: RequestContext): Promise<void> { const existing = this.records.get(record.proposal_id); if (existing) return; this.records.set(record.proposal_id, { ...record }); }
  async getForProposal(proposalId: string, _context: RequestContext): Promise<ApprovalRecord | null> { const value = this.records.get(proposalId); return value ? { ...value } : null; }
}
