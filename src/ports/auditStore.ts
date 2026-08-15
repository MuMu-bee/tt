import type { RequestContext } from '../application/requestContext.ts';
import type { AuditFilter, AuditRecord, AuditWriteStatus } from '../application/contracts.ts';

export interface AuditStore {
  append(event: AuditRecord, context: RequestContext): Promise<AuditWriteStatus>;
  query(filter: AuditFilter, context: RequestContext): Promise<AuditRecord[]>;
  listPendingCompensation(context: RequestContext): Promise<AuditRecord[]>;
  retry(recordId: string, context: RequestContext): Promise<AuditWriteStatus>;
}
