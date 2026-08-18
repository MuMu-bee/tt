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
  private fromChange(plan: OrganizePlan, change: PlannedChange): Proposal {
    return { proposal_id: createRequestId(), request_id: plan.request_id, target_path: change.path, target_zone: change.zone, change_kind: change.kind, base_hash: change.before_hash, before: change.before, after: change.after, diff: change.diff, reason: change.reason, created_at: new Date().toISOString(), status: 'pending', requires_approval: true, schema_version: 1, scope_snapshot: plan.scope_snapshot };
  }
}
