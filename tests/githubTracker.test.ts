import assert from 'node:assert/strict';
import test from 'node:test';
import {
	advanceProjectBaseline,
	buildGlobalIndexRow,
	buildMergedWeeklySummary,
	buildProjectReportPrompt,
	detectProjectIncrements,
	emptyProjectBaseline,
	escapeMarkdownTableCell,
	escapeYamlValue,
	parseCommits,
	parseIssues,
	parseReleaseNotes,
	parseRepoFullName,
	parseRepoInfo,
	parseReleases,
	previousVersionTag,
} from '../src/application/githubTracker.ts';
import { normalizeProjectTrackerSettings } from '../src/data/dashboardTypes.ts';
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

test('detectProjectIncrements returns new releases, commits and issues', () => {
	const snapshot: RepoSnapshot = {
		fullName: 'a/b',
		stars: 10,
		description: '',
		updatedAt: '2026-08-03T00:00:00Z',
		releases: [{ tag: 'v1.1.0', name: 'Release', publishedAt: '2026-08-02T00:00:00Z', body: 'Added X', url: 'u' }],
		commits: [{ sha: 'abc1234', message: 'feat: x', date: '2026-08-02T00:00:00Z', url: 'u' }],
		issues: [{ title: 'Bug', kind: 'issue', state: 'open', updatedAt: '2026-08-02T00:00:00Z', url: 'u' }],
		fetchedAt: '2026-08-03T00:00:00Z',
	};
	const baseline = emptyProjectBaseline('1970-01-01T00:00:00.000Z');
	const increments = detectProjectIncrements(snapshot, baseline);
	assert.equal(increments.length, 3);
	assert.equal(increments[0]?.kind, 'release');
	assert.equal(increments[1]?.kind, 'commit');
	assert.equal(increments[2]?.kind, 'issue');
});

test('advanceProjectBaseline remembers seen activity and keeps star history bounded', () => {
	const snapshot: RepoSnapshot = {
		fullName: 'a/b',
		stars: 12,
		description: '',
		updatedAt: '2026-08-03T00:00:00Z',
		releases: [{ tag: 'v1.0.0', name: '', publishedAt: '2026-08-01T00:00:00Z', body: '', url: 'u' }],
		commits: [{ sha: 'abc1234', message: 'feat', date: '2026-08-01T00:00:00Z', url: 'u' }],
		issues: [],
		fetchedAt: '2026-08-03T00:00:00Z',
	};
	const advanced = advanceProjectBaseline(snapshot, emptyProjectBaseline('1970-01-01T00:00:00.000Z'), '2026-08-03T00:00:00Z');
	assert.deepEqual(advanced.knownReleaseTags, ['v1.0.0']);
	assert.deepEqual(advanced.seenCommits, ['abc1234']);
	assert.equal(advanced.starHistory.length, 1);
	assert.equal(advanced.starHistory[0]?.stars, 12);
});

test('previousVersionTag uses second release or baseline tag', () => {
	const snapshot: RepoSnapshot = {
		fullName: 'a/b',
		stars: 0,
		description: '',
		updatedAt: '',
		releases: [
			{ tag: 'v2.0.0', name: '', publishedAt: '2026-08-02T00:00:00Z', body: '', url: 'u' },
			{ tag: 'v1.0.0', name: '', publishedAt: '2026-08-01T00:00:00Z', body: '', url: 'u' },
		],
		commits: [],
		issues: [],
		fetchedAt: '2026-08-03T00:00:00Z',
	};
	assert.equal(previousVersionTag(snapshot, emptyProjectBaseline()), 'v1.0.0');
});

test('buildMergedWeeklySummary combines multiple increments', () => {
	const summary = buildMergedWeeklySummary([
		{ kind: 'commit', title: 'fix a', detail: 'x', date: '2026-08-02T00:00:00Z', url: '' },
		{ kind: 'release', title: 'v1.2.0', detail: 'release', date: '2026-08-02T00:00:00Z', url: '' },
	]);
	assert.match(summary, /本周合并 2 项/);
	assert.match(summary, /fix a/);
});

test('normalizeProjectTrackerSettings preserves an empty projects array', () => {
	const settings = normalizeProjectTrackerSettings({ projects: [] });
	assert.deepEqual(settings.projects, []);
});

test('normalizeProjectTrackerSettings migrates legacy repos', () => {
	const settings = normalizeProjectTrackerSettings({ repos: ['a/b'] });
	assert.equal(settings.projects.length, 1);
	assert.equal(settings.projects[0]?.repo, 'a/b');
	assert.equal(settings.projects[0]?.groupId, 'p1');
});

test('buildGlobalIndexRow keeps eight markdown cells', () => {
	const row = buildGlobalIndexRow(
		{ repo: 'a/b', groupId: 'p1', series: 'AI工具', enabled: true },
		{ name: '01 高优先' },
		{ stars: 10, updatedAt: '2026-08-01T00:00:00Z', releases: [{ tag: 'v1.0.0', name: '', publishedAt: '', body: '', url: '' }], error: undefined },
		'Projects',
	);
	assert.equal(row.split('|').filter((cell) => cell.trim().length > 0).length, 8);
});

test('escapeYamlValue quotes values with special characters', () => {
	assert.equal(escapeYamlValue('plain'), 'plain');
	assert.equal(escapeYamlValue('a: b'), '"a: b"');
	assert.equal(escapeYamlValue('has # tag'), '"has # tag"');
});

test('escapeMarkdownTableCell escapes pipes and newlines', () => {
	assert.equal(escapeMarkdownTableCell('a|b'), 'a\\|b');
	assert.equal(escapeMarkdownTableCell('a\nb'), 'a b');
});

test('parseReleaseNotes parses strict 【tag|date|summary】rows', () => {
	const notes = parseReleaseNotes([
		'【v1.3.0|2026-08-05T00:00:00Z|新增多轮数学推理与中英混合提示词】',
		'【v1.2.1|2026-07-20T00:00:00Z|修复推理服务内存泄漏】',
		'无关行',
		'',
	].join('\n'));
	assert.equal(notes.length, 2);
	assert.equal(notes[0]?.tag, 'v1.3.0');
	assert.equal(notes[0]?.date, '2026-08-05T00:00:00Z');
	assert.match(notes[0]?.summary ?? '', /多轮数学推理/u);
	assert.equal(notes[1]?.tag, 'v1.2.1');
});

test('parseReleaseNotes caps at 3 versions and ignores junk', () => {
	const lines: string[] = [];
	for (let index = 0; index < 5; index += 1) {
		lines.push('【v1.' + index + '|2026-01-0' + index + 'T00:00:00Z|更新' + index + '】');
	}
	const notes = parseReleaseNotes(lines.join('\n'));
	assert.ok(notes.length <= 3);
	assert.equal(notes.length, 3);
});

test('parseReleaseNotes falls back to pipe-split rows without brackets', () => {
	const notes = parseReleaseNotes('v2.0.0 | 2026-08-01T00:00:00Z | 全新 UI\n冒烟');
	assert.equal(notes.length, 1);
	assert.equal(notes[0]?.tag, 'v2.0.0');
	assert.equal(notes[0]?.date, '2026-08-01T00:00:00Z');
});
