import type { RequestContext } from '../application/requestContext.ts';
import type { RefreshStatus, SearchScope } from '../application/contracts.ts';
import { allowsPath } from '../application/scopeUtils.ts';
import type { IndexHit, IndexPort } from '../ports/indexPort.ts';
import type { VaultReaderPort } from '../ports/vaultReaderPort.ts';
import { createKeywordEntry, searchKeywordEntries, type KeywordIndexEntry, type KeywordSearchResult } from '../domain/keyword-search.ts';
import { parseVaultDocument, type VaultDocument } from '../domain/vault-document.ts';

export interface YieldHook {
	(): Promise<void>;
}

/** Pure in-memory derived index. It only reads through VaultReaderPort and never writes Vault. */
export class InMemoryVaultIndex implements IndexPort {
	private readonly entries = new Map<string, KeywordIndexEntry>();
	private ready = false;
	private readonly vault: VaultReaderPort;
	private readonly yieldHook: YieldHook;
	private readonly batchSize: number;

	constructor(vault: VaultReaderPort, yieldHook: YieldHook = async (): Promise<void> => {
		await Promise.resolve();
	}, batchSize: number = 32) {
		this.vault = vault;
		this.yieldHook = yieldHook;
		this.batchSize = Math.max(1, batchSize);
	}

	async buildAll(documents: VaultDocument[], _context: RequestContext): Promise<void> {
		// Build off to the side and swap only after every document has been indexed.
		// This preserves the previous ready index if parsing/yielding fails midway.
		const nextEntries = new Map<string, KeywordIndexEntry>();
		for (let index = 0; index < documents.length; index += 1) {
			const document = documents[index];
			if (document) nextEntries.set(document.path, createKeywordEntry(document));
			if ((index + 1) % this.batchSize === 0) await this.yieldHook();
		}
		this.entries.clear();
		nextEntries.forEach((entry, path) => this.entries.set(path, entry));
		this.ready = true;
	}

	async upsert(document: VaultDocument, _context: RequestContext): Promise<void> {
		this.entries.set(document.path, createKeywordEntry(document));
		this.ready = true;
	}

	async remove(path: string, _context: RequestContext): Promise<void> {
		this.entries.delete(path);
	}

	async rebuild(context: RequestContext): Promise<RefreshStatus> {
		const paths = await this.vault.listMarkdownPaths(context);
		const documents: VaultDocument[] = [];
		for (let index = 0; index < paths.length; index += 1) {
			const path = paths[index];
			if (!path || !path.toLocaleLowerCase().endsWith('.md')) continue;
			const raw = await this.vault.readMarkdown(path, context);
			documents.push(parseVaultDocument(path, raw));
			if ((index + 1) % this.batchSize === 0) await this.yieldHook();
		}
		await this.buildAll(documents, context);
		return { status: 'succeeded', paths: documents.map((document) => document.path) };
	}

	async search(query: string, context: RequestContext): Promise<KeywordSearchResult[]>;
	async search(query: string, options: Record<string, unknown>, context: RequestContext): Promise<IndexHit[]>;
	async search(query: string, optionsOrContext: Record<string, unknown> | RequestContext, maybeContext?: RequestContext): Promise<KeywordSearchResult[] | IndexHit[]> {
		const context = maybeContext ?? optionsOrContext as RequestContext;
		if (!this.ready) await this.rebuild(context);
		const results = searchKeywordEntries(this.entries.values(), query);
		if (maybeContext) {
			const options = optionsOrContext as Record<string, unknown>;
			const scope = this.readScope(options.scope);
			return results
				.filter((result) => !scope || this.allowsScope(result.path, scope))
				.map((result) => ({ path: result.path, title: result.title, snippet: result.snippet, score: result.score, matched_fields: result.matched_fields, source: result.source, raw_hash: result.raw_hash, open_path: result.open_path }));
		}
		return results;
	}

