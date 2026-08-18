import type { RequestContext } from '../application/requestContext.ts';
import type { MemoryRecallBundle } from '../application/memoryTypes.ts';
import type { AtomStorePort, ConversationStorePort, MemoryRecallPort, PersonaStorePort, SceneStorePort } from '../ports/memoryPort.ts';

const DEFAULT_L1_LIMIT = 5;
const DEFAULT_L0_LIMIT = 3;

/** L3 → L2 → L1 → L0 progressive-disclosure recall used by the chat pipeline. */
export class MemoryRecallService implements MemoryRecallPort {
	private readonly conversations: ConversationStorePort;
	private readonly atoms: AtomStorePort;
	private readonly scenes: SceneStorePort;
	private readonly persona: PersonaStorePort;

	constructor(
		conversations: ConversationStorePort,
		atoms: AtomStorePort,
		scenes: SceneStorePort,
		persona: PersonaStorePort,
	) {
		this.conversations = conversations;
		this.atoms = atoms;
		this.scenes = scenes;
		this.persona = persona;
	}

	async recall(query: string, context: RequestContext): Promise<MemoryRecallBundle> {
		const personaBlock = await this.persona.read(context);
		const l2 = await this.scenes.listIndex(context);
		l2.sort((a, b) => b.heat - a.heat);
		const l1 = await this.atoms.search(query, DEFAULT_L1_LIMIT, context);
		const l0 = l1.length < DEFAULT_L0_LIMIT
			? await this.conversations.search(query, DEFAULT_L0_LIMIT, context)
			: [];
		return {
			l3: personaBlock?.body ?? null,
			l2,
			l1,
			l0,
			drillDown: {
				used: l0.length > 0,
				...(l0.length > 0 ? { reason: 'L1 sparse, fallback to L0' } : {}),
			},
		};
	}
}
