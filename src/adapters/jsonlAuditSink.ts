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
    await this.appendAndGetId(event, context);
  }

  /** Appends an event and returns its audit_id so callers can mark it for compensation. */
  async appendAndGetId(event: AuditEvent, context: RequestContext): Promise<string> {
    /* 随机后缀保证同一 request 同一毫秒内的多条事件不会互相覆盖。 */
    const record: AuditRecord = { ...event, audit_id: `${event.request_id}:${event.created_at}:${createRequestId()}` };
    const status = await this.store.append(record, context);
    /* pending-compensation 也抛错：调用方（WriteService）不得把"审计未落盘"报为成功，
       但记录已标记待补偿，可在 UI 通过 retry 恢复。 */
    if (status !== 'success') throw new Error(`audit persistence failed: ${status}`);
    return record.audit_id;
  }

  /** Marks an audit record as pending compensation (secondary mirror failed). */
  markCompensation(auditId: string, context: RequestContext): Promise<import('../application/contracts.ts').AuditWriteStatus> {
    return this.store.markCompensation(auditId, context);
  }

  query(filter: Partial<AuditEvent>, context: RequestContext): Promise<AuditEvent[]> {
    return this.store.query(filter, context);
  }
}
