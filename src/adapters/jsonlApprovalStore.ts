import type { RequestContext } from '../application/requestContext.ts';
import type { ApprovalRecord } from '../application/contracts.ts';
import type { ApprovalStore } from '../ports/approvalPort.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import type { PersistenceRestoreReport, PersistenceStoreHealth, RestorablePersistenceStore } from '../ports/persistencePort.ts';
import { parseJsonlLines, restoreReport, storeHealth } from './jsonl-utils.ts';

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
    return restoreReport(this.loaded, this.skippedRows, this.restoreError);
  }

  async health(context: RequestContext): Promise<PersistenceStoreHealth> {
    return storeHealth(await this.restore(context));
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
    const { records, skippedRows } = parseJsonlLines<ApprovalRecord>(raw, (value): boolean => {
      const candidate = value as ApprovalRecord;
      return Boolean(candidate.approval_id && candidate.proposal_id && (candidate.decision === 'approve' || candidate.decision === 'reject'));
    });
    for (const record of records) this.records.set(record.proposal_id, record);
    this.skippedRows = skippedRows;
  }

  private async flush(context: RequestContext): Promise<void> {
    const content = [...this.records.values()].map((record) => JSON.stringify(record)).join('\n');
    await this.storage.write(content ? `${content}\n` : '', context);
  }
}
