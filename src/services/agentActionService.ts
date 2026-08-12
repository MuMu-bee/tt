import { App, TFile, Notice, normalizePath } from 'obsidian';
import type { ModelPort } from '../ports/modelPort';
import {
	createRequestContext,
	type RequestContext,
} from '../application/requestContext';
import { toDateKey } from './dashboardMath';
import { CacheStore } from './cacheStore';
import { DashboardService } from './dashboardService';

export class AgentActionService {
	private readonly writer: CacheStore;

	constructor(
		private readonly app: App,
		private readonly dashboard: DashboardService,
		private readonly model: ModelPort,
	) {
		this.writer = new CacheStore(app.vault);
	}

	async createDiary(context: RequestContext = createRequestContext()): Promise<string> {
		void context;
		const date = toDateKey(new Date());
		await this.writer.ensureFolder('Daily');
		const path = normalizePath(`Daily/${date}.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			return path;
		}
		await this.writer.writeText(path, `# ${date}\n\n## Tasks\n\n- [ ] \n`);
		return path;
	}

	async runDeepResearch(context: RequestContext = createRequestContext()): Promise<string> {
		const date = toDateKey(new Date());
		const report = await this.generateReport(
			'研究今天的 AI Agent 资讯，输出 Markdown 报告',
			context,
		);
		return this.writeReport(`deep-research-${date}.md`, report);
	}

	async ingestInbox(
		content: string,
		context: RequestContext = createRequestContext(),
	): Promise<string> {
		void context;
		const trimmed = content.trim();
		if (!trimmed) {
			throw new Error('请输入要导入 Inbox 的内容。');
		}

		await this.writer.ensureFolder('Inbox');
		const now = new Date();
		const timestamp = [
			String(now.getFullYear()),
			String(now.getMonth() + 1).padStart(2, '0'),
			String(now.getDate()).padStart(2, '0'),
			'-',
			String(now.getHours()).padStart(2, '0'),
			String(now.getMinutes()).padStart(2, '0'),
			String(now.getSeconds()).padStart(2, '0'),
		].join('');
		const title = this.sanitizeTitle(trimmed.split(/\r?\n/)[0] ?? 'inbox-note');
		const path = normalizePath(`Inbox/${timestamp}-${title || 'inbox-note'}.md`);
		await this.writer.writeText(path, `---\ncreated: ${now.toISOString()}\ntags:\n  - inbox\n---\n\n${trimmed}\n`);
		return path;
	}

	async runVaultLint(context: RequestContext = createRequestContext()): Promise<string> {
		void context;
		const result = await this.dashboard.scanVault();
		const body = [
			`# Vault lint report`,
			'',
			`Generated: ${new Date().toISOString()}`,
			'',
			`Found ${result.lintIssues.length} note(s) requiring attention.`,
			'',
			...result.lintIssues.flatMap((issue) => [
				`## ${issue.path}`,
				'',
				...issue.reasons.map((reason) => `- ${reason}`),
				'',
			]),
		].join('\n');
		return this.writeReport(`vault-lint-${toDateKey(new Date())}.md`, body);
	}

	private async generateReport(prompt: string, context: RequestContext): Promise<string> {
		return this.model.generate(prompt, context);
	}

	private async writeReport(fileName: string, content: string): Promise<string> {
		await this.writer.ensureFolder('Reports');
		const path = normalizePath(`Reports/${fileName}`);
		await this.writer.writeText(path, content.endsWith('\n') ? content : `${content}\n`);
		return path;
	}

	private sanitizeTitle(value: string): string {
		return value
			.replace(/[\\/:*?"<>|]/g, '-')
			.replace(/\s+/g, '-')
			.slice(0, 60)
			.replace(/^-+|-+$/g, '');
	}
}

export function showActionError(error: unknown): void {
	const message = error instanceof Error ? error.message : '操作失败，请查看开发者控制台。';
	new Notice(message);
}
