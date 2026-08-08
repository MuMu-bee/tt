import { App } from 'obsidian';
import type {
	DashboardData,
	DashboardFeedItem,
	GitHubFeedItem,
	TaskRecord,
	VaultLintIssue,
} from '../data/dashboardTypes';
import { toDateKey } from './dashboardMath';
import { CacheStore } from './cacheStore';
import { FeedService } from './feedService';
import { VaultScanner } from './vaultScanner';

export interface DashboardLoadResult {
	dashboard: DashboardData;
	tasks: TaskRecord[];
	lintIssues: VaultLintIssue[];
}

export class DashboardService {
	private readonly scanner: VaultScanner;
	private readonly feedService: FeedService;

	constructor(app: App) {
		this.scanner = new VaultScanner(app);
		this.feedService = new FeedService(new CacheStore(app.vault));
	}

	async load(forceFeeds = false): Promise<DashboardLoadResult> {
		const today = toDateKey(new Date());
		const [scan, feeds] = await Promise.all([
			this.scanner.scan(today),
			this.feedService.loadAll(forceFeeds),
		]);
		return {
			dashboard: {
				...scan.dashboard,
				feed: feeds.github.map((item) => toDashboardFeedItem(item)),
			},
			tasks: scan.tasks,
			lintIssues: scan.lintIssues,
		};
	}

	async scanVault(): Promise<DashboardLoadResult> {
		const scan = await this.scanner.scan(toDateKey(new Date()));
		return {
			dashboard: scan.dashboard,
			tasks: scan.tasks,
			lintIssues: scan.lintIssues,
		};
	}

	getFeeds(): FeedService {
		return this.feedService;
	}
}

function toDashboardFeedItem(item: GitHubFeedItem): DashboardFeedItem {
	return {
		repo: item.repo,
		description: item.description || '没有描述',
		meta: item.updatedAt ? `更新于 ${formatDate(item.updatedAt)}` : '已同步',
		signal: `★ ${formatStars(item.stars)}`,
	};
}

function formatDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? '未知时间'
		: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatStars(value: number): string {
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	return String(value);
}
