import type { RequestContext } from '../application/requestContext.ts';
import type { MemoryAtom, PersonaBlock, SceneIndexEntry } from '../application/memoryTypes.ts';
import type { ModelPort } from '../ports/modelPort.ts';
import type { PersonaStorePort } from '../ports/memoryPort.ts';

const PERSONA_PROMPT = '你是人格画像生成器。根据现有画像、最近的记忆原子和场景，输出更新后的用户画像正文（Markdown，不含 frontmatter）。\n' +
	'只输出正文，不要输出解释。\n\n';

export class PersonaGenerationService {
	private readonly model: ModelPort;
	private readonly persona: PersonaStorePort;

	constructor(model: ModelPort, persona: PersonaStorePort) {
		this.model = model;
		this.persona = persona;
	}

	async generate(existing: PersonaBlock | null, atoms: MemoryAtom[], scenes: SceneIndexEntry[], context: RequestContext): Promise<PersonaBlock> {
		const now = new Date().toISOString();
		const navigation = formatNavigation(scenes);
		try {
			const prompt = PERSONA_PROMPT + formatExisting(existing) + formatAtoms(atoms) + formatScenes(scenes);
			const body = stripFences(await this.model.generate(prompt, context)).trim() || (existing?.body ?? '');
			return { body, navigation, version: (existing?.version ?? 0) + 1, updated: now };
		} catch {
			if (existing) return { ...existing, navigation, updated: now };
			return { body: fallbackBody(atoms), navigation, version: 1, updated: now };
		}
	}
}

function formatExisting(existing: PersonaBlock | null): string {
	return existing?.body ? '现有画像：\n' + existing.body + '\n\n' : '';
}

function formatAtoms(atoms: MemoryAtom[]): string {
	if (atoms.length === 0) return '';
	return '最近记忆原子：\n' + atoms.map((atom) => '- ' + atom.content).join('\n') + '\n\n';
}

function formatScenes(scenes: SceneIndexEntry[]): string {
	if (scenes.length === 0) return '';
	return '现有场景：\n' + scenes.map((scene) => '- ' + scene.summary).join('\n') + '\n';
}

function formatNavigation(scenes: SceneIndexEntry[]): string {
	if (scenes.length === 0) return '';
	return scenes.slice(0, 10).map((scene) => '- [[' + scene.path.replace(/\.md$/u, '') + '|' + scene.summary + ']]（热度 ' + scene.heat + '）').join('\n');
}

function stripFences(text: string): string {
	return text.replace(/^\s*```(?:markdown|md)?\s*/iu, '').replace(/\s*```\s*$/u, '').trim();
}

function fallbackBody(atoms: MemoryAtom[]): string {
	if (atoms.length === 0) return '# 用户画像\n';
	return '# 用户画像\n\n' + atoms.slice(0, 8).map((atom) => '- ' + atom.content).join('\n') + '\n';
}
