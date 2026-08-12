import type { RepoSnapshot } from '../data/dashboardTypes';
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

	constructor(model: ModelPort) {
		this.model = model;
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
