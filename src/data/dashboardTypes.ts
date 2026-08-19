import type { IconName } from 'obsidian';

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface ParsedTask {
	title: string;
	completed: boolean;
	dueDate?: string;
}

export interface TaskRecord extends ParsedTask {
	sourcePath: string;
	sourceDate: string;
	line: number;
}

export interface DashboardTask {
	title: string;
	meta: string;
	status: TaskStatus;
	sourcePath: string;
	line: number;
	dueDate?: string;
}

export interface DashboardFeedItem {
	repo: string;
	description: string;
	meta: string;
	signal: string;
}

export interface DashboardAction {
	id: string;
	label: string;
	icon: IconName;
}

export interface DashboardData {
	lastSync: string;
	vaultHealth: {
		score: number;
		noteCount: number;
		frontmatterRatio: number;
		tagRatio: number;
	};
	inboxBacklog: {
		count: number;
		oldestDays: number | null;
	};
	taskFlow: {
		rate: number;
		total: number;
		completed: number;
		today: number;
		overdue: number;
	};
	heatmap: {
		start: string;
		end: string;
		activeDays: number;
		counts: Record<string, number>;
	};
	tasks: DashboardTask[];
	feed: DashboardFeedItem[];
}

export interface CacheEntry<T> {
	fetchedAt: string;
	data: T;
}

export interface GitHubFeedItem {
	repo: string;
	description: string;
	stars: number;
	updatedAt: string;
	url: string;
}

export interface VaultLintIssue {
	path: string;
	reasons: string[];
}

export interface VaultScanResult {
	dashboard: DashboardData;
	tasks: TaskRecord[];
	lintIssues: VaultLintIssue[];
}

// ===== Chat / Agent types =====

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: string;
	/** Vault notes referenced in this message */
	references?: ChatReference[];
	/** Whether the message is still being streamed */
	streaming?: boolean;
}

export interface ChatReference {
	path: string;
	title: string;
	snippet: string;
}

export interface AgentConfig {
	/** Cloud LLM API base URL (OpenAI-compatible) */
	baseUrl: string;
	/** API key for cloud LLM */
	apiKey: string;
	/** Model name (e.g. 'step-1-flash', 'mimo-v2.5-pro') */
	model: string;
	/** Ollama URL for local inference */
	ollamaUrl: string;
	/** Ollama model name */
	ollamaModel: string;
	/** Ollama embedding model name (e.g. 'bge-m3'), used for local semantic search */
	ollamaEmbeddingModel: string;
	/** Vision model name for image understanding (e.g. 'step-1o-turbo-vision'); empty disables it */
	visionModel: string;
	/** Whether to use local Ollama instead of cloud API */
	useLocal: boolean;
	/** Max tokens for context injection from vault */
	maxContextTokens: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	baseUrl: 'https://api.stepfun.com/v1',
	apiKey: '',
	model: 'step-1-flash',
	ollamaUrl: 'http://localhost:11434',
	ollamaModel: 'qwen3:8b',
	ollamaEmbeddingModel: 'bge-m3',
	visionModel: '',
	useLocal: false,
	maxContextTokens: 4000,
};

/** 插件自产目录：统一引用，避免魔法字符串在多个文件中漂移。 */
export const WORKBENCH_DIRS = {
	cacheRoot: 'dashboard/cache',
	daily: 'Daily',
	reports: 'Reports',
	inbox: 'Inbox',
} as const;

export const DASHBOARD_ACTIONS: DashboardAction[] = [
	{ id: 'new-diary', label: '新建日记', icon: 'notebook-pen' },
	{ id: 'deep-research', label: '深度研究', icon: 'search-check' },
	{ id: 'github-feeds', label: '项目追踪', icon: 'github' },
	{ id: 'image-understand', label: '图片理解', icon: 'image' },
	{ id: 'inbox-ingest', label: '收件箱导入', icon: 'inbox' },
	{ id: 'vault-lint', label: 'Vault 检查', icon: 'scan-search' },
];

// ===== Project tracker types =====

export interface TrackedRelease {
	tag: string;
	name: string;
	publishedAt: string;
	body: string;
	url: string;
}

export interface TrackedCommit {
	sha: string;
	message: string;
	date: string;
	url: string;
}

export interface TrackedIssue {
	title: string;
	kind: 'issue' | 'pr';
	state: string;
	updatedAt: string;
	url: string;
}

export interface RepoSnapshot {
	fullName: string;
	stars: number;
	description: string;
	updatedAt: string;
	releases: TrackedRelease[];
	commits: TrackedCommit[];
	issues: TrackedIssue[];
	fetchedAt: string;
	error?: string;
}

export type ProjectDotColor = 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'muted';

export interface ProjectGroup {
	id: string;
	name: string;
	dotColor: ProjectDotColor;
	order: number;
}

export interface TrackedProject {
	/** GitHub repository in owner/repo form. */
	repo: string;
	/** Group id this project belongs to. */
	groupId: string;
	/** Whether automatic checking is enabled for this project. */
	enabled: boolean;
	/** Optional user-defined series label used by the series filter. */
	series: string;
	/** Optional per-project GitHub token. Never persisted to data.json. */
	token?: string;
	/** When false, an empty per-project token means "no token" instead of falling back to the global token. */
	useGlobalToken?: boolean;
}

