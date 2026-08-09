import type { RequestContext, RequestActor } from './requestContext';

export type ErrorCode =
  | 'SEARCH_FAILED' | 'INDEX_UNAVAILABLE' | 'SEMANTIC_UNAVAILABLE' | 'EMBEDDING_UNAVAILABLE'
  | 'OUT_OF_WHITELIST' | 'SCOPE_DENIED' | 'FICTION_PROPOSAL_ONLY' | 'FEATURE_DISABLED'
  | 'HASH_CONFLICT' | 'WRITE_FAILED' | 'INDEX_REFRESH_FAILED' | 'AUDIT_FAILED' | 'VALIDATION_ERROR';

export interface ApiEnvelope<T> { code: ErrorCode | 'OK'; data: T | null; message: string; request_id?: string }

export interface SearchScope { kind: 'global' | 'prefix' | 'tag' | 'file'; value?: string; includes?: string[]; excludes?: string[]; snapshot_id?: string }
export interface SearchQuery { text: string; mode?: 'keyword' | 'semantic' | 'hybrid'; limit: number; fields?: string[]; force_semantic?: boolean; keyword_min_results?: number; keyword_min_score?: number; scope?: SearchScope }
export interface SearchResult { path: string; title: string; score: number; source: 'keyword' | 'semantic' | 'hybrid'; matched_fields: string[]; snippet?: string; metadata?: Record<string, unknown> }
export interface SearchDiagnostics { keyword_count: number; semantic_count: number; semantic_called: boolean; degraded: boolean; semantic_unavailable: boolean; fallback_reason?: string; provider?: string; embedding_provider?: string }
export interface SearchResponse { results: SearchResult[]; diagnostics: SearchDiagnostics }
export interface SearchConfig { keyword_min_results: number; keyword_min_score: number; keyword_weight: number; semantic_weight: number; semantic_search_enabled: boolean; semantic_fallback_enabled: boolean }
export interface Health { available: boolean; status: 'healthy' | 'degraded' | 'unavailable'; reason?: string; provider?: string }
export interface RefreshStatus { status: 'succeeded' | 'pending' | 'failed'; paths: string[]; error?: string }

export type VaultZone = 'normal' | 'fiction' | 'unknown';
export interface NoteRecord { path: string; title: string; content: string; frontmatter: Record<string, unknown>; tags: string[]; links: string[]; hash: string; zone: VaultZone }
export type ChangeKind = 'frontmatter-add' | 'tag-add' | 'bidirectional-link-add' | 'format-normalize';
export type FileChangeStatus = 'planned' | 'applied' | 'skipped' | 'failed' | 'conflict' | 'proposal_only';
export interface PlannedChange { path: string; kind: ChangeKind; before: string; after: string; diff: string; reason: string; status: FileChangeStatus; before_hash: string; zone: VaultZone }
export interface OrganizePlan { plan_id: string; request_id: string; changes: PlannedChange[]; scope_snapshot: SearchScope; created_at: string }
export interface WriteRequest { path: string; content: string; before_hash: string; kind: ChangeKind; scope_snapshot: SearchScope; dry_run?: boolean; zone: VaultZone; request_id: string }
export interface WriteResult { path: string; status: 'applied' | 'conflict' | 'failed' | 'proposal_only' | 'skipped'; before_hash: string; after_hash?: string; refresh?: RefreshStatus; error_code?: ErrorCode }
export interface AuditEvent { request_id: string; actor: RequestActor; action: string; path: string; before_hash?: string; after_hash?: string; result: string; created_at: string; error_code?: ErrorCode }

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  keyword_min_results: 3,
  keyword_min_score: 1,
  keyword_weight: 0.7,
  semantic_weight: 0.3,
  semantic_search_enabled: false,
  semantic_fallback_enabled: false,
};

export function envelope<T>(data: T, context: RequestContext, message = 'OK'): ApiEnvelope<T> { return { code: 'OK', data, message, request_id: context.request_id }; }
export function errorEnvelope<T>(code: ErrorCode, message: string, context: RequestContext): ApiEnvelope<T> { return { code, data: null, message, request_id: context.request_id }; }
