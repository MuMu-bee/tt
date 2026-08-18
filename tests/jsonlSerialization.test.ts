import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import { DEFAULT_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import type { ApprovalRecord, AuditEvent, AuditRecord, Proposal, WriteRequest } from '../src/application/contracts.ts';
import type { WritePort } from '../src/ports/writePort.ts';
import type { AuditSink } from '../src/ports/auditSink.ts';
import type { JsonlTextStorage } from '../src/adapters/jsonlStorage.ts';
import { JsonlProposalStore } from '../src/adapters/jsonlProposalStore.ts';
import { JsonlAuditStore } from '../src/adapters/jsonlAuditStore.ts';
import { InMemoryProposalStore } from '../src/adapters/inMemoryProposalStore.ts';
import { InMemoryApprovalStore } from '../src/adapters/inMemoryApprovalStore.ts';
import { ApprovalService } from '../src/services/approvalService.ts';
import { WriteService } from '../src/services/writeService.ts';
import { parseYamlFrontmatter } from '../src/domain/vault-document.ts';

/* ------------------------------------------------------------------ */
/*  Fakes                                                              */
/* ------------------------------------------------------------------ */

class FakeStorage implements JsonlTextStorage {
	content = '';
	failRead = false;
	failWrite = false;
	delayMs = 0;

	async read(_context: RequestContext): Promise<string> {
		if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		if (this.failRead) throw new Error('read failed');
		return this.content;
	}

	async write(value: string, _context: RequestContext): Promise<void> {
		if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		if (this.failWrite) throw new Error('write failed');
		this.content = value;
	}
}

class FakeWritePort implements WritePort {
	content = 'before';
	writes = 0;

	async read(_path: string, _context: RequestContext): Promise<string> { return this.content; }
	async writeAtomic(_path: string, content: string, _context: RequestContext): Promise<void> {
		this.writes += 1;
		this.content = content;
	}
}

class FakeAudit implements AuditSink {
	events: AuditEvent[] = [];
	async append(event: AuditEvent, _context: RequestContext): Promise<void> { this.events.push({ ...event }); }
	async query(_filter: Partial<AuditEvent>, _context: RequestContext): Promise<AuditEvent[]> { return this.events; }
}

function proposal(id: string): Proposal {
	return {
		proposal_id: id,
		request_id: 'request-' + id,
		target_path: 'notes/' + id + '.md',
		target_zone: 'normal',
		change_kind: 'tag-add',
		base_hash: 'abc',
		before: 'before',
		after: 'after',
		diff: '+tag',
		reason: 'test',
		created_at: new Date().toISOString(),
		status: 'pending',
		requires_approval: true,
		schema_version: 1,
	};
}

/* ------------------------------------------------------------------ */
/*  JSONL serialization + recovery                                     */
/* ------------------------------------------------------------------ */

test('concurrent proposal saves are serialized and never lose records', async () => {
	const storage = new FakeStorage();
	storage.delayMs = 2;
	const store = new JsonlProposalStore(storage);
	const context = createRequestContext('user');

	await Promise.all(Array.from({ length: 20 }, (_, index) => store.save(proposal('p' + index), context)));

	const all = await store.list({}, context);
	assert.equal(all.length, 20);
	// The final file must contain exactly 20 non-empty JSON lines.
	assert.equal(storage.content.trim().split('\n').length, 20);
});

test('read failure does not mark the store loaded or flush an empty file', async () => {
	const storage = new FakeStorage();
	const seed = proposal('existing');
	storage.content = JSON.stringify(seed) + '\n';
	const store = new JsonlProposalStore(storage);
	const context = createRequestContext('user');

	storage.failRead = true;
	await assert.rejects(store.save(proposal('p-new'), context), /read failed/);
	assert.equal(storage.content, JSON.stringify(seed) + '\n');

	storage.failRead = false;
	const existing = await store.get('existing', context);
	assert.ok(existing);
	assert.equal(existing.proposal_id, 'existing');
});

test('audit retry keeps pending-compensation state when flush fails', async () => {
	const storage = new FakeStorage();
	const store = new JsonlAuditStore(storage);
	const context = createRequestContext('user');
	const record: AuditRecord = {
		audit_id: 'a1',
		request_id: 'r1',
		actor: 'user',
		action: 'tag-add',
		path: 'notes/a.md',
		result: 'pending-compensation',
		created_at: new Date().toISOString(),
		compensation: true,
	};

	assert.equal(await store.append(record, context), 'success');
	storage.failWrite = true;
	assert.equal(await store.retry('a1', context), 'failed');

	// Failed flush must roll back the in-memory state change.
	storage.failWrite = false;
	assert.equal((await store.listPendingCompensation(context)).length, 1);

	assert.equal(await store.retry('a1', context), 'success');
	assert.equal((await store.listPendingCompensation(context)).length, 0);
});

/* ------------------------------------------------------------------ */
/*  Approval reconciliation                                            */
/* ------------------------------------------------------------------ */

test('approval reconcile repairs a proposal left pending after a failed sync', async () => {
	const proposals = new InMemoryProposalStore();
	const approvals = new InMemoryApprovalStore();
	const service = new ApprovalService(proposals, approvals);
	const context = createRequestContext('user');

	await proposals.save(proposal('p1'), context);
	const decision: ApprovalRecord = {
		approval_id: 'a1',
		proposal_id: 'p1',
		request_id: context.request_id,
		decision: 'approve',
		actor: 'user',
		decided_at: new Date().toISOString(),
	};
	await approvals.save(decision, context);

	const fixed = await service.reconcile(context);
	assert.equal(fixed, 1);
	assert.equal((await proposals.get('p1', context))?.status, 'approved');
});

/* ------------------------------------------------------------------ */
/*  Write scope authorization                                          */
/* ------------------------------------------------------------------ */

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function writeRequest(overrides: Partial<WriteRequest>): WriteRequest {
	return {
		path: 'notes/a.md',
		content: 'after',
		before_hash: 'ignored',
		kind: 'tag-add',
		scope_snapshot: { kind: 'global' },
		zone: 'normal',
		request_id: 'write-scope-test',
		...overrides,
	};
}

function writeService(port: FakeWritePort): { service: WriteService; audit: FakeAudit } {
	const audit = new FakeAudit();
	const flags = { ...DEFAULT_FEATURE_FLAGS, new_write_pipeline: true };
	const service = new WriteService(port, audit, undefined, flags);
	return { service, audit };
}

test('write denies a prefix scope that does not cover the target path', async () => {
	const port = new FakeWritePort();
	port.content = 'before';
	const { service } = writeService(port);
	const result = await service.write(writeRequest({ before_hash: sha(port.content), scope_snapshot: { kind: 'prefix', value: 'note' } }), createRequestContext());
	assert.equal(result.status, 'failed');
	assert.equal(result.error_code, 'SCOPE_DENIED');
	assert.equal(port.writes, 0);
});

test('write denies when the target is outside an includes whitelist', async () => {
	const port = new FakeWritePort();
	port.content = 'before';
	const { service } = writeService(port);
	const result = await service.write(writeRequest({ before_hash: sha(port.content), scope_snapshot: { kind: 'prefix', value: 'notes', includes: ['Other/'] } }), createRequestContext());
	assert.equal(result.status, 'failed');
	assert.equal(result.error_code, 'SCOPE_DENIED');
	assert.equal(port.writes, 0);
});

test('write honors tag scope from the actual note content', async () => {
	const port = new FakeWritePort();
	port.content = '---\ntags:\n  - work\n---\nbody';
	const { service } = writeService(port);
	const allowed = await service.write(writeRequest({ before_hash: sha(port.content), scope_snapshot: { kind: 'tag', value: 'work' } }), createRequestContext());
	assert.equal(allowed.status, 'applied');

	const port2 = new FakeWritePort();
	port2.content = '---\ntags:\n  - work\n---\nbody';
	const { service: service2 } = writeService(port2);
	const denied = await service2.write(writeRequest({ before_hash: sha(port2.content), scope_snapshot: { kind: 'tag', value: 'personal' } }), createRequestContext());
	assert.equal(denied.status, 'failed');
	assert.equal(denied.error_code, 'SCOPE_DENIED');
	assert.equal(port2.writes, 0);
});

/* ------------------------------------------------------------------ */
/*  YAML inline comments                                               */
/* ------------------------------------------------------------------ */

test('yaml scalars strip trailing inline comments but keep URL fragments', () => {
	const parsed = parseYamlFrontmatter('---\nzone: fiction # comment\ncount: 3 # three\nurl: http://example.com/a#frag\n---\nbody');
	assert.equal(parsed.frontmatter.zone, 'fiction');
	assert.equal(parsed.frontmatter.count, 3);
	assert.equal(parsed.frontmatter.url, 'http://example.com/a#frag');
});
