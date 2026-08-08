import { App, TFile } from 'obsidian';
import type {
	DashboardData,
	DashboardTask,
	TaskRecord,
	VaultLintIssue,
} from '../data/dashboardTypes';
import {
	bucketCreationDates,
	calculateHealthScore,
	countTaskMetrics,
	parseLocalDate,
	parseTaskLine,
	toDateKey,
} from './dashboardMath';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const HEATMAP_DAYS = 364;

export class VaultScanner {
	constructor(private readonly app: App) {}

	async scan(today: string, now = Date.now()): Promise<{
		dashboard: DashboardData;
		tasks: TaskRecord[];
		lintIssues: VaultLintIssue[];
	}> {
		const files = this.app.vault.getMarkdownFiles();
		const taskRecords: TaskRecord[] = [];
		const lintIssues: VaultLintIssue[] = [];
		let frontmatterCount = 0;
		let taggedCount = 0;

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter !== undefined) {
				frontmatterCount += 1;
			}
			if ((cache?.tags?.length ?? 0) > 0) {
				taggedCount += 1;
			}

			const content = await this.app.vault.cachedRead(file);
			const sourceDate = toDateKey(new Date(file.stat.ctime));
			content.split(/\r?\n/).forEach((line, index) => {
				const parsed = parseTaskLine(line);
				if (parsed) {
					taskRecords.push({
						...parsed,
						sourcePath: file.path,
						sourceDate,
						line: index + 1,
					});
				}
			});

			const reasons: string[] = [];
			if (cache?.frontmatter === undefined) {
				reasons.push('没有 frontmatter');
			}
			if ((cache?.tags?.length ?? 0) === 0) {
				reasons.push('没有标签');
			}
			if (this.isOrphan(file)) {
				reasons.push('孤立笔记');
			}
			if (now - file.stat.mtime > 30 * DAY_IN_MILLISECONDS) {
				reasons.push('超过 30 天未修改');
			}
			if (reasons.length > 0) {
				lintIssues.push({ path: file.path, reasons });
			}
		}

		const inboxFiles = files.filter((file) => this.isInboxFile(file));
		const oldestInbox = inboxFiles.reduce<number | null>((oldest, file) => {
			if (oldest === null || file.stat.ctime < oldest) {
				return file.stat.ctime;
			}
			return oldest;
		}, null);
		const oldestDays = oldestInbox === null
			? null
			: Math.max(0, Math.floor((now - oldestInbox) / DAY_IN_MILLISECONDS));

		const taskMetrics = countTaskMetrics(taskRecords, today);
		const start = parseLocalDate(today);
		start.setDate(start.getDate() - HEATMAP_DAYS);
		const counts = bucketCreationDates(
			files.map((file) => ({ ctime: file.stat.ctime })),
			toDateKey(start),
			today,
		);
		const todayTasks = await this.readTodayTasks(files, taskRecords, today);
		const frontmatterRatio = files.length === 0 ? 0 : frontmatterCount / files.length;
		const tagRatio = files.length === 0 ? 0 : taggedCount / files.length;

		return {
			dashboard: {
				lastSync: new Date(now).toISOString(),
				vaultHealth: {
					score: calculateHealthScore({
						noteCount: files.length,
						frontmatterRatio,
						tagRatio,
						inboxCount: inboxFiles.length,
						taskCompletionRatio: taskMetrics.total === 0
							? 0
							: taskMetrics.completed / taskMetrics.total,
					}),
					noteCount: files.length,
					frontmatterRatio,
					tagRatio,
				},
				inboxBacklog: {
					count: inboxFiles.length,
					oldestDays,
				},
				taskFlow: {
					rate: taskMetrics.completionRate,
					total: taskMetrics.total,
					completed: taskMetrics.completed,
					today: taskMetrics.today,
					overdue: taskMetrics.overdue,
				},
				heatmap: {
					start: toDateKey(start),
					end: today,
					activeDays: Object.values(counts).filter((count) => count > 0).length,
					counts,
				},
				tasks: todayTasks,
				feed: [],
			},
			tasks: taskRecords,
			lintIssues,
		};
	}

	private async readTodayTasks(
		files: TFile[],
		allTasks: TaskRecord[],
		today: string,
	): Promise<DashboardTask[]> {
		const dailyPath = `Daily/${today}.md`;
		const dailyFile = this.app.vault.getAbstractFileByPath(dailyPath);
		const sourceTasks = dailyFile instanceof TFile
			? await this.readTasksFromFile(dailyFile, today)
			: allTasks.filter((task) => task.sourceDate === today);

		return sourceTasks.slice(0, 5).map((task) => ({
			title: task.title,
			meta: `${task.sourcePath} / 第 ${task.line} 行`,
			status: task.completed ? 'done' : 'todo',
			sourcePath: task.sourcePath,
			line: task.line,
			...(task.dueDate ? { dueDate: task.dueDate } : {}),
		}));
	}

	private async readTasksFromFile(file: TFile, today: string): Promise<TaskRecord[]> {
		const content = await this.app.vault.cachedRead(file);
		const tasks: TaskRecord[] = [];
		content.split(/\r?\n/).forEach((line, index) => {
			const parsed = parseTaskLine(line);
			if (parsed) {
				tasks.push({
					...parsed,
					sourcePath: file.path,
					sourceDate: today,
					line: index + 1,
				});
			}
		});
		return tasks;
	}

	private isInboxFile(file: TFile): boolean {
		return file.path.startsWith('Inbox/') && file.extension === 'md';
	}

	private isOrphan(file: TFile): boolean {
		const outgoing = this.app.metadataCache.resolvedLinks[file.path] ?? {};
		const unresolved = this.app.metadataCache.unresolvedLinks[file.path] ?? {};
		const hasOutgoing = Object.keys(outgoing).length > 0 || Object.keys(unresolved).length > 0;
		const hasIncoming = Object.values(this.app.metadataCache.resolvedLinks).some(
			(links) => (links[file.path] ?? 0) > 0,
		);
		return !hasOutgoing && !hasIncoming;
	}
}
