import { createRequestContext, type RequestContext } from '../application/requestContext.ts';
import type { MemoryFeatureFlags } from '../application/featureFlags.ts';
import type { ConversationTurn, MemoryAtom, MemoryRecallBundle, MemoryRole } from '../application/memoryTypes.ts';
import type { AtomStorePort, ConversationStorePort, MemoryCapturePort, MemoryRecallPort, PersonaStorePort, SceneStorePort } from '../ports/memoryPort.ts';
import { MemoryCaptureService } from './memoryCaptureService.ts';
import { MemoryRecallService } from './memoryRecallService.ts';
import type { MemoryExtractionService } from './memoryExtractionService.ts';
import type { SceneExtractionService } from './sceneExtractionService.ts';
import type { PersonaGenerationService } from './personaGenerationService.ts';

type Timer = ReturnType<typeof setTimeout>;

export interface MemoryPipelineOptions {
	conversations: ConversationStorePort;
	atoms: AtomStorePort;
	scenes: SceneStorePort;
	persona: PersonaStorePort;
	extractor: MemoryExtractionService;
	sceneExtractor: SceneExtractionService;
	personaGenerator: PersonaGenerationService;
	flags: MemoryFeatureFlags;
	/** Warm-up threshold grows 1→2→4→… up to this value. Default 5. */
	everyNConversations?: number;
	/** L1 idle flush timeout in seconds. Default 600. */
	l1IdleTimeoutSeconds?: number;
	/** Delay after L1 before L2 may run, in seconds. Default 10. */
	l2DelayAfterL1Seconds?: number;
	/** Minimum interval between L2 runs, in seconds. Default 60. */
	l2MinIntervalSeconds?: number;
	/** Maximum interval between L2 runs, in seconds. Default 3600. */
	l2MaxIntervalSeconds?: number;
}

/** Wires L0 capture, L1/L2/L3 auto-extraction and recall behind one feature-flag gate. */
export class MemoryPipeline implements MemoryCapturePort, MemoryRecallPort {
	private readonly captureService: MemoryCaptureService;
	private readonly recallService: MemoryRecallService;
	private readonly conversations: ConversationStorePort;
	private readonly atoms: AtomStorePort;
	private readonly scenes: SceneStorePort;
	private readonly persona: PersonaStorePort;
	private readonly extractor: MemoryExtractionService;
	private readonly sceneExtractor: SceneExtractionService;
	private readonly personaGenerator: PersonaGenerationService;
	private readonly flags: MemoryFeatureFlags;
	private readonly turnCounts = new Map<string, number>();
	private readonly nextThresholds = new Map<string, number>();
	private readonly inFlight = new Set<string>();
	private readonly idleTimers = new Map<string, Timer>();
	private readonly l2Timers = new Map<string, Timer>();
	private readonly l2State = new Map<string, { lastL2: number; nextL2: number }>();
	private l3Promise: Promise<void> | null = null;
	private readonly everyN: number;
	private readonly l1IdleTimeoutSeconds: number;
	private readonly l2DelayAfterL1Ms: number;
	private readonly l2MinIntervalMs: number;
	private readonly l2MaxIntervalMs: number;

	constructor(options: MemoryPipelineOptions) {
		this.conversations = options.conversations;
		this.atoms = options.atoms;
		this.scenes = options.scenes;
		this.persona = options.persona;
		this.extractor = options.extractor;
		this.sceneExtractor = options.sceneExtractor;
		this.personaGenerator = options.personaGenerator;
		this.flags = options.flags;
		this.captureService = new MemoryCaptureService(options.conversations);
		this.recallService = new MemoryRecallService(options.conversations, options.atoms, options.scenes, options.persona);
		this.everyN = Math.max(1, options.everyNConversations ?? 5);
		this.l1IdleTimeoutSeconds = Math.max(1, options.l1IdleTimeoutSeconds ?? 600);
		this.l2DelayAfterL1Ms = Math.max(0, options.l2DelayAfterL1Seconds ?? 10) * 1000;
		this.l2MinIntervalMs = Math.max(0, options.l2MinIntervalSeconds ?? 60) * 1000;
		this.l2MaxIntervalMs = Math.max(this.l2MinIntervalMs, options.l2MaxIntervalSeconds ?? 3600) * 1000;
	}

	async capture(sessionKey: string, sessionId: string, role: MemoryRole, content: string, context: RequestContext): Promise<void> {
		if (!this.flags.enabled) return;
		if (this.flags.captureL0) await this.captureService.capture(sessionKey, sessionId, role, content, context);
		if (!this.flags.autoExtract || role !== 'user') return;
		const count = (this.turnCounts.get(sessionKey) ?? 0) + 1;
		this.turnCounts.set(sessionKey, count);
		this.resetL1Idle(sessionKey, sessionId);
		const threshold = this.nextThresholds.get(sessionKey) ?? 1;
		if (count >= threshold) {
			this.turnCounts.set(sessionKey, 0);
			this.nextThresholds.set(sessionKey, Math.min(this.everyN, threshold * 2));
			void this.scheduleL1(sessionKey, sessionId, context);
		}
	}

