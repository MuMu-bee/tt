import type { ParsedTask, TaskRecord } from '../data/dashboardTypes';

export interface HealthScoreInput {
	noteCount: number;
	frontmatterRatio: number;
	tagRatio: number;
	inboxCount: number;
	taskCompletionRatio: number;
}

export interface TaskMetrics {
	total: number;
	completed: number;
	completionRate: number;
	today: number;
	overdue: number;
}

export function calculateHealthScore(input: HealthScoreInput): number {
	const noteVolumeScore = clamp(input.noteCount / 100) * 10;
	const frontmatterScore = clamp(input.frontmatterRatio) * 25;
	const tagScore = clamp(input.tagRatio) * 20;
	const inboxScore = clamp(1 - input.inboxCount / 20) * 20;
	const taskScore = clamp(input.taskCompletionRatio) * 25;

	return Math.round(
		noteVolumeScore + frontmatterScore + tagScore + inboxScore + taskScore,
	);
}

export function parseTaskLine(line: string): ParsedTask | null {
	const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
	if (!match) {
		return null;
	}

	const marker = match[1];
	const rawTitle = match[2];
	if (marker === undefined || rawTitle === undefined) {
		return null;
	}

	const dueMatch = /(?:\u{1f4c5}|due::)\s*(\d{4}-\d{2}-\d{2})/u.exec(rawTitle);
	const dueDate = dueMatch?.[1];
	const title = rawTitle
		.replace(/(?:\u{1f4c5}|due::)\s*\d{4}-\d{2}-\d{2}/gu, '')
		.replace(/\s+/g, ' ')
		.trim();

	return {
		title,
		completed: marker !== ' ',
		...(dueDate ? { dueDate } : {}),
	};
}

export function countTaskMetrics(
	tasks: Array<Pick<TaskRecord, 'completed' | 'sourceDate' | 'dueDate'>>,
	today: string,
): TaskMetrics {
	const total = tasks.length;
	const completed = tasks.filter((task) => task.completed).length;
	const todayTasks = tasks.filter((task) => task.sourceDate === today).length;
	const overdue = tasks.filter(
		(task) => !task.completed && task.dueDate !== undefined && task.dueDate < today,
	).length;

	return {
		total,
		completed,
		completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
		today: todayTasks,
		overdue,
	};
}

export function bucketCreationDates(
	files: Array<{ ctime: number }>,
	rangeStart: string,
	rangeEnd: string,
): Record<string, number> {
	const start = parseLocalDate(rangeStart);
	const end = parseLocalDate(rangeEnd);
	const counts: Record<string, number> = {};

	for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
		counts[toDateKey(cursor)] = 0;
	}

	for (const file of files) {
		const date = new Date(file.ctime);
		const key = toDateKey(date);
		if (key in counts) {
			counts[key] = (counts[key] ?? 0) + 1;
		}
	}

	return counts;
}

export function isCacheFresh(
	fetchedAt: string,
	now: number,
	maxAgeMs: number,
): boolean {
	const fetchedTime = Date.parse(fetchedAt);
	return Number.isFinite(fetchedTime) && now >= fetchedTime && now - fetchedTime < maxAgeMs;
}

export function matchesDashboardQuery(query: string, values: string[]): boolean {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) {
		return true;
	}
	return values.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function formatDashboardActionMessage(
	label: string,
	status: 'running' | 'success',
	path?: string,
): string {
	if (status === 'running') {
		return `${label}正在执行。`;
	}
	return path ? `${label}已完成：${path}` : `${label}已完成。`;
}

export function toDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
	return new Date(`${value}T00:00:00`);
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}
