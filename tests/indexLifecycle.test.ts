import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext } from '../src/application/requestContext.ts';
import { InMemoryVaultIndex } from '../src/adapters/in-memory-vault-index.ts';
import { IndexLifecycleService } from '../src/services/indexLifecycleService.ts';
import type { VaultReaderPort } from '../src/ports/vaultReaderPort.ts';

class MemoryReader implements VaultReaderPort {
	public readonly writes: string[] = [];
	public failPath: string | null = null;
	public readonly files: Record<string, string>;
	public constructor(files: Record<string, string>) { this.files = files; }
	public async readMarkdown(path: string): Promise<string> {
		if (path === this.failPath) throw new Error(`read failed: ${path}`);
		return this.files[path] ?? '';
	}
	public async listMarkdownPaths(): Promise<string[]> { return Object.keys(this.files); }
}

const context = createRequestContext('background-task');

test('rebuild reaches ready state and supports create, modify, delete, and rename', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nold' });
	const index = new InMemoryVaultIndex(reader);
	const lifecycle = new IndexLifecycleService(reader, index);
	await lifecycle.rebuild(context);
	assert.deepEqual(lifecycle.getState(), { status: 'ready', count: 1 });
	assert.equal((await index.search('old', context)).length, 1);

	reader.files['b.md'] = '# Beta\ncreated';
	await lifecycle.create('b.md', context);
	assert.equal((await index.search('created', context)).length, 1);
	reader.files['b.md'] = '# Beta\nmodified';
	await lifecycle.modify('b.md', context);
	assert.deepEqual(await index.search('created', context), []);
	assert.equal((await index.search('modified', context)).length, 1);
	await lifecycle.delete('b.md', context);
	delete reader.files['b.md'];
	assert.deepEqual(await index.search('modified', context), []);

	reader.files['renamed.md'] = reader.files['a.md'] ?? '';
	await lifecycle.rename('a.md', 'renamed.md', context);
	const oldPathHits = await index.search('a.md', context);
	assert.deepEqual(oldPathHits, []);
	assert.equal((await index.search('old', context)).length, 1);
	assert.equal((await index.search('renamed', context)).length, 1);
	assert.deepEqual(reader.writes, []);
});

test('failed rebuild preserves the previous ready index and searchable entries', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nlegacy' });
	const index = new InMemoryVaultIndex(reader);
	const lifecycle = new IndexLifecycleService(reader, index);
	await lifecycle.rebuild(context);
	reader.files['new.md'] = '# New\nreplacement';
	reader.failPath = 'new.md';
	await assert.rejects(lifecycle.rebuild(context), /read failed/);
	assert.equal(lifecycle.getState().status, 'failed');
	assert.equal(index.availability(), 'ready');
	assert.equal((await index.search('legacy', context)).length, 1);
	assert.deepEqual(await index.search('replacement', context), []);
	assert.deepEqual(reader.writes, []);
});

test('incremental failure records failed state and preserves indexed entries', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nlegacy' });
	const index = new InMemoryVaultIndex(reader);
	const lifecycle = new IndexLifecycleService(reader, index);
	await lifecycle.rebuild(context);
	reader.failPath = 'missing.md';
	await assert.rejects(lifecycle.modify('missing.md', context), /read failed/);
	assert.equal(lifecycle.getState().status, 'failed');
	assert.match(lifecycle.getState().error ?? '', /read failed/);
	assert.equal(lifecycle.getState().count, 1);
	assert.equal((await index.search('legacy', context)).length, 1);
});

test('non-Markdown incremental paths are ignored safely', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nlegacy' });
	const index = new InMemoryVaultIndex(reader);
	const lifecycle = new IndexLifecycleService(reader, index);
	await lifecycle.rebuild(context);
	await lifecycle.modify('image.png', context);
	assert.deepEqual(lifecycle.getState(), { status: 'ready', count: 1 });
});

test('failed staged build preserves entries and ready availability', async () => {
	const reader = new MemoryReader({ 'a.md': '# Alpha\nlegacy' });
	let shouldFail = false;
	const index = new InMemoryVaultIndex(reader, async () => {
		if (shouldFail) throw new Error('yield failed');
	}, 1);
	await index.rebuild(context);
	shouldFail = true;
	await assert.rejects(index.buildAll([{ path: 'b.md', title: 'Beta', frontmatter: {}, tags: [], body: 'replacement', raw: 'replacement', raw_hash: 'hash' }], context), /yield failed/);
	assert.equal(index.availability(), 'ready');
	assert.equal((await index.search('legacy', context)).length, 1);
	assert.deepEqual(await index.search('replacement', context), []);
});
