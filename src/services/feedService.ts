import { requestUrl } from 'obsidian';
import type { GitHubFeedItem } from '../data/dashboardTypes';
import { CacheStore } from './cacheStore';
import { isCacheFresh } from './dashboardMath';

const CACHE_MAX_AGE = 60 * 60 * 1000;
const GITHUB_SEARCH_URL = 'https://api.github.com/search/repositories?q=AI%20agent&sort=updated&order=desc&per_page=5';

export interface FeedBundle {
	github: GitHubFeedItem[];
}

export class FeedService {
	constructor(private readonly cache: CacheStore) {}

	async loadAll(force = false): Promise<FeedBundle> {
		const github = await this.getGitHubFeed(force);
		return { github };
	}

	async getGitHubFeed(force = false): Promise<GitHubFeedItem[]> {
		return this.loadCached('github-feed', force, [], async () => {
			const response = await requestUrl({
				url: GITHUB_SEARCH_URL,
				headers: {
					Accept: 'application/vnd.github+json',
					'User-Agent': 'agent-dashboard/0.1.0',
				},
			});
			return parseGitHubFeed(response.json);
		});
	}

	private async loadCached<T>(
		name: string,
		force: boolean,
		empty: T,
		loader: () => Promise<T>,
	): Promise<T> {
		const cached = await this.cache.read<T>(name);
		if (!force && cached && isCacheFresh(cached.fetchedAt, Date.now(), CACHE_MAX_AGE)) {
			return cached.data;
		}

		try {
			const data = await loader();
			await this.cache.write(name, data);
			return data;
		} catch (error) {
			// 抓取失败不再静默吞掉：记录日志便于排查（限流、网络、上游故障等）。
			console.error(
				`[agent-dashboard] 信息流「${name}」抓取失败，已回退到缓存或空数据。`,
				error,
			);
			return cached?.data ?? empty;
		}
	}
}

function parseGitHubFeed(payload: unknown): GitHubFeedItem[] {
	if (!isRecord(payload) || !Array.isArray(payload.items)) {
		return [];
	}

	return payload.items.slice(0, 5).flatMap((item) => {
		if (!isRecord(item) || typeof item.full_name !== 'string' || typeof item.html_url !== 'string') {
			return [];
		}
		return [{
			repo: item.full_name,
			description: typeof item.description === 'string' ? item.description : '',
			stars: typeof item.stargazers_count === 'number' ? item.stargazers_count : 0,
			updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
			url: item.html_url,
		}];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
