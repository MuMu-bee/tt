import type { RequestContext } from '../application/requestContext.ts';
import { createRequestId } from '../application/requestContext.ts';
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
    /* 随机后缀保证同一 request 同一毫秒内的多条事件不会互相覆盖。 */
    const record: AuditRecord = { ...event, audit_id: `${event.request_id}:${event.created_at}:${createRequestId()}` };
    const status = await this.store.append(record, context);
    if (status !== 'success') throw new Error(`audit persistence failed: ${status}`);
  }

  query(filter: Partial<AuditEvent>, context: RequestContext): Promise<AuditEvent[]> {
    return this.store.query(filter, context);
  }
}
