import type { RequestContext } from '../application/requestContext';
import type { AuditEvent, AuditWriteStatus } from '../application/contracts';
export interface AuditSink {
  append(event: AuditEvent, context: RequestContext): Promise<void>;
  query(filter: Partial<AuditEvent>, context: RequestContext): Promise<AuditEvent[]>;
  retry?(recordId: string, context: RequestContext): Promise<AuditWriteStatus>;
}
