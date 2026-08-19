import { requestUrl } from 'obsidian';
import type {
	ProjectBaseline,
	ProjectGroup,
	ProjectIncrementItem,
	ProjectTrackerSettings,
	RepoSnapshot,
	TrackedCommit,
	TrackedIssue,
	TrackedProject,
	TrackedRelease,
} from '../data/dashboardTypes';
import { CacheStore } from './cacheStore';
import { isCacheFresh } from './dashboardMath';
import {
	advanceProjectBaseline,
	detectProjectIncrements,
	emptyProjectBaseline,
	parseCommits,
	parseIssues,
	parseRepoFullName,
	parseRepoInfo,
	parseReleases,
	type RepoRef,
} from '../application/githubTracker';

const CACHE_MAX_AGE = 60 * 60 * 1000;

export interface ProjectSummary {
	text: string;
	version?: string;
	generatedAt?: string;
}

export interface ProjectCheckResult {
	project: TrackedProject;
	snapshot: RepoSnapshot;
	/** Baseline after the check (used for status, star history and next diff). */
	baseline: ProjectBaseline;
	/** Baseline before the check (used for "vs 上一版本" comparison). */
	previousBaseline: ProjectBaseline;
	increments: ProjectIncrementItem[];
}

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
 * Fetches recent activity for tracked GitHub repositories and keeps the
 * incremental baseline (lastSeenAt / knownReleaseTags) in CacheStore.
 */
export class ProjectTracker {
	private readonly cache: CacheStore;
	private settings: ProjectTrackerSettings;

	constructor(cache: CacheStore, settings: ProjectTrackerSettings) {
		this.cache = cache;
		this.settings = this.cloneSettings(settings);
	}

	getSettings(): ProjectTrackerSettings {
		return this.cloneSettings(this.settings);
	}

	setSettings(settings: ProjectTrackerSettings): void {
		this.settings = this.cloneSettings(settings);
	}

	getProjects(): TrackedProject[] {
		return this.settings.projects.map((project) => ({ ...project }));
	}

	getGroups(): ProjectGroup[] {
		return this.settings.groups.map((group) => ({ ...group }));
	}

	getProject(repo: string): TrackedProject | undefined {
		return this.settings.projects.find((project) => project.repo === repo);
	}

	getRepos(): string[] {
		return this.settings.projects.map((project) => project.repo);
	}

	getEnabledRepos(): string[] {
		return this.settings.projects.filter((project) => project.enabled).map((project) => project.repo);
	}

	getTokenFor(repo: string): string {
		const project = this.getProject(repo);
		if (project?.token) return project.token.trim();
		if (project && project.useGlobalToken === false) return '';
		return this.settings.githubToken.trim();
	}

	async readBaseline(repo: string): Promise<ProjectBaseline | null> {
		const entry = await this.cache.read<ProjectBaseline>('project-baseline-' + repo);
		return entry?.data ?? null;
	}

	async writeBaseline(repo: string, baseline: ProjectBaseline): Promise<void> {
		await this.cache.write('project-baseline-' + repo, baseline);
	}

	async readSummary(repo: string): Promise<ProjectSummary | null> {
		const entry = await this.cache.read<ProjectSummary | string>('summary-' + repo);
		if (!entry?.data) return null;
		if (typeof entry.data === 'string') {
			return { text: entry.data, version: undefined, generatedAt: undefined };
		}
		return entry.data;
	}

	async writeSummary(repo: string, summary: string, version?: string): Promise<void> {
		const value: ProjectSummary = { text: summary, version, generatedAt: new Date().toISOString() };
		await this.cache.write('summary-' + repo, value);
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
			const token = this.getTokenFor(repo);
			const [infoPayload, releasesPayload, commitsPayload, issuesPayload] = await Promise.all([
				this.get('/repos/' + ref.owner + '/' + ref.repo, ref, token),
				this.get('/repos/' + ref.owner + '/' + ref.repo + '/releases?per_page=3', ref, token),
				this.get('/repos/' + ref.owner + '/' + ref.repo + '/commits?per_page=8', ref, token),
				this.get('/repos/' + ref.owner + '/' + ref.repo + '/issues?state=all&sort=updated&per_page=8', ref, token),
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

	/**
	 * Refreshes one project, computes incremental items against the baseline and
	 * persists the advanced baseline. Paused projects are not fetched; their last
	 * cached snapshot is returned when available.
	 */
	async checkProject(project: TrackedProject, force = false): Promise<ProjectCheckResult> {
		const previous = await this.readBaseline(project.repo);
		const baseline = previous ?? emptyProjectBaseline('1970-01-01T00:00:00.000Z');

		if (!project.enabled) {
			const cached = await this.cache.read<RepoSnapshot>('project-' + project.repo);
			const snapshot: RepoSnapshot = cached?.data ?? {
				fullName: project.repo,
				stars: 0,
				description: '',
				updatedAt: '',
				releases: [],
				commits: [],
				issues: [],
				fetchedAt: new Date().toISOString(),
				error: '已暂停',
			};
			return {
				project: { ...project },
				snapshot,
				baseline: baseline ?? emptyProjectBaseline(snapshot.fetchedAt),
				previousBaseline: baseline ?? emptyProjectBaseline(snapshot.fetchedAt),
				increments: [],
			};
		}

		const snapshot = await this.refresh(project.repo, force);
		if (snapshot.error) {
			return {
				project: { ...project },
				snapshot,
				baseline,
				previousBaseline: baseline,
				increments: [],
			};
		}

		const increments = detectProjectIncrements(snapshot, baseline);
		const advanced = advanceProjectBaseline(snapshot, baseline, new Date().toISOString());
		await this.writeBaseline(project.repo, advanced);
		return {
			project: { ...project },
			snapshot,
			baseline: advanced,
			previousBaseline: baseline,
			increments,
		};
	}

	async checkAll(force = false): Promise<ProjectCheckResult[]> {
		const projects = this.settings.projects;
		const results: Array<ProjectCheckResult | undefined> = new Array<ProjectCheckResult | undefined>(projects.length);
		let cursor = 0;
		const workerCount = Math.min(3, projects.length);
		const workers = Array.from({ length: workerCount }, async () => {
			while (cursor < projects.length) {
				const index = cursor;
				cursor += 1;
				const project = projects[index];
				if (!project) break;
				results[index] = await this.checkProject(project, force);
			}
		});
		await Promise.all(workers);
		return results.filter((item): item is ProjectCheckResult => item !== undefined);
	}

	private async get(path: string, ref: RepoRef, token: string): Promise<unknown> {
		const response = await requestUrl({
			url: 'https://api.github.com' + path,
			headers: apiHeaders(token),
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

	private cloneSettings(settings: ProjectTrackerSettings): ProjectTrackerSettings {
		return {
			...settings,
			projects: settings.projects.map((project) => ({ ...project })),
			groups: settings.groups.map((group) => ({ ...group })),
		};
	}
}
