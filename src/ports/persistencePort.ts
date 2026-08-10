import type { RequestContext } from '../application/requestContext.ts';

export interface PersistenceRestoreReport {
  available: boolean;
  loaded: boolean;
  skipped_rows: number;
  error?: string;
}

export interface PersistenceStoreHealth extends PersistenceRestoreReport {
  healthy: boolean;
}

export interface RestorablePersistenceStore {
  restore(context: RequestContext): Promise<PersistenceRestoreReport>;
  health(context: RequestContext): Promise<PersistenceStoreHealth>;
}
