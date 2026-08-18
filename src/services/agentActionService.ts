import { App, TFile, Notice, normalizePath } from 'obsidian';
import type { ModelPort } from '../ports/modelPort';
import {
	createRequestContext,
	type RequestContext,
} from '../application/requestContext';
import { toDateKey } from './dashboardMath';
import { DashboardService } from './dashboardService';
import { WORKBENCH_DIRS } from '../data/dashboardTypes';
import type { WorkbenchWriteService } from './workbenchWriteService';

export class AgentActionService {
	constructor(
		private readonly app: App,
		private readonly dashboard: DashboardService,
		private readonly model: ModelPort,
		private readonly workbenchWrite: WorkbenchWriteService,
	) {}

	async createDiary(context: RequestContext = createRequestContext()): Promise<string> {
		const date = toDateKey(new Date());
		const path = normalizePath(`${WORKBENCH_DIRS.daily}/${date}.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			return path;
		}
		const result = await this.workbenchWrite.writeGenerated({
			path,
			content: `# ${date}\n\n## Tasks\n\n- [ ] \n`,
			kind: 'diary',
			context,
		});
		if (result.status === 'failed') {
			throw new Error(result.error_code ?? '日记写入失败');
		}
		return result.path;
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
		const trimmed = content.trim();
		if (!trimmed) {
			throw new Error('请输入要导入 Inbox 的内容。');
		}

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
		const path = normalizePath(`${WORKBENCH_DIRS.inbox}/${timestamp}-${title || 'inbox-note'}.md`);
		const result = await this.workbenchWrite.writeGenerated({
			path,
			content: `---\ncreated: ${now.toISOString()}\ntags:\n  - inbox\n---\n\n${trimmed}\n`,
			kind: 'inbox',
			context,
		});
		if (result.status === 'failed') {
			throw new Error(result.error_code ?? 'Inbox 写入失败');
		}
		return result.path;
	}

	async runVaultLint(_context: RequestContext = createRequestContext()): Promise<string> {
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
		const path = normalizePath(`${WORKBENCH_DIRS.reports}/${fileName}`);
		const context = createRequestContext();
		const result = await this.workbenchWrite.writeGenerated({
			path,
			content: content.endsWith('\n') ? content : `${content}\n`,
			kind: 'report',
			context,
		});
		if (result.status === 'failed') {
			throw new Error(result.error_code ?? '报告写入失败');
		}
		return result.path;
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
