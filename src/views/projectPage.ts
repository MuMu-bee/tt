import { Notice, normalizePath, setIcon } from 'obsidian';
import { createRequestContext, type RequestContext } from '../application/requestContext';
import type {
	ProjectGroup,
	ProjectIncrementItem,
	ProjectTrackerSettings,
	StarPoint,
} from '../data/dashboardTypes';
import type { ProjectCheckResult, ProjectTracker } from '../services/projectTracker';
import type { ProjectReportService } from '../services/projectReportService';
import type { WorkbenchWriteService } from '../services/workbenchWriteService';
import { showActionError } from '../services/agentActionService';
import { buildMergedWeeklySummary, previousVersionTag, recentStarPoints } from '../application/githubTracker';

export type ProjectBoardTab = 'all' | 'updates' | 'stale' | 'paused';

export interface ProjectBoardState {
	tab: ProjectBoardTab;
	mergeWeekly: boolean;
	search: string;
	series: string;
}

export const DEFAULT_PROJECT_BOARD_STATE: ProjectBoardState = {
	tab: 'all',
	mergeWeekly: false,
	search: '',
	series: '',
};

export interface ProjectPageHost {
	projectTracker: ProjectTracker;
	projectReport: ProjectReportService;
	workbenchWrite: WorkbenchWriteService;
	boardState: ProjectBoardState;
	projectListEl: HTMLElement | null;
	projectTrackerBusy: boolean;
	isClosed(): boolean;
	registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void;
	setFeedback(message: string): void;
	openNote(path: string): Promise<void>;
	hasNote(path: string): boolean;
	formatDate(date: Date): string;
	openExternal(url: string): void;
	openSettings(): void;
}

const boardResultsCache = new WeakMap<ProjectTracker, ProjectCheckResult[]>();
const boardLoadGeneration = new WeakMap<ProjectTracker, number>();

let summaryQueueTail: Promise<void> = Promise.resolve();

function enqueueSummary(task: () => Promise<void>): Promise<void> {
	const run = summaryQueueTail.then(task, task);
	summaryQueueTail = run.catch(() => undefined);
	return run;
}

export function renderProjectTracker(host: ProjectPageHost, parent: HTMLElement): void {
	parent.empty();
	const board = parent.createDiv({ cls: 'agent-dashboard-project-board' });
	host.projectListEl = board;

	renderBoardHeader(host, board);
	const toolbar = board.createDiv({ cls: 'agent-dashboard-project-toolbar' });
	const groupsEl = board.createDiv({ cls: 'agent-dashboard-project-groups' });

	renderStatusTabs(host, toolbar, groupsEl);
	renderControls(host, toolbar, groupsEl);

	void loadBoard(host, groupsEl, false);
}

function renderBoardHeader(host: ProjectPageHost, board: HTMLElement): void {
	const header = board.createDiv({ cls: 'agent-dashboard-project-board__header' });
	const copy = header.createDiv();
	copy.createEl('h1', { text: '项目追踪' });
	copy.createEl('p', { text: '按关注优先级分组，跟踪你关注的 GitHub 项目更新、版本与讨论。' });
}

function renderStatusTabs(host: ProjectPageHost, toolbar: HTMLElement, groupsEl: HTMLElement): void {
	const tabs: { id: ProjectBoardTab; label: string }[] = [
		{ id: 'all', label: '全部' },
		{ id: 'updates', label: '有更新' },
		{ id: 'stale', label: '久未检查' },
		{ id: 'paused', label: '已暂停' },
	];
	const tabBar = toolbar.createDiv({ cls: 'agent-dashboard-project-tabs' });
	tabs.forEach((tab) => {
		const button = tabBar.createEl('button', {
			cls: 'agent-dashboard-project-tab' + (host.boardState.tab === tab.id ? ' is-active' : ''),
			attr: { type: 'button', 'aria-pressed': String(host.boardState.tab === tab.id) },
		});
		button.createSpan({ text: tab.label });
		host.registerDomEvent(button, 'click', () => {
			host.boardState.tab = tab.id;
			tabBar.querySelectorAll<HTMLElement>('.agent-dashboard-project-tab').forEach((el) => {
				el.classList.toggle('is-active', el === button);
				el.setAttr('aria-pressed', String(el === button));
			});
			renderBoardFromCache(host, groupsEl);
		});
	});
}

