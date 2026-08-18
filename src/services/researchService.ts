import { requestUrl, normalizePath } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';
import { WORKBENCH_DIRS } from '../data/dashboardTypes.ts';
import type { ResearchPort, ResearchTask, ResearchSource, ResearchTaskStatus } from '../ports/researchPort.ts';
import type { WorkbenchWriteService } from './workbenchWriteService.ts';

const SEARCH_API = 'https://api.duckduckgo.com/?q=%s&format=json&no_html=1';
/** 生成报告文件名时查询词截断长度。 */
const FILENAME_QUERY_SLICE = 20;
/** 提交的研究查询最大长度。 */
const MAX_QUERY_LENGTH = 2000;
/** 内存中保留的研究任务上限，超出后清理最老的终态任务。 */
const MAX_TASKS = 100;

/* Sensitive patterns to detect before outbound requests */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /api[_-]?key|apikey|token|secret|password/i, label: 'API密钥' },
	{ pattern: /\b[A-Za-z0-9]{32,}\b/, label: '疑似密钥' },
	{ pattern: /身份证|手机号|银行卡|密码/i, label: '个人信息' },
];

/** Background research service that searches the web and saves results as vault notes. */
export class ResearchService implements ResearchPort {
	private tasks = new Map<string, ResearchTask>();
	private readonly requestUrl: typeof requestUrl;

	constructor(private readonly workbenchWrite: WorkbenchWriteService) {
		this.requestUrl = requestUrl;
	}

	async submit(query: string, context: RequestContext = createRequestContext('user')): Promise<string> {
		const trimmed = query.trim();
		if (!trimmed) throw new Error('研究主题不能为空');
		if (trimmed.length > MAX_QUERY_LENGTH) throw new Error(`研究主题过长（上限 ${MAX_QUERY_LENGTH} 字符）`);
		const taskId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const task: ResearchTask = { taskId, query: trimmed, status: 'queued', createdAt: new Date().toISOString() };
		this.tasks.set(taskId, task);

		/* 防止任务 Map 无限增长：超过上限时清理最老的终态任务。 */
		if (this.tasks.size > MAX_TASKS) {
			const terminal = [...this.tasks.entries()]
				.filter(([, t]) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
				.sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
			const toRemove = terminal.slice(0, this.tasks.size - MAX_TASKS);
			for (const [id] of toRemove) this.tasks.delete(id);
		}

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

		/* cancel() 可能在任何 await 之后修改 task.status，TS 的收窄在这里不可靠，
		   因此每次检查都通过宽类型重新读取当前状态。 */
		const isCancelled = (): boolean => (task as { status: ResearchTaskStatus }).status === 'cancelled';

		/* FR-022: sensitive content check before outbound request */
		const sensitiveHits = SENSITIVE_PATTERNS.filter((s) => s.pattern.test(task.query));
		if (sensitiveHits.length > 0) {
			task.status = 'failed';
			task.error = `查询包含敏感信息（${sensitiveHits.map((s) => s.label).join('、')}），已阻止外发请求`;
			return;
		}

		try {
			/* 协作式取消：任何 await 之后都检查取消状态，已取消的任务不再继续写结果。 */
			if (isCancelled()) return;

			/* Search the web */
			const searchUrl = SEARCH_API.replace('%s', encodeURIComponent(task.query));
			const response = await this.requestUrl({ url: searchUrl, method: 'GET' });
			if (isCancelled()) return;

			if (response.status === 200) {
				const data: unknown = response.json;
				if (isRecord(data) && Array.isArray(data.RelatedTopics)) {
					data.RelatedTopics.slice(0, 5).forEach((topic: unknown) => {
						if (!isRecord(topic) || typeof topic.Text !== 'string' || typeof topic.FirstURL !== 'string') {
							return;
						}
						sources.push({
							url: topic.FirstURL,
							title: topic.Text.split(' - ')[0] ?? topic.Text,
							snippet: topic.Text,
							fetchedAt: new Date().toISOString(),
							provider: 'DuckDuckGo',
						});
					});
				}
			}

			/* Generate summary */
			const summary = sources.length > 0
				? `关于「${task.query}」的研究结果：找到 ${sources.length} 个相关来源。`
				: `关于「${task.query}」的研究：未找到相关结果。`;

			/* Cancel check: the user may have cancelled while the network call was in flight. */
			if (this.tasks.get(task.taskId)?.status === 'cancelled') return;

			/* Save results as vault note through the unified generated-content writer. */
			const date = new Date();
			const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
			const fileName = `研究-${task.query.slice(0, FILENAME_QUERY_SLICE).replace(/[\\?*[\]]/g, '_')}-${stamp}.md`;
			const content = this.formatReport(task.query, summary, sources);
			const reportPath = normalizePath(`${WORKBENCH_DIRS.reports}/${fileName}`);
			const writeResult = await this.workbenchWrite.writeGenerated({ path: reportPath, content, kind: 'research', context });
			if (writeResult.status === 'failed') {
				throw new Error(writeResult.error_code ?? '研究报告写入失败');
			}
			if (writeResult.status === 'skipped') {
				throw new Error('研究报告已存在，未覆盖');
			}

			/* 最终确认：写入完成后若已被取消，不把取消覆盖为 completed。 */
			if (isCancelled()) return;

			task.result = { summary, sources, reportPath: writeResult.path };
			task.status = 'completed';
			task.completedAt = new Date().toISOString();
		} catch (error) {
			/* 已取消的任务保持 cancelled，不被异常覆盖为 failed。 */
			if (!isCancelled()) {
				task.status = 'failed';
				task.error = error instanceof Error ? error.message : '研究任务失败';
			}
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}