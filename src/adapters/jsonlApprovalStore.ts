import type { RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import type { PersistenceRestoreReport, PersistenceStoreHealth, RestorablePersistenceStore } from '../ports/persistencePort.ts';

/** JSONL-backed approvals, retaining the first decision for each proposal. */
export class JsonlApprovalStore implements ApprovalStore, RestorablePersistenceStore {
  private readonly records = new Map<string, ApprovalRecord>();
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

  async save(record: ApprovalRecord, context: RequestContext): Promise<void> {
    if (!record.approval_id || !record.proposal_id) throw new Error('valid approval required');
    await this.load(context);
    if (this.records.has(record.proposal_id)) return;
    this.records.set(record.proposal_id, { ...record });
    await this.flush(context);
  }

  async getForProposal(proposalId: string, context: RequestContext): Promise<ApprovalRecord | null> {
    await this.load(context);
    const value = this.records.get(proposalId);
    return value ? { ...value } : null;
  }

  private async load(context: RequestContext): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw = '';
    try { raw = await this.storage.read(context); } catch (error) { this.restoreError = error instanceof Error ? error.message : 'approval restore failed'; return; }
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as ApprovalRecord;
        if (value.approval_id && value.proposal_id && (value.decision === 'approve' || value.decision === 'reject')) this.records.set(value.proposal_id, value);
        else this.skippedRows += 1;
      } catch { this.skippedRows += 1; }
    }
  }

  private async flush(context: RequestContext): Promise<void> {
    const content = [...this.records.values()].map((record) => JSON.stringify(record)).join('\n');
    await this.storage.write(content ? `${content}\n` : '', context);
  }
}
