import type { RequestContext } from '../application/requestContext.ts';
import type { AuditEvent, AuditRecord } from '../application/contracts.ts';
import type { AuditSink } from '../ports/auditSink.ts';
import { JsonlAuditStore } from './jsonlAuditStore.ts';

/** AuditSink facade over the durable AuditStore. */
export class JsonlAuditSink implements AuditSink {
  private readonly store: JsonlAuditStore;

  constructor(store: JsonlAuditStore) {
    this.store = store;
  }

  async append(event: AuditEvent, context: RequestContext): Promise<void> {
    const record: AuditRecord = { ...event, audit_id: `${event.request_id}:${event.created_at}` };
    const status = await this.store.append(record, context);
    if (status !== 'success') throw new Error(`audit persistence failed: ${status}`);
  }

  query(filter: Partial<AuditEvent>, context: RequestContext): Promise<AuditEvent[]> {
    return this.store.query(filter, context);
  }
}
