import type { RequestContext } from '../application/requestContext';
import type { AuditEvent } from '../application/contracts';
import type { AuditSink } from '../ports/auditSink';
export class AuditService { constructor(private readonly sink: AuditSink) {} append(event: AuditEvent, context: RequestContext): Promise<void> { return this.sink.append(event, context); } query(filter: Partial<AuditEvent>, context: RequestContext): Promise<AuditEvent[]> { return this.sink.query(filter, context); } }
