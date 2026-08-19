import type { AgentDashboardSettings } from '../settings.ts';

export interface Secrets {
	agentApiKey: string;
	githubToken: string;
	/** Per-repository GitHub tokens, keyed by "owner/repo". */
	githubTokens: Record<string, string>;
}

export const EMPTY_SECRETS: Secrets = { agentApiKey: '', githubToken: '', githubTokens: {} };

export interface SecretStore {
	read(): Promise<Secrets | null>;
	write(secrets: Secrets): Promise<void>;
}

/** Returns a settings object with secrets removed, safe to persist to data.json. */
export function stripSecrets(settings: AgentDashboardSettings): AgentDashboardSettings {
	return {
		...settings,
		agent: { ...settings.agent, apiKey: '' },
		projectTracker: {
			...settings.projectTracker,
			githubToken: '',
			projects: settings.projectTracker.projects.map((project) => ({ ...project, token: '' })),
		},
	};
}

/** Returns settings with secrets re-applied from the secrets file (runtime-only). */
export function applySecrets(settings: AgentDashboardSettings, secrets: Secrets): AgentDashboardSettings {
	const tokens = secrets.githubTokens ?? {};
	return {
		...settings,
		agent: { ...settings.agent, apiKey: secrets.agentApiKey },
		projectTracker: {
			...settings.projectTracker,
			githubToken: secrets.githubToken,
			projects: settings.projectTracker.projects.map((project) => ({
				...project,
				token: tokens[project.repo] ?? '',
			})),
		},
	};
}

/**
 * One-time migration from legacy data.json fields into the secrets file.
 * Only copies a field when the secrets side is still empty, then clears it from settings.
 */
export function migrateSecrets(
	settings: AgentDashboardSettings,
	secrets: Secrets | null,
): { settings: AgentDashboardSettings; secrets: Secrets; migrated: boolean } {
	const current = secrets ?? EMPTY_SECRETS;
	const next: Secrets = {
		agentApiKey: current.agentApiKey ?? '',
		githubToken: current.githubToken ?? '',
		githubTokens: { ...(current.githubTokens ?? {}) },
	};
	let migrated = false;

	const nextSettings = {
		...settings,
		agent: { ...settings.agent },
		projectTracker: {
			...settings.projectTracker,
			projects: settings.projectTracker.projects.map((project) => ({ ...project })),
		},
	};

	if (!next.agentApiKey && settings.agent.apiKey) {
		next.agentApiKey = settings.agent.apiKey;
		nextSettings.agent.apiKey = '';
		migrated = true;
	}
	if (!next.githubToken && settings.projectTracker.githubToken) {
		next.githubToken = settings.projectTracker.githubToken;
		nextSettings.projectTracker.githubToken = '';
		migrated = true;
	}
	for (const project of nextSettings.projectTracker.projects) {
		if (project.token && !next.githubTokens[project.repo]) {
			next.githubTokens[project.repo] = project.token;
			project.token = '';
			migrated = true;
		}
	}

	return { settings: nextSettings, secrets: next, migrated };
}
