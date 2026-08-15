import type {
	RepoSnapshot,
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
