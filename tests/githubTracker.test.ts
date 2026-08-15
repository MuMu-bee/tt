import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildProjectReportPrompt,
	parseCommits,
	parseIssues,
	parseRepoFullName,
	parseRepoInfo,
	parseReleases,
} from '../src/application/githubTracker.ts';
import type { RepoSnapshot } from '../src/data/dashboardTypes.ts';

test('parseRepoFullName accepts valid owner/repo', () => {
	assert.deepEqual(parseRepoFullName('HKUDS/DeepTutor'), { owner: 'HKUDS', repo: 'DeepTutor' });
});

test('parseRepoFullName rejects invalid formats', () => {
	assert.throws(() => parseRepoFullName('DeepTutor'), /所有者\/仓库名/);
	assert.throws(() => parseRepoFullName('HKUDS/Deep Tutor'), /所有者\/仓库名/);
	assert.throws(() => parseRepoFullName(''), /所有者\/仓库名/);
});

test('parseRepoInfo extracts basic repo info', () => {
	const info = parseRepoInfo({
		full_name: 'HKUDS/DeepTutor',
		stargazers_count: 34025,
		description: 'Lifelong Personalized Tutoring',
		updated_at: '2026-08-01T00:00:00Z',
	});
	assert.equal(info.fullName, 'HKUDS/DeepTutor');
	assert.equal(info.stars, 34025);
	assert.equal(info.description, 'Lifelong Personalized Tutoring');
	assert.equal(info.updatedAt, '2026-08-01T00:00:00Z');
});

test('parseRepoInfo tolerates missing/bad fields', () => {
	const info = parseRepoInfo({ stargazers_count: 'nope' });
	assert.equal(info.stars, 0);
	assert.equal(info.fullName, '');
	assert.equal(parseRepoInfo(null).fullName, '');
});

test('parseReleases extracts releases and drops bad rows', () => {
	const releases = parseReleases([
		{ tag_name: 'v1.2.0', name: 'New release', published_at: '2026-08-01T00:00:00Z', body: 'Added X', html_url: 'https://github.com/a/b/releases/v1.2.0' },
		{ not_tag: true },
		null,
	]);
	assert.equal(releases.length, 1);
	assert.equal(releases[0]?.tag, 'v1.2.0');
	assert.equal(releases[0]?.body, 'Added X');
	assert.equal(parseReleases('nope').length, 0);
});

test('parseCommits extracts short sha and first message line', () => {
	const commits = parseCommits([
		{
			sha: 'abcdef1234567890',
			commit: { message: 'feat: add something\n\nbody', committer: { date: '2026-08-02T00:00:00Z' } },
			html_url: 'https://github.com/a/b/commit/abcdef1',
		},
		{ commit: { message: 'bad' } },
	]);
	assert.equal(commits.length, 1);
	assert.equal(commits[0]?.sha, 'abcdef1');
	assert.equal(commits[0]?.message, 'feat: add something');
});

test('parseIssues distinguishes issues from pull requests', () => {
	const issues = parseIssues([
		{ title: 'Bug: crashes', state: 'open', updated_at: '2026-08-01T00:00:00Z', html_url: 'https://github.com/a/b/issues/1' },
		{ title: 'PR: fix it', state: 'closed', pull_request: {}, updated_at: '2026-08-02T00:00:00Z', html_url: 'https://github.com/a/b/pull/2' },
		{ no_title: true },
	]);
	assert.equal(issues.length, 2);
	assert.equal(issues[0]?.kind, 'issue');
	assert.equal(issues[1]?.kind, 'pr');
	assert.equal(issues[1]?.state, 'closed');
});

test('buildProjectReportPrompt includes all sections', () => {
	const snapshot: RepoSnapshot = {
		fullName: 'HKUDS/DeepTutor',
		stars: 34025,
		description: 'Tutoring',
		updatedAt: '2026-08-01T00:00:00Z',
		releases: [{ tag: 'v1.2.0', name: '', publishedAt: '2026-08-01T00:00:00Z', body: 'Added X', url: 'u' }],
		commits: [{ sha: 'abc1234', message: 'feat', date: '2026-08-02T00:00:00Z', url: 'u' }],
		issues: [{ title: 'Bug', kind: 'issue', state: 'open', updatedAt: '2026-08-01T00:00:00Z', url: 'u' }],
		fetchedAt: '2026-08-03T00:00:00Z',
	};
	const prompt = buildProjectReportPrompt(snapshot);
	assert.match(prompt, /HKUDS\/DeepTutor/);
	assert.match(prompt, /【版本发布】/);
	assert.match(prompt, /【最近提交】/);
	assert.match(prompt, /【问题与讨论】/);
	assert.match(prompt, /v1\.2\.0/);
	assert.match(prompt, /abc1234/);
});

test('buildProjectReportPrompt handles empty activity', () => {
	const snapshot: RepoSnapshot = {
		fullName: 'a/b',
		stars: 0,
		description: '',
		updatedAt: '',
		releases: [],
		commits: [],
		issues: [],
		fetchedAt: '2026-08-03T00:00:00Z',
	};
	const prompt = buildProjectReportPrompt(snapshot);
	assert.match(prompt, /（无）/);
});
