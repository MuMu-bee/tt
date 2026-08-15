import { App, normalizePath } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';

export interface DualStorageStatus {
	primaryOk: boolean;
	secondaryOk: boolean;
	lastError?: string;
}

/** Writes persistence records to both Vault and the plugin data directory. */
export class DualJsonlStorage {
	private readonly app: App;
	private readonly vaultPath: string;
	private readonly secondaryPath: string;
	private status: DualStorageStatus = { primaryOk: true, secondaryOk: true };

	constructor(app: App, vaultPath: string, secondaryRelativePath: string) {
		this.app = app;
		this.vaultPath = vaultPath;
		/* Plugin data dir is outside the vault: .obsidian/plugins/agent-dashboard/ */
		this.secondaryPath = secondaryRelativePath;
	}

	getStatus(): DualStorageStatus {
		return { ...this.status };
	}

	async readPrimary(context: RequestContext = createRequestContext('background-task')): Promise<string> {
		try {
			return await this.app.vault.adapter.read(normalizePath(this.vaultPath));
		} catch {
			return '';
		}
	}

	async readSecondary(): Promise<string> {
		try {
			const adapter = this.app.vault.adapter;
			const base = this.app.vault.configDir;
			return await adapter.read(normalizePath(`${base}/plugins/agent-dashboard/${this.secondaryPath}`));
		} catch {
			return '';
		}
	}

	/** Appends one record to both Vault and local dir. Returns false if either failed. */
	async writeDual(content: string, context: RequestContext = createRequestContext('background-task')): Promise<boolean> {
		const primaryOk = await this.appendTo(
			this.vaultPath,
			async () => { await this.ensureVaultDir(); },
			content,
			'Vault 写入失败',
		);
		const secondaryOk = await this.writeSecondary(content, context);
		this.status = { primaryOk, secondaryOk, lastError: this.status.lastError };
		return primaryOk && secondaryOk;
	}

	/**
	 * Appends one record to the plugin data dir mirror only. The Vault side is
	 * owned by the primary store (JsonlAuditStore flushes the whole file), so
	 * writing it here would overwrite the store's history.
	 */
	async writeSecondary(content: string, context: RequestContext = createRequestContext('background-task')): Promise<boolean> {
		const adapter = this.app.vault.adapter;
		const base = this.app.vault.configDir;
		const dir = normalizePath(`${base}/plugins/agent-dashboard`);
		const ok = await this.appendTo(
			normalizePath(`${dir}/${this.secondaryPath}`),
			async () => { await adapter.mkdir(dir); },
			content,
			'本地目录写入失败',
		);
		if (!ok) {
			this.status = { primaryOk: this.status.primaryOk, secondaryOk: false, lastError: this.status.lastError };
		}
		return ok;
	}

	/** Appends one JSON line to a file, preserving any existing content. */
	private async appendTo(path: string, ensureDir: () => Promise<void>, content: string, errorLabel: string): Promise<boolean> {
		try {
			await ensureDir();
			let existing = '';
			try {
				existing = await this.app.vault.adapter.read(path);
			} catch {
				/* missing file is fine: treat as empty */
			}
			const payload = existing.trim() ? `${existing.replace(/\s*$/, '')}\n${content}\n` : `${content}\n`;
			await this.app.vault.adapter.write(path, payload);
			return true;
		} catch (error) {
			this.status = { ...this.status, lastError: error instanceof Error ? error.message : errorLabel };
			return false;
		}
	}

	private async ensureVaultDir(): Promise<void> {
		const dir = this.vaultPath.split('/').slice(0, -1).join('/');
		if (dir) await this.app.vault.adapter.mkdir(dir);
	}
}