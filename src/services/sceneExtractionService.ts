import type { RequestContext } from '../application/requestContext.ts';
import { MEMORY_SCENES_DIR, type MemoryAtom, type SceneBlock, type SceneIndexEntry, type SceneOperation, type ScenePlan } from '../application/memoryTypes.ts';
import type { ModelPort } from '../ports/modelPort.ts';
import type { SceneStorePort } from '../ports/memoryPort.ts';
import { sanitizeJsonForParse } from './memoryExtractionService.ts';

const SCENE_PROMPT = '你是场景提炼器。根据下面的记忆原子，把属于同一场景/任务的知识合并成场景块。\n' +
	'只输出 JSON，不要输出解释。格式：{"operations":[{"action":"create|update|merge","slug":"场景标识","filename":"场景文件名.md","summary":"一句话摘要","content":"场景 Markdown 正文","source_atoms":["m_xxx"]}]}\n\n' +
	'没有需要合并的场景时输出 {"operations":[]}。\n\n记忆原子：\n';

export class SceneExtractionService {
	private readonly model: ModelPort;
	private readonly scenes: SceneStorePort;

	constructor(model: ModelPort, scenes: SceneStorePort) {
		this.model = model;
		this.scenes = scenes;
	}

	async planScenes(atoms: MemoryAtom[], context: RequestContext): Promise<ScenePlan> {
		if (atoms.length === 0) return { operations: [] };
		try {
			const text = await this.model.generate(SCENE_PROMPT + formatAtoms(atoms), context);
			return parseScenePlan(text);
		} catch {
			return { operations: [] };
		}
	}

	async applyPlan(plan: ScenePlan, context: RequestContext): Promise<SceneIndexEntry[]> {
		const entries: SceneIndexEntry[] = [];
		for (const operation of plan.operations) {
			const scene = toSceneBlock(operation);
			await this.scenes.write(scene, context);
			entries.push(toIndexEntry(scene));
		}
		return entries;
	}
}

export function parseScenePlan(text: string): ScenePlan {
	const json = sanitizeJsonForParse(text);
	if (!json) return { operations: [] };
	try {
		const value: unknown = JSON.parse(json);
		if (typeof value !== 'object' || value === null) return { operations: [] };
		const operations = (value as { operations?: unknown }).operations;
		if (!Array.isArray(operations)) return { operations: [] };
		return { operations: operations.filter(isSceneOperation).map(normalizeSceneOperation) };
	} catch {
		return { operations: [] };
	}
}

function formatAtoms(atoms: MemoryAtom[]): string {
	return atoms.map((atom) => '[' + atom.id + '] (' + atom.type + ') ' + atom.content).join('\n');
}

function isSceneOperation(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return record.action === 'create' || record.action === 'update' || record.action === 'merge';
}

function normalizeSceneOperation(value: unknown): SceneOperation {
	const record = value as Record<string, unknown>;
	const slug = typeof record.slug === 'string' ? record.slug : 'scene';
	return {
		action: (record.action as SceneOperation['action']) ?? 'create',
		slug,
		filename: typeof record.filename === 'string' ? record.filename : slug + '.md',
		summary: typeof record.summary === 'string' ? record.summary : '',
		content: typeof record.content === 'string' ? record.content : '',
		source_atoms: Array.isArray(record.source_atoms) ? record.source_atoms.filter((item): item is string => typeof item === 'string') : [],
	};
}

function toSceneBlock(operation: SceneOperation): SceneBlock {
	const now = new Date().toISOString();
	return {
		slug: operation.slug,
		filename: operation.filename,
		path: MEMORY_SCENES_DIR + '/' + operation.filename,
		summary: operation.summary,
		heat: 1,
		created: now,
		updated: now,
		source_atoms: operation.source_atoms,
		content: operation.content,
	};
}

function toIndexEntry(scene: SceneBlock): SceneIndexEntry {
	return {
		slug: scene.slug,
		filename: scene.filename,
		path: scene.path,
		summary: scene.summary,
		heat: scene.heat,
		created: scene.created,
		updated: scene.updated,
		source_atoms: scene.source_atoms,
	};
}
