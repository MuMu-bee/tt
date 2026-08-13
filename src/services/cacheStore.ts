import { normalizePath, TFile, TFolder, Vault } from 'obsidian';
import type { CacheEntry } from '../data/dashboardTypes';
import { WORKBENCH_DIRS } from '../data/dashboardTypes';

const CACHE_ROOT = WORKBENCH_DIRS.cacheRoot;

export class CacheStore {
	constructor(private readonly vault: Vault) {}

	async read<T>(name: string): Promise<CacheEntry<T> | null> {
		const path = this.cachePath(name);
		const abstractFile = this.vault.getAbstractFileByPath(path);
		if (!(abstractFile instanceof TFile)) {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(await this.vault.cachedRead(abstractFile));
			if (!isCacheEntry(parsed)) {
				return null;
			}
			return parsed as CacheEntry<T>;
		} catch {
			return null;
		}
	}

	async write<T>(name: string, data: T): Promise<CacheEntry<T>> {
		await this.ensureFolder(CACHE_ROOT);
		const entry: CacheEntry<T> = {
			fetchedAt: new Date().toISOString(),
			data,
		};
		const path = this.cachePath(name);
		const serialized = JSON.stringify(entry, null, 2);
		await this.writeText(path, serialized);

		return entry;
	}

	async writeText(path: string, content: string): Promise<TFile> {
		const normalizedPath = normalizePath(path);
		const parent = normalizedPath.split('/').slice(0, -1).join('/');
		if (parent) {
			await this.ensureFolder(parent);
		}

		const abstractFile = this.vault.getAbstractFileByPath(normalizedPath);
		if (abstractFile instanceof TFile) {
			await this.vault.process(abstractFile, () => content);
			return abstractFile;
		}
		if (abstractFile instanceof TFolder) {
			throw new Error(`Path is a folder: ${normalizedPath}`);
		}
		return this.vault.create(normalizedPath, content);
	}

	async ensureFolder(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);
		const segments = normalizedPath.split('/');
		let currentPath = '';

		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			const existing = this.vault.getAbstractFileByPath(currentPath);
			if (existing instanceof TFolder) {
				continue;
			}
			if (existing instanceof TFile) {
				throw new Error(`Path is a file: ${currentPath}`);
			}
			await this.vault.createFolder(currentPath);
		}
	}

	private cachePath(name: string): string {
		return normalizePath(`${CACHE_ROOT}/${name}.json`);
	}
}

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.fetchedAt === 'string' && 'data' in record;
}
