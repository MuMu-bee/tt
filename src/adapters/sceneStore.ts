import type { RequestContext } from '../application/requestContext.ts';
import { MEMORY_SCENES_DIR, MEMORY_SCENE_INDEX_PATH, type SceneBlock, type SceneIndexEntry } from '../application/memoryTypes.ts';
import type { MemoryFileStorage, SceneStorePort } from '../ports/memoryPort.ts';
import { parseYamlFrontmatter } from '../domain/vault-document.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

/** L2 store: human-readable scene Markdown + a machine-maintained JSON index. */
export class SceneStore implements SceneStorePort {
	private readonly queue = new SerialQueue();
	private readonly storage: MemoryFileStorage;

	constructor(storage: MemoryFileStorage) {
		this.storage = storage;
	}

	async listIndex(context: RequestContext): Promise<SceneIndexEntry[]> {
		const raw = await this.storage.read(MEMORY_SCENE_INDEX_PATH, context);
		if (!raw) return [];
		return parseSceneIndex(raw);
	}

	async read(slug: string, context: RequestContext): Promise<SceneBlock | null> {
		const entries = await this.listIndex(context);
		const entry = entries.find((item) => item.slug === slug);
		if (!entry) return null;
		const raw = await this.storage.read(entry.path, context);
		if (!raw) return null;
		return parseSceneMarkdown(entry, raw);
	}

	async write(scene: SceneBlock, context: RequestContext): Promise<void> {
		return this.queue.run(async () => {
			await this.storage.write(scene.path, formatSceneMarkdown(scene), context);
			const entries = await this.listIndex(context);
			const next = entries.filter((item) => item.slug !== scene.slug);
			next.push(toIndexEntry(scene));
			next.sort((a, b) => b.heat - a.heat);
			await this.storage.write(MEMORY_SCENE_INDEX_PATH, JSON.stringify(next, null, 2), context);
		});
	}
}

function formatSceneMarkdown(scene: SceneBlock): string {
	const sourceAtoms = scene.source_atoms.map((atom) => `  - ${atom}`).join('\n');
	return [
		'---',
		'memory_layer: l2',
		`scene: ${scene.slug}`,
		`summary: ${yamlString(scene.summary)}`,
		`heat: ${scene.heat}`,
		`created: ${scene.created}`,
		`updated: ${scene.updated}`,
		'source_atoms:',
		...(sourceAtoms ? [sourceAtoms] : []),
		'---',
		'',
		scene.content,
	].join('\n') + '\n';
}

function parseSceneMarkdown(entry: SceneIndexEntry, raw: string): SceneBlock | null {
	const parsed = parseYamlFrontmatter(raw);
	const fm = parsed.frontmatter;
	return {
		...entry,
		slug: asString(fm.scene) ?? entry.slug,
		summary: asString(fm.summary) ?? entry.summary,
		heat: asNumber(fm.heat) ?? entry.heat,
		created: asString(fm.created) ?? entry.created,
		updated: asString(fm.updated) ?? entry.updated,
		source_atoms: asStringArray(fm.source_atoms) ?? entry.source_atoms,
		content: parsed.body.trim(),
	};
}

function parseSceneIndex(raw: string): SceneIndexEntry[] {
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value)) return [];
		return value.filter(isSceneIndexEntry);
	} catch {
		return [];
	}
}

function isSceneIndexEntry(value: unknown): value is SceneIndexEntry {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.slug === 'string' && typeof record.path === 'string';
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

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}