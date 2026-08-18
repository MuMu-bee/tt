import type { RequestContext } from '../application/requestContext.ts';
import { MEMORY_CONVERSATIONS_DIR, type ConversationTurn } from '../application/memoryTypes.ts';
import type { ConversationStorePort, MemoryFileStorage } from '../ports/memoryPort.ts';
import { parseJsonlLines } from './jsonl-utils.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

/** L0 store: appends raw conversation turns to day-sharded JSONL files. */
export class ConversationStore implements ConversationStorePort {
	private readonly queue = new SerialQueue();
	private readonly storage: MemoryFileStorage;

	constructor(storage: MemoryFileStorage) {
		this.storage = storage;
	}

	async append(turn: ConversationTurn, context: RequestContext): Promise<void> {
		return this.queue.run(async () => {
			const path = conversationPath(turn.timestamp);
			const existing = await this.storage.read(path, context);
			await this.storage.write(path, existing + JSON.stringify(turn) + '\n', context);
		});
	}

	async listRecent(limit: number, context: RequestContext): Promise<ConversationTurn[]> {
		const turns = await this.readAll(context);
		return turns
			.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
			.slice(0, Math.max(0, limit));
	}

	async search(query: string, limit: number, context: RequestContext): Promise<ConversationTurn[]> {
		const terms = tokenize(query);
		if (terms.length === 0) return [];
		const turns = await this.readAll(context);
		return turns
			.map((turn) => ({ turn, score: scoreText(turn.content, terms) }))
			.filter((hit) => hit.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, Math.max(0, limit))
			.map((hit) => hit.turn);
	}

	private async readAll(context: RequestContext): Promise<ConversationTurn[]> {
		const files = await this.storage.list(MEMORY_CONVERSATIONS_DIR, context);
		const turns: ConversationTurn[] = [];
		for (const file of files) {
			const raw = await this.storage.read(file, context);
			if (!raw) continue;
			turns.push(...parseJsonlLines<ConversationTurn>(raw, isConversationTurn).records);
		}
		return turns;
	}
}

function conversationPath(timestamp: string): string {
	const day = (timestamp || new Date().toISOString()).slice(0, 10);
	return `${MEMORY_CONVERSATIONS_DIR}/${day}.jsonl`;
}

function isConversationTurn(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.id === 'string'
		&& (record.role === 'user' || record.role === 'assistant')
		&& typeof record.content === 'string'
		&& typeof record.timestamp === 'string';
}

function tokenize(query: string): string[] {
	return query.toLowerCase().split(/\s+/u).filter((word) => word.length > 1);
}

function scoreText(content: string, terms: string[]): number {
	const haystack = content.toLowerCase();
	return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}