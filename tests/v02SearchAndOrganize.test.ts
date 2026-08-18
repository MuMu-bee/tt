import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import type { IndexHit, IndexPort } from '../src/ports/indexPort.ts';
import type { SemanticSearchPort } from '../src/ports/semanticSearchPort.ts';
import type { SearchQuery, SearchResult } from '../src/application/contracts.ts';
import { SearchService } from '../src/services/searchService.ts';
import { DEFAULT_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import { OrganizeService, type OrganizePort } from '../src/services/organizeService.ts';

class FakeIndex implements IndexPort {
  public calls = 0;
  private readonly hits: IndexHit[];
  constructor(hits: IndexHit[]) { this.hits = hits; }
  async search(): Promise<IndexHit[]> { this.calls += 1; return this.hits; }
  async invalidate(): Promise<void> { return Promise.resolve(); }
  availability(): 'ready' { return 'ready'; }
}
class FakeSemantic implements SemanticSearchPort {
  public calls = 0;
  private readonly results: SearchResult[];
  public fail = false;
  constructor(results: SearchResult[] = []) { this.results = results; }
  async health() { return { available: true, status: 'healthy' as const }; }
  async search(_query: SearchQuery): Promise<SearchResult[]> { this.calls += 1; if (this.fail) throw new Error('offline'); return this.results; }
}

test('keyword threshold prevents semantic call', async () => {
  const semantic = new FakeSemantic();
  const service = new SearchService(new FakeIndex([{ path: 'a.md', title: 'A', score: 2, snippet: 'x' }]), semantic, { semantic_search_enabled: true, semantic_fallback_enabled: true });
  const response = await service.search({ text: 'x', mode: 'keyword', limit: 5, keyword_min_results: 1, keyword_min_score: 1 }, createRequestContext());
  assert.equal(response.diagnostics.semantic_called, false);
  assert.equal(semantic.calls, 0);
});

test('hybrid semantic call deduplicates path and keeps keyword metadata', async () => {
  const semantic = new FakeSemantic([{ path: './A.md', title: 'semantic', score: 9, matched_fields: ['embedding'], source: 'semantic' }]);
  const service = new SearchService(new FakeIndex([{ path: 'a.md', title: 'keyword', score: 1, snippet: 's', matched_fields: ['content'] }]), semantic, { semantic_search_enabled: true, semantic_fallback_enabled: true });
  const response = await service.search({ text: 'x', mode: 'hybrid', limit: 5, keyword_min_results: 3, keyword_min_score: 10 }, createRequestContext());
  assert.equal(semantic.calls, 1);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.source, 'hybrid');
  assert.deepEqual(response.results[0]?.matched_fields.sort(), ['content', 'embedding']);
});

test('semantic outage falls back to keyword results with diagnostics', async () => {
  const semantic = new FakeSemantic();
  semantic.fail = true;
  const service = new SearchService(new FakeIndex([{ path: 'a.md', title: 'A', score: 1, snippet: 's' }]), semantic, { semantic_search_enabled: true, semantic_fallback_enabled: true });
  const response = await service.search({ text: 'x', mode: 'hybrid', limit: 5, force_semantic: true }, createRequestContext());
  assert.equal(response.results[0]?.source, 'keyword');
  assert.equal(response.diagnostics.degraded, true);
  assert.equal(response.diagnostics.semantic_unavailable, true);
});

test('organize defaults to no changes while preserving fiction proposal policy', async () => {
  const scanner: OrganizePort = { scan: async () => [{ path: 'fiction/a.md', title: 'A', content: 'x', frontmatter: {}, tags: [], links: [], hash: 'h', zone: 'fiction' }] };
  const service = new OrganizeService(scanner, { ...DEFAULT_FEATURE_FLAGS, organize: { frontmatter: true, tags: true, links: true, format: true } });
  const plan = await service.plan({ kind: 'global' }, createRequestContext());
  // bidirectional-link-add 在没有 related 目标时被跳过（自链接也不会生成），故为 3 项。
  assert.equal(plan.changes.length, 3);
  assert.ok(plan.changes.every((change) => change.status === 'proposal_only'));
});

test('bidirectional link change is generated when a related target exists', async () => {
  const scanner: OrganizePort = { scan: async () => [{ path: 'notes/a.md', title: 'A', content: 'x', frontmatter: { related: 'B' }, tags: [], links: [], hash: 'h', zone: 'normal' }] };
  const service = new OrganizeService(scanner, { ...DEFAULT_FEATURE_FLAGS, organize: { frontmatter: false, tags: false, links: true, format: false } });
  const plan = await service.plan({ kind: 'global' }, createRequestContext());
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]?.kind, 'bidirectional-link-add');
  assert.ok(plan.changes[0]?.after.includes('[[B]]'));
});

test('bidirectional link change skips a related target equal to the note itself', async () => {
  const scanner: OrganizePort = { scan: async () => [{ path: 'notes/A.md', title: 'A', content: 'x', frontmatter: { related: 'A' }, tags: [], links: [], hash: 'h', zone: 'normal' }] };
  const service = new OrganizeService(scanner, { ...DEFAULT_FEATURE_FLAGS, organize: { frontmatter: false, tags: false, links: true, format: false } });
  const plan = await service.plan({ kind: 'global' }, createRequestContext());
  assert.equal(plan.changes.length, 0);
});
