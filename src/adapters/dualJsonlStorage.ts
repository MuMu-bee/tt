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

	/** Writes to both Vault and local dir. Returns false if either failed. */
	async writeDual(content: string, context: RequestContext = createRequestContext('background-task')): Promise<boolean> {
		let primaryOk = true;
		let secondaryOk = true;
		let lastError: string | undefined;

		/* Primary: vault */
		try {
			await this.ensureVaultDir();
			await this.app.vault.adapter.write(normalizePath(this.vaultPath), content);
		} catch (error) {
			primaryOk = false;
			lastError = error instanceof Error ? error.message : 'Vault 写入失败';
		}

		/* Secondary: plugin data dir */
		try {
			const adapter = this.app.vault.adapter;
			const base = this.app.vault.configDir;
			const dir = normalizePath(`${base}/plugins/agent-dashboard`);
			await adapter.mkdir(dir);
			await adapter.write(normalizePath(`${dir}/${this.secondaryPath}`), content);
		} catch (error) {
			secondaryOk = false;
			lastError = error instanceof Error ? error.message : '本地目录写入失败';
		}

		this.status = { primaryOk, secondaryOk, lastError };
		return primaryOk && secondaryOk;
	}

	private async ensureVaultDir(): Promise<void> {
		const dir = this.vaultPath.split('/').slice(0, -1).join('/');
		if (dir) await this.app.vault.adapter.mkdir(dir);
	}
}