function renderControls(host: ProjectPageHost, toolbar: HTMLElement, groupsEl: HTMLElement): void {
	const controls = toolbar.createDiv({ cls: 'agent-dashboard-project-controls' });

	const mergeLabel = controls.createEl('label', { cls: 'agent-dashboard-project-toggle' });
	const mergeInput = mergeLabel.createEl('input', { attr: { type: 'checkbox' } });
	mergeInput.checked = host.boardState.mergeWeekly;
	mergeLabel.createSpan({ text: '合并周报' });
	host.registerDomEvent(mergeInput, 'change', () => {
		host.boardState.mergeWeekly = mergeInput.checked;
		renderBoardFromCache(host, groupsEl);
	});

	const search = controls.createEl('input', {
		cls: 'agent-dashboard-project-search',
		attr: { type: 'search', placeholder: '搜索项目、标签、关键字', 'aria-label': '搜索项目' },
	});
	search.value = host.boardState.search;
	host.registerDomEvent(search, 'input', () => {
		host.boardState.search = search.value;
		renderBoardFromCache(host, groupsEl);
	});

	const series = controls.createEl('select', {
		cls: 'agent-dashboard-project-series',
		attr: { 'aria-label': '系列筛选' },
	});
	updateSeriesOptions(host, series);
	series.value = host.boardState.series;
	host.registerDomEvent(series, 'change', () => {
		host.boardState.series = series.value;
		renderBoardFromCache(host, groupsEl);
	});

	const settings = controls.createEl('button', {
		cls: 'agent-dashboard-subtle-button',
		attr: { type: 'button', 'aria-label': '项目追踪设置' },
	});
	settings.createSpan({ text: '设置' });
	host.registerDomEvent(settings, 'click', () => {
		host.openSettings();
	});

	const refresh = controls.createEl('button', {
		cls: 'agent-dashboard-subtle-button',
		attr: { type: 'button', 'aria-label': '刷新项目追踪' },
	});
	refresh.createSpan({ text: '刷新' });
	host.registerDomEvent(refresh, 'click', () => {
		refresh.disabled = true;
		void loadBoard(host, groupsEl, true).finally(() => { refresh.disabled = false; });
	});

	const sink = controls.createEl('button', {
		cls: 'agent-dashboard-subtle-button',
		attr: { type: 'button', 'aria-label': '写入项目笔记' },
	});
	sink.createSpan({ text: '沉淀笔记' });
	host.registerDomEvent(sink, 'click', () => {
		sink.disabled = true;
		void sinkProjectNotes(host)
			.then((indexPath) => {
				new Notice('项目笔记已更新：' + indexPath);
				void host.openNote(indexPath);
			})
			.catch((error: unknown) => showActionError(error))
			.finally(() => { sink.disabled = false; });
	});
}

function updateSeriesOptions(host: ProjectPageHost, select: HTMLSelectElement): void {
	const cached = boardResultsCache.get(host.projectTracker);
	const projects = cached?.map((result) => result.project) ?? host.projectTracker.getProjects();
	const seriesList = Array.from(new Set(projects.map((project) => project.series || '未分类').filter(Boolean)));
	select.empty();
	select.createEl('option', { attr: { value: '' }, text: '全部系列' });
	seriesList.forEach((series) => select.createEl('option', { attr: { value: series }, text: series }));
}

