import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import type { AuditEvent, WriteRequest } from '../src/application/contracts.ts';
import { WriteService } from '../src/services/writeService.ts';
import { DEFAULT_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import type { WritePort } from '../src/ports/writePort.ts';
import type { AuditSink } from '../src/ports/auditSink.ts';

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
  async append(event: AuditEvent, _context: RequestContext): Promise<void> { this.events.push(event); }
  async query(): Promise<AuditEvent[]> { return this.events; }
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function request(beforeHash: string, overrides: Partial<WriteRequest> = {}): WriteRequest {
  return {
    path: 'notes/a.md',
    content: 'after',
    before_hash: beforeHash,
    kind: 'tag-add',
    scope_snapshot: { kind: 'global' },
    zone: 'normal',
    request_id: 'request-body',
    ...overrides,
  };
}

test('feature-off write performs zero writes', async () => {
  const port = new FakeWritePort();
  const audit = new FakeAudit();
  const service = new WriteService(port, audit, undefined, DEFAULT_FEATURE_FLAGS);
  const result = await service.write(request(sha('before')), createRequestContext());
  assert.equal(result.status, 'skipped');
  assert.equal(port.writes, 0);
  assert.equal(audit.events.length, 0);
});

test('hash conflict leaves content unchanged and performs zero writes', async () => {
  const port = new FakeWritePort();
  const audit = new FakeAudit();
  const flags = { ...DEFAULT_FEATURE_FLAGS, new_write_pipeline: true };
  const service = new WriteService(port, audit, undefined, flags);
  const result = await service.write(request(sha('stale')), createRequestContext());
  assert.equal(result.status, 'conflict');
  assert.equal(result.error_code, 'HASH_CONFLICT');
  assert.equal(port.content, 'before');
  assert.equal(port.writes, 0);
});

test('successful write returns after hash and structured audit request context', async () => {
  const port = new FakeWritePort();
  const audit = new FakeAudit();
  const flags = { ...DEFAULT_FEATURE_FLAGS, new_write_pipeline: true };
  const service = new WriteService(port, audit, undefined, flags);
  const context = createRequestContext('workbench-agent');
  const result = await service.write(request(sha('before')), context);
  assert.equal(result.status, 'applied');
  assert.equal(result.after_hash, sha('after'));
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.request_id, context.request_id);
  assert.equal(audit.events[0]?.actor, 'workbench-agent');
  assert.equal(audit.events[0]?.path, 'notes/a.md');
  assert.equal(audit.events[0]?.before_hash, sha('before'));
  assert.equal(audit.events[0]?.after_hash, sha('after'));
  assert.equal(audit.events[0]?.result, 'applied');
});
