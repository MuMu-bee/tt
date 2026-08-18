import { App, normalizePath, TFile } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import type { MemoryFileStorage } from '../ports/memoryPort.ts';

/** Vault-backed implementation of MemoryFileStorage. */
export class VaultMemoryStorage implements MemoryFileStorage {
	constructor(private readonly app: App) {}

	async read(path: string, _context: RequestContext): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return '';
		return this.app.vault.cachedRead(file);
	}

	async write(path: string, content: string, _context: RequestContext): Promise<void> {
		const normalized = normalizePath(path);
		const parent = normalized.split('/').slice(0, -1).join('/');
		if (parent) {
			const parentFile = this.app.vault.getAbstractFileByPath(parent);
			if (!parentFile) await this.app.vault.adapter.mkdir(parent);
		}
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return;
		}
		await this.app.vault.create(normalized, content);
	}

	async list(prefix: string, _context: RequestContext): Promise<string[]> {
		const normalized = prefix.replace(/\\/gu, '/');
		return this.app.vault.getFiles()
			.map((file) => file.path)
			.filter((path) => path.startsWith(normalized));
	}
}
