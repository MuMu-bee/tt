import type { PersistenceRestoreReport, PersistenceStoreHealth } from '../ports/persistencePort';

/** Parses JSONL text into validated records, counting skipped (corrupt) rows. */
export function parseJsonlLines<T>(raw: string, validate: (value: unknown) => boolean): { records: T[]; skippedRows: number } {
	const records: T[] = [];
	let skippedRows = 0;
	for (const line of raw.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (validate(value)) {
				records.push(value as T);
			} else {
				skippedRows += 1;
			}
		} catch {
			skippedRows += 1;
		}
	}
	return { records, skippedRows };
}

/** Builds a restore report; an error marks the store unavailable. */
export function restoreReport(loaded: boolean, skippedRows: number, error?: string): PersistenceRestoreReport {
	return { available: !error, loaded, skipped_rows: skippedRows, ...(error ? { error } : {}) };
}

export function storeHealth(report: PersistenceRestoreReport): PersistenceStoreHealth {
	return { ...report, healthy: report.available && report.loaded };
}
