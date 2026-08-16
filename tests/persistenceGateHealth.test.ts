import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import type { PersistenceRestoreReport, RestorablePersistenceStore } from '../src/ports/persistencePort.ts';
import { PersistenceGate } from '../src/services/persistenceGate.ts';

class FakeRestorableStore implements RestorablePersistenceStore {
  private report: PersistenceRestoreReport;
  constructor(available = true, loaded = true) { this.report = { available, loaded, skipped_rows: 0 }; }
  setFailure() { this.report = { available: false, loaded: false, skipped_rows: 0, error: 'restore failed' }; }
  setSuccess() { this.report = { available: true, loaded: true, skipped_rows: 0 }; }
  async restore() { return { ...this.report }; }
  async health() { return { ...this.report, healthy: this.report.available && this.report.loaded }; }
}

test('persistence gate recovers from degraded to healthy when restore succeeds later', async () => {
  const context = createRequestContext();
  const proposals = new FakeRestorableStore();
  const approvals = new FakeRestorableStore();
  const audit = new FakeRestorableStore();
  const gate = new PersistenceGate(true);

  proposals.setFailure();
  await gate.restore({ proposals, approvals, audit }, context);
  assert.equal(gate.status().degraded, true);
  assert.equal(gate.isWritable(), false);

  /* 存储修复后重新 restore → 恢复可写（degraded -> healthy） */
  proposals.setSuccess();
  await gate.restore({ proposals, approvals, audit }, context);
  assert.equal(gate.status().degraded, false);
  assert.equal(gate.isWritable(), true);
});
