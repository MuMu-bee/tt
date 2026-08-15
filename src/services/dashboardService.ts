import { App } from 'obsidian';
import type {
	DashboardData,
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
		// GitHub 信息流已无 UI 消费方（项目追踪页使用 ProjectTracker），
		// 不再发起无效的 GitHub Search API 请求（未认证限流约 10 次/分钟）。
		void forceFeeds;
		const today = toDateKey(new Date());
		const scan = await this.scanner.scan(today);
		return {
			dashboard: {
				...scan.dashboard,
				feed: [],
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
