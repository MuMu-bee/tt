import { normalizePath } from 'obsidian';
import type { RepoSnapshot, } from '../data/dashboardTypes';
import { WORKBENCH_DIRS } from '../data/dashboardTypes';
import type { ModelPort } from '../ports/modelPort';
import type { RequestContext } from '../application/requestContext';
import { buildProjectReportPrompt } from '../application/githubTracker';

export interface ProjectReportResult {
	report: string;
	error?: string;
}

/**
 * Generates a plain-Chinese project report through the configured model.
 * Never throws: failures surface as `error` so callers can show them.
 */
export class ProjectReportService {
	private readonly model: ModelPort;
	private readonly app?: import('obsidian').App;

	constructor(model: ModelPort, app?: import('obsidian').App) {
		this.model = model;
		this.app = app;
	}

	/** Writes a markdown report under Reports/. Vault writes go through the service, not the UI. */
	async writeReport(fileName: string, content: string): Promise<string> {
		if (!this.app) {
			throw new Error('报告写入服务未初始化');
		}
		await this.app.vault.adapter.mkdir(WORKBENCH_DIRS.reports);
		const path = normalizePath(`${WORKBENCH_DIRS.reports}/${fileName}`);
		await this.app.vault.create(path, content);
		return path;
	}

	async generateReport(
		snapshot: RepoSnapshot,
		context: RequestContext,
	): Promise<ProjectReportResult> {
		if (snapshot.releases.length === 0 && snapshot.commits.length === 0 && snapshot.issues.length === 0) {
			return {
				report: '',
				error: snapshot.error ? `拉取失败：${snapshot.error}` : '该项目最近没有可总结的动态',
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
}
