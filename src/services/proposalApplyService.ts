import { sha256Hex } from '../utils/sha256.ts';
import type { RequestContext } from '../application/requestContext.ts';
import type { AuditEvent, ProposalStatus, WriteResult } from '../application/contracts.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { AuditSink } from '../ports/auditSink.ts';
import type { WritePort } from '../ports/writePort.ts';
import { WriteService } from './writeService.ts';
import type { PersistenceGate } from './persistenceGate.ts';

export interface ProposalApplyResult extends WriteResult { proposal_status: ProposalStatus }
export class ProposalApplyService {
  private readonly proposals: ProposalStore;
  private readonly approvals: ApprovalStore;
  private readonly writes: WriteService;
  private readonly port: WritePort;
  private readonly persistenceGate?: PersistenceGate;
  private readonly snapshotHook?: (path: string, before: string, after: string, context: RequestContext) => Promise<void>;
  private readonly auditSink?: AuditSink;

  constructor(proposals: ProposalStore, approvals: ApprovalStore, writes: WriteService, port: WritePort, persistenceGate?: PersistenceGate, snapshotHook?: (path: string, before: string, after: string, context: RequestContext) => Promise<void>, auditSink?: AuditSink) {
    this.proposals = proposals;
    this.approvals = approvals;
    this.writes = writes;
    this.port = port;
    this.persistenceGate = persistenceGate;
    this.snapshotHook = snapshotHook;
    this.auditSink = auditSink;
  }
  private readonly applyQueues = new Map<string, Promise<unknown>>();

  /** Serializes apply per proposal so concurrent calls cannot double-write. */
  async apply(proposalId: string, context: RequestContext): Promise<ProposalApplyResult> {
    const previous = this.applyQueues.get(proposalId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.applyNow(proposalId, context));
    this.applyQueues.set(proposalId, next);
    try {
      return await next;
    } finally {
      if (this.applyQueues.get(proposalId) === next) this.applyQueues.delete(proposalId);
    }
  }

  private async applyNow(proposalId: string, context: RequestContext): Promise<ProposalApplyResult> {
    if (this.persistenceGate && !this.persistenceGate.isWritable()) {
      return { path: '', status: 'failed', before_hash: '', error_code: 'PERSISTENCE_DEGRADED', proposal_status: 'failed' };
    }
    const proposal = await this.proposals.get(proposalId, context);
    if (!proposal) throw new Error('proposal not found');
    if (proposal.status === 'applied') throw new Error('proposal already applied');
    if (proposal.status !== 'approved') {
      /* 未授权的 apply 尝试也留审计痕迹。 */
      await this.auditSkipped(proposal, 'skipped', context);
      return { path: proposal.target_path, status: 'skipped', before_hash: proposal.base_hash, proposal_status: proposal.status };
    }
    /* 过期检查：已过期的 approved proposal 不允许 apply。 */
    if (proposal.expires_at && Date.parse(proposal.expires_at) < Date.now()) {
      await this.proposals.updateStatus(proposalId, 'expired', context);
      return { path: proposal.target_path, status: 'skipped', before_hash: proposal.base_hash, proposal_status: 'expired' };
    }
    if (proposal.target_zone === 'fiction' || proposal.target_zone === 'unknown') { await this.proposals.updateStatus(proposalId, 'failed', context); return { path: proposal.target_path, status: 'proposal_only', before_hash: proposal.base_hash, error_code: 'FICTION_PROPOSAL_ONLY', proposal_status: 'failed' }; }
    const approval = await this.approvals.getForProposal(proposalId, context);
    if (!approval || approval.decision !== 'approve') {
      await this.auditSkipped(proposal, 'skipped', context);
      return { path: proposal.target_path, status: 'skipped', before_hash: proposal.base_hash, proposal_status: proposal.status };
    }
    const current = await this.port.read(proposal.target_path, context.child ? context.child() : context);
    if (sha256Hex(current) !== proposal.base_hash) { await this.proposals.updateStatus(proposalId, 'conflict', context); return { path: proposal.target_path, status: 'conflict', before_hash: sha256Hex(current), error_code: 'HASH_CONFLICT', proposal_status: 'conflict' }; }
    const result = await this.writes.write({ path: proposal.target_path, content: proposal.after, before_hash: proposal.base_hash, kind: proposal.change_kind, scope_snapshot: proposal.scope_snapshot ?? { kind: 'file', value: proposal.target_path }, zone: proposal.target_zone, request_id: proposal.request_id }, context);
    const nextStatus: ProposalStatus = result.status === 'applied' ? 'applied' : result.status === 'conflict' ? 'conflict' : result.status === 'proposal_only' ? 'failed' : 'failed';
    await this.proposals.updateStatus(proposalId, nextStatus, context);
    /* Save rollback snapshot after successful apply */
    if (result.status === 'applied' && this.snapshotHook) {
      try { await this.snapshotHook(proposal.target_path, proposal.before, proposal.after, context.child ? context.child() : context); } catch { /* snapshot failure is non-fatal */ }
    }
    return { ...result, proposal_status: nextStatus };
  }

  private async auditSkipped(proposal: { target_path: string; base_hash: string; change_kind: string }, result: string, context: RequestContext): Promise<void> {
    if (!this.auditSink) return;
    const event: AuditEvent = {
      request_id: context.request_id,
      actor: context.actor,
      action: 'proposal-apply-skipped',
      path: proposal.target_path,
      before_hash: proposal.base_hash,
      result,
      created_at: new Date().toISOString(),
    };
    try { await this.auditSink.append(event, context.child ? context.child() : context); } catch { /* audit of a skipped apply is best-effort */ }
  }
}
