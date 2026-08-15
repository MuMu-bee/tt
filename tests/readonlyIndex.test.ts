import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '../src/application/requestContext.ts';
import { InMemoryVaultIndex } from '../src/adapters/in-memory-vault-index.ts';
import { parseVaultDocument } from '../src/domain/vault-document.ts';
import type { VaultReaderPort } from '../src/ports/vaultReaderPort.ts';

class MemoryReader implements VaultReaderPort {
	public readonly writes: string[] = [];
	public files: Record<string, string>;
	constructor(files: Record<string, string>) { this.files = files; }
	async readMarkdown(path: string): Promise<string> { return this.files[path] ?? ''; }
	async listMarkdownPaths(): Promise<string[]> { return Object.keys(this.files); }
}

const context = createRequestContext();

test('parses missing, known, nested, array, and unknown frontmatter fields', () => {
	const missing = parseVaultDocument('plain.md', '# Plain\n\nbody');
	assert.deepEqual(missing.frontmatter, {});
	const document = parseVaultDocument('notes/alpha.md', '---\ntags: [alpha, beta]\ncustom: retained\nmeta:\n  owner: user\n  enabled: true\n---\n# Alpha\n\nBody');
	assert.deepEqual(document.frontmatter, { tags: ['alpha', 'beta'], custom: 'retained', meta: { owner: 'user', enabled: true } });
	assert.deepEqual(document.tags, ['alpha', 'beta']);
});

test('hash is stable and changes when raw content changes', () => {
	const first = parseVaultDocument('a.md', '# A\ntext');
	const same = parseVaultDocument('a.md', '# A\ntext');
	const changed = parseVaultDocument('a.md', '# A\nchanged');
	assert.equal(first.raw_hash, same.raw_hash);
	assert.notEqual(first.raw_hash, changed.raw_hash);
});

test('searches title, path, frontmatter, tags, and body with source metadata', async () => {
	const reader = new MemoryReader({ 'notes/alpha.md': '---\ntags: [needle]\ncustom: blue\n---\n# Alpha\n\nBody contains needle.', 'other.md': '# Other\nnone' });
	const index = new InMemoryVaultIndex(reader);
	const results = await index.search('needle', context);
	assert.equal(results.length, 1);
	assert.equal(results[0]?.title, 'Alpha');
	assert.equal(results[0]?.path, 'notes/alpha.md');
	assert.equal(results[0]?.source, 'keyword');
	assert.equal(results[0]?.raw_hash, parseVaultDocument('notes/alpha.md', reader.files['notes/alpha.md'] ?? '').raw_hash);
	assert.ok(results[0]?.matched_fields.includes('tags'));
	assert.ok(results[0]?.matched_fields.includes('content'));
	assert.equal(results[0]?.open(), 'notes/alpha.md');
	assert.deepEqual(await index.search('absent', context), []);
});

test('supports incremental upsert, remove, clear, and full rebuild', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nold' });
	const index = new InMemoryVaultIndex(reader);
	await index.rebuild(context);
	assert.equal((await index.search('old', context)).length, 1);
	await index.upsert(parseVaultDocument('b.md', '# Beta\nnew'), context);
	assert.equal((await index.search('new', context)).length, 1);
	await index.remove('a.md', context);
	assert.deepEqual(await index.search('old', context), []);
	index.clearDerivedIndex();
	assert.equal((await index.search('old', context)).length, 1);
	reader.files['a.md'] = '# Alpha\nrestored';
	await index.rebuild(context);
	assert.equal((await index.search('restored', context)).length, 1);
	assert.equal(reader.writes.length, 0);
});

test('yields during large rebuild batches', async () => {
	let yields = 0;
	const files: Record<string, string> = {};
	for (let index = 0; index < 65; index += 1) files[`note-${index}.md`] = `# Note ${index}\nbody`;
	const reader = new MemoryReader(files);
	const index = new InMemoryVaultIndex(reader, async () => { yields += 1; }, 8);
	await index.rebuild(context);
	assert.ok(yields >= 8);
});
