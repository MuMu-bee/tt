import type { RequestContext } from '../application/requestContext.ts';
import type { AuditFilter, AuditRecord, AuditWriteStatus } from '../application/contracts.ts';
import type { AuditStore } from '../ports/auditStore.ts';

export class InMemoryAuditStore implements AuditStore {
  private readonly records = new Map<string, AuditRecord>();
  async append(event: AuditRecord, _context: RequestContext): Promise<AuditWriteStatus> { this.records.set(event.audit_id, { ...event }); return 'success'; }
  async query(filter: AuditFilter, _context: RequestContext): Promise<AuditRecord[]> { return [...this.records.values()].filter((e) => (!filter.request_id || e.request_id === filter.request_id) && (!filter.proposal_id || e.proposal_id === filter.proposal_id) && (!filter.path || e.path === filter.path) && (!filter.result || e.result === filter.result)).map((e) => ({ ...e })); }
  async listPendingCompensation(_context: RequestContext): Promise<AuditRecord[]> { return [...this.records.values()].filter((e) => e.result === 'pending-compensation').map((e) => ({ ...e })); }
  async retry(recordId: string, _context: RequestContext): Promise<AuditWriteStatus> { const event = this.records.get(recordId); if (!event) return 'failed'; this.records.set(recordId, { ...event, result: 'success', compensation: false }); return 'success'; }
}
