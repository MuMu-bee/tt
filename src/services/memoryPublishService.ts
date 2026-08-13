import { App, normalizePath } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';

export interface MemorySnapshot {
	version: string;
	publishedAt: string;
	noteCount: number;
	paths: string[];
}

export interface HermesAdapter {
	publish(snapshot: MemorySnapshot, context: RequestContext): Promise<void>;
	getLatestVersion(context: RequestContext): Promise<MemorySnapshot | null>;
	rollback(version: string, context: RequestContext): Promise<void>;
}

const SNAPSHOTS_DIR = '_workbench/memory/';

/** Publishes versioned memory snapshots for Hermes to consume. */
export class MemoryPublishService implements HermesAdapter {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	async publish(snapshot: MemorySnapshot, context: RequestContext = createRequestContext('background-task')): Promise<void> {
		await this.app.vault.adapter.mkdir(SNAPSHOTS_DIR);
		const path = normalizePath(`${SNAPSHOTS_DIR}${snapshot.version}.json`);
		await this.app.vault.create(path, JSON.stringify(snapshot, null, 2));
	}

	async getLatestVersion(_context: RequestContext = createRequestContext('background-task')): Promise<MemorySnapshot | null> {
		try {
			const files = await this.app.vault.adapter.list(SNAPSHOTS_DIR);
			const jsonFiles = files.files.filter((f: string) => f.endsWith('.json')).sort().reverse();
			if (jsonFiles.length === 0) return null;
			const content = await this.app.vault.adapter.read(jsonFiles[0] as string);
			return JSON.parse(content) as MemorySnapshot;
		} catch {
			return null;
		}
	}

	async rollback(version: string, _context: RequestContext = createRequestContext('background-task')): Promise<void> {
		/* Keep the snapshot but mark it as rolled back */
		const path = normalizePath(`${SNAPSHOTS_DIR}${version}.json`);
		try {
			const content = await this.app.vault.adapter.read(path);
			const snapshot = JSON.parse(content) as MemorySnapshot;
			(snapshot as unknown as Record<string, unknown>).rolledBackAt = new Date().toISOString();
			await this.app.vault.adapter.write(path, JSON.stringify(snapshot, null, 2));
		} catch {
			throw new Error(`无法回滚版本 ${version}：快照不存在`);
		}
	}

	/** Generates a new snapshot from the current vault state. */
	async generateSnapshot(paths: string[], context: RequestContext = createRequestContext('background-task')): Promise<MemorySnapshot> {
		const version = `v${Date.now()}`;
		return {
			version,
			publishedAt: new Date().toISOString(),
			noteCount: paths.length,
			paths,
		};
	}
}