async function loadBoard(host: ProjectPageHost, groupsEl: HTMLElement, force: boolean): Promise<void> {
	const generation = (boardLoadGeneration.get(host.projectTracker) ?? 0) + 1;
	boardLoadGeneration.set(host.projectTracker, generation);
	if (host.isClosed()) return;
	if (host.projectTrackerBusy) {
		groupsEl.empty();
		groupsEl.createDiv({ cls: 'agent-dashboard-empty-state', text: '正在刷新，请稍候…' });
		return;
	}
	host.projectTrackerBusy = true;
	groupsEl.empty();
	groupsEl.createDiv({ cls: 'agent-dashboard-empty-state', text: '正在检查项目动态…' });
	try {
		const results = await host.projectTracker.checkAll(force);
		if (host.isClosed() || generation !== boardLoadGeneration.get(host.projectTracker)) return;
		boardResultsCache.set(host.projectTracker, results);
		const seriesSelect = groupsEl.parentElement?.querySelector<HTMLSelectElement>('.agent-dashboard-project-series');
		if (seriesSelect) {
			updateSeriesOptions(host, seriesSelect);
			seriesSelect.value = host.boardState.series;
		}
		renderBoard(host, groupsEl, results);
	} catch (error) {
		if (!host.isClosed() && generation === boardLoadGeneration.get(host.projectTracker)) {
			groupsEl.empty();
			groupsEl.createDiv({ cls: 'agent-dashboard-empty-state', text: '加载项目动态失败，请稍后重试。' });
			host.setFeedback('项目追踪刷新失败：' + (error instanceof Error ? error.message : '未知错误'));
		}
	} finally {
		if (generation === boardLoadGeneration.get(host.projectTracker)) {
			host.projectTrackerBusy = false;
		}
	}
}

function renderBoardFromCache(host: ProjectPageHost, groupsEl: HTMLElement): void {
	const results = boardResultsCache.get(host.projectTracker);
	if (!results) {
		void loadBoard(host, groupsEl, false);
		return;
	}
	renderBoard(host, groupsEl, results);
}

function renderBoard(host: ProjectPageHost, groupsEl: HTMLElement, results: ProjectCheckResult[]): void {
	groupsEl.empty();
	const settings = host.projectTracker.getSettings();
	const groups = [...settings.groups].sort((a, b) => a.order - b.order);
	const visible = results.filter((result) => matchesBoard(host, result, settings));
	if (visible.length === 0) {
		groupsEl.createDiv({ cls: 'agent-dashboard-empty-state', text: '没有匹配的项目。' });
		return;
	}

	groups.forEach((group) => {
		const cards = visible.filter((result) => result.project.groupId === group.id);
		if (cards.length === 0) return;
		const section = groupsEl.createEl('section', { cls: 'agent-dashboard-project-group' });
		const header = section.createDiv({ cls: 'agent-dashboard-project-group__header' });
		const parsed = parseGroupName(group.name, group.order);
		const title = header.createDiv({ cls: 'agent-dashboard-project-group__title' });
		title.createSpan({ cls: 'agent-dashboard-project-group__index', text: parsed.index });
		title.createSpan({ cls: 'agent-dashboard-project-group__name', text: parsed.name });
		if (parsed.sub) title.createSpan({ cls: 'agent-dashboard-project-group__sub', text: parsed.sub });
		const meta = header.createDiv({ cls: 'agent-dashboard-project-group__meta' });
		meta.createSpan({ text: String(cards.length) + ' 条 · 本周 ' });
		meta.createEl('b', { text: '+' + String(weeklyNewCount(cards)) });
		const grid = section.createDiv({ cls: 'agent-dashboard-project-grid' });
		cards.forEach((result) => renderProjectCard(host, grid, result, group));
	});
}

function matchesBoard(host: ProjectPageHost, result: ProjectCheckResult, settings: ProjectTrackerSettings): boolean {
	const state = host.boardState;
	if (state.tab !== 'all') {
		const status = projectStatus(result, settings.staleAfterDays);
		if (status !== state.tab) return false;
	}
	if (state.series && (result.project.series || '未分类') !== state.series) return false;
	if (state.search.trim()) {
		const query = state.search.trim().toLowerCase();
		const haystack = (result.project.repo + ' ' + (result.project.series || '') + ' ' + result.snapshot.description).toLowerCase();
		if (!haystack.includes(query)) return false;
	}
	return true;
}

type ProjectCardStatus = 'updates' | 'stale' | 'paused' | 'normal';

