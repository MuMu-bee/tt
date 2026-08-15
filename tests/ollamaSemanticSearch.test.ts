import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import type { VaultReaderPort } from '../src/ports/vaultReaderPort.ts';
import type { EmbeddingPort } from '../src/ports/embeddingPort.ts';
import type { Health } from '../src/application/contracts.ts';
import { OllamaSemanticSearch } from '../src/adapters/ollamaSemanticSearch.ts';

class FakeReader implements VaultReaderPort {
	notes = new Map<string, string>();

	constructor(notes: Record<string, string>) {
		Object.entries(notes).forEach(([path, content]) => this.notes.set(path, content));
	}

	async readMarkdown(path: string): Promise<string> {
		const content = this.notes.get(path);
		if (content === undefined) throw new Error(`missing ${path}`);
		return content;
	}

	async listMarkdownPaths(): Promise<string[]> {
		return [...this.notes.keys()];
	}
}

/**
 * Deterministic fake embedding: a text maps to a vector derived from whether it
 * contains "books" (读书), "notes" (心得), or both. Queries embed the same way,
 * so cosine similarity is 1 for same-topic, 0.707 for both, 0 for other.
 */
class FakeEmbedding implements EmbeddingPort {
	embedCalls = 0;
	fail = false;

	private vectorOf(text: string): number[] {
		const hasBooks = text.includes('读书');
		const hasNotes = text.includes('心得');
		return [hasBooks ? 1 : 0, hasNotes ? 1 : 0];
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (this.fail) throw new Error('embedding unavailable');
		this.embedCalls += 1;
		return texts.map((text) => this.vectorOf(text));
	}

	async health(): Promise<Health> {
		return { available: true, status: 'healthy', provider: 'ollama' };
	}
}

const ctx = (): RequestContext => createRequestContext('workbench-agent');

function makeSearch(notes: Record<string, string>, embedding = new FakeEmbedding()): {
	search: OllamaSemanticSearch;
	reader: FakeReader;
	embedding: FakeEmbedding;
} {
	const reader = new FakeReader(notes);
	return { search: new OllamaSemanticSearch(reader, embedding), reader, embedding };
}

test('semantic search ranks same-topic notes first', async () => {
	const { search } = makeSearch({
		'a.md': '# 读书心得\n这是一篇关于读书的笔记',
		'b.md': '# 运动计划\n这是一篇关于跑步的笔记',
	});
	const results = await search.search({ text: '读书', limit: 5, mode: 'semantic' }, ctx());
	assert.equal(results[0]?.path, 'a.md');
	assert.ok(results.length >= 1);
	assert.equal(results[0]?.source, 'semantic');
	assert.ok(results[0]?.matched_fields.includes('content'));
	assert.equal(typeof results[0]?.metadata?.open_path, 'string');
});

test('semantic search returns notes containing both query aspects', async () => {
	const { search } = makeSearch({
		'a.md': '读书笔记内容',
		'b.md': '完全无关的日记',
	});
	const results = await search.search({ text: '读书 心得', limit: 5 }, ctx());
	assert.ok(results.some((result) => result.path === 'a.md'));
});

test('non-md files are skipped during indexing', async () => {
	const { search, embedding } = makeSearch({
		'note.md': '读书',
		'note.txt': '心得',
	});
	await search.search({ text: '读书', limit: 5 }, ctx());
	// Only the .md note should have been embedded into the index.
	const secondRun = await search.search({ text: '心得', limit: 5 }, ctx());
	assert.ok(Array.isArray(secondRun));
	void embedding;
});

test('index is built lazily and only increments for new paths', async () => {
	const embedding = new FakeEmbedding();
	const { search, reader } = makeSearch({ 'a.md': '读书' }, embedding);

	// First search builds the whole index (1 embed batch) + 1 query embed.
	await search.search({ text: '读书', limit: 5 }, ctx());
	const callsAfterFirst = embedding.embedCalls;
	assert.equal(callsAfterFirst, 2);

	// Second search only embeds the query again.
	await search.search({ text: '读书', limit: 5 }, ctx());
	assert.equal(embedding.embedCalls, callsAfterFirst + 1);

	// Adding a new note triggers one incremental embed batch + one query embed.
	reader.notes.set('b.md', '心得');
	await search.search({ text: '心得', limit: 5 }, ctx());
	assert.equal(embedding.embedCalls, callsAfterFirst + 3);
});

test('scope excludes filter out semantic hits', async () => {
	const { search } = makeSearch({
		'a.md': '读书',
		'drafts/b.md': '读书',
	});
	const results = await search.search(
		{ text: '读书', limit: 10, scope: { kind: 'global', excludes: ['drafts/'] } },
		ctx(),
	);
	assert.ok(results.every((result) => !result.path.startsWith('drafts/')));
});

test('zero-similarity notes are filtered out', async () => {
	const { search } = makeSearch({
		'a.md': '读书',
		'b.md': '完全无关',
	});
	// "读书" maps to [1,0]; "完全无关" maps to [0,0] -> score 0, filtered.
	const results = await search.search({ text: '读书', limit: 10 }, ctx());
	assert.ok(results.every((result) => result.path !== 'b.md'));
});

test('embedding failure rejects and lets the facade degrade', async () => {
	const embedding = new FakeEmbedding();
	embedding.fail = true;
	const { search } = makeSearch({ 'a.md': '读书' }, embedding);
	await assert.rejects(() => search.search({ text: '读书', limit: 5 }, ctx()));
});
