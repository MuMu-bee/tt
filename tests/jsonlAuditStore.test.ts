import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import type { AuditRecord } from '../src/application/contracts.ts';
import type { JsonlTextStorage } from '../src/adapters/jsonlStorage.ts';
import { JsonlAuditStore } from '../src/adapters/jsonlAuditStore.ts';

/** In-memory JSONL storage simulating one file. */
class MemoryJsonlStorage implements JsonlTextStorage {
  private content = '';
  failWrite = false;
  constructor(initial = '') { this.content = initial; }
  async read() { return this.content; }
  async write(value: string) {
    if (this.failWrite) throw new Error('write failed');
    this.content = value;
  }
  get() { return this.content; }
}

function auditRecord(id: string): AuditRecord {
  return {
    audit_id: id,
    request_id: 'req-' + id,
    actor: 'user',
    action: 'tag-add',
    path: 'notes/a.md',
    result: 'applied',
    created_at: new Date().toISOString(),
  };
}

test('jsonl audit store: append success persists and is queryable', async () => {
  const storage = new MemoryJsonlStorage();
  const store = new JsonlAuditStore(storage);
  const context = createRequestContext();
  const status = await store.append(auditRecord('a1'), context);
  assert.equal(status, 'success');
  const records = await store.query({ audit_id: 'a1' }, context);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.audit_id, 'a1');
});

test('jsonl audit store: flush failure returns pending-compensation and retry recovers', async () => {
  const storage = new MemoryJsonlStorage();
  const store = new JsonlAuditStore(storage);
  const context = createRequestContext();
  storage.failWrite = true;
  const status = await store.append(auditRecord('a2'), context);
  assert.equal(status, 'pending-compensation');
  const pending = await store.listPendingCompensation(context);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.audit_id, 'a2');
  /* 存储恢复后重试成功并清除待补偿标记 */
  storage.failWrite = false;
  const retried = await store.retry('a2', context);
  assert.equal(retried, 'success');
  assert.equal((await store.listPendingCompensation(context)).length, 0);
});

test('jsonl audit store: markCompensation flags a record and retry clears it', async () => {
  const storage = new MemoryJsonlStorage();
  const store = new JsonlAuditStore(storage);
  const context = createRequestContext();
  await store.append(auditRecord('a3'), context);
  const marked = await store.markCompensation('a3', context);
  assert.equal(marked, 'success');
  assert.equal((await store.listPendingCompensation(context)).length, 1);
  await store.retry('a3', context);
  assert.equal((await store.listPendingCompensation(context)).length, 0);
});

test('jsonl audit store: restore skips corrupt rows and keeps valid ones', async () => {
  const storage = new MemoryJsonlStorage(JSON.stringify(auditRecord('ok1')) + '\n{{{broken json{{{\n');
  const store = new JsonlAuditStore(storage);
  const context = createRequestContext();
  const report = await store.restore(context);
  assert.equal(report.loaded, true);
  assert.equal(report.skipped_rows, 1);
  assert.equal((await store.query({}, context)).length, 1);
});
