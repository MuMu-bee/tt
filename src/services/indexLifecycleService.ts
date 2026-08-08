import type { RequestContext } from '../application/requestContext';
import { createRequestContext } from '../application/requestContext.ts';
import type { IndexPort } from '../ports/indexPort';
import type { VaultReaderPort } from '../ports/vaultReaderPort';
import { parseVaultDocument } from '../domain/vault-document.ts';

export type IndexLifecycleStatus = 'rebuilding' | 'ready' | 'failed';
export interface IndexLifecycleState {
	status: IndexLifecycleStatus;
	count: number;
	error?: string;
}

/** Returns whether a Vault path is a Markdown note eligible for indexing. */
export function isMarkdownPath(path: string): boolean {
	return path.toLocaleLowerCase().endsWith('.md');
}

/** Coordinates safe full and incremental index updates without writing Vault. */
export class IndexLifecycleService {
	private state: IndexLifecycleState = { status: 'failed', count: 0 };
	private rebuildPromise: Promise<void> | null = null;
	private readonly pathQueues = new Map<string, Promise<void>>();
	private indexedPaths = new Set<string>();

	private readonly reader: VaultReaderPort;
	private readonly index: IndexPort;

	constructor(reader: VaultReaderPort, index: IndexPort) {
		this.reader = reader;
		this.index = index;
	}

	getState(): IndexLifecycleState { return { ...this.state }; }

	async rebuild(context: RequestContext = createRequestContext('background-task')): Promise<void> {
		if (this.rebuildPromise) return this.rebuildPromise;
		const previous = this.state;
		this.state = { status: 'rebuilding', count: previous.count };
		this.rebuildPromise = this.runRebuild(context, previous).finally(() => { this.rebuildPromise = null; });
		return this.rebuildPromise;
	}

	async create(path: string, context?: RequestContext): Promise<void> {
		return this.enqueue(path, () => this.withIncrementalFailureState(() => this.upsert(path, context)));
	}
	async modify(path: string, context?: RequestContext): Promise<void> {
		return this.enqueue(path, () => this.withIncrementalFailureState(() => this.upsert(path, context)));
	}
	async delete(path: string, context: RequestContext = createRequestContext('background-task')) {
		return this.enqueue(path, () => this.withIncrementalFailureState(async () => {
			await this.index.invalidate(path, context);
			if (this.indexedPaths.delete(path)) this.updateReadyCount(-1);
		}));
	}
	async rename(oldPath: string, newPath: string, context: RequestContext = createRequestContext('background-task')) {
		const key = `${oldPath}=>${newPath}`;
		return this.enqueue(key, () => this.withIncrementalFailureState(async () => {
			await this.index.invalidate(oldPath, context);
			if (this.indexedPaths.delete(oldPath)) this.updateReadyCount(-1);
			await this.upsert(newPath, context);
		}));
	}

	private async runRebuild(context: RequestContext, previous: IndexLifecycleState): Promise<void> {
		try {
			const paths = await this.reader.listMarkdownPaths(context);
			const documents = [];
			for (const path of paths) {
				if (isMarkdownPath(path)) documents.push(parseVaultDocument(path, await this.reader.readMarkdown(path, context)));
			}
			await this.indexBuildAll(documents, context);
			this.indexedPaths = new Set(documents.map((document) => document.path));
			this.state = { status: 'ready', count: this.indexedPaths.size };
		} catch (error) {
			this.state = { status: 'failed', count: previous.count, error: error instanceof Error ? error.message : '索引重建失败' };
			throw error;
		}
	}

	private async indexBuildAll(documents: ReturnType<typeof parseVaultDocument>[], context: RequestContext): Promise<void> {
		const rebuildable = this.index as IndexPort & { buildAll?: (docs: typeof documents, ctx: RequestContext) => Promise<void> };
		if (!rebuildable.buildAll) throw new Error('索引不支持全量重建');
		await rebuildable.buildAll(documents, context);
	}

	private async withIncrementalFailureState(operation: () => Promise<void>): Promise<void> {
		try {
			await operation();
		} catch (error) {
			this.state = {
				status: 'failed',
				count: this.indexedPaths.size,
				error: error instanceof Error ? error.message : '增量索引更新失败',
			};
			throw error;
		}
	}

	private async upsert(path: string, context = createRequestContext('background-task')): Promise<void> {
		if (!isMarkdownPath(path)) return;
		const file = await this.reader.readMarkdown(path, context);
		const upsertable = this.index as IndexPort & { upsert?: (doc: ReturnType<typeof parseVaultDocument>, ctx: RequestContext) => Promise<void> };
		if (!upsertable.upsert) throw new Error('索引不支持增量更新');
		await upsertable.upsert(parseVaultDocument(path, file), context);
		const wasIndexed = this.indexedPaths.has(path);
		this.indexedPaths.add(path);
		this.state = { status: 'ready', count: wasIndexed ? this.state.count : this.state.count + 1 };
	}

	private enqueue(key: string, operation: () => Promise<void>): Promise<void> {
		const previous = this.pathQueues.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation).finally(() => {
			if (this.pathQueues.get(key) === next) this.pathQueues.delete(key);
		});
		this.pathQueues.set(key, next);
		return next;
	}

	private updateReadyCount(delta: number): void {
		this.state = { status: 'ready', count: Math.max(0, this.state.count + delta) };
	}
}
