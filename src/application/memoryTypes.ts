/** Default derived-memory root. Like `dashboard/`, it is excluded from the Vault knowledge index. */
export const MEMORY_ROOT = '_memory';
export const MEMORY_CONVERSATIONS_DIR = `${MEMORY_ROOT}/conversations`;
export const MEMORY_RECORDS_DIR = `${MEMORY_ROOT}/records`;
export const MEMORY_SCENES_DIR = `${MEMORY_ROOT}/scenes`;
export const MEMORY_PERSONA_PATH = `${MEMORY_ROOT}/persona.md`;
export const MEMORY_SCENE_INDEX_PATH = `${MEMORY_ROOT}/.metadata/scene_index.json`;

/* Phase 4 architecture reservations. These directories are not yet produced by
   any pipeline; keeping the paths here prevents them from being magic strings
   scattered through the codebase later. */
export const MEMORY_SKILLS_DIR = `${MEMORY_ROOT}/skills`;
export const MEMORY_WIKI_DIR = `${MEMORY_ROOT}/wiki`;
export const MEMORY_CODE_GRAPH_DIR = `${MEMORY_ROOT}/code-graph`;

export interface SkillAsset {
	name: string;
	path: string;
	description: string;
	version: number;
	updatedAt: string;
}

export interface WikiPage {
	title: string;
	path: string;
	summary: string;
	updatedAt: string;
}

export interface CodeGraphNode {
	id: string;
	label: string;
	kind: 'file' | 'symbol' | 'module';
	path: string;
}

export type MemoryRole = 'user' | 'assistant';

/** L0: raw conversation turn. */
export interface ConversationTurn {
	id: string;
	sessionKey: string;
	sessionId: string;
	role: MemoryRole;
	content: string;
	timestamp: string;
}

export type MemoryAtomType = 'persona' | 'episodic' | 'instruction';

/** L1: an atomic memory extracted from conversations. */
export interface MemoryAtom {
	id: string;
	content: string;
	type: MemoryAtomType;
	priority: number;
	scene_name: string;
	source_message_ids: string[];
	source_paths: string[];
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	sessionKey: string;
	sessionId: string;
}

/** L2 index entry stored in scene_index.json. */
export interface SceneIndexEntry {
	slug: string;
	filename: string;
	path: string;
	summary: string;
	heat: number;
	created: string;
	updated: string;
	source_atoms: string[];
}

/** L2: a scene block read back from a Markdown file. */
export interface SceneBlock extends SceneIndexEntry {
	content: string;
}

/** L3: persona body plus the auto-appended scene navigation section. */
export interface PersonaBlock {
	body: string;
	navigation: string;
	version: number;
	updated: string;
}

/** Bundle returned by the progressive-disclosure recall service. */
export interface MemoryRecallBundle {
	l3: string | null;
	l2: SceneIndexEntry[];
	l1: MemoryAtom[];
	l0: ConversationTurn[];
	drillDown: { used: boolean; reason?: string };
}

/** Raw L1 memory produced by the extraction LLM before it is persisted. */
export interface ExtractedMemory {
	content: string;
	type: MemoryAtomType;
	priority: number;
	scene_name: string;
	source_message_ids: string[];
}

/** L2 write operation produced by the scene-extraction LLM. */
export interface SceneOperation {
	action: 'create' | 'update' | 'merge';
	slug: string;
	filename: string;
	summary: string;
	content: string;
	source_atoms: string[];
}

export interface ScenePlan {
	operations: SceneOperation[];
}