export type ProjectIncrementKind = 'release' | 'commit' | 'issue';

export interface ProjectIncrementItem {
	kind: ProjectIncrementKind;
	title: string;
	detail: string;
	date: string;
	url: string;
}

export interface StarPoint {
	date: string;
	stars: number;
}

export interface ProjectBaseline {
	lastSeenAt: string;
	knownReleaseTags: string[];
	seenCommits: string[];
	seenIssues: string[];
	starHistory: StarPoint[];
}

export interface ProjectTrackerSettings {
	projects: TrackedProject[];
	groups: ProjectGroup[];
	/** Global GitHub personal access token (kept in secrets.json, never data.json). */
	githubToken: string;
	/** Generate a daily Chinese report at 08:00 when enabled. */
	autoReport: boolean;
	/** Automatic check interval in minutes. 0 disables polling; checks still run manually. */
	autoCheckMinutes: number;
	/** Number of days without new activity before a project counts as stale. */
	staleAfterDays: number;
	/** Vault folder for per-project changelogs and the global index note. */
	noteFolder: string;
}

export const DEFAULT_PROJECT_GROUPS: ProjectGroup[] = [
	{ id: 'p1', name: '01 高优先 · 每天看', dotColor: 'red', order: 1 },
	{ id: 'p2', name: '02 常规 · 每周看', dotColor: 'orange', order: 2 },
	{ id: 'p3', name: '03 低优先 · 偶尔看', dotColor: 'blue', order: 3 },
	{ id: 'p4', name: '04 备选池 · 待定', dotColor: 'muted', order: 4 },
];

export const DEFAULT_TRACKED_PROJECTS: TrackedProject[] = [
	{ repo: 'HKUDS/DeepTutor', groupId: 'p1', enabled: true, series: '' },
];

export const DEFAULT_PROJECT_TRACKER_SETTINGS: ProjectTrackerSettings = {
	projects: DEFAULT_TRACKED_PROJECTS.map((project) => ({ ...project })),
	groups: DEFAULT_PROJECT_GROUPS.map((group) => ({ ...group })),
	githubToken: '',
	autoReport: true,
	autoCheckMinutes: 60,
	staleAfterDays: 7,
	noteFolder: 'Projects',
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isProjectDotColor(value: unknown): value is ProjectDotColor {
	return value === 'red' || value === 'orange' || value === 'blue' || value === 'purple' || value === 'green' || value === 'muted';
}

function normalizeGroups(raw: unknown): ProjectGroup[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		return DEFAULT_PROJECT_GROUPS.map((group) => ({ ...group }));
	}
	const groups = raw.flatMap((item) => {
		if (!isRecord(item) || !asString(item.id)) return [];
		return [{
			id: asString(item.id),
			name: asString(item.name, asString(item.id)),
			dotColor: isProjectDotColor(item.dotColor) ? item.dotColor : 'muted',
			order: asNumber(item.order, 0),
		}];
	});
	return groups.length > 0 ? groups : DEFAULT_PROJECT_GROUPS.map((group) => ({ ...group }));
}

function normalizeProjects(raw: unknown, groupIds: string[]): TrackedProject[] {
	if (!Array.isArray(raw)) {
		return DEFAULT_TRACKED_PROJECTS.map((project) => ({ ...project, groupId: groupIds[0] ?? project.groupId }));
	}
	return raw.flatMap((item) => {
		if (!isRecord(item) || !asString(item.repo)) return [];
		return [{
			repo: asString(item.repo),
			groupId: asString(item.groupId, groupIds[0] ?? 'p1'),
			enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
			series: asString(item.series),
			token: asString(item.token),
			useGlobalToken: typeof item.useGlobalToken === 'boolean' ? item.useGlobalToken : true,
		}];
	});
}

/**
 * Normalizes stored project-tracker settings into the current shape.
 * Migrates the legacy `repos: string[]` field into the canonical `projects` list.
 */
export function normalizeProjectTrackerSettings(
	raw: (Partial<ProjectTrackerSettings> & { repos?: string[] }) | null | undefined,
): ProjectTrackerSettings {
	const base = raw ?? {};
	const groups = normalizeGroups(base.groups);
	const groupIds = groups.map((group) => group.id);
	const legacyRepos = Array.isArray(base.repos) ? base.repos.filter((repo): repo is string => typeof repo === 'string') : [];
	const projects = Array.isArray(base.projects)
		? normalizeProjects(base.projects, groupIds)
		: legacyRepos.length > 0
			? legacyRepos.map((repo) => ({ repo, groupId: groupIds[0] ?? 'p1', enabled: true, series: '', token: '', useGlobalToken: true }))
			: DEFAULT_TRACKED_PROJECTS.map((project) => ({ ...project, groupId: groupIds[0] ?? project.groupId }));
	return {
		projects: projects.map((project) => ({ ...project, groupId: groupIds.includes(project.groupId) ? project.groupId : (groupIds[0] ?? 'p1') })),
		groups: groups.map((group) => ({ ...group })),
		githubToken: asString(base.githubToken),
		autoReport: typeof base.autoReport === 'boolean' ? base.autoReport : true,
		autoCheckMinutes: asNumber(base.autoCheckMinutes, 60),
		staleAfterDays: asNumber(base.staleAfterDays, 7),
		noteFolder: asString(base.noteFolder, 'Projects'),
	};
}
