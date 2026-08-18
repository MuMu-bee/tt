import type { RequestContext } from '../application/requestContext.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';
import type { PersistenceRestoreReport, PersistenceStoreHealth, RestorablePersistenceStore } from '../ports/persistencePort.ts';
import { parseJsonlLines, restoreReport, storeHealth } from './jsonl-utils.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

/**
 * Base class for append/rewrite JSONL stores that need strict serialization.
 *
 * Every public store operation runs through withStore, which:
 *   1. loads the file at most once (and only flips loaded after a successful
 *      read + parse — never before the await completes), and
 *   2. serializes read-modify-write cycles through a SerialQueue.
 *
 * If loading fails, the enqueued operation is rejected instead of proceeding
 * with an empty in-memory map, which prevents a transient read error from
 * flushing an empty file and destroying persisted records.
 */
export abstract class SerializedJsonlStore<T> implements RestorablePersistenceStore {
	protected readonly records = new Map<string, T>();
	protected readonly storage: JsonlTextStorage;
	private loaded = false;
	private loadPromise: Promise<void> | null = null;
	private skippedRows = 0;
	private restoreError: string | undefined;
	private readonly queue = new SerialQueue();

	constructor(storage: JsonlTextStorage) {
		this.storage = storage;
	}

	async restore(context: RequestContext): Promise<PersistenceRestoreReport> {
		try {
			await this.load(context);
		} catch (error) {
			this.restoreError = error instanceof Error ? error.message : 'restore failed';
		}
		return restoreReport(this.loaded, this.skippedRows, this.restoreError);
	}

	async health(context: RequestContext): Promise<PersistenceStoreHealth> {
		return storeHealth(await this.restore(context));
	}

	/** Runs one operation after loading, inside the store's serial queue. */
	protected withStore<R>(context: RequestContext, operation: () => Promise<R>): Promise<R> {
		return this.queue.run(async () => {
			await this.load(context);
			return operation();
		});
	}

	/** Rewrites the whole file from the in-memory map. */
	protected async flush(context: RequestContext): Promise<void> {
		const content = [...this.records.values()].map((record) => JSON.stringify(record)).join('\n');
		await this.storage.write(content ? content + '\n' : '', context);
	}

	/** Stable key used to deduplicate records in the in-memory map. */
	protected abstract keyOf(record: T): string;

	/** Row validation used during JSONL recovery. */
	protected abstract validate(value: unknown): boolean;

	private load(context: RequestContext): Promise<void> {
		if (this.loaded) return Promise.resolve();
		if (!this.loadPromise) {
			this.loadPromise = this.doLoad(context)
				.catch((error) => {
					this.restoreError = error instanceof Error ? error.message : 'restore failed';
					this.loaded = false;
					throw error;
				})
				.finally(() => {
					this.loadPromise = null;
				});
		}
		return this.loadPromise;
	}

	private async doLoad(context: RequestContext): Promise<void> {
		const raw = await this.storage.read(context);
		const { records, skippedRows } = parseJsonlLines<T>(raw, (value) => this.validate(value));
		this.records.clear();
		for (const record of records) this.records.set(this.keyOf(record), record);
		this.skippedRows = skippedRows;
		this.loaded = true;
	}
}
