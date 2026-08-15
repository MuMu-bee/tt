import type { PersistenceRestoreReport } from '../ports/persistencePort.ts';

export interface PersistenceRuntimeStatus {
  restored: boolean;
  write_enabled: boolean;
  degraded: boolean;
  stores: {
    proposals: PersistenceRestoreReport;
    approvals: PersistenceRestoreReport;
    audit: PersistenceRestoreReport;
  };
}

export interface PersistenceGate {
  isWritable(): boolean;
  status(): PersistenceRuntimeStatus;
}
