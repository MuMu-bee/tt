import { createRequestId, type RequestContext } from '../application/requestContext.ts';
import type { OrganizePlan, PlannedChange, Proposal, ProposalFilter } from '../application/contracts.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';

export class ProposalService {
  private readonly store: ProposalStore;

  constructor(store: ProposalStore) {
    this.store = store;
  }
  async createFromPlan(plan: OrganizePlan, context: RequestContext): Promise<Proposal[]> {
    const proposals: Proposal[] = [];
    for (const change of plan.changes) {
      const proposal = this.fromChange(plan, change);
      await this.store.save(proposal, context.child ? context.child() : context);
      proposals.push(proposal);
    }
    return proposals;
  }
  async get(proposalId: string, context: RequestContext): Promise<Proposal | null> { return this.store.get(proposalId, context); }
  async list(filter: ProposalFilter, context: RequestContext): Promise<Proposal[]> { return this.store.list(filter, context); }

  /** Marks pending/approved proposals past their expires_at as expired. Returns how many were expired. */
  async expireOverdue(context: RequestContext): Promise<number> {
    const all = await this.store.list({}, context);
    const now = Date.now();
    let count = 0;
    for (const proposal of all) {
      if ((proposal.status === 'pending' || proposal.status === 'approved') && proposal.expires_at && Date.parse(proposal.expires_at) < now) {
        await this.store.updateStatus(proposal.proposal_id, 'expired', context);
        count += 1;
      }
    }
    return count;
  }
  private fromChange(plan: OrganizePlan, change: PlannedChange): Proposal {
    return { proposal_id: createRequestId(), request_id: plan.request_id, target_path: change.path, target_zone: change.zone, change_kind: change.kind, base_hash: change.before_hash, before: change.before, after: change.after, diff: change.diff, reason: change.reason, created_at: new Date().toISOString(), status: 'pending', requires_approval: true, schema_version: 1 };
  }
}
