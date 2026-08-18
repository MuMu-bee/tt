import type { RequestContext } from '../application/requestContext.ts';
import type { ConversationTurn, MemoryRole } from '../application/memoryTypes.ts';
import type { ConversationStorePort, MemoryCapturePort } from '../ports/memoryPort.ts';

/** Captures raw L0 conversation turns into the conversation store. */
export class MemoryCaptureService implements MemoryCapturePort {
	private readonly conversations: ConversationStorePort;

	constructor(conversations: ConversationStorePort) {
		this.conversations = conversations;
	}

	async capture(sessionKey: string, sessionId: string, role: MemoryRole, content: string, context: RequestContext): Promise<void> {
		const trimmed = content.trim();
		if (!trimmed) return;
		const turn: ConversationTurn = {
			id: generateId(),
			sessionKey,
			sessionId,
			role,
			content: trimmed,
			timestamp: new Date().toISOString(),
		};
		await this.conversations.append(turn, context);
	}
}

function generateId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}