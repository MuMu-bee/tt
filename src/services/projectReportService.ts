import { normalizePath, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type {
	ProjectBaseline,
	ProjectGroup,
	ProjectIncrementItem,
	RepoSnapshot,
	TrackedProject,
} from '../data/dashboardTypes';
import type { ModelPort } from '../ports/modelPort';
import { createRequestContext, type RequestContext } from '../application/requestContext';
import type { WorkbenchWriteService } from './workbenchWriteService';
import {
	buildGlobalIndexRow,
	buildMergedWeeklySummary,
	buildProjectReportPrompt,
	buildRecentUpdatesPrompt,
	buildVsSummaryPrompt,
	escapeYamlValue,
} from '../application/githubTracker';
import type { ProjectCheckResult } from './projectTracker';

export interface ProjectReportResult {
	report: string;
	error?: string;
}

export interface VsSummaryResult {
	summary: string;
	error?: string;
}

export interface RecentUpdatesResult {
	items: string[];
	error?: string;
}

const DEFAULT_NOTE_FOLDER = 'Projects';

/**
 * Generates plain-Chinese project reports and persists the project-tracker
 * notes (per-project changelog + global index) under the configured folder.
 */
export class ProjectReportService {
	private readonly model: ModelPort;
	private readonly app?: App;
	private readonly workbenchWrite?: WorkbenchWriteService;

	constructor(model: ModelPort, app?: App, workbenchWrite?: WorkbenchWriteService) {
		this.model = model;
		this.app = app;
		this.workbenchWrite = workbenchWrite;
	}

	/** Writes a markdown report under Reports/. Vault writes go through the service, not the UI. */
	async writeReport(fileName: string, content: string): Promise<string> {
		if (!this.app) {
			throw new Error('报告写入服务未初始化');
		}
		await this.ensureFolder('Reports');
		const path = normalizePath('Reports/' + fileName);
		await this.writeText(path, content);
		return path;
	}

	async generateReport(
		snapshot: RepoSnapshot,
		context: RequestContext,
	): Promise<ProjectReportResult> {
		if (snapshot.releases.length === 0 && snapshot.commits.length === 0 && snapshot.issues.length === 0) {
			return {
				report: '',
				error: snapshot.error ? '拉取失败：' + snapshot.error : '该项目最近没有可总结的动态',
			};
		}
		try {
			const content = await this.model.generate(buildProjectReportPrompt(snapshot), context);
			return { report: content };
		} catch (error) {
			return {
				report: '',
				error: error instanceof Error ? error.message : '报告生成失败',
			};
		}
	}

	/** Produces a short Chinese list of the most important recent user-visible updates. */
	async generateRecentUpdates(snapshot: RepoSnapshot, context: RequestContext): Promise<RecentUpdatesResult> {
		if (snapshot.releases.length === 0 && snapshot.commits.length === 0 && snapshot.issues.length === 0) {
			return { items: [], error: snapshot.error ? '拉取失败：' + snapshot.error : '暂无最近更新' };
		}
		try {
			const raw = await this.model.generate(buildRecentUpdatesPrompt(snapshot), context);
			const items = raw
				.split(/\n+/u)
				.map((line) => line.replace(/^[-*·•\d.\s]+/u, '').trim())
				.filter((line) => line.length > 0)
				.slice(0, 5);
			return { items: items.length > 0 ? items : ['最近没有重要的用户可见更新。'] };
		} catch (error) {
			return {
				items: [],
				error: error instanceof Error ? error.message : '最近更新摘要生成失败',
			};
		}
	}

	/** Produces the fixed "vs <上一版本> · <更新了什么>" one-sentence card summary. */
	async generateVsSummary(
		snapshot: RepoSnapshot,
		baseline: ProjectBaseline,
		increments: ProjectIncrementItem[],
		context: RequestContext,
	): Promise<VsSummaryResult> {
		if (snapshot.releases.length === 0 && snapshot.commits.length === 0 && snapshot.issues.length === 0) {
			return { summary: 'vs 上一版本 · 本次无实质更新', error: snapshot.error };
		}
		try {
			const raw = await this.model.generate(buildVsSummaryPrompt(snapshot, baseline, increments), context);
			const summary = raw
				.replace(/[#*>'-]/gu, ' ')
				.replace(/\s+/gu, ' ')
				.trim();
			return { summary: summary || 'vs 上一版本 · 本次无实质更新' };
		} catch (error) {
			return {
				summary: 'vs 上一版本 · ' + (increments.length > 0 ? buildMergedWeeklySummary(increments) : '本次无实质更新'),
				error: error instanceof Error ? error.message : '摘要生成失败',
			};
		}
	}

	/** Creates or updates the per-project changelog note. */
	async writeProjectChangelog(
		project: TrackedProject,
		group: ProjectGroup | undefined,
		snapshot: RepoSnapshot,
		increments: ProjectIncrementItem[],
		summary: string,
		noteFolder = DEFAULT_NOTE_FOLDER,
		context: RequestContext = createRequestContext('background-task'),
	): Promise<string> {
		if (!this.app) throw new Error('笔记写入服务未初始化');
		const folder = this.normalizeFolder(noteFolder);
		const fileName = project.repo.replace('/', '-') + '.md';
		const path = normalizePath(folder + '/' + fileName);

		const old = await this.readText(path);
		const date = new Date();
		const dateLabel = date.toISOString().slice(0, 10);
		const heading = '## 本次更新 · ' + dateLabel;
		const section = this.renderIncrementSection(increments);
		const frontmatter = [
			'---',
			'repo: ' + escapeYamlValue(project.repo),
			'group: ' + escapeYamlValue(group?.name ?? project.groupId),
			'series: ' + escapeYamlValue(project.series || '未分类'),
			'stars: ' + String(snapshot.stars),
			'updated: ' + escapeYamlValue(snapshot.fetchedAt),
			'version: ' + escapeYamlValue(snapshot.releases[0]?.tag ?? ''),
			'---',
			'',
		].join('\n');

		const oldBody = this.stripFrontmatter(old);
		const alreadyLoggedToday = oldBody.includes(heading);
		const titleBlock = oldBody && !alreadyLoggedToday
			? ''
			: [
				'# ' + project.repo,
				'',
				'> ' + summary,
				'',
				'Star ' + String(snapshot.stars) + ' · 最近更新 ' + (snapshot.updatedAt || '未知'),
				'',
				'- [打开 GitHub ↗](https://github.com/' + project.repo + ')',
				'',
			].join('\n');
		const body = alreadyLoggedToday ? '' : titleBlock + heading + '\n' + section + '\n';
		const next = alreadyLoggedToday
			? frontmatter + oldBody
			: frontmatter + oldBody + (oldBody ? '\n---\n\n' : '') + body;
		await this.writeGeneratedOrDirect(path, next, context);
		return path;
	}

	/** Rebuilds the global project index note. */
	async writeGlobalIndex(
		results: ProjectCheckResult[],
		groups: ProjectGroup[],
		noteFolder = DEFAULT_NOTE_FOLDER,
		context: RequestContext = createRequestContext('background-task'),
	): Promise<string> {
		if (!this.app) throw new Error('笔记写入服务未初始化');
		const folder = this.normalizeFolder(noteFolder);
		const path = normalizePath(folder + '/项目追踪索引.md');

		const rows = results.map(({ project, snapshot }) => {
			const group = groups.find((candidate) => candidate.id === project.groupId);
			return buildGlobalIndexRow(project, group, snapshot, folder);
		}).join('\n');

		const content = [
			'# 项目追踪索引',
			'',
			'> 更新时间：' + new Date().toISOString(),
			'',
			'| 项目 | 优先级 | 系列 | 状态 | Star | 版本 | 最近更新 | 日志 |',
			'| --- | --- | --- | --- | --- | --- | --- | --- |',
			rows,
			'',
		].join('\n');
		await this.writeGeneratedOrDirect(path, content, context);
		return path;
	}

	private async writeGeneratedOrDirect(path: string, content: string, context: RequestContext): Promise<void> {
		if (this.workbenchWrite) {
			const result = await this.workbenchWrite.writeGenerated({
				path,
				content,
				kind: 'project',
				context,
				overwrite: true,
			});
			if (result.status === 'failed') {
				throw new Error(result.error_code ?? '项目笔记写入失败');
			}
			return;
		}
		await this.writeText(path, content);
	}

	private renderIncrementSection(increments: ProjectIncrementItem[]): string {
		if (increments.length === 0) {
			return '暂无新增改动。\n';
		}
		return increments.slice(0, 20).map((item) => {
			const kind = item.kind === 'release' ? '版本' : item.kind === 'commit' ? '提交' : '讨论';
			const date = item.date ? ' · ' + item.date.slice(0, 10) : '';
			return '- [' + kind + '] ' + (item.title || item.detail) + date + (item.url ? ' — ' + item.url : '');
		}).join('\n') + '\n';
	}

	private normalizeFolder(folder: string): string {
		const trimmed = folder.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
		return trimmed || DEFAULT_NOTE_FOLDER;
	}

	private stripFrontmatter(content: string): string {
		if (!content.startsWith('---')) return content;
		const end = content.indexOf('\n---', 3);
		if (end < 0) return content;
		return content.slice(end + 4).replace(/^\n+/, '');
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!this.app) throw new Error('笔记写入服务未初始化');
		const normalized = normalizePath(folder);
		const segments = normalized.split('/');
		let current = '';
		for (const segment of segments) {
			current = current ? current + '/' + segment : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFile) throw new Error('路径被文件占用：' + current);
			if (!existing) await this.app.vault.createFolder(current);
		}
	}

	private async readText(path: string): Promise<string> {
		if (!this.app) return '';
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return '';
		return this.app.vault.cachedRead(file);
	}

	private async writeText(path: string, content: string): Promise<void> {
		if (!this.app) throw new Error('笔记写入服务未初始化');
		const parent = path.split('/').slice(0, -1).join('/');
		if (parent) await this.ensureFolder(parent);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}
}
