import type { RequestContext } from '../application/requestContext.ts';
import type { Proposal, ProposalFilter, ProposalStatus } from '../application/contracts.ts';
import type { ProposalStore } from '../ports/proposalPort.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import type { PersistenceRestoreReport, PersistenceStoreHealth, RestorablePersistenceStore } from '../ports/persistencePort.ts';

const TERMINAL_STATUSES: ProposalStatus[] = ['rejected', 'applied', 'conflict', 'expired'];

/** JSONL-backed proposal store. Invalid rows are ignored during recovery. */
export class JsonlProposalStore implements ProposalStore, RestorablePersistenceStore {
  private readonly records = new Map<string, Proposal>();
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

  async save(proposal: Proposal, context: RequestContext): Promise<void> {
    if (!proposal.proposal_id || !proposal.schema_version) throw new Error('valid proposal required');
    await this.load(context);
    this.records.set(proposal.proposal_id, { ...proposal });
    await this.flush(context);
  }

  async get(proposalId: string, context: RequestContext): Promise<Proposal | null> {
    await this.load(context);
    const value = this.records.get(proposalId);
    return value ? { ...value } : null;
  }

  async list(filter: ProposalFilter, context: RequestContext): Promise<Proposal[]> {
    await this.load(context);
    return [...this.records.values()]
      .filter((proposal) => (!filter.status || proposal.status === filter.status)
        && (!filter.target_path || proposal.target_path === filter.target_path)
        && (!filter.request_id || proposal.request_id === filter.request_id))
      .map((proposal) => ({ ...proposal }));
  }

  async updateStatus(proposalId: string, status: ProposalStatus, context: RequestContext): Promise<void> {
    await this.load(context);
    const value = this.records.get(proposalId);
    if (!value) throw new Error('proposal not found');
    if (TERMINAL_STATUSES.includes(value.status) && value.status !== status) {
      throw new Error(`terminal proposal cannot transition: ${value.status}`);
    }
    this.records.set(proposalId, { ...value, status });
    await this.flush(context);
  }

  private async load(context: RequestContext): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw = '';
    try { raw = await this.storage.read(context); } catch (error) { this.restoreError = error instanceof Error ? error.message : 'proposal restore failed'; return; }
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as Proposal;
        if (value.proposal_id && Number.isInteger(value.schema_version)) this.records.set(value.proposal_id, value);
        else this.skippedRows += 1;
      } catch { this.skippedRows += 1; }
    }
  }

  private async flush(context: RequestContext): Promise<void> {
    const content = [...this.records.values()].map((proposal) => JSON.stringify(proposal)).join('\n');
    await this.storage.write(content ? `${content}\n` : '', context);
  }
}
