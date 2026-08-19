import type {
	ProjectBaseline,
	ProjectIncrementItem,
	RepoSnapshot,
	StarPoint,
	TrackedCommit,
	TrackedIssue,
	TrackedRelease,
} from '../data/dashboardTypes';

/**
 * Pure helpers for the GitHub project tracker.
 * 注意：保持无 obsidian 依赖，以便在 node --experimental-strip-types 下测试。
 */

export interface RepoRef {
	owner: string;
	repo: string;
}

/** Parses "owner/repo" into a repo reference, validating the format. */
export function parseRepoFullName(value: string): RepoRef {
	const trimmed = value.trim();
	const parts = trimmed.split('/');
	const owner = parts[0] ?? '';
	const repo = parts[1] ?? '';
	const isValid = parts.length === 2
		&& owner.length > 0
		&& repo.length > 0
		&& /^[A-Za-z0-9_.-]+$/u.test(owner)
		&& /^[A-Za-z0-9_.-]+$/u.test(repo);
	if (!isValid) {
		throw new Error('仓库格式应为 所有者/仓库名（如 HKUDS/DeepTutor）：' + value);
	}
	return { owner, repo };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Parses `GET /repos/{owner}/{repo}` basic info. */
export function parseRepoInfo(payload: unknown): { fullName: string; stars: number; description: string; updatedAt: string } {
	if (!isRecord(payload)) {
		return { fullName: '', stars: 0, description: '', updatedAt: '' };
	}
	return {
		fullName: asString(payload.full_name),
		stars: asNumber(payload.stargazers_count),
		description: asString(payload.description),
		updatedAt: asString(payload.updated_at),
	};
}

/** Parses `GET /repos/{owner}/{repo}/releases` into the latest releases. */
export function parseReleases(payload: unknown): TrackedRelease[] {
	if (!Array.isArray(payload)) {
		return [];
	}
	return payload.flatMap((item) => {
		if (!isRecord(item) || typeof item.tag_name !== 'string') {
			return [];
		}
		return [{
			tag: item.tag_name,
			name: asString(item.name),
			publishedAt: asString(item.published_at),
			body: asString(item.body),
			url: asString(item.html_url),
		}];
	});
}

/** Parses `GET /repos/{owner}/{repo}/commits` into recent commits. */
export function parseCommits(payload: unknown): TrackedCommit[] {
	if (!Array.isArray(payload)) {
		return [];
	}
	return payload.flatMap((item) => {
		if (!isRecord(item) || typeof item.sha !== 'string' || !isRecord(item.commit)) {
			return [];
		}
		const message = asString(item.commit.message);
		const date = isRecord(item.commit.committer) ? asString(item.commit.committer.date) : '';
		return [{
			sha: item.sha.slice(0, 7),
			message: message.split('\n')[0] ?? '',
			date,
			url: asString(item.html_url),
		}];
	});
}

/** Parses `GET /repos/{owner}/{repo}/issues` (state=all) into issues/PRs. */
export function parseIssues(payload: unknown): TrackedIssue[] {
	if (!Array.isArray(payload)) {
		return [];
	}
	return payload.flatMap((item) => {
		if (!isRecord(item) || typeof item.title !== 'string') {
			return [];
		}
		return [{
			title: item.title,
			kind: isRecord(item.pull_request) ? 'pr' : 'issue',
			state: asString(item.state),
			updatedAt: asString(item.updated_at),
			url: asString(item.html_url),
		}];
	});
}

/** Builds the Chinese-summary prompt for a repo snapshot. */
export function buildProjectReportPrompt(snapshot: RepoSnapshot): string {
	const lines: string[] = [];
	lines.push('请用通俗中文总结下面这个 GitHub 项目的最近动态，输出 Markdown。');
	lines.push('要求：像给朋友讲一样说清楚"最近更新了什么、新增了什么功能、修复了什么"，不要照搬英文原文。');
	lines.push('项目：' + snapshot.fullName);
	lines.push('描述：' + (snapshot.description || '（无）'));
	lines.push('Star 数：' + String(snapshot.stars));
	lines.push('最近更新时间：' + (snapshot.updatedAt || '（未知）'));
	lines.push('');
	lines.push('【版本发布】');
	if (snapshot.releases.length === 0) {
		lines.push('（无）');
	} else {
		snapshot.releases.forEach((release) => {
			lines.push('- ' + release.tag + (release.name ? ' (' + release.name + ')' : '') + ' 发布自 ' + release.publishedAt);
			if (release.body) {
				lines.push('  ' + release.body.slice(0, 600));
			}
		});
	}
	lines.push('');
	lines.push('【最近提交】');
	if (snapshot.commits.length === 0) {
		lines.push('（无）');
	} else {
		snapshot.commits.forEach((commit) => {
			lines.push('- ' + commit.sha + ' ' + commit.message + ' (' + commit.date + ')');
		});
	}
	lines.push('');
	lines.push('【问题与讨论】');
	if (snapshot.issues.length === 0) {
		lines.push('（无）');
	} else {
		snapshot.issues.forEach((issue) => {
			lines.push('- [' + (issue.kind === 'pr' ? 'PR' : 'Issue') + '] ' + issue.title + ' (' + issue.state + ') 更新于 ' + issue.updatedAt);
		});
	}
	return lines.join('\n');
}

// ===== Board / incremental tracking helpers =====

const MAX_BASELINE_IDS = 80;
const MAX_STAR_POINTS = 6;

function issueKey(issue: TrackedIssue): string {
	return issue.kind + ':' + issue.title + ':' + issue.updatedAt;
}

/** Creates a fresh baseline for a repo that has never been checked. */
export function emptyProjectBaseline(now = new Date().toISOString()): ProjectBaseline {
	return {
		lastSeenAt: now,
		knownReleaseTags: [],
		seenCommits: [],
		seenIssues: [],
		starHistory: [],
	};
}

/** Compares a fresh snapshot against the previous baseline and returns new items. */
export function detectProjectIncrements(snapshot: RepoSnapshot, baseline: ProjectBaseline): ProjectIncrementItem[] {
	const items: ProjectIncrementItem[] = [];
	const knownTags = new Set(baseline.knownReleaseTags ?? []);
	const seenCommits = new Set(baseline.seenCommits ?? []);
	const seenIssues = new Set(baseline.seenIssues ?? []);

	for (const release of snapshot.releases) {
		if (knownTags.has(release.tag)) continue;
		items.push({
			kind: 'release',
			title: release.name || release.tag,
			detail: release.body ? release.body.replace(/\s+/gu, ' ').trim().slice(0, 160) : '新版本发布',
			date: release.publishedAt,
			url: release.url,
		});
	}
	for (const commit of snapshot.commits) {
		if (seenCommits.has(commit.sha)) continue;
		items.push({
			kind: 'commit',
			title: commit.message,
			detail: commit.sha,
			date: commit.date,
			url: commit.url,
		});
	}
	for (const issue of snapshot.issues) {
		const key = issueKey(issue);
		if (seenIssues.has(key)) continue;
		items.push({
			kind: 'issue',
			title: issue.title,
			detail: (issue.kind === 'pr' ? 'PR' : 'Issue') + ' · ' + issue.state,
			date: issue.updatedAt,
			url: issue.url,
		});
	}
	return items;
}

/** Moves the baseline forward after a successful check, keeping history bounded. */
export function advanceProjectBaseline(snapshot: RepoSnapshot, baseline: ProjectBaseline, now = new Date().toISOString()): ProjectBaseline {
	const starHistory = [...(baseline.starHistory ?? [])];
	const last = starHistory[starHistory.length - 1];
	if (!last || last.stars !== snapshot.stars || Math.abs(new Date(now).getTime() - new Date(last.date).getTime()) >= 60 * 60 * 1000) {
		starHistory.push({ date: now, stars: snapshot.stars });
	}
	while (starHistory.length > MAX_STAR_POINTS) {
		starHistory.shift();
	}

	const knownReleaseTags = [...(baseline.knownReleaseTags ?? [])];
	for (const release of snapshot.releases) {
		if (!knownReleaseTags.includes(release.tag)) knownReleaseTags.push(release.tag);
	}
	while (knownReleaseTags.length > MAX_BASELINE_IDS) knownReleaseTags.shift();

	const seenCommits = [...(baseline.seenCommits ?? [])];
	for (const commit of snapshot.commits) {
		if (!seenCommits.includes(commit.sha)) seenCommits.push(commit.sha);
	}
	while (seenCommits.length > MAX_BASELINE_IDS) seenCommits.shift();

	const seenIssues = [...(baseline.seenIssues ?? [])];
	for (const issue of snapshot.issues) {
		const key = issueKey(issue);
		if (!seenIssues.includes(key)) seenIssues.push(key);
	}
	while (seenIssues.length > MAX_BASELINE_IDS) seenIssues.shift();

	return { lastSeenAt: now, knownReleaseTags, seenCommits, seenIssues, starHistory };
}

/** Returns the previous release tag for the fixed "vs <上一版本>" summary label. */
export function previousVersionTag(snapshot: RepoSnapshot, baseline: ProjectBaseline): string {
	const currentTag = snapshot.releases[0]?.tag;
	if (snapshot.releases.length >= 2) {
		return snapshot.releases[1]?.tag ?? '上一版本';
	}
	const tags = baseline.knownReleaseTags ?? [];
	for (let index = tags.length - 1; index >= 0; index -= 1) {
		const tag = tags[index];
		if (tag && tag !== currentTag) {
			return tag;
		}
	}
	return '上一版本';
}

/** Prompt for the fixed one-sentence Chinese summary shown on every card. */
export function buildVsSummaryPrompt(snapshot: RepoSnapshot, baseline: ProjectBaseline, increments: ProjectIncrementItem[]): string {
	const prev = previousVersionTag(snapshot, baseline);
	const lines: string[] = [];
	lines.push('你是 GitHub 项目动态的中文编辑。请只输出一句话，格式严格固定为：');
	lines.push('vs ' + prev + ' · <本次更新了什么>');
	lines.push('要求：');
	lines.push('1. 一句话说清本次相比 ' + prev + ' 新增/修复了什么，用通俗中文，不要照搬英文；');
	lines.push('2. 不要输出任何标题、列表、Markdown 或额外解释；');
	lines.push('3. 若没有可总结的更新，输出：vs ' + prev + ' · 本次无实质更新');
	lines.push('');
	lines.push('项目：' + snapshot.fullName);
	lines.push('描述：' + (snapshot.description || '（无）'));
	lines.push('Star 数：' + String(snapshot.stars));
	lines.push('');
	lines.push('本次新增：');
	if (increments.length === 0) {
		lines.push('（无）');
	} else {
		increments.slice(0, 12).forEach((item) => {
			lines.push('- [' + item.kind + '] ' + item.title + (item.date ? ' (' + item.date + ')' : ''));
			if (item.detail && item.detail !== item.title) lines.push('  ' + item.detail);
		});
	}
	return lines.join('\n');
}

/** Deterministic merged-weekly sentence used when the merge toggle is on. */
export function buildMergedWeeklySummary(increments: ProjectIncrementItem[]): string {
	if (increments.length === 0) {
		return '本周暂无新增。';
	}
	if (increments.length === 1) {
		const item = increments[0];
		if (!item) return '本周新增 1 项。';
		return '本周新增：' + (item.title || item.detail || item.kind);
	}
	const top = increments.slice(0, 3).map((item) => item.title || item.detail || item.kind).join('；');
	return '本周合并 ' + String(increments.length) + ' 项：' + top + '…';
}

/** Keeps at most the latest N star points for the inline sparkline. */
export function recentStarPoints(history: StarPoint[], count = 5): StarPoint[] {
	return history.slice(-count);
}

/** Prompt for a short Chinese list of important recent updates. */
export function buildRecentUpdatesPrompt(snapshot: RepoSnapshot): string {
	const lines: string[] = [];
	lines.push('请根据下面这个 GitHub 项目的最近活动，总结 3-5 条最重要的用户可见更新（新功能、重要修复、体验优化）。');
	lines.push('要求：每条一句中文，只输出条目本身，每行一条；不要版本号、不要英文、不要 Markdown 符号、不要编号。');
	lines.push('项目：' + snapshot.fullName);
	lines.push('');
	lines.push('最近版本：');
	if (snapshot.releases.length === 0) {
		lines.push('（无）');
	} else {
		snapshot.releases.slice(0, 3).forEach((release) => {
			lines.push('- ' + release.tag + (release.name ? ' ' + release.name : ''));
			if (release.body) lines.push('  ' + release.body.replace(/\s+/gu, ' ').slice(0, 500));
		});
	}
	lines.push('');
	lines.push('最近提交：');
	if (snapshot.commits.length === 0) {
		lines.push('（无）');
	} else {
		snapshot.commits.slice(0, 8).forEach((commit) => {
			lines.push('- ' + commit.message);
		});
	}
	return lines.join('\n');
}

/** Escapes a cell value for Markdown tables. */
export function escapeMarkdownTableCell(value: string): string {
	return value
		.replace(/\|/gu, '\\|')
		.replace(/\n/gu, ' ')
		.replace(/\r/gu, '');
}

/** Builds one row for the global project index Markdown table. */
export function buildGlobalIndexRow(
	project: Pick<import('../data/dashboardTypes').TrackedProject, 'repo' | 'groupId' | 'series' | 'enabled'>,
	group: Pick<import('../data/dashboardTypes').ProjectGroup, 'name'> | undefined,
	snapshot: Pick<import('../data/dashboardTypes').RepoSnapshot, 'stars' | 'updatedAt' | 'releases' | 'error'>,
	folder: string,
): string {
	const logPath = folder + '/' + project.repo.replace('/', '-') + '.md';
	const status = !project.enabled ? '已暂停' : snapshot.error ? '检查失败' : '正常';
	return [
		'| ' + escapeMarkdownTableCell(project.repo) + ' |',
		escapeMarkdownTableCell(group?.name ?? project.groupId) + ' |',
		escapeMarkdownTableCell(project.series || '未分类') + ' |',
		escapeMarkdownTableCell(status) + ' |',
		String(snapshot.stars) + ' |',
		escapeMarkdownTableCell(snapshot.releases[0]?.tag ?? '—') + ' |',
		escapeMarkdownTableCell(snapshot.updatedAt ? snapshot.updatedAt.slice(0, 10) : '—') + ' |',
		'[日志](' + logPath + ') |',
	].join(' ');
}

/** Escapes a scalar for safe embedding in YAML frontmatter. */
export function escapeYamlValue(value: string): string {
	const normalized = value.replace(/\n/gu, ' ').replace(/\r/gu, ' ').trim();
	if (/[:#[\]{}&*!|>'%@`"']/u.test(normalized) || /^\s|\s$/u.test(normalized)) {
		return '"' + normalized.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"') + '"';
	}
	return normalized;
}

