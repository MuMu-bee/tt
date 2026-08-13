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

export interface RssFeedItem {
	title: string;
	link: string;
	description: string;
	publishedAt: string;
}

export interface HackerNewsItem {
	title: string;
	url: string;
	score: number;
	by: string;
	time: number;
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
	{ id: 'pull-rss', label: '拉取 RSS', icon: 'rss' },
	{ id: 'github-feeds', label: 'GitHub 动态', icon: 'github' },
	{ id: 'inbox-ingest', label: '收件箱导入', icon: 'inbox' },
	{ id: 'vault-lint', label: 'Vault 检查', icon: 'scan-search' },
];
