import { parseVaultDocument } from '../domain/vault-document.ts';
import { sha256Hex } from '../utils/sha256.ts';
import { cosineSimilarity, normalize } from '../application/vectorMath.ts';
import {
	createRequestContext,
	type RequestContext,
} from '../application/requestContext.ts';
import { allowsPath } from '../application/scopeUtils.ts';
import type {
	Health,
	SearchQuery,
	SearchResult,
	SearchScope,
} from '../application/contracts.ts';
import type { VaultReaderPort } from '../ports/vaultReaderPort.ts';
import type { EmbeddingPort } from '../ports/embeddingPort.ts';
import type { SemanticSearchPort } from '../ports/semanticSearchPort.ts';

interface SemanticEntry {
	vector: number[];
	title: string;
	rawHash: string;
	content: string;
}

const BATCH_SIZE = 16;

/**
 * Local semantic search over vault notes using an Ollama embedding model.
 *
 * Index is kept in memory and built lazily: the first search embeds every
 * markdown note, later searches only embed notes that are new or changed
 * paths. When the embedding provider is unavailable, `search` throws and the
 * search facade degrades back to keyword results.
 */
export class OllamaSemanticSearch implements SemanticSearchPort {
	private readonly reader: VaultReaderPort;
	private readonly embeddings: EmbeddingPort;
	private readonly entries = new Map<string, SemanticEntry>();
	private building: Promise<void> | null = null;

	constructor(reader: VaultReaderPort, embeddings: EmbeddingPort) {
		this.reader = reader;
		this.embeddings = embeddings;
	}

	async health(context: RequestContext): Promise<Health> {
		return this.embeddings.health(context);
	}

	async search(query: SearchQuery, context: RequestContext): Promise<SearchResult[]> {
		const text = (query.text ?? '').trim();
		if (!text) {
			return [];
		}
		const limit = Number.isFinite(query.limit) ? Math.max(1, Math.floor(query.limit)) : 10;
		await this.ensureIndexed(context);

		const childContext =
			context.child ? context.child() : createRequestContext(context.actor, context.request_id);
		const [queryVector] = await this.embeddings.embed([text], childContext);
		const normalizedQuery = normalize(queryVector ?? []);

		const hits: Array<{ path: string; entry: SemanticEntry; score: number }> = [];
		const paths = [...this.entries.keys()];
		for (let index = 0; index < paths.length; index += 1) {
			const path = paths[index];
			const entry = path ? this.entries.get(path) : undefined;
			if (!path || !entry) {
				continue;
			}
			const score = cosineSimilarity(normalizedQuery, entry.vector);
			if (score <= 0) {
				continue;
			}
			if (!this.allowsScope(path, query.scope)) {
				continue;
			}
			hits.push({ path, entry, score });
		}
		hits.sort((a, b) => b.score - a.score);

		return hits.slice(0, limit).map((hit) => ({
			path: hit.path,
			title: hit.entry.title,
			score: hit.score,
			source: 'semantic' as const,
			matched_fields: ['content'],
			snippet: extractSnippet(hit.entry.content, text),
			metadata: { raw_hash: hit.entry.rawHash, open_path: hit.path },
		}));
	}

	private async ensureIndexed(context: RequestContext): Promise<void> {
		if (this.building) {
			return this.building;
		}
		this.building = this.build(context).finally(() => {
			this.building = null;
		});
		return this.building;
	}

	private async build(context: RequestContext): Promise<void> {
		const paths = await this.reader.listMarkdownPaths(context);
		const current = new Set(paths);

		for (const path of this.entries.keys()) {
			if (!current.has(path)) {
				this.entries.delete(path);
			}
		}

		const childContext =
			context.child ? context.child() : createRequestContext(context.actor, context.request_id);

		/* Read once per path so unchanged notes stay cached and changed notes re-embed. */
		const rawByPath = new Map<string, string>();
		const missing: string[] = [];
		for (const path of paths) {
			if (!path || !path.toLocaleLowerCase().endsWith('.md')) {
				continue;
			}
			const raw = await this.reader.readMarkdown(path, childContext);
			rawByPath.set(path, raw);
			const existing = this.entries.get(path);
			if (existing && existing.rawHash === sha256Hex(raw)) {
				continue;
			}
			if (existing) {
				this.entries.delete(path);
			}
			missing.push(path);
		}

		for (let start = 0; start < missing.length; start += BATCH_SIZE) {
			const batch = missing.slice(start, start + BATCH_SIZE);
			const texts: string[] = [];
			const parsed: Array<{ path: string; title: string; rawHash: string; content: string }> = [];
			for (const path of batch) {
				if (!path) {
					continue;
				}
				const raw = rawByPath.get(path);
				if (raw === undefined) {
					continue;
				}
				const document = parseVaultDocument(path, raw);
				const content = document.body || raw;
				texts.push(content || path);
				parsed.push({
					path,
					title: document.title,
					rawHash: sha256Hex(raw),
					content,
				});
			}
			if (texts.length === 0) {
				continue;
			}
			const vectors = await this.embeddings.embed(texts, childContext);
			parsed.forEach((item, index) => {
				const vector = vectors[index];
				if (!vector || vector.length === 0) {
					return;
				}
				this.entries.set(item.path, {
					vector: normalize(vector),
					title: item.title,
					rawHash: item.rawHash,
					content: item.content,
				});
			});
		}
	}

	private allowsScope(path: string, scope?: SearchScope): boolean {
		// tag 过滤在关键词侧执行；语义侧保持路径级检查一致。
		return allowsPath(path, scope);
	}
}

function extractSnippet(content: string, query: string): string {
	const normalized = content.replace(/\s+/gu, ' ').trim();
	if (!normalized) {
		return '';
	}
	const lower = normalized.toLocaleLowerCase();
	const firstWord = query.split(/\s+/u).find((word) => word.length > 1);
	let index = -1;
	if (firstWord) {
		index = lower.indexOf(firstWord.toLocaleLowerCase());
	}
	if (index < 0) {
		index = 0;
	}
	const start = Math.max(0, index - 100);
	const end = Math.min(normalized.length, index + 260);
	const snippet = normalized.slice(start, end);
	return `${start > 0 ? '…' : ''}${snippet}${end < normalized.length ? '…' : ''}`;
}
