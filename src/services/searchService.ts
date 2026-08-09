import { createRequestContext, type RequestContext } from '../application/requestContext.ts';
import { DEFAULT_SEARCH_CONFIG, type SearchConfig, type SearchDiagnostics, type SearchQuery, type SearchResponse, type SearchResult, type SearchScope } from '../application/contracts.ts';
import type { IndexHit, IndexPort } from '../ports/indexPort';
import type { SemanticSearchPort } from '../ports/semanticSearchPort';

export interface SearchRequest { query?: string; text?: string; limit?: number; mode?: SearchQuery['mode']; force_semantic?: boolean; keyword_min_results?: number; keyword_min_score?: number; scope?: SearchScope; fields?: string[]; context?: RequestContext }
export interface LegacySearchResult extends SearchResult { open_path: string; raw_hash?: string }
export class SearchServiceError extends Error { public readonly code: string; public readonly cause?: unknown; constructor(code: string, message: string, cause?: unknown) { super(message); this.name = 'SearchServiceError'; this.code = code; this.cause = cause; } }

/** Keyword-first search facade with optional semantic fallback and deterministic hybrid merge. */
export class SearchService {
  private readonly index: IndexPort;
  private readonly semantic?: SemanticSearchPort;
  private readonly config: SearchConfig;
  constructor(index: IndexPort, semantic?: SemanticSearchPort, config: Partial<SearchConfig> = {}) { this.index = index; this.semantic = semantic; this.config = { ...DEFAULT_SEARCH_CONFIG, ...config }; }
  async query(request: SearchRequest): Promise<LegacySearchResult[]>;
  async query(query: string, limit?: number, context?: RequestContext): Promise<LegacySearchResult[]>;
  async query(input: SearchRequest | string, legacyLimit = 10, legacyContext = createRequestContext('user')): Promise<LegacySearchResult[]> {
    const request: SearchRequest = typeof input === 'string' ? { query: input, limit: legacyLimit, context: legacyContext } : input;
    const response = await this.search(this.toQuery(request), request.context ?? createRequestContext('user'));
    return response.results.map((result) => ({ ...result, open_path: this.metadataString(result, 'open_path') ?? result.path, ...(this.metadataString(result, 'raw_hash') ? { raw_hash: this.metadataString(result, 'raw_hash') } : {}) }));
  }
  async search(query: SearchQuery, context: RequestContext = createRequestContext('user')): Promise<SearchResponse> {
    const text = query.text.trim();
    const limit = Number.isFinite(query.limit) ? Math.max(0, Math.floor(query.limit)) : 10;
    if (!text || limit === 0) return { results: [], diagnostics: this.emptyDiagnostics() };
    const keywordOptions: Record<string, unknown> = { limit, scope: query.scope, fields: query.fields };
    let keywordHits: IndexHit[] = [];
    try { keywordHits = await this.index.search(text, keywordOptions, context); }
    catch (error) { throw new SearchServiceError('SEARCH_FAILED', this.message(error), error); }
    const keywordResults = keywordHits.slice(0, limit).map((hit) => this.normalize(hit, 'keyword'));
    const minResults = query.keyword_min_results ?? this.config.keyword_min_results;
    const minScore = query.keyword_min_score ?? this.config.keyword_min_score;
    const shouldSemantic = query.mode === 'semantic' || query.mode === 'hybrid' || query.force_semantic === true || keywordResults.length < minResults || (keywordResults[0]?.score ?? 0) < minScore;
    const semanticEnabled = this.config.semantic_search_enabled && (query.mode !== 'keyword' || this.config.semantic_fallback_enabled || query.force_semantic === true);
    if (!shouldSemantic || !semanticEnabled || !this.semantic) return { results: keywordResults, diagnostics: { ...this.emptyDiagnostics(), keyword_count: keywordResults.length, semantic_called: false } };
    try {
      const semanticResults = (await this.semantic.search(query, context.child ? context.child() : createRequestContext(context.actor, context.request_id))).slice(0, limit).map((result) => ({ ...result, source: 'semantic' as const }));
      const results = query.mode === 'semantic' ? semanticResults : this.hybrid(keywordResults, semanticResults, limit);
      return { results, diagnostics: { keyword_count: keywordResults.length, semantic_count: semanticResults.length, semantic_called: true, degraded: false, semantic_unavailable: false } };
    } catch (error) {
      const diagnostics: SearchDiagnostics = { keyword_count: keywordResults.length, semantic_count: 0, semantic_called: true, degraded: true, semantic_unavailable: true, fallback_reason: this.message(error) };
      if (keywordResults.length > 0) return { results: keywordResults, diagnostics };
      throw new SearchServiceError('SEMANTIC_UNAVAILABLE', this.message(error), error);
    }
  }
  private toQuery(request: SearchRequest): SearchQuery { return { text: (request.text ?? request.query ?? ''), limit: request.limit ?? 10, mode: request.mode ?? 'keyword', force_semantic: request.force_semantic, keyword_min_results: request.keyword_min_results, keyword_min_score: request.keyword_min_score, scope: request.scope, fields: request.fields }; }
  private normalize(hit: IndexHit, source: 'keyword'): SearchResult { return { path: hit.path, title: hit.title, score: hit.score, matched_fields: hit.matched_fields ?? [], snippet: hit.snippet, source, metadata: { raw_hash: hit.raw_hash, open_path: hit.open_path ?? hit.path } }; }
  private metadataString(result: SearchResult, key: string): string | undefined { const value = result.metadata?.[key]; return typeof value === 'string' ? value : undefined; }
  private hybrid(keyword: SearchResult[], semantic: SearchResult[], limit: number): SearchResult[] {
    const keywordByPath = new Map<string, SearchResult>();
    const semanticOnly: SearchResult[] = [];
    keyword.forEach((item) => keywordByPath.set(this.pathKey(item.path), { ...item, source: 'hybrid' }));
    semantic.forEach((item) => {
      const key = this.pathKey(item.path);
      const existing = keywordByPath.get(key);
      if (existing) {
        existing.matched_fields = [...new Set([...existing.matched_fields, ...item.matched_fields])];
        existing.score += item.score * this.config.semantic_weight;
      } else {
        semanticOnly.push({ ...item, source: 'hybrid' });
      }
    });
    const keywordResults = [...keywordByPath.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const semanticResults = semanticOnly.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return [...keywordResults, ...semanticResults].slice(0, limit);
  }
  private pathKey(path: string): string { return path.replaceAll('\\', '/').replace(/^\.\//u, '').toLocaleLowerCase(); }
  private emptyDiagnostics(): SearchDiagnostics { return { keyword_count: 0, semantic_count: 0, semantic_called: false, degraded: false, semantic_unavailable: false }; }
  private message(error: unknown): string { return error instanceof Error ? error.message : '搜索失败'; }
}