function projectStatus(result: ProjectCheckResult, staleAfterDays: number): ProjectCardStatus {
	if (!result.project.enabled) return 'paused';
	if (result.increments.length > 0) return 'updates';
	const lastSeen = Date.parse(result.baseline.lastSeenAt);
	const ageDays = Number.isFinite(lastSeen) ? (Date.now() - lastSeen) / 86_400_000 : Number.POSITIVE_INFINITY;
	return ageDays > staleAfterDays ? 'stale' : 'normal';
}

function renderProjectCard(host: ProjectPageHost, grid: HTMLElement, result: ProjectCheckResult, group: ProjectGroup): void {
	const { snapshot } = result;
	const card = grid.createEl('article', { cls: 'agent-dashboard-project-card' });

	const top = card.createDiv({ cls: 'agent-dashboard-project-card__top' });
	const groupLabel = top.createDiv({ cls: 'agent-dashboard-project-card__group' });
	groupLabel.createSpan({ cls: 'agent-dashboard-project-dot dot-' + group.dotColor });
	groupLabel.createSpan({ cls: 'agent-dashboard-project-card__group-name', text: parseGroupName(group.name, group.order).name });
	top.createSpan({ cls: 'agent-dashboard-project-card__ep', text: 'NO EP.' });

	const body = card.createDiv({ cls: 'agent-dashboard-project-card__body' });
	body.createEl('strong', { cls: 'agent-dashboard-project-card__name', text: snapshot.fullName });
	const summaryRow = body.createDiv({ cls: 'agent-dashboard-project-card__summary' });
	const vs = previousVersionTag(snapshot, result.previousBaseline);
	summaryRow.createSpan({ cls: 'agent-dashboard-project-card__vs', text: 'vs ' + vs });
	const summaryText = summaryRow.createSpan({ cls: 'agent-dashboard-project-card__summary-text', text: '正在生成摘要…' });
	void loadVsSummary(host, result, summaryText);

	const meta = card.createDiv({ cls: 'agent-dashboard-project-card__meta' });
	meta.createSpan({ cls: 'agent-dashboard-project-card__stars', text: '★ ' + formatStars(snapshot.stars) });
	const spark = meta.createSpan({ cls: 'agent-dashboard-project-card__spark' });
	renderSparkline(spark, result.baseline.starHistory);
	meta.createSpan({ cls: 'agent-dashboard-project-card__version', text: snapshot.releases[0]?.tag ?? '—' });

	renderNewBlock(host, card, result, vs);

	const footer = card.createDiv({ cls: 'agent-dashboard-project-card__footer' });
	footer.createSpan({ cls: 'agent-dashboard-project-card__updated', text: shortDate(snapshot.updatedAt || snapshot.fetchedAt) + ' · 更新' });
	const read = footer.createEl('button', { cls: 'agent-dashboard-project-card__read', attr: { type: 'button' } });
	read.createSpan({ text: '详细原文' });
	read.createSpan({ text: ' ↗' });
	host.registerDomEvent(read, 'click', () => { void openReadSelection(host, result); });
}

function renderNewBlock(host: ProjectPageHost, card: HTMLElement, result: ProjectCheckResult, vs: string): void {
	const { snapshot, increments } = result;
	if (snapshot.releases.length === 0 && snapshot.commits.length === 0 && snapshot.issues.length === 0) return;
	const block = card.createDiv({ cls: 'agent-dashboard-project-new' });
	const header = block.createEl('button', { cls: 'agent-dashboard-project-new__header', attr: { type: 'button' } });
	header.createSpan({ cls: 'agent-dashboard-project-new__chip', text: 'NEW' });
	const label = header.createSpan({ cls: 'agent-dashboard-project-new__label' });
	const arrow = header.createSpan({ cls: 'agent-dashboard-project-new__arrow' });
	const body = block.createDiv({ cls: 'agent-dashboard-project-new__body' });

	const hasNewCommits = increments.some((item) => item.kind === 'commit');
	label.createSpan({ text: hasNewCommits ? '本次重要更新（自 ' + vs + ' 后）' : '最近重要更新' });
	body.hidden = true;
	body.createDiv({ cls: 'agent-dashboard-project-new__loading', text: '正在生成中文更新摘要…' });
	setIcon(arrow, 'chevron-right');

	host.registerDomEvent(header, 'click', () => {
		body.hidden = !body.hidden;
		setIcon(arrow, body.hidden ? 'chevron-right' : 'chevron-down');
	});

	void loadRecentUpdates(host, result, body, hasNewCommits);
}

