import { App, TFile } from 'obsidian';
import type { RequestContext } from '../application/requestContext';
import type { VaultReaderPort } from '../ports/vaultReaderPort';

/** Adapts Obsidian's Vault API to the read-only workbench port. */
export class ObsidianVaultReader implements VaultReaderPort {
	constructor(private readonly app: App) {}

	async readMarkdown(path: string, _context: RequestContext): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`找不到 Markdown 文件：${path}`);
		}
		return this.app.vault.cachedRead(file);
	}

	async listMarkdownPaths(_context: RequestContext): Promise<string[]> {
		return this.app.vault.getMarkdownFiles().map((file) => file.path);
	}
}
