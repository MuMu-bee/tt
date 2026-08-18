import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import type { MemoryFileStorage } from '../src/ports/memoryPort.ts';
import type { ModelPort } from '../src/ports/modelPort.ts';
import { ConversationStore } from '../src/adapters/conversationStore.ts';
import { AtomStore } from '../src/adapters/atomStore.ts';
import { SceneStore } from '../src/adapters/sceneStore.ts';
import { PersonaStore } from '../src/adapters/personaStore.ts';
import { MemoryExtractionService, parseExtractedMemories, sanitizeJsonForParse } from '../src/services/memoryExtractionService.ts';
import { SceneExtractionService, parseScenePlan } from '../src/services/sceneExtractionService.ts';
import { PersonaGenerationService } from '../src/services/personaGenerationService.ts';
import { MemoryPipeline } from '../src/services/memoryPipeline.ts';
import { DEFAULT_MEMORY_FEATURE_FLAGS } from '../src/application/featureFlags.ts';
import type { ConversationTurn } from '../src/application/memoryTypes.ts';

class FakeMemoryStorage implements MemoryFileStorage {
	files = new Map<string, string>();
	async read(path: string): Promise<string> { return this.files.get(path) ?? ''; }
	async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
	async list(prefix: string): Promise<string[]> { return [...this.files.keys()].filter((p) => p.startsWith(prefix)); }
}

class FakeModel implements ModelPort {
	responses: string[];
	index = 0;
	constructor(responses: string[]) { this.responses = responses; }
	async generate(): Promise<string> {
		const value = this.responses[this.index] ?? '';
		this.index += 1;
		return value;
	}
}

const ctx = (): RequestContext => createRequestContext('workbench-agent');

function turn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
	return { id: 't1', sessionKey: 's', sessionId: 'sid', role: 'user', content: '读书', timestamp: '2026-08-18T10:00:00.000Z', ...overrides };
}

test('sanitizeJsonForParse strips fences and keeps the JSON value', () => {
	const text = '前缀文本 \`\`\`json\n[{"a":1}]\n\`\`\` 后缀';
	const json = sanitizeJsonForParse(text);
	assert.equal(json, '[{"a":1}]');
});

test('parseExtractedMemories parses model JSON and ignores chatter', () => {
	const memories = parseExtractedMemories('好的，以下是结果：\n[{"content":"用户偏好关键词搜索","type":"persona","priority":90,"scene_name":"search","source_message_ids":["t1"]}]');
	assert.equal(memories.length, 1);
	assert.equal(memories[0]?.content, '用户偏好关键词搜索');
	assert.equal(memories[0]?.type, 'persona');
});

test('memory extraction falls back to episodic atoms when the model fails', async () => {
	const model = new FakeModel([]);
	model.generate = async () => { throw new Error('no model'); };
	const extractor = new MemoryExtractionService(model);
	const atoms = await extractor.extractL1('s', 'sid', [turn()], ctx());
	assert.equal(atoms.length, 1);
	assert.equal(atoms[0]?.type, 'episodic');
	assert.equal(atoms[0]?.source_message_ids[0], 't1');
});

test('scene plan parser accepts operations and drops junk', () => {
	const plan = parseScenePlan('{"operations":[{"action":"create","slug":"help","filename":"help.md","summary":"帮用户","content":"# 场景","source_atoms":[]}]}');
	assert.equal(plan.operations.length, 1);
	assert.equal(plan.operations[0]?.slug, 'help');
});

test('persona generation falls back to existing persona when the model fails', async () => {
	const model = new FakeModel([]);
	model.generate = async () => { throw new Error('no model'); };
	const storage = new FakeMemoryStorage();
	const persona = new PersonaStore(storage);
	const generator = new PersonaGenerationService(model, persona);
	const block = await generator.generate({ body: '旧画像', navigation: '', version: 2, updated: '' }, [], [], ctx());
	assert.equal(block.body, '旧画像');
	assert.equal(block.version, 2);
});

test('memory pipeline extracts atoms, scenes and persona end-to-end', async () => {
	const storage = new FakeMemoryStorage();
	const conversations = new ConversationStore(storage);
	const atoms = new AtomStore(storage);
	const scenes = new SceneStore(storage);
	const persona = new PersonaStore(storage);
	await conversations.append(turn({ id: 't1', content: '用户偏好关键词搜索' }), ctx());

	const model = new FakeModel([
		'[{"content":"用户偏好关键词搜索","type":"persona","priority":90,"scene_name":"search","source_message_ids":["t1"]}]',
		'{"operations":[{"action":"create","slug":"help-user","filename":"help-user.md","summary":"帮用户整理知识库","content":"# 场景","source_atoms":[]}]}',
		'用户是 Obsidian 深度用户',
	]);
	const pipeline = new MemoryPipeline({
		conversations,
		atoms,
		scenes,
		persona,
		extractor: new MemoryExtractionService(model),
		sceneExtractor: new SceneExtractionService(model, scenes),
		personaGenerator: new PersonaGenerationService(model, persona),
		flags: { ...DEFAULT_MEMORY_FEATURE_FLAGS, enabled: true, captureL0: true, autoExtract: true, autoRecall: true },
	});

	await pipeline.runExtraction('s', 'sid', ctx());
	assert.equal((await atoms.listRecent(10, ctx())).length, 1);
	assert.equal((await scenes.listIndex(ctx())).length, 1);
	assert.equal((await persona.read(ctx()))?.body, '用户是 Obsidian 深度用户');
});
