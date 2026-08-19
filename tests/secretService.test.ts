import assert from 'node:assert/strict';
import test from 'node:test';
import { applySecrets, migrateSecrets, stripSecrets, EMPTY_SECRETS } from '../src/services/secretService.ts';
import type { AgentDashboardSettings } from '../src/settings.ts';

function makeSettings(apiKey: string, githubToken: string): AgentDashboardSettings {
	return {
		agent: { baseUrl: '', apiKey, model: '', ollamaUrl: '', ollamaModel: '', ollamaEmbeddingModel: '', visionModel: '', useLocal: false, maxContextTokens: 4000 },
		projectTracker: { projects: [], groups: [], githubToken, autoReport: false, autoCheckMinutes: 60, staleAfterDays: 7, noteFolder: 'Projects' },
		featureFlags: {
			semantic_search: false,
			semantic_fallback: false,
			new_write_pipeline: false,
			organize_auto_apply: false,
			organize: { frontmatter: false, tags: false, links: false, format: false },
			fiction_proposal_only: true,
			memory: { enabled: false, captureL0: false, autoExtract: false, autoRecall: false, recallDepth: 'l3' },
		},
	};
}

test('stripSecrets removes api key and github token from settings', () => {
	const settings = makeSettings('sk-key', 'gh-token');
	const stripped = stripSecrets(settings);
	assert.equal(stripped.agent.apiKey, '');
	assert.equal(stripped.projectTracker.githubToken, '');
	assert.equal(settings.agent.apiKey, 'sk-key');
});

test('applySecrets restores secrets into settings', () => {
	const settings = makeSettings('', '');
	const applied = applySecrets(settings, { agentApiKey: 'sk-key', githubToken: 'gh-token', githubTokens: {} });
	assert.equal(applied.agent.apiKey, 'sk-key');
	assert.equal(applied.projectTracker.githubToken, 'gh-token');
});

test('migrateSecrets copies legacy data.json keys and clears them', () => {
	const settings = makeSettings('legacy-key', 'legacy-token');
	const result = migrateSecrets(settings, EMPTY_SECRETS);
	assert.equal(result.migrated, true);
	assert.equal(result.secrets.agentApiKey, 'legacy-key');
	assert.equal(result.secrets.githubToken, 'legacy-token');
	assert.equal(result.settings.agent.apiKey, '');
	assert.equal(result.settings.projectTracker.githubToken, '');
});

test('migrateSecrets never overwrites an existing secrets file', () => {
	const settings = makeSettings('new-key', 'new-token');
	const result = migrateSecrets(settings, { agentApiKey: 'file-key', githubToken: 'file-token', githubTokens: {} });
	assert.equal(result.migrated, false);
	assert.equal(result.secrets.agentApiKey, 'file-key');
	assert.equal(result.settings.agent.apiKey, 'new-key');
});

test('migrateSecrets moves per-project tokens into githubTokens', () => {
	const settings = makeSettings('', '');
	settings.projectTracker.projects = [{ repo: 'a/b', groupId: 'p1', enabled: true, series: '', token: 'repo-token' }];
	const result = migrateSecrets(settings, EMPTY_SECRETS);
	assert.equal(result.migrated, true);
	assert.equal(result.secrets.githubTokens['a/b'], 'repo-token');
	assert.equal(result.settings.projectTracker.projects[0]?.token, '');
});
