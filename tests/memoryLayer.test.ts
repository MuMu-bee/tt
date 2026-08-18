import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import type { MemoryFileStorage } from '../src/ports/memoryPort.ts';
import { ConversationStore } from '../src/adapters/conversationStore.ts';
import { AtomStore } from '../src/adapters/atomStore.ts';
import { SceneStore } from '../src/adapters/sceneStore.ts';
import { PersonaStore } from '../src/adapters/personaStore.ts';
import { MemoryRecallService } from '../src/services/memoryRecallService.ts';
import type { ConversationTurn, MemoryAtom, SceneBlock } from '../src/application/memoryTypes.ts';

class FakeMemoryStorage implements MemoryFileStorage {
	files = new Map<string, string>();

	async read(path: string): Promise<string> {
		return this.files.get(path) ?? '';
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async list(prefix: string): Promise<string[]> {
		return [...this.files.keys()].filter((path) => path.startsWith(prefix));
	}
}

const ctx = (): RequestContext => createRequestContext('workbench-agent');

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
	return {
		id: 't1',
		sessionKey: 's',
		sessionId: 'sid',
		role: 'user',
		content: 'hello',
		timestamp: '2026-08-18T10:00:00.000Z',
		...overrides,
	};
}

test('conversation store appends day-sharded turns and searches them', async () => {
	const storage = new FakeMemoryStorage();
	const store = new ConversationStore(storage);
	await store.append(makeTurn({ id: 't1', content: '读书笔记' }), ctx());
	await store.append(makeTurn({ id: 't2', content: '运动计划', timestamp: '2026-08-19T10:00:00.000Z' }), ctx());

	const recent = await store.listRecent(10, ctx());
	assert.equal(recent.length, 2);

	const hits = await store.search('读书', 10, ctx());
	assert.equal(hits[0]?.id, 't1');
	assert.equal(storage.files.size, 2);
});

test('atom store saves and searches persona atoms', async () => {
	const storage = new FakeMemoryStorage();
	const store = new AtomStore(storage);
	const atom: MemoryAtom = {
		id: 'm1',
		content: '用户偏好关键词优先搜索',
		type: 'persona',
		priority: 90,
		scene_name: 'search',
		source_message_ids: ['t1'],
		source_paths: [],
		metadata: {},
		createdAt: '2026-08-18T10:00:00.000Z',
		updatedAt: '2026-08-18T10:00:00.000Z',
		sessionKey: 's',
		sessionId: 'sid',
	};
	await store.save(atom, ctx());

	const hits = await store.search('关键词', 10, ctx());
	assert.equal(hits[0]?.id, 'm1');
	assert.equal((await store.listRecent(10, ctx())).length, 1);
});

test('scene store maintains the scene index and reads scene blocks', async () => {
	const storage = new FakeMemoryStorage();
	const store = new SceneStore(storage);
	const scene: SceneBlock = {
		slug: 'help-user',
		filename: 'help-user.md',
		path: '_memory/scenes/help-user.md',
		summary: '帮用户整理知识库',
		heat: 3,
		created: '2026-08-18T10:00:00.000Z',
		updated: '2026-08-18T10:00:00.000Z',
		source_atoms: ['m1'],
		content: '# 场景\n\n要点',
	};
	await store.write(scene, ctx());

	const index = await store.listIndex(ctx());
	assert.equal(index.length, 1);
	assert.equal(index[0]?.slug, 'help-user');

	const read = await store.read('help-user', ctx());
	assert.equal(read?.summary, '帮用户整理知识库');
	assert.equal(read?.content, '# 场景\n\n要点');
});

test('persona store separates body from scene navigation', async () => {
	const storage = new FakeMemoryStorage();
	const store = new PersonaStore(storage);
	await store.write({
		body: '用户是 Obsidian 深度用户',
		navigation: '- [[help-user]]',
		version: 2,
		updated: '2026-08-18T10:00:00.000Z',
	}, ctx());

	const read = await store.read(ctx());
	assert.equal(read?.body, '用户是 Obsidian 深度用户');
	assert.ok(read?.navigation.includes('[[help-user]]'));
	assert.equal(read?.version, 2);
});

test('memory recall returns L3, L2, L1 and falls back to L0 only when L1 is sparse', async () => {
	const storage = new FakeMemoryStorage();
	const conversations = new ConversationStore(storage);
	const atoms = new AtomStore(storage);
	const scenes = new SceneStore(storage);
	const persona = new PersonaStore(storage);
	await conversations.append(makeTurn({ id: 't1', content: '读书笔记' }), ctx());
	await atoms.save({
		id: 'm1', content: '用户偏好关键词优先搜索', type: 'persona', priority: 90,
		scene_name: 'search', source_message_ids: ['t1'], source_paths: [], metadata: {},
		createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z',
		sessionKey: 's', sessionId: 'sid',
	}, ctx());
	await scenes.write({
		slug: 'help-user', filename: 'help-user.md', path: '_memory/scenes/help-user.md',
		summary: '帮用户整理知识库', heat: 3, created: '2026-08-18T10:00:00.000Z',
		updated: '2026-08-18T10:00:00.000Z', source_atoms: [], content: '# 场景',
	}, ctx());
	await persona.write({ body: '用户画像正文', navigation: '- [[help-user]]', version: 1, updated: '2026-08-18T10:00:00.000Z' }, ctx());

	const recall = new MemoryRecallService(conversations, atoms, scenes, persona);
	const bundle = await recall.recall('关键词', ctx());
	assert.equal(bundle.l3, '用户画像正文');
	assert.equal(bundle.l2[0]?.slug, 'help-user');
	assert.equal(bundle.l1[0]?.id, 'm1');
	assert.equal(bundle.drillDown.used, false);
});

test('memory recall falls back to L0 when L1 has no hits', async () => {
	const storage = new FakeMemoryStorage();
	const conversations = new ConversationStore(storage);
	const atoms = new AtomStore(storage);
	const scenes = new SceneStore(storage);
	const persona = new PersonaStore(storage);
	await conversations.append(makeTurn({ id: 't1', content: '读书笔记' }), ctx());

	const recall = new MemoryRecallService(conversations, atoms, scenes, persona);
	const bundle = await recall.recall('读书', ctx());
	assert.equal(bundle.l1.length, 0);
	assert.equal(bundle.l0[0]?.id, 't1');
	assert.equal(bundle.drillDown.used, true);
});