	private readScope(value: unknown): SearchScope | undefined {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
		const candidate = value as Record<string, unknown>;
		if (candidate.kind !== 'global' && candidate.kind !== 'prefix' && candidate.kind !== 'tag' && candidate.kind !== 'file') return undefined;
		return {
			kind: candidate.kind,
			...(typeof candidate.value === 'string' ? { value: candidate.value } : {}),
			...(Array.isArray(candidate.includes) ? { includes: candidate.includes.filter((item): item is string => typeof item === 'string') } : {}),
			excludes: Array.isArray(candidate.excludes) ? candidate.excludes.filter((item): item is string => typeof item === 'string') : [],
		};
	}

	private allowsScope(path: string, scope: SearchScope): boolean {
		if (!allowsPath(path, scope)) return false;
		if (scope.kind === 'tag') return this.entries.get(path)?.document.tags.includes(scope.value ?? '') ?? false;
		return true;
	}

	async invalidate(path: string, context: RequestContext): Promise<void> {
		await this.remove(path, context);
	}

	availability(): 'ready' | 'unavailable' {
		return this.ready ? 'ready' : 'unavailable';
	}

	/** Removes only derived memory; callers can recover by invoking rebuild. */
	clearDerivedIndex(): void {
		this.entries.clear();
		this.ready = false;
	}

	/** Returns graph data (nodes + edges) from indexed documents for knowledge graph. */
	getGraphData(): { nodes: Array<{ id: string; title: string; type: string; degree: number }>; edges: Array<{ source: string; target: string }>; stats: { nodeCount: number; edgeCount: number; isolatedCount: number } } {
		const nodes: Array<{ id: string; title: string; type: string; degree: number }> = [];
		const degreeMap = new Map<string, number>();
		const edgeSet = new Set<string>();
		const edges: Array<{ source: string; target: string }> = [];

		this.entries.forEach((entry, path) => {
			const doc = entry.document;
			const type = path.startsWith('Wiki') || path.startsWith('wiki') ? 'wiki'
				: path.startsWith('Raw') || path.startsWith('raw') ? 'raw'
				: path.startsWith('Inbox') || path.startsWith('inbox') ? 'inbox'
				: 'note';
			nodes.push({ id: path, title: doc.title, type, degree: 0 });
			degreeMap.set(path, 0);
		});

		const { byPath, byTitle } = this.buildLinkResolvers();
		this.entries.forEach((entry, path) => {
			const links = entry.document.links;
			if (!links) return;
			links.forEach((link) => {
				const target = this.resolveLink(link, byPath, byTitle);
				if (target && degreeMap.has(path) && degreeMap.has(target)) {
					const key = path < target ? `${path}::${target}` : `${target}::${path}`;
					if (!edgeSet.has(key)) {
						edgeSet.add(key);
						degreeMap.set(path, (degreeMap.get(path) ?? 0) + 1);
						degreeMap.set(target, (degreeMap.get(target) ?? 0) + 1);
					}
				}
			});
		});

		nodes.forEach((n) => { n.degree = degreeMap.get(n.id) ?? 0; });
		edgeSet.forEach((key) => {
			const [s, t] = key.split('::');
			if (s && t) edges.push({ source: s, target: t });
		});

		const isolatedCount = nodes.filter((n) => n.degree === 0).length;
		return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length, isolatedCount } };
	}

	private buildLinkResolvers(): { byPath: Map<string, string>; byTitle: Map<string, string> } {
		const byPath = new Map<string, string>();
		const byTitle = new Map<string, string>();
		this.entries.forEach((entry, path) => {
			const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
			const setPath = (key: string): void => {
				if (key && !byPath.has(key)) byPath.set(key, path);
			};
			setPath(normalizedPath);
			if (normalizedPath.endsWith('.md')) setPath(normalizedPath.slice(0, -3));
			const basename = path.replace(/\\/g, '/').split('/').pop() ?? path;
			const normalizedBase = basename.toLowerCase();
			setPath(normalizedBase);
			if (normalizedBase.endsWith('.md')) setPath(normalizedBase.slice(0, -3));
			const title = entry.document.title.toLowerCase();
			if (title && !byTitle.has(title)) byTitle.set(title, path);
		});
		return { byPath, byTitle };
	}

	private resolveLink(link: string, byPath: Map<string, string>, byTitle: Map<string, string>): string | null {
		const normalized = link.replace(/\\/g, '/').toLowerCase();
		return byPath.get(normalized) ?? byTitle.get(normalized) ?? null;
	}
}
