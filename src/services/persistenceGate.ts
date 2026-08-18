import type { RequestContext } from '../application/requestContext.ts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts.ts';
import type { PersistenceRestoreReport, RestorablePersistenceStore } from '../ports/persistencePort.ts';

export class PersistenceGate {
  private current: PersistenceRuntimeStatus;

  constructor(writeEnabled: boolean) {
    const unavailable: PersistenceRestoreReport = { available: false, loaded: false, skipped_rows: 0, error: 'persistence not restored' };
    this.current = { restored: false, write_enabled: writeEnabled, degraded: true, stores: { proposals: unavailable, approvals: unavailable, audit: unavailable } };
  }

  async restore(stores: { proposals: RestorablePersistenceStore; approvals: RestorablePersistenceStore; audit: RestorablePersistenceStore }, context: RequestContext): Promise<PersistenceRuntimeStatus> {
    const [proposals, approvals, audit] = await Promise.all([
      stores.proposals.restore(context.child ? context.child() : context),
      stores.approvals.restore(context.child ? context.child() : context),
      stores.audit.restore(context.child ? context.child() : context),
    ]);
    const restored = proposals.loaded && approvals.loaded && audit.loaded;
    const available = proposals.available && approvals.available && audit.available;
    this.current = { restored, write_enabled: this.current.write_enabled, degraded: !restored || !available, stores: { proposals, approvals, audit } };
    return this.current;
  }

  isWritable(): boolean { return this.current.write_enabled && this.current.restored && !this.current.degraded; }

  /** Persistence layer is restored and healthy, independent of the proposal write flag. Generated-content writes use this gate. */
  isPersistenceReady(): boolean { return this.current.restored && !this.current.degraded; }

  status(): PersistenceRuntimeStatus { return this.current; }
}
