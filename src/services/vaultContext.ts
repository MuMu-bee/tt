import { App, TFile } from 'obsidian';
import type { ChatReference } from '../data/dashboardTypes';
import type { SearchService } from './searchService';

/** 粗估换算：1 token ≈ 3 字符。 */
const TOKENS_TO_CHARS_FACTOR = 3;

/**
 * Vault context injection: search vault for notes relevant to a query,
 * read their content, and assemble a context string for the LLM.
 */
export class VaultContextService {
	constructor(private readonly app: App, private readonly searchService?: SearchService) {}

	/**
	 * Search vault files by keyword matching (title + content).
	 * Returns top N references with snippets.
	 */
	async search(query: string, maxResults = 5): Promise<ChatReference[]> {
		if (this.searchService) {
			const results = await this.searchService.query({ query, limit: maxResults });
			return results.map((result) => ({ path: result.path, title: result.title, snippet: result.snippet ?? '' }));
		}
		const keywords = this.extractKeywords(query);
		if (keywords.length === 0) {
			return [];
		}

		const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file.path));
		// 并行读取文件内容，避免大库下串行 I/O 拖慢每次对话。
		const withContent = await Promise.all(
			files.map(async (file) => ({ file, content: await this.app.vault.cachedRead(file) })),
		);
		const scored: Array<{ file: TFile; score: number; snippet: string }> = [];

		for (const { file, content } of withContent) {
			const score = this.scoreMatch(file.basename, content, keywords);

			if (score > 0) {
				const snippet = this.extractSnippet(content, keywords);
				scored.push({ file, score, snippet });
			}
		}

		// Sort by score descending, take top N
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, maxResults).map((item) => ({
			path: item.file.path,
			title: item.file.basename,
			snippet: item.snippet,
		}));
	}

	/**
	 * Build a context string from references for LLM injection.
	 */
	buildContext(references: ChatReference[], maxTokens: number): string {
		if (references.length === 0) {
			return '';
		}

		const parts: string[] = ['以下是 Vault 中与用户问题相关的笔记内容：\n'];
		let totalLength = 0;
		const charLimit = maxTokens * TOKENS_TO_CHARS_FACTOR;

		for (const ref of references) {
			const part = `【${ref.title}】(${ref.path})\n${ref.snippet}\n`;
			if (totalLength + part.length > charLimit) {
				break;
			}
			parts.push(part);
			totalLength += part.length;
		}

		return parts.join('\n');
	}

	/**
	 * Extract keywords from a natural language query.
	 */
	private extractKeywords(query: string): string[] {
		// Remove common Chinese stop words and punctuation
		const stopWords = new Set([
			'的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
			'一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有',
			'看', '好', '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么',
			'如何', '吗', '呢', '吧', '啊', '嗯', '哦', '帮我', '看看', '一下', '请问',
			'能不能', '可以', '帮', '找', '搜', '查询', '查', '什么', '哪个', '哪里',
		]);

		// Split by whitespace and Chinese boundaries
		const words = query
			.replace(/[，。！？、；：""''（）【】《》\s]+/g, ' ')
			.split(/\s+/)
			.map((w) => w.trim().toLowerCase())
			.filter((w) => w.length > 0 && !stopWords.has(w));

		const keywords = new Set<string>();
		for (const word of words) {
			keywords.add(word);
			// 中文没有空格分词：补充 2-gram，避免整句作为单个子串导致召回不足。
			if (/[\u4e00-\u9fff]/.test(word) && word.length >= 2) {
				for (let i = 0; i < word.length - 1; i += 1) {
					keywords.add(word.slice(i, i + 2));
				}
			}
		}

		return [...keywords];
	}

	/**
	 * Score how well a file matches the keywords.
	 */
	private scoreMatch(title: string, content: string, keywords: string[]): number {
		const titleLower = title.toLowerCase();
		const contentLower = content.toLowerCase();
		let score = 0;

		for (const keyword of keywords) {
			// Title match worth more
			if (titleLower.includes(keyword)) {
				score += 10;
			}
			// Content match
			const count = contentLower.split(keyword).length - 1;
			score += Math.min(count, 5); // cap per keyword to avoid spam
		}

		return score;
	}

	/**
	 * Extract a relevant snippet around the first keyword match.
	 */
	private extractSnippet(content: string, keywords: string[]): string {
		const contentLower = content.toLowerCase();
		let bestIndex = -1;
		let bestKeyword = '';

		for (const keyword of keywords) {
			const idx = contentLower.indexOf(keyword);
			if (idx >= 0 && (bestIndex < 0 || idx < bestIndex)) {
				bestIndex = idx;
				bestKeyword = keyword;
			}
		}

		if (bestIndex < 0) {
			// No match found, return first 200 chars
			return content.slice(0, 200).trim() + '...';
		}

		// Extract ~300 chars around the match
		const start = Math.max(0, bestIndex - 100);
		const end = Math.min(content.length, bestIndex + bestKeyword.length + 200);
		let snippet = content.slice(start, end).trim();

		if (start > 0) snippet = '...' + snippet;
		if (end < content.length) snippet = snippet + '...';

		return snippet;
	}

	private isExcluded(path: string): boolean {
		const excluded = [
			'dashboard/',
			'.obsidian/',
			'Templates/',
			'.canvas',
			'.kanban',
		];
		return excluded.some((pattern) => path.includes(pattern));
	}
}
