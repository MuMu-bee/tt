import type { RequestContext } from '../application/requestContext.ts';
import { MEMORY_RECORDS_DIR, type MemoryAtom } from '../application/memoryTypes.ts';
import type { AtomStorePort, MemoryFileStorage } from '../ports/memoryPort.ts';
import { parseJsonlLines } from './jsonl-utils.ts';
import { SerialQueue } from '../utils/serialQueue.ts';

/** L1 store: append-only JSONL atoms plus a lazy in-memory keyword index. */
export class AtomStore implements AtomStorePort {
	private readonly queue = new SerialQueue();
	private readonly atoms = new Map<string, MemoryAtom>();
	private readonly storage: MemoryFileStorage;
	private loaded = false;
	private loadPromise: Promise<void> | null = null;

	constructor(storage: MemoryFileStorage) {
		this.storage = storage;
	}

	async save(atom: MemoryAtom, context: RequestContext): Promise<void> {
		return this.queue.run(async () => {
			await this.load(context);
			this.atoms.set(atom.id, atom);
			const path = atomPath(atom.createdAt);
			const existing = await this.storage.read(path, context);
			await this.storage.write(path, existing + JSON.stringify(atom) + '\n', context);
		});
	}

	async search(query: string, limit: number, context: RequestContext): Promise<MemoryAtom[]> {
		await this.load(context);
		const terms = tokenize(query);
		if (terms.length === 0) return [];
		return [...this.atoms.values()]
			.map((atom) => ({ atom, score: scoreAtom(atom, terms) }))
			.filter((hit) => hit.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, Math.max(0, limit))
			.map((hit) => hit.atom);
	}

	async listRecent(limit: number, context: RequestContext): Promise<MemoryAtom[]> {
		await this.load(context);
		return [...this.atoms.values()]
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
			.slice(0, Math.max(0, limit));
	}

	private async load(context: RequestContext): Promise<void> {
		if (this.loaded) return;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.doLoad(context)
			.finally(() => { this.loadPromise = null; });
		return this.loadPromise;
	}

	private async doLoad(context: RequestContext): Promise<void> {
		const files = await this.storage.list(MEMORY_RECORDS_DIR, context);
		for (const file of files) {
			const raw = await this.storage.read(file, context);
			if (!raw) continue;
			for (const atom of parseJsonlLines<MemoryAtom>(raw, isMemoryAtom).records) {
				this.atoms.set(atom.id, atom);
			}
		}
		this.loaded = true;
	}
}

function atomPath(timestamp: string): string {
	const day = (timestamp || new Date().toISOString()).slice(0, 10);
	return `${MEMORY_RECORDS_DIR}/${day}.jsonl`;
}

function isMemoryAtom(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.id === 'string'
		&& typeof record.content === 'string'
		&& (record.type === 'persona' || record.type === 'episodic' || record.type === 'instruction');
}

function tokenize(query: string): string[] {
	return query.toLowerCase().split(/\s+/u).filter((word) => word.length > 1);
}

function scoreAtom(atom: MemoryAtom, terms: string[]): number {
	const haystack = `${atom.content.toLowerCase()} ${atom.type} ${atom.scene_name.toLowerCase()}`;
	let score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
	if (atom.type === 'persona' || atom.type === 'instruction') score += 1;
	if (atom.priority >= 90) score += 1;
	return score;
}