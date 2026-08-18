import { App, normalizePath, TFile } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import type { WritePort } from '../ports/writePort.ts';

/**
 * Obsidian Vault write adapter. Only Markdown paths are accepted.
 * Obsidian's Vault API does not guarantee cross-platform atomic rename; this
 * adapter therefore uses a single-file modify operation and relies on the
 * service-level before/after hash guard to preserve safety boundaries.
 */
export class ObsidianWritePort implements WritePort {
  constructor(private readonly app: App) {}

  async read(path: string, _context: RequestContext): Promise<string> {
    this.assertMarkdownPath(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`找不到 Markdown 文件：${path}`);
    return this.app.vault.cachedRead(file);
  }

  async writeAtomic(path: string, content: string, _context: RequestContext): Promise<void> {
    this.assertMarkdownPath(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`找不到 Markdown 文件：${path}`);
    await this.app.vault.modify(file, content);
  }

  async create(path: string, content: string, _context: RequestContext): Promise<void> {
    this.assertMarkdownPath(path);
    const normalized = normalizePath(path);
    const parent = normalized.split('/').slice(0, -1).join('/');
    if (parent) {
      const parentFile = this.app.vault.getAbstractFileByPath(parent);
      if (!parentFile) await this.app.vault.adapter.mkdir(parent);
    }
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) throw new Error(`文件已存在：${normalized}`);
    await this.app.vault.create(normalized, content);
  }

  private assertMarkdownPath(path: string): void {
    if (!path || !path.toLocaleLowerCase().endsWith('.md') || path.includes('..')) {
      throw new Error(`仅允许写入 Markdown 相对路径：${path}`);
    }
  }
}