	async recall(query: string, context: RequestContext): Promise<MemoryRecallBundle> {
		if (!this.flags.enabled || !this.flags.autoRecall) return emptyBundle();
		return this.recallService.recall(query, context);
	}

	/** Immediate full-chain extraction (used by tests and manual calls). */
	async runExtraction(sessionKey: string, sessionId: string, context: RequestContext): Promise<void> {
		const key = 'extract:' + sessionKey;
		if (this.inFlight.has(key)) return;
		this.inFlight.add(key);
		try {
			const atoms = await this.extractAndSaveAtoms(sessionKey, sessionId, context);
			if (atoms.length === 0) return;
			const entries = await this.runL2Now(context);
			if (entries.length > 0) await this.runL3Now(context);
		} catch (error) {
			console.error('[agent-dashboard] 记忆自动提炼失败。', error);
		} finally {
			this.inFlight.delete(key);
		}
	}

	dispose(): void {
		for (const timer of this.idleTimers.values()) clearTimeout(timer);
		for (const timer of this.l2Timers.values()) clearTimeout(timer);
		this.idleTimers.clear();
		this.l2Timers.clear();
	}

	private async scheduleL1(sessionKey: string, sessionId: string, context: RequestContext): Promise<void> {
		const key = 'extract:' + sessionKey;
		if (this.inFlight.has(key)) return;
		this.inFlight.add(key);
		try {
			const atoms = await this.extractAndSaveAtoms(sessionKey, sessionId, context);
			if (atoms.length === 0) return;
			this.scheduleL2(context);
		} catch (error) {
			console.error('[agent-dashboard] L1 提炼失败。', error);
		} finally {
			this.inFlight.delete(key);
		}
	}

	private async extractAndSaveAtoms(sessionKey: string, sessionId: string, context: RequestContext): Promise<MemoryAtom[]> {
		const turns = (await this.conversations.listRecent(50, context))
			.filter((turn: ConversationTurn) => turn.sessionKey === sessionKey)
			.reverse();
		const atoms = await this.extractor.extractL1(sessionKey, sessionId, turns, context);
		for (const atom of atoms) await this.atoms.save(atom, context);
		return atoms;
	}

	private scheduleL2(context: RequestContext): void {
		const key = 'global';
		const now = Date.now();
		const state = this.l2State.get(key) ?? { lastL2: 0, nextL2: 0 };
		const earliest = state.lastL2 + this.l2MinIntervalMs;
		const next = Math.min(this.l2MaxIntervalMs, Math.max(now + this.l2DelayAfterL1Ms, earliest));
		state.nextL2 = next;
		this.l2State.set(key, state);
		const delay = Math.max(0, next - now);
		const existing = this.l2Timers.get(key);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			state.lastL2 = Date.now();
			void this.runL2(context);
		}, delay);
		unref(timer);
		this.l2Timers.set(key, timer);
	}

	private async runL2(context: RequestContext): Promise<void> {
		const atoms = (await this.atoms.listRecent(20, context));
		if (atoms.length === 0) return;
		const plan = await this.sceneExtractor.planScenes(atoms, context);
		const entries = await this.sceneExtractor.applyPlan(plan, context);
		if (entries.length > 0) this.scheduleL3(context);
	}

	private async runL2Now(context: RequestContext) {
		const atoms = (await this.atoms.listRecent(20, context));
		if (atoms.length === 0) return [];
		const plan = await this.sceneExtractor.planScenes(atoms, context);
		return this.sceneExtractor.applyPlan(plan, context);
	}

	private scheduleL3(context: RequestContext): void {
		if (this.l3Promise) return;
		this.l3Promise = this.runL3(context).finally(() => { this.l3Promise = null; });
	}

	private async runL3(context: RequestContext): Promise<void> {
		const atoms = await this.atoms.listRecent(20, context);
		const scenes = await this.scenes.listIndex(context);
		const existing = await this.persona.read(context);
		const block = await this.personaGenerator.generate(existing, atoms, scenes, context);
		await this.persona.write(block, context);
	}

	private async runL3Now(context: RequestContext): Promise<void> {
		if (this.l3Promise) return this.l3Promise;
		this.l3Promise = this.runL3(context).finally(() => { this.l3Promise = null; });
		return this.l3Promise;
	}

	private resetL1Idle(sessionKey: string, sessionId: string): void {
		const existing = this.idleTimers.get(sessionKey);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			const pending = this.turnCounts.get(sessionKey) ?? 0;
			if (pending > 0) {
				this.turnCounts.set(sessionKey, 0);
				void this.scheduleL1(sessionKey, sessionId, createRequestContext('background-task'));
			}
		}, this.l1IdleTimeoutSeconds * 1000);
		unref(timer);
		this.idleTimers.set(sessionKey, timer);
	}
}

function emptyBundle(): MemoryRecallBundle {
	return { l3: null, l2: [], l1: [], l0: [], drillDown: { used: false } };
}

function unref(timer: Timer): void {
	const maybeUnref = timer as Timer & { unref?: () => void };
	maybeUnref.unref?.();
}
