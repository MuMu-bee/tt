import { App, Platform, TFile, Notice, normalizePath } from 'obsidian';
import type {
	GitHubFeedItem,
	RssFeedItem,
} from '../data/dashboardTypes';
import { toDateKey } from './dashboardMath';
import { CacheStore } from './cacheStore';
import { DashboardService } from './dashboardService';

export class AgentActionService {
	private readonly writer: CacheStore;

	constructor(
		private readonly app: App,
		private readonly dashboard: DashboardService,
		private readonly getHermesPath: () => string,
	) {
		this.writer = new CacheStore(app.vault);
	}

	async createDiary(): Promise<string> {
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

	async runDeepResearch(): Promise<string> {
		const date = toDateKey(new Date());
		const report = await this.runHermes(
			'研究今天的 AI Agent 资讯，输出 Markdown 报告',
		);
		return this.writeReport(`deep-research-${date}.md`, report);
	}

	async pullRssSummary(): Promise<string> {
		const items = await this.dashboard.getFeeds().getRssFeed(true);
		const report = await this.runHermes(this.buildRssPrompt(items));
		return this.writeReport(`rss-summary-${toDateKey(new Date())}.md`, report);
	}

	async pullGitHubPicks(): Promise<string> {
		const items = await this.dashboard.getFeeds().getGitHubFeed(true);
		const report = await this.runHermes(this.buildGitHubPrompt(items));
		return this.writeReport(`github-picks-${toDateKey(new Date())}.md`, report);
	}

	async ingestInbox(content: string): Promise<string> {
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

	async runVaultLint(): Promise<string> {
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

	private async runHermes(prompt: string): Promise<string> {
		if (!Platform.isDesktop) {
			throw new Error('hermes 只能在桌面端运行。');
		}

		const command = this.getHermesPath().trim() || 'hermes';
		const { spawn } = await import('node:child_process');
		return new Promise<string>((resolve, reject) => {
			const child = spawn(command, ['-p', prompt], { windowsHide: true });
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', (chunk: Uint8Array | string) => {
				stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			});
			child.stderr?.on('data', (chunk: Uint8Array | string) => {
				stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
			});
			child.once('error', (error: Error & { code?: string }) => {
				if (error.code === 'ENOENT') {
					reject(new Error('找不到 hermes，请在插件设置中配置 hermes 命令路径。'));
					return;
				}
				reject(error);
			});
			child.once('close', (code) => {
				if (code === 0) {
					resolve(stdout.trim());
					return;
				}
				reject(new Error(`hermes 执行失败（${code ?? 'unknown'}）：${stderr.trim()}`));
			});
		});
	}

	private async writeReport(fileName: string, content: string): Promise<string> {
		await this.writer.ensureFolder('Reports');
		const path = normalizePath(`Reports/${fileName}`);
		await this.writer.writeText(path, content.endsWith('\n') ? content : `${content}\n`);
		return path;
	}

	private buildRssPrompt(items: RssFeedItem[]): string {
		return [
			'请用中文总结以下 RSS 新闻，输出 Markdown，包含标题、来源链接、核心要点和值得跟进的方向。',
			JSON.stringify(items),
		].join('\n\n');
	}

	private buildGitHubPrompt(items: GitHubFeedItem[]): string {
		return [
			'请从以下 GitHub AI Agent 项目中筛选值得关注的项目，输出中文 Markdown，说明项目用途、关注理由和 stars。',
			JSON.stringify(items),
		].join('\n\n');
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
