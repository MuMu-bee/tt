import { createRequestId, type RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord, ProposalStatus } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

export interface ApprovalResult { decision: 'approve' | 'reject'; status: ProposalStatus; idempotent: boolean }
export class ApprovalService {
  private readonly proposals: ProposalStore;
  private readonly approvals: ApprovalStore;
  private readonly queue = new SerialQueue();

  constructor(proposals: ProposalStore, approvals: ApprovalStore) {
    this.proposals = proposals;
    this.approvals = approvals;
  }

  async decide(proposalId: string, decision: 'approve' | 'reject', context: RequestContext, note?: string): Promise<ApprovalResult> {
    return this.queue.run(async () => {
      const existing = await this.approvals.getForProposal(proposalId, context);
      if (existing) return { decision: existing.decision, status: existing.decision === 'approve' ? 'approved' : 'rejected', idempotent: true };
      const proposal = await this.proposals.get(proposalId, context);
      if (!proposal) throw new Error('proposal not found');
      if (proposal.status !== 'pending') throw new Error('proposal is not pending: ' + proposal.status);
      const record: ApprovalRecord = { approval_id: createRequestId(), proposal_id: proposalId, request_id: context.request_id, decision, actor: 'user', decided_at: new Date().toISOString(), ...(note ? { note } : {}) };
      /* 1) Persist the decision intent first. */
      await this.approvals.save(record, context.child ? context.child() : context);
      const status: ProposalStatus = decision === 'approve' ? 'approved' : 'rejected';
      /* 2) Then update the proposal. If this fails, the approval remains and
         reconcile() will repair the proposal status during the next restore. */
      try {
        await this.proposals.updateStatus(proposalId, status, context.child ? context.child() : context);
      } catch (error) {
        console.error('[agent-dashboard] 审批状态同步失败，将在恢复期对账。', error);
        throw error;
      }
      return { decision, status, idempotent: false };
    });
  }

  /** Repairs proposals that have an approval decision but are still pending. */
  async reconcile(context: RequestContext): Promise<number> {
    const approvals = await this.approvals.listAll(context);
    let fixed = 0;
    for (const approval of approvals) {
      const proposal = await this.proposals.get(approval.proposal_id, context);
      if (proposal && proposal.status === 'pending') {
        await this.proposals.updateStatus(approval.proposal_id, approval.decision === 'approve' ? 'approved' : 'rejected', context);
        fixed += 1;
      }
    }
    return fixed;
  }
}
