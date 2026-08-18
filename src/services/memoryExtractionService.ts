import type { RequestContext } from '../application/requestContext.ts';
import type { ConversationTurn, ExtractedMemory, MemoryAtom, MemoryAtomType } from '../application/memoryTypes.ts';
import type { ModelPort } from '../ports/modelPort.ts';

const EXTRACTION_PROMPT = '你是记忆提炼器。从下面的对话中提取值得长期记住的关键信息点。\n\n' +
	'只输出 JSON 数组，不要输出任何解释或 Markdown 代码块。每个元素包含：\n' +
	'{"content":"信息点内容","type":"persona|episodic|instruction","priority":0-100,"scene_name":"场景名","source_message_ids":["消息id"]}\n\n' +
	'type 含义：persona=稳定偏好/特质；episodic=带时间的客观事件；instruction=用户对 AI 的长期行为规则。\n' +
	'没有值得记的内容时输出 []。\n\n对话：\n';

export class MemoryExtractionService {
	private readonly model: ModelPort;

	constructor(model: ModelPort) {
		this.model = model;
	}

	async extractL1(sessionKey: string, sessionId: string, turns: ConversationTurn[], context: RequestContext): Promise<MemoryAtom[]> {
		if (turns.length === 0) return [];
		const prompt = EXTRACTION_PROMPT + formatTurns(turns);
		let text = '';
		try {
			text = await this.model.generate(prompt, context);
		} catch {
			return fallbackAtoms(sessionKey, sessionId, turns);
		}
		const extracted = parseExtractedMemories(text);
		if (extracted.length === 0) return fallbackAtoms(sessionKey, sessionId, turns);
		const now = new Date().toISOString();
		return extracted.map((item, index) => toMemoryAtom(item, index, now, sessionKey, sessionId));
	}
}

export function parseExtractedMemories(text: string): ExtractedMemory[] {
	const json = sanitizeJsonForParse(text);
	if (!json) return [];
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return [];
		return value.filter(isExtractedMemory).map(normalizeExtractedMemory);
	} catch {
		return [];
	}
}

export function sanitizeJsonForParse(text: string): string {
	const withoutFences = text.replace(/^\s*```(?:json)?\s*/iu, '').replace(/\s*```\s*$/u, '');
	const starts = [withoutFences.indexOf('['), withoutFences.indexOf('{')].filter((index) => index >= 0);
	const start = starts.length > 0 ? Math.min(...starts) : 0;
	const trimmed = withoutFences.slice(start);
	const arrayEnd = trimmed.lastIndexOf(']');
	const objectEnd = trimmed.lastIndexOf('}');
	const end = Math.max(arrayEnd, objectEnd);
	return trimmed.slice(0, end + 1);
}

function formatTurns(turns: ConversationTurn[]): string {
	return turns.map((turn) => '[' + turn.id + '] ' + turn.role + ': ' + turn.content).join('\n');
}

function fallbackAtoms(sessionKey: string, sessionId: string, turns: ConversationTurn[]): MemoryAtom[] {
	const now = new Date().toISOString();
	return turns.slice(0, 8).map((turn, index) => ({
		id: 'm_fallback_' + Date.now() + '_' + index,
		content: turn.content.slice(0, 200),
		type: 'episodic',
		priority: 10,
		scene_name: 'conversation',
		source_message_ids: [turn.id],
		source_paths: [],
		metadata: {},
		createdAt: now,
		updatedAt: now,
		sessionKey,
		sessionId,
	}));
}

function toMemoryAtom(item: ExtractedMemory, index: number, now: string, sessionKey: string, sessionId: string): MemoryAtom {
	return {
		id: 'm_' + Date.now() + '_' + index,
		content: item.content.trim(),
		type: item.type,
		priority: clampPriority(item.priority),
		scene_name: item.scene_name.trim() || 'general',
		source_message_ids: item.source_message_ids,
		source_paths: [],
		metadata: {},
		createdAt: now,
		updatedAt: now,
		sessionKey,
		sessionId,
	};
}

function isExtractedMemory(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.content === 'string'
		&& (record.type === 'persona' || record.type === 'episodic' || record.type === 'instruction');
}

function normalizeExtractedMemory(value: unknown): ExtractedMemory {
	const record = value as Record<string, unknown>;
	return {
		content: typeof record.content === 'string' ? record.content : '',
		type: (record.type as MemoryAtomType) ?? 'episodic',
		priority: typeof record.priority === 'number' ? record.priority : 10,
		scene_name: typeof record.scene_name === 'string' ? record.scene_name : 'general',
		source_message_ids: Array.isArray(record.source_message_ids)
			? record.source_message_ids.filter((item): item is string => typeof item === 'string')
			: [],
	};
}

function clampPriority(priority: number): number {
	if (!Number.isFinite(priority)) return 10;
	return Math.max(-1, Math.min(100, Math.round(priority)));
}
