import type { RequestContext } from '../application/requestContext.ts';
import type { AuditFilter, AuditRecord, AuditWriteStatus } from '../application/contracts.ts';
import type { AuditStore } from '../ports/auditStore.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import type { PersistenceRestoreReport, PersistenceStoreHealth, RestorablePersistenceStore } from '../ports/persistencePort.ts';

/** JSONL-backed audit store with query and compensation retry support. */
export class JsonlAuditStore implements AuditStore, RestorablePersistenceStore {
  private readonly records = new Map<string, AuditRecord>();
  private loaded = false;
  private skippedRows = 0;
  private restoreError: string | undefined;

  private readonly storage: JsonlTextStorage;

  constructor(storage: JsonlTextStorage) {
    this.storage = storage;
  }

  async restore(context: RequestContext): Promise<PersistenceRestoreReport> {
    await this.load(context);
    return { available: !this.restoreError, loaded: this.loaded, skipped_rows: this.skippedRows, ...(this.restoreError ? { error: this.restoreError } : {}) };
  }

  async health(context: RequestContext): Promise<PersistenceStoreHealth> {
    const report = await this.restore(context);
    return { ...report, healthy: report.available && report.loaded };
  }

  async append(event: AuditRecord, context: RequestContext): Promise<AuditWriteStatus> {
    const record: AuditRecord = {
      ...event,
      audit_id: event.audit_id || `${event.request_id}:${event.created_at}`,
    };
    if (!record.audit_id) return 'failed';
    await this.load(context);
    this.records.set(record.audit_id, { ...record });
    try {
      await this.flush(context);
      return 'success';
    } catch {
      return 'failed';
    }
  }

  async query(filter: AuditFilter | Partial<AuditRecord>, context: RequestContext): Promise<AuditRecord[]> {
    await this.load(context);
    return [...this.records.values()]
      .filter((event) => (!filter.request_id || event.request_id === filter.request_id)
        && (!filter.proposal_id || event.proposal_id === filter.proposal_id)
        && (!filter.path || event.path === filter.path)
        && (!filter.result || event.result === filter.result))
      .map((event) => ({ ...event }));
  }

  async listPendingCompensation(context: RequestContext): Promise<AuditRecord[]> {
    return this.query({ result: 'pending-compensation' }, context);
  }

  async retry(recordId: string, context: RequestContext): Promise<AuditWriteStatus> {
    await this.load(context);
    const event = this.records.get(recordId);
    if (!event) return 'failed';
    this.records.set(recordId, { ...event, result: 'success', compensation: false });
    try {
      await this.flush(context);
      return 'success';
    } catch {
      return 'failed';
    }
  }

  private async load(context: RequestContext): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw = '';
    try { raw = await this.storage.read(context); } catch (error) { this.restoreError = error instanceof Error ? error.message : 'audit restore failed'; return; }
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as AuditRecord;
        if (value.audit_id && value.request_id && value.created_at) this.records.set(value.audit_id, value);
        else this.skippedRows += 1;
      } catch { this.skippedRows += 1; }
    }
  }

  private async flush(context: RequestContext): Promise<void> {
    const content = [...this.records.values()].map((event) => JSON.stringify(event)).join('\n');
    await this.storage.write(content ? `${content}\n` : '', context);
  }
}
