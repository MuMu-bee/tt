import type { RequestContext } from '../application/requestContext.ts';
import type { ConversationTurn, MemoryAtom, MemoryRecallBundle, MemoryRole, PersonaBlock, SceneBlock, SceneIndexEntry } from '../application/memoryTypes.ts';

/** Minimal file storage used by memory adapters. Implementations may be Vault- or test-backed. */
export interface MemoryFileStorage {
	/** Returns empty string when the path does not exist. */
	read(path: string, context: RequestContext): Promise<string>;
	write(path: string, content: string, context: RequestContext): Promise<void>;
	list(prefix: string, context: RequestContext): Promise<string[]>;
}

export interface ConversationStorePort {
	append(turn: ConversationTurn, context: RequestContext): Promise<void>;
	listRecent(limit: number, context: RequestContext): Promise<ConversationTurn[]>;
	search(query: string, limit: number, context: RequestContext): Promise<ConversationTurn[]>;
}

export interface AtomStorePort {
	save(atom: MemoryAtom, context: RequestContext): Promise<void>;
	search(query: string, limit: number, context: RequestContext): Promise<MemoryAtom[]>;
	listRecent(limit: number, context: RequestContext): Promise<MemoryAtom[]>;
}

export interface SceneStorePort {
	listIndex(context: RequestContext): Promise<SceneIndexEntry[]>;
	read(slug: string, context: RequestContext): Promise<SceneBlock | null>;
	write(scene: SceneBlock, context: RequestContext): Promise<void>;
}

export interface PersonaStorePort {
	read(context: RequestContext): Promise<PersonaBlock | null>;
	write(persona: PersonaBlock, context: RequestContext): Promise<void>;
}

export interface MemoryCapturePort {
	capture(sessionKey: string, sessionId: string, role: MemoryRole, content: string, context: RequestContext): Promise<void>;
}

export interface MemoryRecallPort {
	recall(query: string, context: RequestContext): Promise<MemoryRecallBundle>;
}

/** Facade used by ChatService: capture + recall + (in the pipeline) auto-extraction. */
export interface MemoryChatHooks {
	captureTurn(sessionKey: string, sessionId: string, role: MemoryRole, content: string, context: RequestContext): Promise<void>;
	recall(query: string, context: RequestContext): Promise<MemoryRecallBundle>;
}
