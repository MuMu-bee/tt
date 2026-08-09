import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import { InMemoryVaultIndex } from '../src/adapters/in-memory-vault-index.ts';
import { parseVaultDocument } from '../src/domain/vault-document.ts';
import { ScopeService } from '../src/services/scopeService.ts';
import { SearchService } from '../src/services/searchService.ts';
import type { IndexHit } from '../src/ports/indexPort.ts';
import type { SemanticSearchPort } from '../src/ports/semanticSearchPort.ts';
import type { SearchQuery, SearchResult, NoteRecord } from '../src/application/contracts.ts';
import type { RequestContext } from '../src/application/requestContext.ts';

class Reader {
  private readonly files: Record<string, string> = {
    'notes/keep.md': '# Keep\nkeyword',
    'private/secret.md': '# Secret\nkeyword',
  };

  async listMarkdownPaths(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async readMarkdown(path: string): Promise<string> {
    return this.files[path] ?? '';
  }
}

class FixedSemantic implements SemanticSearchPort {
  private readonly results: SearchResult[];

  constructor(results: SearchResult[]) {
    this.results = results;
  }

  async health() { return { available: true, status: 'healthy' as const }; }
  async search(_query: SearchQuery, _context: RequestContext): Promise<SearchResult[]> {
    return this.results;
  }
}

class FixedIndex {
  private readonly hits: IndexHit[];

  constructor(hits: IndexHit[]) {
    this.hits = hits;
  }

  async search(_text: string, _options: Record<string, unknown>, _context: RequestContext): Promise<IndexHit[]> {
    return this.hits;
  }
  async invalidate(): Promise<void> {}
  availability(): 'ready' { return 'ready'; }
}

function note(path: string): NoteRecord {
  return { path, title: path, content: 'x', frontmatter: {}, tags: [], links: [], hash: 'h', zone: 'normal' };
}

test('keyword index enforces scope excludes passed by search service', async () => {
  const index = new InMemoryVaultIndex(new Reader());
  const context = createRequestContext();
  const results = await index.search('keyword', {
    scope: { kind: 'global', excludes: ['private'] },
  }, context);
  assert.deepEqual(results.map((result) => result.path), ['notes/keep.md']);
});

test('scope includes restricts global organization to included paths', () => {
  const scope = new ScopeService();
  const snapshot = scope.snapshot({ kind: 'prefix', value: 'notes', includes: ['notes'] });
  assert.equal(scope.allows(note('notes/keep.md'), snapshot), true);
  assert.equal(scope.allows(note('other/place.md'), snapshot), false);
});

test('hybrid mode keeps keyword hits ahead of semantic-only hits', async () => {
  const semantic = new FixedSemantic([{
    path: 'semantic.md', title: 'Semantic', score: 100, matched_fields: ['embedding'], source: 'semantic',
  }]);
  const service = new SearchService(new FixedIndex([
    { path: 'keyword.md', title: 'Keyword', score: 1, snippet: 'hit', matched_fields: ['content'] },
  ]), semantic, { semantic_search_enabled: true, semantic_fallback_enabled: true });
  const response = await service.search({
    text: 'keyword', mode: 'hybrid', limit: 5, keyword_min_results: 3, keyword_min_score: 10,
  }, createRequestContext());
  assert.equal(response.results[0]?.path, 'keyword.md');
});
