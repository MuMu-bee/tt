import { requestUrl } from 'obsidian';
import type {
	RepoSnapshot,
	TrackedCommit,
	TrackedIssue,
	TrackedRelease,
} from '../data/dashboardTypes';
import { CacheStore } from './cacheStore';
import { isCacheFresh } from './dashboardMath';
import {
	parseCommits,
	parseIssues,
	parseRepoFullName,
	parseRepoInfo,
	parseReleases,
	type RepoRef,
} from '../application/githubTracker';

const CACHE_MAX_AGE = 60 * 60 * 1000;

function apiHeaders(token?: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'agent-dashboard/0.1.0',
	};
	const trimmed = token ? token.trim() : '';
	if (trimmed) {
		headers.Authorization = 'Bearer ' + trimmed;
	}
	return headers;
}

/**
 * Fetches recent activity for a tracked GitHub repository: basic info,
 * releases, commits and issues/PRs. Results are cached for one hour.
 */
export class ProjectTracker {
	private readonly cache: CacheStore;
	private readonly token: string;
	private repos: string[];

	constructor(cache: CacheStore, token: string, repos: string[]) {
		this.cache = cache;
		this.token = token;
		this.repos = [...repos];
	}

	getRepos(): string[] {
		return [...this.repos];
	}

	setRepos(repos: string[]): void {
		this.repos = [...repos];
	}

	async readSummary(repo: string): Promise<string | null> {
		const entry = await this.cache.read<{ text: string }>('summary-' + repo);
		return entry?.data.text ?? null;
	}

	async writeSummary(repo: string, summary: string): Promise<void> {
		await this.cache.write('summary-' + repo, { text: summary });
	}

	async refresh(repo: string, force = false): Promise<RepoSnapshot> {
		const cacheKey = 'project-' + repo;
		const cached = await this.cache.read<RepoSnapshot>(cacheKey);
		if (!force && cached && isCacheFresh(cached.fetchedAt, Date.now(), CACHE_MAX_AGE)) {
			return cached.data;
		}

		let snapshot: RepoSnapshot;
		try {
			const ref = parseRepoFullName(repo);
			const [infoPayload, releasesPayload, commitsPayload, issuesPayload] = await Promise.all([
				this.get(`/repos/${ref.owner}/${ref.repo}`, ref),
				this.get(`/repos/${ref.owner}/${ref.repo}/releases?per_page=3`, ref),
				this.get(`/repos/${ref.owner}/${ref.repo}/commits?per_page=8`, ref),
				this.get(`/repos/${ref.owner}/${ref.repo}/issues?state=all&sort=updated&per_page=8`, ref),
			]);
			const info = parseRepoInfo(infoPayload);
			const releases: TrackedRelease[] = parseReleases(releasesPayload);
			const commits: TrackedCommit[] = parseCommits(commitsPayload);
			const issues: TrackedIssue[] = parseIssues(issuesPayload);
			snapshot = {
				fullName: info.fullName || repo,
				stars: info.stars,
				description: info.description,
				updatedAt: info.updatedAt,
				releases,
				commits,
				issues,
				fetchedAt: new Date().toISOString(),
			};
		} catch (error) {
			snapshot = {
				fullName: repo,
				stars: 0,
				description: '',
				updatedAt: '',
				releases: [],
				commits: [],
				issues: [],
				fetchedAt: new Date().toISOString(),
				error: error instanceof Error ? error.message : '拉取失败',
			};
		}

		await this.cache.write(cacheKey, snapshot);
		return snapshot;
	}

	private async get(path: string, ref: RepoRef): Promise<unknown> {
		const response = await requestUrl({
			url: 'https://api.github.com' + path,
			headers: apiHeaders(this.token),
			throw: false,
		});
		if (response.status === 404) {
			throw new Error('找不到仓库 ' + ref.owner + '/' + ref.repo + '，请检查名称是否正确');
		}
		if (response.status === 403 || response.status === 429) {
			throw new Error('GitHub 请求过于频繁（' + response.status + '），请在设置中填写 GitHub Token 或稍后再试');
		}
		if (response.status < 200 || response.status >= 300) {
			throw new Error('GitHub 返回 ' + response.status);
		}
		return response.json;
	}
}
