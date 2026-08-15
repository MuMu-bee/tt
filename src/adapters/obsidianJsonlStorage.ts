import { App, TFile, TFolder } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import type { JsonlTextStorage } from './jsonlStorage.ts';

/** Persists protected JSONL records in the vault without exposing them to write rules. */
export class ObsidianJsonlStorage implements JsonlTextStorage {
  private readonly app: App;
  private readonly path: string;

  constructor(app: App, path: string) {
    this.app = app;
    this.path = path;
  }

  async read(_context: RequestContext): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof TFile)) return '';
    return this.app.vault.cachedRead(file);
  }

  async write(value: string, _context: RequestContext): Promise<void> {
    await this.ensureParentFolders();
    const existing = this.app.vault.getAbstractFileByPath(this.path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, value);
      return;
    }
    await this.app.vault.create(this.path, value);
  }

  private async ensureParentFolders(): Promise<void> {
    const segments = this.path.split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
}
