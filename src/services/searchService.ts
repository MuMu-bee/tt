import type { RequestContext } from '../application/requestContext';
import { createRequestContext } from '../application/requestContext.ts';
import type { IndexHit, IndexPort } from '../ports/indexPort';

export interface SearchRequest {
	query: string;
	limit?: number;
	context?: RequestContext;
}

export interface SearchResult {
	path: string;
	title: string;
	score: number;
	matched_fields: string[];
	snippet: string;
	source: 'keyword';
	raw_hash?: string;
	open_path: string;
}

/** Keyword-only application facade. It is the single read search source for UI and chat. */
export class SearchService {
	private readonly index: IndexPort;

	constructor(index: IndexPort) {
		this.index = index;
	}

	async query(request: SearchRequest): Promise<SearchResult[]>;
	async query(query: string, limit?: number, context?: RequestContext): Promise<SearchResult[]>;
	async query(
		requestOrQuery: SearchRequest | string,
		limit = 10,
		context = createRequestContext('user'),
	): Promise<SearchResult[]> {
		const request: SearchRequest = typeof requestOrQuery === 'string'
			? { query: requestOrQuery, limit, context }
			: requestOrQuery;
		const query = request.query.trim();
		if (!query) return [];
		const safeLimit = Number.isFinite(request.limit) ? Math.max(0, Math.floor(request.limit ?? 10)) : 10;
		if (safeLimit === 0) return [];
		const requestContext = request.context ?? createRequestContext('user');
		try {
			const hits = await this.index.search(query, { limit: safeLimit }, requestContext);
			return hits.slice(0, safeLimit).map((hit) => this.normalize(hit));
		} catch (error) {
			throw new SearchServiceError('SEARCH_FAILED', this.errorMessage(error), error);
		}
	}

	private normalize(hit: IndexHit): SearchResult {
		return {
			path: hit.path,
			title: hit.title,
			score: hit.score,
			matched_fields: hit.matched_fields ?? [],
			snippet: hit.snippet,
			source: hit.source ?? 'keyword',
			...(hit.raw_hash ? { raw_hash: hit.raw_hash } : {}),
			open_path: hit.open_path ?? hit.path,
		};
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : '关键词检索失败';
	}
}

export class SearchServiceError extends Error {
	public readonly code: string;
	public readonly cause?: unknown;

	constructor(code: string, message: string, cause?: unknown) {
		super(message);
		this.name = 'SearchServiceError';
		this.code = code;
		this.cause = cause;
	}
}