async function loadRecentUpdates(host: ProjectPageHost, result: ProjectCheckResult, body: HTMLElement, hasNewCommits: boolean): Promise<void> {
	await enqueueSummary(async () => {
		try {
			const generated = await host.projectReport.generateRecentUpdates(result.snapshot, createRequestContext('background-task'));
			if (host.isClosed()) return;
			body.empty();
			if (generated.items.length === 0) {
				body.createDiv({ cls: 'agent-dashboard-project-new__merged', text: generated.error ?? '暂无中文更新摘要。' });
				return;
			}
			generated.items.forEach((text) => {
				const row = body.createDiv({ cls: 'agent-dashboard-project-new__item' });
				row.createSpan({ cls: 'agent-dashboard-project-new__summary', text });
			});
		} catch {
			if (!host.isClosed()) body.createDiv({ cls: 'agent-dashboard-project-new__merged', text: '中文更新摘要生成失败（请检查模型配置）。' });
		}
	});
}

function parseGroupName(name: string, order: number): { index: string; name: string; sub: string } {
	const match = name.match(/^(\d{2})\s+(.+?)\s*·\s*(.+)$/u);
	if (match) return { index: match[1] ?? String(order).padStart(2, '0'), name: match[2] ?? name, sub: match[3] ?? '' };
	return { index: String(order).padStart(2, '0'), name, sub: '' };
}

function weeklyNewCount(cards: ProjectCheckResult[]): number {
	const now = Date.now();
	return cards.reduce((total, card) => total + card.increments.filter((item) => {
		const time = Date.parse(item.date);
		return Number.isFinite(time) && now - time >= 0 && now - time <= 7 * 86_400_000;
	}).length, 0);
}

function loadVsSummary(host: ProjectPageHost, result: ProjectCheckResult, el: HTMLElement): Promise<void> {
	return enqueueSummary(async () => {
		const currentTag = result.snapshot.releases[0]?.tag;
		try {
			const cached = await host.projectTracker.readSummary(result.project.repo);
			if (cached && (!currentTag || cached.version === currentTag)) {
				el.setText(cleanVsSummary(cached.text));
				return;
			}
			const generated = await host.projectReport.generateVsSummary(
				result.snapshot,
				result.previousBaseline,
				result.increments,
				createRequestContext('background-task'),
			);
			if (host.isClosed()) return;
			const text = generated.summary || 'vs 上一版本 · 本次无实质更新';
			await host.projectTracker.writeSummary(result.project.repo, text, currentTag);
			el.setText(cleanVsSummary(text));
		} catch {
			if (!host.isClosed()) el.setText('vs 上一版本 · 摘要生成失败（请检查模型配置）');
		}
	});
}

async function openReadSelection(host: ProjectPageHost, result: ProjectCheckResult): Promise<void> {
	const settings = host.projectTracker.getSettings();
	const notePath = normalizePath(settings.noteFolder + '/' + result.project.repo.replace('/', '-') + '.md');
	if (host.hasNote(notePath)) {
		await host.openNote(notePath);
		return;
	}
	host.openExternal('https://github.com/' + result.project.repo);
}

