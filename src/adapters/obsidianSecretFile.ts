import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Secrets, SecretStore } from '../services/secretService.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Node-backed secrets file. The plugin directory is local and owned by the user. */
export class ObsidianSecretFile implements SecretStore {
	private readonly filePath: string;

	constructor(pluginDir: string) {
		this.filePath = join(pluginDir, 'secrets.json');
	}

	async read(): Promise<Secrets | null> {
		try {
			const raw = await fs.readFile(this.filePath, 'utf8');
			const value: unknown = JSON.parse(raw);
			if (typeof value !== 'object' || value === null) return null;
			const record = value as Record<string, unknown>;
			const githubTokens: Record<string, string> = {};
			if (isRecord(record.githubTokens)) {
				for (const [key, value] of Object.entries(record.githubTokens)) {
					if (typeof value === 'string') githubTokens[key] = value;
				}
			}
			return {
				agentApiKey: typeof record.agentApiKey === 'string' ? record.agentApiKey : '',
				githubToken: typeof record.githubToken === 'string' ? record.githubToken : '',
				githubTokens,
			};
		} catch {
			return null;
		}
	}

	async write(secrets: Secrets): Promise<void> {
		await fs.mkdir(join(this.filePath, '..'), { recursive: true });
		await fs.writeFile(this.filePath, JSON.stringify(secrets, null, 2), { encoding: 'utf8', mode: 0o600 });
	}
}
