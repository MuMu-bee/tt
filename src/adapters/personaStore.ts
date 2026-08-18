import type { RequestContext } from '../application/requestContext.ts';
import { MEMORY_PERSONA_PATH, type PersonaBlock } from '../application/memoryTypes.ts';
import type { MemoryFileStorage, PersonaStorePort } from '../ports/memoryPort.ts';
import { parseYamlFrontmatter } from '../domain/vault-document.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

const NAVIGATION_HEADING = '## 场景导航';

/** L3 store: persona.md with a stable body and an auto-appended scene navigation section. */
export class PersonaStore implements PersonaStorePort {
	private readonly queue = new SerialQueue();
	private readonly storage: MemoryFileStorage;

	constructor(storage: MemoryFileStorage) {
		this.storage = storage;
	}

	async read(context: RequestContext): Promise<PersonaBlock | null> {
		const raw = await this.storage.read(MEMORY_PERSONA_PATH, context);
		if (!raw) return null;
		const parsed = parseYamlFrontmatter(raw);
		const fm = parsed.frontmatter;
		const bodyAndNav = splitNavigation(parsed.body);
		return {
			body: bodyAndNav.body.trim(),
			navigation: bodyAndNav.navigation.trim(),
			version: asNumber(fm.version) ?? 1,
			updated: asString(fm.updated) ?? '',
		};
	}

	async write(persona: PersonaBlock, context: RequestContext): Promise<void> {
		return this.queue.run(async () => {
			await this.storage.write(MEMORY_PERSONA_PATH, formatPersona(persona), context);
		});
	}
}

function formatPersona(persona: PersonaBlock): string {
	const navigation = persona.navigation.trim() ? `\n\n${NAVIGATION_HEADING}\n\n${persona.navigation.trim()}\n` : '';
	return [
		'---',
		'memory_layer: l3',
		`version: ${persona.version}`,
		`updated: ${persona.updated}`,
		'---',
		'',
		persona.body.trim(),
		navigation,
	].join('\n');
}

function splitNavigation(body: string): { body: string; navigation: string } {
	const index = body.indexOf(NAVIGATION_HEADING);
	if (index < 0) return { body, navigation: '' };
	return {
		body: body.slice(0, index),
		navigation: body.slice(index + NAVIGATION_HEADING.length),
	};
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}