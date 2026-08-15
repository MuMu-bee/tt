import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import { InMemoryVaultIndex } from '../src/adapters/in-memory-vault-index.ts';
import { SearchService, SearchServiceError } from '../src/services/searchService.ts';
import type { VaultReaderPort } from '../src/ports/vaultReaderPort.ts';

class MemoryReader implements VaultReaderPort {
	public readonly writes: string[] = [];
	public readonly files: Record<string, string>;
	public constructor(files: Record<string, string>) { this.files = files; }
	public async readMarkdown(path: string): Promise<string> { return this.files[path] ?? ''; }
	public async listMarkdownPaths(): Promise<string[]> { return Object.keys(this.files); }
}

test('returns no results for empty queries and zero limits', async () => {
	const index = new InMemoryVaultIndex(new MemoryReader({ 'a.md': '# Alpha\nneedle' }));
	const service = new SearchService(index);
	assert.deepEqual(await service.query({ query: '   ', limit: 10 }), []);
	assert.deepEqual(await service.query({ query: 'needle', limit: 0 }), []);
});

test('returns normalized keyword hits and honors result limits', async () => {
	const reader = new MemoryReader({
		'a.md': '# Alpha\nneedle',
		'b.md': '# Beta\nneedle',
	});
	const service = new SearchService(new InMemoryVaultIndex(reader));
	const results = await service.query({ query: 'needle', limit: 1, context: createRequestContext('user') });
	assert.equal(results.length, 1);
	assert.equal(results[0]?.source, 'keyword');
	assert.equal(results[0]?.open_path, results[0]?.path);
	assert.ok(results[0]?.matched_fields.includes('content'));
});

test('wraps index failures in a typed SearchServiceError', async () => {
	const index = {
		search: async (): Promise<never> => { throw new Error('index unavailable'); },
		invalidate: async (): Promise<void> => undefined,
		availability: (): 'unavailable' => 'unavailable',
	};
	const service = new SearchService(index);
	await assert.rejects(service.query('needle'), (error: unknown) => {
		assert.ok(error instanceof SearchServiceError);
		assert.equal(error.code, 'SEARCH_FAILED');
		assert.equal(error.message, 'index unavailable');
		return true;
	});
});
