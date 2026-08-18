import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import type { IndexHit, IndexPort } from '../src/ports/indexPort.ts';
import type { SemanticSearchPort } from '../src/ports/semanticSearchPort.ts';
import type { SearchQuery, SearchResult } from '../src/application/contracts.ts';
import { SearchService } from '../src/services/searchService.ts';

class FakeIndex implements IndexPort {
  async search() { return [{ path: 'a.md', title: 'A', score: 1, snippet: 's' } as IndexHit]; }
  async invalidate() { return Promise.resolve(); }
  availability() { return 'ready' as const; }
}

class FakeSemantic implements SemanticSearchPort {
  calls = 0;
  async health() { return { available: true, status: 'healthy' as const }; }
  async search(_query: SearchQuery): Promise<SearchResult[]> { this.calls += 1; return []; }
}

test('search service honors live flag getter changes without re-composition', async () => {
  const semantic = new FakeSemantic();
  const flags = { semantic_search_enabled: false, semantic_fallback_enabled: true };
  const service = new SearchService(
    new FakeIndex(),
    () => (flags.semantic_search_enabled ? semantic : undefined),
    {},
    () => ({ semantic_search_enabled: flags.semantic_search_enabled, semantic_fallback_enabled: flags.semantic_fallback_enabled }),
  );

  /* flag 关闭：语义不调用 */
  await service.search({ text: 'x', mode: 'hybrid', limit: 5, force_semantic: true }, createRequestContext());
  assert.equal(semantic.calls, 0);

  /* 运行时翻转 flag：下一次搜索立即使用语义适配器（无需重建 runtime） */
  flags.semantic_search_enabled = true;
  await service.search({ text: 'x', mode: 'hybrid', limit: 5, force_semantic: true }, createRequestContext());
  assert.equal(semantic.calls, 1);
});
