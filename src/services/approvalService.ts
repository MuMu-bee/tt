import { createRequestId, type RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord, ProposalStatus } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';

export interface ApprovalResult { decision: 'approve' | 'reject'; status: ProposalStatus; idempotent: boolean }
export class ApprovalService {
  private readonly proposals: ProposalStore;
  private readonly approvals: ApprovalStore;

  constructor(proposals: ProposalStore, approvals: ApprovalStore) {
    this.proposals = proposals;
    this.approvals = approvals;
  }
  async decide(proposalId: string, decision: 'approve' | 'reject', context: RequestContext, note?: string): Promise<ApprovalResult> {
    const existing = await this.approvals.getForProposal(proposalId, context);
    if (existing) return { decision: existing.decision, status: existing.decision === 'approve' ? 'approved' : 'rejected', idempotent: true };
    const proposal = await this.proposals.get(proposalId, context);
    if (!proposal) throw new Error('proposal not found');
    if (proposal.status !== 'pending') throw new Error(`proposal is not pending: ${proposal.status}`);
    /* 过期检查：过期的 pending proposal 不允许再审批。 */
    if (proposal.expires_at && Date.parse(proposal.expires_at) < Date.now()) {
      await this.proposals.updateStatus(proposalId, 'expired', context.child ? context.child() : context);
      throw new Error('proposal has expired');
    }
    const record: ApprovalRecord = { approval_id: createRequestId(), proposal_id: proposalId, request_id: context.request_id, decision, actor: 'user', decided_at: new Date().toISOString(), ...(note ? { note } : {}) };
    await this.approvals.save(record, context.child ? context.child() : context);
    const status: ProposalStatus = decision === 'approve' ? 'approved' : 'rejected';
    await this.proposals.updateStatus(proposalId, status, context.child ? context.child() : context);
    return { decision, status, idempotent: false };
  }
}
