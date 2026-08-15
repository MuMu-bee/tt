import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import { DEFAULT_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import type { AuditEvent, OrganizePlan, WriteRequest } from '../src/application/contracts.ts';
import type { WritePort } from '../src/ports/writePort.ts';
import type { AuditSink } from '../src/ports/auditSink.ts';
import { InMemoryProposalStore } from '../src/adapters/inMemoryProposalStore.ts';
import { InMemoryApprovalStore } from '../src/adapters/inMemoryApprovalStore.ts';
import { InMemoryAuditStore } from '../src/adapters/inMemoryAuditStore.ts';
import { ProposalService } from '../src/services/proposalService.ts';
import { ApprovalService } from '../src/services/approvalService.ts';
import { ProposalApplyService } from '../src/services/proposalApplyService.ts';
import { WriteService } from '../src/services/writeService.ts';

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
  fail = false;

  async append(event: AuditEvent): Promise<void> {
    if (this.fail) throw new Error('audit failed');
    this.events.push({ ...event });
  }

  async query(): Promise<AuditEvent[]> {
    return this.events;
  }
}

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

function setup(zone: 'normal' | 'fiction' | 'unknown' = 'normal') {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const proposalService = new ProposalService(proposals);
  const approvalService = new ApprovalService(proposals, approvals);
  const port = new FakeWritePort();
  const audit = new FakeAuditSink();
  const write = new WriteService(port, audit, undefined, { ...DEFAULT_FEATURE_FLAGS, new_write_pipeline: true });
  const apply = new ProposalApplyService(proposals, approvals, write, port);
  return { proposals, approvals, proposalService, approvalService, port, audit, apply, zone };
}

async function approvedProposal(ctx: ReturnType<typeof createRequestContext>, zone: 'normal' | 'fiction' | 'unknown' = 'normal') {
  const env = setup(zone);
  const [proposal] = await env.proposalService.createFromPlan(plan(zone), ctx);
  assert.ok(proposal);
  await env.approvalService.decide(proposal.proposal_id, 'approve', ctx);
  return { ...env, proposal };
}

test('normal plan proposal approval apply writes once and audits', async () => {
  const context = createRequestContext('workbench-agent');
  const env = await approvedProposal(context);
  const result = await env.apply.apply(env.proposal.proposal_id, context);

  assert.equal(result.status, 'applied');
  assert.equal(result.proposal_status, 'applied');
  assert.equal(env.port.content, 'after');
  assert.equal(env.port.writes, 1);
  assert.equal(env.audit.events.length, 1);
  assert.equal(env.audit.events[0]?.result, 'applied');
});

test('fiction and unknown proposals never write, even after approval', async () => {
  for (const zone of ['fiction', 'unknown'] as const) {
    const env = await approvedProposal(createRequestContext(), zone);
    const result = await env.apply.apply(env.proposal.proposal_id, createRequestContext());
    assert.equal(result.status, 'proposal_only');
    assert.equal(result.error_code, 'FICTION_PROPOSAL_ONLY');
    assert.equal(env.port.writes, 0);
    assert.equal(env.port.content, 'before');
  }
});

test('base hash conflict prevents writes and marks proposal conflict', async () => {
  const env = await approvedProposal(createRequestContext());
  env.port.content = 'changed externally';
  const result = await env.apply.apply(env.proposal.proposal_id, createRequestContext());

  assert.equal(result.status, 'conflict');
  assert.equal(result.error_code, 'HASH_CONFLICT');
  assert.equal(result.proposal_status, 'conflict');
  assert.equal(env.port.writes, 0);
});

test('repeated apply is rejected rather than reported as a successful no-op', async () => {
  const context = createRequestContext();
  const env = await approvedProposal(context);
  await env.apply.apply(env.proposal.proposal_id, context);

  await assert.rejects(
    env.apply.apply(env.proposal.proposal_id, context),
    /already applied|not pending|terminal/i,
  );
});

test('approval decision is idempotent and keeps first decision', async () => {
  const context = createRequestContext();
  const env = setup();
  const [proposal] = await env.proposalService.createFromPlan(plan(), context);
  assert.ok(proposal);
  const first = await env.approvalService.decide(proposal.proposal_id, 'approve', context);
  const second = await env.approvalService.decide(proposal.proposal_id, 'reject', context);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.decision, 'approve');
});

test('write failures are returned as failed and never as applied', async () => {
  const context = createRequestContext();
  const env = await approvedProposal(context);
  env.port.failWrite = true;
  const result = await env.apply.apply(env.proposal.proposal_id, context);

  assert.equal(result.status, 'failed');
  assert.equal(result.error_code, 'WRITE_FAILED');
  assert.equal(result.proposal_status, 'failed');
  assert.equal(env.port.writes, 0);
  assert.equal(env.audit.events[0]?.result, 'failed');
});

test('audit store supports query and pending compensation recovery', async () => {
  const store = new InMemoryAuditStore();
  const context = createRequestContext();
  await store.append({ audit_id: 'a1', request_id: 'r1', proposal_id: 'p1', actor: 'user', action: 'tag-add', path: 'notes/a.md', result: 'pending-compensation', created_at: new Date().toISOString() }, context);
  assert.equal((await store.query({ proposal_id: 'p1' }, context)).length, 1);
  assert.equal((await store.listPendingCompensation(context)).length, 1);
  assert.equal(await store.retry('a1', context), 'success');
  assert.equal((await store.listPendingCompensation(context)).length, 0);
});
