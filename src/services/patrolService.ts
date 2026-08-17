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

/** 巡检报告中 issue 列表的最大样例条数。 */
const MAX_ISSUE_SAMPLES = 10;

/** Periodically patrols the vault for issues and generates reports. */
export class PatrolService {
	private readonly app: App;
	private readonly lifecycle: IndexLifecycleService;
	private readonly proposals?: import('./proposalService.ts').ProposalService;

	constructor(app: App, lifecycle: IndexLifecycleService, proposals?: import('./proposalService.ts').ProposalService) {
		this.app = app;
		this.lifecycle = lifecycle;
		this.proposals = proposals;
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
			const paths = this.app.vault.getMarkdownFiles();
			for (const file of paths) {
				const content = await this.app.vault.read(file);
				if (!content.startsWith('---')) {
					report.missingFrontmatter++;
					if (report.issues.length < MAX_ISSUE_SAMPLES) {
						report.issues.push(`缺少 frontmatter：${file.path}`);
					}
				}
			}

			if (report.missingFrontmatter > 0) {
				report.issues.push(`共 ${report.missingFrontmatter} 篇笔记缺少 frontmatter`);
			}

			/* Broken link detection: count unresolved [[wikilinks]] targets from Obsidian's metadata cache. */
			const unresolved = this.app.metadataCache.unresolvedLinks ?? {};
			let brokenLinkCount = 0;
			const brokenSamples: string[] = [];
			for (const [sourcePath, targets] of Object.entries(unresolved)) {
				if (!sourcePath.toLocaleLowerCase().endsWith('.md')) continue;
				for (const target of Object.keys(targets ?? {})) {
					brokenLinkCount += 1;
					if (brokenSamples.length < MAX_ISSUE_SAMPLES) {
						brokenSamples.push(`${sourcePath} -> [[${target}]]`);
					}
				}
			}
			report.brokenLinks = brokenLinkCount;
			if (brokenLinkCount > 0) {
				report.issues.push(`发现 ${brokenLinkCount} 条断链`);
				for (const sample of brokenSamples) {
					report.issues.push(`  断链：${sample}`);
				}
			}

			/* Expired proposals: mark overdue pending/approved proposals as expired and report them. */
			if (this.proposals) {
				const context = createRequestContext('background-task');
				const expiredCount = await this.proposals.expireOverdue(context);
				report.expiredProposals = expiredCount;
				if (expiredCount > 0) {
					report.issues.push(`${expiredCount} 条 proposal 已过期并标记`);
				}
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
