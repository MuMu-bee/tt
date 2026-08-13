import { App, requestUrl, normalizePath } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';
import type { ResearchPort, ResearchTask, ResearchTaskStatus, ResearchResult, ResearchSource } from '../ports/researchPort.ts';

const SEARCH_API = 'https://api.duckduckgo.com/?q=%s&format=json&no_html=1';
const TASKS_DIR = '_workbench/research/';

/* Sensitive patterns to detect before outbound requests */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /api[_-]?key|apikey|token|secret|password/i, label: 'API密钥' },
	{ pattern: /\b[A-Za-z0-9]{32,}\b/, label: '疑似密钥' },
	{ pattern: /身份证|手机号|银行卡|密码/i, label: '个人信息' },
];

/** Background research service that searches the web and saves results as vault notes. */
export class ResearchService implements ResearchPort {
	private readonly app: App;
	private tasks = new Map<string, ResearchTask>();
	private readonly requestUrl: typeof requestUrl;

	constructor(app: App) {
		this.app = app;
		this.requestUrl = requestUrl;
	}

	async submit(query: string, context: RequestContext = createRequestContext('user')): Promise<string> {
		const taskId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const task: ResearchTask = { taskId, query, status: 'queued', createdAt: new Date().toISOString() };
		this.tasks.set(taskId, task);

		/* Run asynchronously */
		this.runTask(task, context).catch(() => { /* errors handled in runTask */ });
		return taskId;
	}

	getStatus(taskId: string, _context: RequestContext): Promise<ResearchTask | null> {
		return Promise.resolve(this.tasks.get(taskId) ?? null);
	}

	async cancel(taskId: string, _context: RequestContext): Promise<void> {
		const task = this.tasks.get(taskId);
		if (task && (task.status === 'queued' || task.status === 'running')) {
			task.status = 'cancelled';
		}
	}

	list(_context: RequestContext): Promise<ResearchTask[]> {
		return Promise.resolve([...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
	}

	private async runTask(task: ResearchTask, context: RequestContext): Promise<void> {
		task.status = 'running';
		const sources: ResearchSource[] = [];

		/* FR-022: sensitive content check before outbound request */
		const sensitiveHits = SENSITIVE_PATTERNS.filter((s) => s.pattern.test(task.query));
		if (sensitiveHits.length > 0) {
			task.status = 'failed';
			task.error = `查询包含敏感信息（${sensitiveHits.map((s) => s.label).join('、')}），已阻止外发请求`;
			return;
		}

		try {
			/* Search the web */
			const searchUrl = SEARCH_API.replace('%s', encodeURIComponent(task.query));
			const response = await this.requestUrl({ url: searchUrl, method: 'GET' });

			if (response.status === 200) {
				const data = response.json;
				if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
					data.RelatedTopics.slice(0, 5).forEach((topic: Record<string, unknown>) => {
						if (topic.Text && topic.FirstURL) {
							sources.push({
								url: topic.FirstURL as string,
								title: (topic.Text as string).split(' - ')[0] ?? topic.Text as string,
								snippet: topic.Text as string,
								fetchedAt: new Date().toISOString(),
								provider: 'DuckDuckGo',
							});
						}
					});
				}
			}

			/* Generate summary */
			const summary = sources.length > 0
				? `关于「${task.query}」的研究结果：找到 ${sources.length} 个相关来源。`
				: `关于「${task.query}」的研究：未找到相关结果。`;

			/* Save results as vault note */
			const date = new Date();
			const fileName = `研究-${task.query.slice(0, 20).replace(/[\/\\?*\[\]]/g, '_')}-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.md`;
			const content = this.formatReport(task.query, summary, sources);
			await this.app.vault.adapter.mkdir('Reports');
			const reportPath = normalizePath(`Reports/${fileName}`);
			await this.app.vault.create(reportPath, content);

			task.result = { summary, sources, reportPath };
			task.status = 'completed';
			task.completedAt = new Date().toISOString();
		} catch (error) {
			task.status = 'failed';
			task.error = error instanceof Error ? error.message : '研究任务失败';
		}
	}

	private formatReport(query: string, summary: string, sources: ResearchSource[]): string {
		const lines: string[] = [];
		lines.push(`# 研究：${query}`);
		lines.push('');
		lines.push(`> 生成时间：${new Date().toISOString()}`);
		lines.push('');
		lines.push('## 摘要');
		lines.push('');
		lines.push(summary);
		lines.push('');
		if (sources.length > 0) {
			lines.push('## 来源');
			lines.push('');
			sources.forEach((src, i) => {
				lines.push(`${i + 1}. **${src.title}**`);
				lines.push(`   - 来源：${src.url}`);
				lines.push(`   - 摘要：${src.snippet}`);
				lines.push('');
			});
		}
		lines.push('---');
		lines.push('*由墨忆台自动生成*');
		return lines.join('\n');
	}
}