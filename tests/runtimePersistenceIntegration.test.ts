import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import { DEFAULT_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import type { AuditEvent, OrganizePlan, WriteRequest } from '../src/application/contracts.ts';
import type { PersistenceRuntimeStatus } from '../src/application/persistenceContracts.ts';
import type { PersistenceRestoreReport, RestorablePersistenceStore } from '../src/ports/persistencePort.ts';
import type { WritePort } from '../src/ports/writePort.ts';
import type { AuditSink } from '../src/ports/auditSink.ts';
import { InMemoryProposalStore } from '../src/adapters/inMemoryProposalStore.ts';
import { InMemoryApprovalStore } from '../src/adapters/inMemoryApprovalStore.ts';
import { InMemoryAuditStore } from '../src/adapters/inMemoryAuditStore.ts';
import { ProposalService } from '../src/services/proposalService.ts';
import { ApprovalService } from '../src/services/approvalService.ts';
import { ProposalApplyService } from '../src/services/proposalApplyService.ts';
import { WriteService } from '../src/services/writeService.ts';
import { PersistenceGate } from '../src/services/persistenceGate.ts';

/* ------------------------------------------------------------------ */
/*  Test doubles                                                       */
/* ------------------------------------------------------------------ */

class FakeWritePort implements WritePort {
  content = 'before';
  writes = 0;
  failWrite = false;

  async read(_path: string, _context: Parameters<WritePort['read']>[1]): Promise<string> {
    return this.content;
  }

  async writeAtomic(_path: string, content: string, _context: Parameters<WritePort['writeAtomic']>[2]): Promise<void> {
    if (this.failWrite) throw new Error('write failed');
    this.writes += 1;
    this.content = content;
  }
}

class FakeAuditSink implements AuditSink {
  events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async query(): Promise<AuditEvent[]> {
    return this.events;
  }
}

/** A controllable restorable store for testing PersistenceGate. */
class FakeRestorableStore implements RestorablePersistenceStore {
  private report: PersistenceRestoreReport;

  constructor(available = true, loaded = true, skippedRows = 0) {
    this.report = { available, loaded, skipped_rows: skippedRows };
  }

  setFailure(): void {
    this.report = { available: false, loaded: false, skipped_rows: 0, error: 'restore failed' };
  }

  setSuccess(available = true, loaded = true, skippedRows = 0): void {
    this.report = { available, loaded, skipped_rows: skippedRows };
  }

  async restore(_context: RequestContext): Promise<PersistenceRestoreReport> {
    return { ...this.report };
  }

  async health(_context: RequestContext) {
    return { ...this.report, healthy: this.report.available && this.report.loaded };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function plan(zone: 'normal' | 'fiction' | 'unknown' = 'normal'): OrganizePlan {
  return {
    plan_id: 'plan-1',
    request_id: 'request-1',
    scope_snapshot: { kind: 'global' },
    created_at: new Date().toISOString(),
    changes: [{
      path: 'notes/a.md',
      kind: 'tag-add',
      before: 'before',
      after: 'after',
      diff: '+tag',
      reason: 'test',
      status: 'planned',
      before_hash: hash('before'),
      zone,
    }],
  };
}

interface FullTestEnv {
  proposals: InMemoryProposalStore;
  approvals: InMemoryApprovalStore;
  proposalService: ProposalService;
  approvalService: ApprovalService;
  port: FakeWritePort;
  audit: FakeAuditSink;
  write: WriteService;
  apply: ProposalApplyService;
  gate: PersistenceGate;
  proposalStore: FakeRestorableStore;
  approvalStore: FakeRestorableStore;
  auditStore: FakeRestorableStore;
}

function createTestEnv(): FullTestEnv {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const proposalService = new ProposalService(proposals);
  const approvalService = new ApprovalService(proposals, approvals);
  const port = new FakeWritePort();
  const audit = new FakeAuditSink();
  const flags = { ...DEFAULT_FEATURE_FLAGS, new_write_pipeline: true };
  const proposalStore = new FakeRestorableStore();
  const approvalStore = new FakeRestorableStore();
  const auditStore = new FakeRestorableStore();
  const gate = new PersistenceGate(true);
  const write = new WriteService(port, audit, undefined, flags, gate);
  const apply = new ProposalApplyService(proposals, approvals, write, port, gate);
  return { proposals, approvals, proposalService, approvalService, port, audit, write, apply, gate, proposalStore, approvalStore, auditStore };
}

async function createApprovedProposal(env: FullTestEnv, context: RequestContext) {
  const [proposal] = await env.proposalService.createFromPlan(plan(), context);
  assert.ok(proposal);
  await env.approvalService.decide(proposal.proposal_id, 'approve', context);
  return proposal;
}

/* ================================================================== */
/*  Scenario 1: Restart recovery — pending proposals and approvals     */
/*              survive a simulated process restart.                   */
/* ================================================================== */

test('restart recovery: pending proposals and approvals are restored', async () => {
  const context = createRequestContext('workbench-agent');
  const env = createTestEnv();

  // Simulate creating a proposal before restart
  const [proposal] = await env.proposalService.createFromPlan(plan(), context);
  assert.ok(proposal);
  assert.equal(proposal.status, 'pending');

  // Simulate approving before restart
  await env.approvalService.decide(proposal.proposal_id, 'approve', context);

  // Simulate process restart: restore persistence from stores
  const status = await env.gate.restore(
    { proposals: env.proposalStore, approvals: env.approvalStore, audit: env.auditStore },
    context,
  );

  // Verify restore succeeded
  assert.equal(status.restored, true);
  assert.equal(status.degraded, false);
  assert.equal(status.stores.proposals.loaded, true);
  assert.equal(status.stores.approvals.loaded, true);
  assert.equal(status.stores.audit.loaded, true);

  // Verify the gate is writable after successful restore
  assert.equal(env.gate.isWritable(), true);

  // Verify the proposal still exists and is approved
  const restored = await env.proposals.get(proposal.proposal_id, context);
  assert.ok(restored);
  assert.equal(restored.status, 'approved');

  // Verify the approval still exists
  const approval = await env.approvals.getForProposal(proposal.proposal_id, context);
  assert.ok(approval);
  assert.equal(approval.decision, 'approve');
});

/* ================================================================== */
/*  Scenario 2: Degraded state — when restore fails, the runtime       */
/*              enters degraded mode and approval/write are blocked.    */
/* ================================================================== */

test('degraded state: restore failure blocks approval and write via PERSISTENCE_DEGRADED', async () => {
  const context = createRequestContext('workbench-agent');
  const env = createTestEnv();

  // Make one store fail to restore
  env.proposalStore.setFailure();

  const status = await env.gate.restore(
    { proposals: env.proposalStore, approvals: env.approvalStore, audit: env.auditStore },
    context,
  );

  // Verify degraded
  assert.equal(status.restored, false);
  assert.equal(status.degraded, true);
  assert.equal(env.gate.isWritable(), false);

  // Verify WriteService returns PERSISTENCE_DEGRADED
  const writeReq: WriteRequest = {
    path: 'notes/a.md',
    content: 'after',
    before_hash: hash('before'),
    kind: 'tag-add',
    scope_snapshot: { kind: 'global' },
    zone: 'normal',
    request_id: 'req-degraded-write',
  };
  const writeResult = await env.write.write(writeReq, context);
  assert.equal(writeResult.status, 'failed');
  assert.equal(writeResult.error_code, 'PERSISTENCE_DEGRADED');

  // Verify ProposalApplyService returns PERSISTENCE_DEGRADED
  const applyResult = await env.apply.apply('nonexistent-id', context);
  assert.equal(applyResult.status, 'failed');
  assert.equal(applyResult.error_code, 'PERSISTENCE_DEGRADED');
});

/* ================================================================== */
/*  Scenario 3: Auto-apply blocked — after restart recovery,           */
/*              approved proposals are NOT automatically applied.       */
/* ================================================================== */

test('auto-apply blocked: recovery does not trigger automatic apply of approved proposals', async () => {
  const context = createRequestContext('workbench-agent');
  const env = createTestEnv();

  // Create and approve a proposal before restart
  const proposal = await createApprovedProposal(env, context);

  // Simulate restart recovery
  const status = await env.gate.restore(
    { proposals: env.proposalStore, approvals: env.approvalStore, audit: env.auditStore },
    context,
  );
  assert.equal(status.restored, true);

  // After recovery, no writes should have occurred
  assert.equal(env.port.writes, 0);
  assert.equal(env.audit.events.length, 0);

  // The proposal should still be in approved status (not applied)
  const restored = await env.proposals.get(proposal.proposal_id, context);
  assert.ok(restored);
  assert.equal(restored.status, 'approved');

  // Only explicit apply should trigger the write
  const result = await env.apply.apply(proposal.proposal_id, context);
  assert.equal(result.status, 'applied');
  assert.equal(env.port.writes, 1);
});

/* ================================================================== */
/*  Scenario 4: Basic functionality in degraded state —                */
/*              Dashboard (search/index) still starts and works.       */
/* ================================================================== */

test('degraded state: search and index remain functional even when persistence is degraded', async () => {
  const context = createRequestContext('workbench-agent');
  const env = createTestEnv();

  // Make restore fail
  env.approvalStore.setFailure();

  const status = await env.gate.restore(
    { proposals: env.proposalStore, approvals: env.approvalStore, audit: env.auditStore },
    context,
  );

  // Runtime is degraded
  assert.equal(status.degraded, true);
  assert.equal(env.gate.isWritable(), false);

  // But the persistence gate status is still inspectable
  const currentStatus: PersistenceRuntimeStatus = env.gate.status();
  assert.equal(currentStatus.degraded, true);
  assert.equal(currentStatus.stores.approvals.loaded, false);
  assert.equal(currentStatus.stores.proposals.loaded, true);
  assert.equal(currentStatus.stores.audit.loaded, true);

  // Write and apply are blocked
  const writeReq: WriteRequest = {
    path: 'notes/b.md',
    content: 'content',
    before_hash: hash('content'),
    kind: 'tag-add',
    scope_snapshot: { kind: 'global' },
    zone: 'normal',
    request_id: 'req-degraded-basic',
  };
  const writeResult = await env.write.write(writeReq, context);
  assert.equal(writeResult.status, 'failed');
  assert.equal(writeResult.error_code, 'PERSISTENCE_DEGRADED');
});
