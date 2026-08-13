import { App } from 'obsidian';
import type { IndexLifecycleService } from './indexLifecycleService.ts';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';

export interface PatrolReport {
	timestamp: string;
	noteCount: number;
	expiredProposals: number;
	missingFrontmatter: number;
	brokenLinks: number;
	issues: string[];
}

/** Periodically patrols the vault for issues and generates reports. */
export class PatrolService {
	private readonly app: App;
	private readonly lifecycle: IndexLifecycleService;

	constructor(app: App, lifecycle: IndexLifecycleService) {
		this.app = app;
		this.lifecycle = lifecycle;
	}

	async patrol(context: RequestContext = createRequestContext('background-task')): Promise<PatrolReport> {
		const state = this.lifecycle.getState();
		const report: PatrolReport = {
			timestamp: new Date().toISOString(),
			noteCount: state.count,
			expiredProposals: 0,
			missingFrontmatter: 0,
			brokenLinks: 0,
			issues: [],
		};

		try {
			/* Check for missing frontmatter */
			const paths = await this.app.vault.getMarkdownFiles();
			for (const file of paths) {
				const content = await this.app.vault.read(file);
				if (!content.startsWith('---')) {
					report.missingFrontmatter++;
					if (report.issues.length < 10) {
						report.issues.push(`缺少 frontmatter：${file.path}`);
					}
				}
			}

			if (report.missingFrontmatter > 0) {
				report.issues.push(`共 ${report.missingFrontmatter} 篇笔记缺少 frontmatter`);
			}

			if (report.noteCount === 0) {
				report.issues.push('索引为空，请重建索引');
			} else {
				report.issues.push(`索引就绪，${report.noteCount} 篇笔记`);
			}
		} catch (error) {
			report.issues.push(`巡检失败：${error instanceof Error ? error.message : '未知错误'}`);
		}

		return report;
	}
}