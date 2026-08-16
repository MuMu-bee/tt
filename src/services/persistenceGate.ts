import type { RequestContext } from '../application/requestContext.ts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts.ts';
import type { PersistenceRestoreReport, RestorablePersistenceStore } from '../ports/persistencePort.ts';

export class PersistenceGate {
  private current: PersistenceRuntimeStatus;
  private readonly writeEnabled: () => boolean;

  constructor(writeEnabled: boolean | (() => boolean)) {
    this.writeEnabled = typeof writeEnabled === 'function' ? writeEnabled : () => writeEnabled;
    const unavailable: PersistenceRestoreReport = { available: false, loaded: false, skipped_rows: 0, error: 'persistence not restored' };
    this.current = { restored: false, write_enabled: this.writeEnabled(), degraded: true, stores: { proposals: unavailable, approvals: unavailable, audit: unavailable } };
  }

  async restore(stores: { proposals: RestorablePersistenceStore; approvals: RestorablePersistenceStore; audit: RestorablePersistenceStore }, context: RequestContext): Promise<PersistenceRuntimeStatus> {
    const [proposals, approvals, audit] = await Promise.all([
      stores.proposals.restore(context.child ? context.child() : context),
      stores.approvals.restore(context.child ? context.child() : context),
      stores.audit.restore(context.child ? context.child() : context),
    ]);
    const restored = proposals.loaded && approvals.loaded && audit.loaded;
    const available = proposals.available && approvals.available && audit.available;
    this.current = { restored, write_enabled: this.writeEnabled(), degraded: !restored || !available, stores: { proposals, approvals, audit } };
    return this.current;
  }

  isWritable(): boolean { return this.writeEnabled() && this.current.restored && !this.current.degraded; }
  status(): PersistenceRuntimeStatus { return this.current; }
}
