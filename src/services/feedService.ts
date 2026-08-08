import { requestUrl } from 'obsidian';
import type {
	GitHubFeedItem,
	HackerNewsItem,
	RssFeedItem,
} from '../data/dashboardTypes';
import { CacheStore } from './cacheStore';
import { isCacheFresh } from './dashboardMath';
import { parseRssXml } from './rssParser';

const CACHE_MAX_AGE = 60 * 60 * 1000;
const GITHUB_SEARCH_URL = 'https://api.github.com/search/repositories?q=AI%20agent&sort=updated&order=desc&per_page=5';
const RSS_URL = 'https://hnrss.org/newest';
const HN_TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';

export interface FeedBundle {
	github: GitHubFeedItem[];
	rss: RssFeedItem[];
	hn: HackerNewsItem[];
}

export class FeedService {
	constructor(private readonly cache: CacheStore) {}

	async loadAll(force = false): Promise<FeedBundle> {
		const [github, rss, hn] = await Promise.all([
			this.getGitHubFeed(force),
			this.getRssFeed(force),
			this.getHackerNewsFeed(force),
		]);
		return { github, rss, hn };
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

	async getRssFeed(force = false): Promise<RssFeedItem[]> {
		return this.loadCached('rss-feed', force, [], async () => {
			const response = await requestUrl({
			url: RSS_URL,
				headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
			});
			return parseRssXml(response.text);
		});
	}

	async getHackerNewsFeed(force = false): Promise<HackerNewsItem[]> {
		return this.loadCached('hn-feed', force, [], async () => {
			const response = await requestUrl(HN_TOP_STORIES_URL);
			const ids = asNumberArray(response.json).slice(0, 5);
			const items = await Promise.all(
				ids.map(async (id) => {
					try {
						const itemResponse = await requestUrl(
							`https://hacker-news.firebaseio.com/v0/item/${id}.json`,
						);
						return parseHackerNewsItem(itemResponse.json);
					} catch {
						return null;
					}
				}),
			);
			return items.filter((item): item is HackerNewsItem => item !== null);
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
		} catch {
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

function parseHackerNewsItem(payload: unknown): HackerNewsItem | null {
	if (!isRecord(payload) || typeof payload.title !== 'string') {
		return null;
	}
	return {
		title: payload.title,
		url: typeof payload.url === 'string'
			? payload.url
			: `https://news.ycombinator.com/item?id=${typeof payload.id === 'number' ? String(payload.id) : ''}`,
		score: typeof payload.score === 'number' ? payload.score : 0,
		by: typeof payload.by === 'string' ? payload.by : '',
		time: typeof payload.time === 'number' ? payload.time : 0,
	};
}

function asNumberArray(value: unknown): number[] {
	return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