async function sinkProjectNotes(host: ProjectPageHost): Promise<string> {
	const results = boardResultsCache.get(host.projectTracker) ?? await host.projectTracker.checkAll(true);
	const settings = host.projectTracker.getSettings();
	const groups = host.projectTracker.getGroups();
	const context = createRequestContext('user');

	for (const result of results) {
		const group = groups.find((candidate) => candidate.id === result.project.groupId);
		const currentTag = result.snapshot.releases[0]?.tag;
		const cached = await host.projectTracker.readSummary(result.project.repo);
		let summary = cached && (!currentTag || cached.version === currentTag) ? cached.text : '';
		if (!summary) {
			const generated = await host.projectReport.generateVsSummary(result.snapshot, result.previousBaseline, result.increments, context);
			summary = generated.summary || buildMergedWeeklySummary(result.increments);
			await host.projectTracker.writeSummary(result.project.repo, summary, currentTag);
		}
		await host.projectReport.writeProjectChangelog(result.project, group, result.snapshot, result.increments, summary, settings.noteFolder);
	}
	return host.projectReport.writeGlobalIndex(results, groups, settings.noteFolder);
}

export async function generateProjectReport(host: ProjectPageHost, context: RequestContext): Promise<string> {
	const results = await host.projectTracker.checkAll(true);
	const parts: string[] = [];
	for (const result of results) {
		const generated = await host.projectReport.generateReport(result.snapshot, context);
		if (generated.report) {
			parts.push('# ' + result.snapshot.fullName + '\n\n' + generated.report);
		} else if (generated.error) {
			parts.push('# ' + result.snapshot.fullName + '\n\n> ' + generated.error);
		}
	}
	if (parts.length === 0) throw new Error('没有可生成的报告内容');
	const date = new Date();
	const stamp = [
		date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
		String(date.getHours()).padStart(2, '0') + '-' + String(date.getMinutes()).padStart(2, '0') + '-' + String(date.getSeconds()).padStart(2, '0'),
	].join('-');
	const path = normalizePath('Reports/项目动态-' + stamp + '.md');
	const written = await host.workbenchWrite.writeGenerated({
		path,
		content: parts.join('\n\n---\n\n') + '\n',
		kind: 'project',
		context,
	});
	if (written.status === 'failed') throw new Error(written.error_code ?? '项目报告写入失败');
	return written.path;
}

function renderSparkline(parent: HTMLElement, history: StarPoint[]): void {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = parent.ownerDocument.createElementNS(ns, 'svg');
	svg.setAttribute('class', 'agent-dashboard-project-spark');
	svg.setAttribute('viewBox', '0 0 100 28');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.setAttribute('aria-hidden', 'true');
	let points = recentStarPoints(history);
	if (points.length === 0) {
		parent.setText('—');
		return;
	}
	if (points.length < 5) {
		const last = points[points.length - 1] ?? { date: '', stars: 0 };
		points = [...points, ...Array.from({ length: 5 - points.length }, () => last)];
	}
	const values = points.map((point) => point.stars);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	const coords = values.map((value, index) => {
		const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
		const y = 24 - ((value - min) / range) * 20;
		return x.toFixed(1) + ',' + y.toFixed(1);
	});
	if (points.length === 1) {
		const circle = parent.ownerDocument.createElementNS(ns, 'circle');
		circle.setAttribute('cx', '50');
		circle.setAttribute('cy', String(Number(coords[0]?.split(',')[1] ?? '12')));
		circle.setAttribute('r', '3');
		circle.setAttribute('fill', 'var(--color-green)');
		svg.appendChild(circle);
	} else {
		const polyline = parent.ownerDocument.createElementNS(ns, 'polyline');
		polyline.setAttribute('points', coords.join(' '));
		const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
		polyline.setAttribute('fill', 'none');
		polyline.setAttribute('stroke', rising ? 'var(--color-green)' : 'var(--color-red)');
		polyline.setAttribute('stroke-width', '2');
		polyline.setAttribute('stroke-linecap', 'round');
		polyline.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(polyline);
	}
	parent.appendChild(svg);
}

function formatStars(stars: number): string {
	if (stars >= 1000) return (stars / 1000).toFixed(1).replace('.0', '') + 'k';
	return String(stars);
}

function shortDate(value: string): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value.slice(0, 5);
	return String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function cleanVsSummary(text: string): string {
	return text.replace(/^vs\s+[^\s·]+\s*·\s*/u, '').trim();
}
