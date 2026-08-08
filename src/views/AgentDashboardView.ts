import { ItemView, Notice, setIcon, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type {
	DashboardAction,
	DashboardData,
	DashboardTask,
	TaskStatus,
} from '../data/dashboardTypes';
import { DASHBOARD_ACTIONS } from '../data/dashboardTypes';
import { AgentActionService, showActionError } from '../services/agentActionService';
import { DashboardService } from '../services/dashboardService';
import {
	formatDashboardActionMessage,
	matchesDashboardQuery,
} from '../services/dashboardMath';
import { InboxIngestModal } from '../ui/InboxIngestModal';

export const VIEW_TYPE_AGENT_DASHBOARD = 'agent-dashboard-view';

const NAV_ITEMS = [
	{ label: '总览', icon: 'layout-dashboard' as const, target: 'agent-dashboard-overview' },
	{ label: '知识库', icon: 'library' as const, target: 'agent-dashboard-notes' },
	{ label: '任务与计划', icon: 'list-checks' as const, target: 'agent-dashboard-tasks' },
	{ label: 'GitHub', icon: 'github' as const, target: 'agent-dashboard-agents' },
	{ label: '对话', icon: 'message-square' as const, target: '__chat__' },
	{ label: '设置', icon: 'settings-2' as const, target: null },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
	todo: '待办',
	doing: '进行中',
	done: '已完成',
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DISPLAY_NAME = 'TT';

export class AgentDashboardView extends ItemView {
	private data: DashboardData | null = null;
	private refreshPromise: Promise<boolean> | null = null;
	private refreshTimer: number | null = null;
	private lifecycleToken = 0;
	private isClosed = true;
	private runningAction: string | null = null;
	private searchQuery = '';
	private taskListEl: HTMLElement | null = null;
	private feedListEl: HTMLElement | null = null;
	private taskFilterEmptyEl: HTMLElement | null = null;
	private feedFilterEmptyEl: HTMLElement | null = null;

	private liveLabelEl: HTMLSpanElement | null = null;
	private syncTimeEl: HTMLSpanElement | null = null;
	private sidebarSyncEl: HTMLSpanElement | null = null;
	private activeViewLabelEl: HTMLSpanElement | null = null;
	private feedbackEl: HTMLSpanElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly dashboard: DashboardService,
		private readonly actionService: AgentActionService,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT_DASHBOARD;
	}

	getDisplayText(): string {
		return '智能体工作台';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	protected async onOpen(): Promise<void> {
		this.isClosed = false;
		this.lifecycleToken += 1;
		this.render();
		await this.refresh();
	}

	protected onClose(): Promise<void> {
		this.isClosed = true;
		this.lifecycleToken += 1;
		this.clearRefreshTimer();
		this.refreshPromise = null;
		this.contentEl.empty();
		this.data = null;
		this.liveLabelEl = null;
		this.syncTimeEl = null;
		this.sidebarSyncEl = null;
		this.activeViewLabelEl = null;
		this.feedbackEl = null;
		this.taskListEl = null;
		this.feedListEl = null;
		this.taskFilterEmptyEl = null;
		this.feedFilterEmptyEl = null;
		return Promise.resolve();
	}

	scheduleRefresh(): void {
		if (this.isClosed) {
			return;
		}

		this.clearRefreshTimer();
		const viewWindow = this.containerEl.ownerDocument.defaultView;
		if (!viewWindow) {
			return;
		}

		this.refreshTimer = viewWindow.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 500);
	}

	async refresh(forceFeeds = false): Promise<boolean> {
		if (this.isClosed) {
			return false;
		}
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		const token = this.lifecycleToken;
		this.setSyncState('正在同步', new Date().toISOString());
		this.refreshPromise = this.dashboard
			.load(forceFeeds)
			.then((result) => {
				if (this.isClosed || token !== this.lifecycleToken) {
					return false;
				}
				this.data = result.dashboard;
				this.render();
				return true;
			})
			.catch((error: unknown) => {
				if (this.isClosed || token !== this.lifecycleToken) {
					return false;
				}
				if (this.data) {
					this.setSyncState('同步失败', this.data.lastSync);
					this.setFeedback(`刷新失败：${this.getErrorMessage(error)}`);
				} else {
					this.renderErrorState(this.getErrorMessage(error));
				}
				showActionError(error);
				return false;
			})
			.finally(() => {
				this.refreshPromise = null;
			});

		return this.refreshPromise;
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('agent-dashboard-view');
		this.taskListEl = null;
		this.feedListEl = null;
		this.taskFilterEmptyEl = null;
		this.feedFilterEmptyEl = null;

		const data = this.data;
		if (!data) {
			this.renderLoadingState();
			return;
		}

		const shell = this.contentEl.createDiv({ cls: 'agent-dashboard-shell' });
		this.renderSidebar(shell, data);

		const workspace = shell.createDiv({ cls: 'agent-dashboard-workspace' });
		this.renderHeader(workspace, data);

		const content = workspace.createDiv({ cls: 'agent-dashboard-content' });
		this.renderWelcome(content, data);
		this.renderActions(content);
		this.renderStats(content, data);
		this.renderHeatmap(content, data);

		const lowerGrid = content.createDiv({ cls: 'agent-dashboard-lower-grid' });
		this.renderTasks(lowerGrid, data);
		this.renderGitHubFeed(lowerGrid, data);
	}

	private renderLoadingState(): void {
		const state = this.contentEl.createDiv({ cls: 'agent-dashboard-loading-state' });
		state.createEl('strong', { text: '正在加载仪表盘' });
		state.createSpan({ text: '正在读取 Vault 和缓存的信息流。' });
	}

	private renderErrorState(message: string): void {
		this.contentEl.empty();
		this.contentEl.addClass('agent-dashboard-view');
		const state = this.contentEl.createDiv({ cls: 'agent-dashboard-loading-state agent-dashboard-error-state' });
		state.createEl('strong', { text: '仪表盘暂时无法加载' });
		state.createSpan({ text: message });
	}

	private renderSidebar(parent: HTMLElement, data: DashboardData): void {
		const sidebar = parent.createEl('aside', {
			cls: 'agent-dashboard-sidebar',
			attr: { 'aria-label': '主导航' },
		});
		const brand = sidebar.createDiv({ cls: 'agent-dashboard-brand' });
		brand.createDiv({ cls: 'agent-dashboard-brand-mark', text: 'TT' });
		const brandCopy = brand.createDiv({ cls: 'agent-dashboard-brand-copy' });
		brandCopy.createEl('strong', { text: '智能体工作台' });
		brandCopy.createSpan({ text: '个人工作空间' });

		const nav = sidebar.createEl('nav', {
			cls: 'agent-dashboard-nav',
			attr: { 'aria-label': '工作区导航' },
		});
		nav.createEl('p', { cls: 'agent-dashboard-nav-label', text: '工作区' });
		const navButtons: HTMLButtonElement[] = [];

		NAV_ITEMS.forEach((item, index) => {
			const button = nav.createEl('button', {
				cls: `agent-dashboard-nav-item${index === 0 ? ' is-active' : ''}`,
				attr: {
					type: 'button',
					'aria-pressed': index === 0 ? 'true' : 'false',
				},
			});
			const icon = button.createSpan({
				cls: 'agent-dashboard-nav-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, item.icon);
			button.createSpan({ text: item.label });
			navButtons.push(button);

			this.registerDomEvent(button, 'click', () => {
				navButtons.forEach((navButton) => {
					const isActive = navButton === button;
					navButton.classList.toggle('is-active', isActive);
					navButton.setAttr('aria-pressed', String(isActive));
				});
				this.activeViewLabelEl?.setText(item.label);
				if (item.target) {
					this.scrollToSection(item.target);
					this.setFeedback(`已跳转到${item.label}。`);
					return;
				}
				this.setFeedback('插件设置请从 Obsidian 设置中打开。');
			});
		});

		const footer = sidebar.createDiv({ cls: 'agent-dashboard-sidebar-footer' });
		footer.createSpan({ cls: 'agent-dashboard-status-dot', attr: { 'aria-hidden': 'true' } });
		const footerCopy = footer.createDiv();
		footerCopy.createSpan({ text: '最后同步' });
		this.sidebarSyncEl = footerCopy.createEl('strong', {
			text: this.formatTime(data.lastSync),
		});
	}

	private renderHeader(parent: HTMLElement, data: DashboardData): void {
		const header = parent.createEl('header', { cls: 'agent-dashboard-toolbar' });
		const title = header.createDiv({ cls: 'agent-dashboard-toolbar-title' });
		title.createEl('strong', { text: '智能体工作台' });
		title.createSpan({ cls: 'agent-dashboard-toolbar-divider', attr: { 'aria-hidden': 'true' } });
		this.activeViewLabelEl = title.createSpan({ text: '总览' });

		const actions = header.createDiv({ cls: 'agent-dashboard-toolbar-actions' });
		const search = actions.createEl('label', { cls: 'agent-dashboard-search' });
		const searchIcon = search.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(searchIcon, 'search');
		const searchInput = search.createEl('input', {
			attr: {
				type: 'search',
				placeholder: '搜索工作区、任务或知识',
				'aria-label': '搜索工作区、任务或知识',
				'aria-controls': 'agent-dashboard-tasks agent-dashboard-agents',
			},
		});
		searchInput.value = this.searchQuery;
		this.registerDomEvent(searchInput, 'input', () => {
			this.searchQuery = searchInput.value;
			this.updateSearchVisibility();
		});

		const syncState = actions.createDiv({ cls: 'agent-dashboard-sync-state' });
		syncState.createSpan({ cls: 'agent-dashboard-status-dot', attr: { 'aria-hidden': 'true' } });
		this.liveLabelEl = syncState.createSpan({ text: '已同步' });
		syncState.createSpan({ text: '·', attr: { 'aria-hidden': 'true' } });
		this.syncTimeEl = syncState.createSpan({
			text: `最后同步 ${this.formatTime(data.lastSync)}`,
		});

		const refreshButton = actions.createEl('button', {
			cls: 'agent-dashboard-toolbar-button',
			attr: {
				type: 'button',
				'aria-label': '刷新仪表盘',
				'data-tooltip-position': 'top',
			},
		});
		const refreshIcon = refreshButton.createSpan({
			cls: 'agent-dashboard-refresh-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(refreshIcon, 'refresh-cw');
		refreshButton.createSpan({ text: '刷新' });
		this.registerDomEvent(refreshButton, 'click', () => {
			void this.handleRefresh(refreshButton);
		});
	}

	private renderWelcome(parent: HTMLElement, data: DashboardData): void {
		const welcome = parent.createEl('section', {
			cls: 'agent-dashboard-welcome',
			attr: {
				id: 'agent-dashboard-overview',
				'aria-labelledby': 'agent-dashboard-welcome-title',
			},
		});
		const copy = welcome.createDiv();
		copy.createSpan({ cls: 'agent-dashboard-date-label', text: this.formatDate(new Date()) });
		const welcomeTitle = copy.createEl('h1', { attr: { id: 'agent-dashboard-welcome-title' } });
		welcomeTitle.setText(`早上好，${DISPLAY_NAME}`);
		copy.createEl('p', { text: '这里是你的智能体工作概览。今天专注于最重要的事。' });

		const status = welcome.createDiv({ cls: 'agent-dashboard-quiet-status' });
		status.createSpan({ cls: 'agent-dashboard-status-dot', attr: { 'aria-hidden': 'true' } });
		status.createSpan({ text: this.healthStatus(data.vaultHealth.score) });
	}

	private renderActions(parent: HTMLElement): void {
		const section = parent.createEl('section', {
			cls: 'agent-dashboard-actions',
			attr: { 'aria-labelledby': 'agent-dashboard-actions-title' },
		});
		const heading = section.createDiv({ cls: 'agent-dashboard-actions-heading' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-actions-title' }, text: '快捷操作' });
		this.feedbackEl = heading.createSpan({
			cls: 'agent-dashboard-action-feedback',
			attr: { role: 'status', 'aria-live': 'polite' },
			text: '数据来自当前 Vault。',
		});

		const actionList = section.createDiv({ cls: 'agent-dashboard-action-list' });
		DASHBOARD_ACTIONS.forEach((action) => {
			const button = actionList.createEl('button', {
				cls: 'agent-dashboard-action-button',
				attr: { type: 'button', 'data-action': action.id },
			});
			const icon = button.createSpan({
				cls: 'agent-dashboard-action-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, action.icon);
			button.createSpan({ cls: 'agent-dashboard-action-label', text: action.label });
			button.createSpan({ cls: 'agent-dashboard-action-state', text: '就绪' });
			this.registerDomEvent(button, 'click', () => {
				void this.handleAction(action, button);
			});
		});
	}

	private renderStats(parent: HTMLElement, data: DashboardData): void {
		const grid = parent.createEl('section', {
			cls: 'agent-dashboard-metrics-grid',
			attr: { 'aria-label': '核心指标' },
		});
		const metrics = [
			{
				label: 'Vault 健康分',
				value: String(data.vaultHealth.score),
				detail: `${data.vaultHealth.noteCount} 篇笔记 · frontmatter ${this.formatPercent(data.vaultHealth.frontmatterRatio)}`,
				icon: 'activity' as const,
				tone: 'green',
			},
			{
				label: 'Inbox 待处理',
				value: String(data.inboxBacklog.count),
				detail: data.inboxBacklog.oldestDays === null
					? '当前没有待处理文件'
					: `最老 ${data.inboxBacklog.oldestDays} 天`,
				icon: 'inbox' as const,
				tone: 'orange',
			},
			{
				label: '任务流',
				value: `${data.taskFlow.rate}%`,
				detail: `${data.taskFlow.today} 项今日 · ${data.taskFlow.overdue} 项逾期`,
				icon: 'check-check' as const,
				tone: 'green',
			},
		];

		metrics.forEach((metric) => {
			const card = grid.createEl('article', { cls: 'agent-dashboard-metric-card' });
			const topline = card.createDiv({ cls: 'agent-dashboard-metric-topline' });
			topline.createSpan({ text: metric.label });
			const symbol = topline.createSpan({
				cls: `agent-dashboard-metric-symbol symbol-${metric.tone}`,
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(symbol, metric.icon);
			card.createDiv({ cls: 'agent-dashboard-metric-value', text: metric.value });
			const foot = card.createDiv({ cls: 'agent-dashboard-metric-foot' });
			foot.createSpan({
				cls: metric.tone === 'orange' ? 'agent-dashboard-attention' : 'agent-dashboard-positive',
				text: metric.detail,
			});
			foot.createSpan({
				cls: `agent-dashboard-metric-hairline ${metric.tone}`,
				attr: { 'aria-hidden': 'true' },
			});
		});
	}

	private renderHeatmap(parent: HTMLElement, data: DashboardData): void {
		const card = parent.createEl('section', {
			cls: 'agent-dashboard-surface agent-dashboard-activity-card',
			attr: {
				id: 'agent-dashboard-notes',
				'aria-labelledby': 'agent-dashboard-heatmap-title',
			},
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '过去 12 个月' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-heatmap-title' }, text: '笔记创建活跃度' });
		heading.createEl('p', { text: '根据 Markdown 文件的创建时间统计。' });
		const total = header.createDiv({ cls: 'agent-dashboard-activity-total' });
		total.createEl('strong', { text: String(data.heatmap.activeDays) });
		total.createSpan({ text: ` 个活跃日 · ${this.formatMonthRange(data.heatmap.start, data.heatmap.end)}` });

		const scroll = card.createDiv({ cls: 'agent-dashboard-heatmap-scroll' });
		const frame = scroll.createDiv({ cls: 'agent-dashboard-heatmap-frame' });
		const monthLabels = frame.createDiv({ cls: 'agent-dashboard-month-labels', attr: { 'aria-hidden': 'true' } });
		const heatmapBody = frame.createDiv({ cls: 'agent-dashboard-heatmap-body' });
		const weekdayLabels = heatmapBody.createDiv({ cls: 'agent-dashboard-weekday-labels', attr: { 'aria-hidden': 'true' } });
		['一', '', '三', '', '五', '', '日'].forEach((label) => weekdayLabels.createSpan({ text: label }));
		const grid = heatmapBody.createDiv({
			cls: 'agent-dashboard-heatmap-grid',
			attr: { role: 'grid', 'aria-label': '笔记创建活跃度热力图' },
		});

		const start = this.parseDate(data.heatmap.start);
		const end = this.parseDate(data.heatmap.end);
		const gridStart = new Date(start);
		const offset = (gridStart.getDay() + 6) % 7;
		gridStart.setDate(gridStart.getDate() - offset);
		const maxCount = Math.max(1, ...Object.values(data.heatmap.counts));

		for (let index = 0; index < 53 * 7; index += 1) {
			const date = new Date(gridStart);
			date.setDate(gridStart.getDate() + index);
			const inRange = date >= start && date <= end;
			const dateKey = this.toDateKey(date);
			const count = inRange ? (data.heatmap.counts[dateKey] ?? 0) : 0;
			const level = inRange ? this.heatLevel(count, maxCount) : 0;
			const label = inRange
				? `${this.formatDate(date)}，创建 ${count} 篇笔记`
				: '不在当前范围内';
			grid.createSpan({
				cls: `agent-dashboard-heat-cell level-${level}`,
				attr: {
					role: 'gridcell',
					'aria-label': label,
					title: label,
				},
			});
		}

		for (
			let monthDate = new Date(start.getFullYear(), start.getMonth(), 1);
			monthDate <= end;
			monthDate.setMonth(monthDate.getMonth() + 1)
		) {
			const daysFromGridStart = Math.floor((monthDate.getTime() - gridStart.getTime()) / DAY_IN_MILLISECONDS);
			const column = Math.floor(daysFromGridStart / 7) + 1;
			const label = monthLabels.createSpan({
				text: monthDate.toLocaleDateString('zh-CN', { month: 'short' }),
			});
			label.setCssProps({ '--agent-month-column': String(column) });
		}

		const footer = card.createDiv({ cls: 'agent-dashboard-activity-footer' });
		footer.createSpan({ text: '颜色深浅代表当天创建的笔记数量。' });
		const legend = footer.createDiv({ cls: 'agent-dashboard-legend', attr: { 'aria-label': '活跃度图例' } });
		legend.createSpan({ text: '少' });
		for (let level = 0; level <= 4; level += 1) {
			legend.createSpan({ cls: `agent-dashboard-heat-cell level-${level}`, attr: { 'aria-hidden': 'true' } });
		}
		legend.createSpan({ text: '多' });
	}

	private renderTasks(parent: HTMLElement, data: DashboardData): void {
		const card = parent.createEl('article', {
			cls: 'agent-dashboard-surface agent-dashboard-list-card',
			attr: {
				id: 'agent-dashboard-tasks',
				'aria-labelledby': 'agent-dashboard-tasks-title',
			},
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
		const heading = header.createDiv();
		heading.createSpan({
			cls: 'agent-dashboard-eyebrow',
			text: `今天 · ${String(data.tasks.length).padStart(2, '0')} 项`,
		});
		heading.createEl('h2', { attr: { id: 'agent-dashboard-tasks-title' }, text: '今天的任务' });
		const completed = data.tasks.filter((task) => task.status === 'done').length;
		heading.createEl('p', { text: `${data.tasks.length - completed} 项待处理 · ${completed} 项已完成` });
		const allTasksButton = header.createEl('button', {
			cls: 'agent-dashboard-subtle-button',
			attr: { type: 'button', 'aria-label': '打开任务来源笔记' },
		});
		allTasksButton.createSpan({ text: '打开来源' });
		const arrow = allTasksButton.createSpan({ attr: { 'aria-hidden': 'true' } });
		setIcon(arrow, 'arrow-up-right');
		this.registerDomEvent(allTasksButton, 'click', () => {
			const firstTask = data.tasks[0];
			if (firstTask) {
				void this.openTaskSource(firstTask);
				return;
			}
			this.setFeedback('今天还没有可打开的任务。');
		});

		const list = card.createDiv({ cls: 'agent-dashboard-task-list' });
		this.taskListEl = list;
		if (data.tasks.length === 0) {
			this.renderEmptyState(list, '今天还没有找到任务。');
			return;
		}
		this.taskFilterEmptyEl = list.createDiv({
			cls: 'agent-dashboard-empty-state',
			text: '没有匹配的任务。',
		});
		this.taskFilterEmptyEl.hidden = true;

		data.tasks.forEach((task) => {
			const row = list.createEl('button', {
				cls: 'agent-dashboard-task-row',
				attr: {
					type: 'button',
					'aria-label': `${task.title}，状态：${STATUS_LABELS[task.status]}`,
				},
			});
			row.dataset.searchText = `${task.title} ${task.meta}`;
			const marker = row.createSpan({
				cls: 'agent-dashboard-task-marker',
				attr: { 'aria-hidden': 'true' },
			});
			if (task.status === 'done') {
				setIcon(marker, 'check');
			} else if (task.status === 'doing') {
				setIcon(marker, 'circle-dashed');
			}
			const copy = row.createSpan({ cls: 'agent-dashboard-task-copy' });
			const title = copy.createSpan({ cls: 'agent-dashboard-task-title', text: task.title });
			copy.createSpan({ cls: 'agent-dashboard-task-meta', text: task.meta });
			const badge = row.createSpan({
				cls: 'agent-dashboard-status-badge',
				text: STATUS_LABELS[task.status],
			});
			row.dataset.status = task.status;
			title.toggleClass('is-complete', task.status === 'done');
			badge.setAttr('aria-label', `任务状态：${STATUS_LABELS[task.status]}`);
			this.registerDomEvent(row, 'click', () => {
				void this.openTaskSource(task);
			});
		});
		this.updateSearchVisibility();
	}

	private renderGitHubFeed(parent: HTMLElement, data: DashboardData): void {
		const card = parent.createEl('article', {
			cls: 'agent-dashboard-surface agent-dashboard-list-card',
			attr: {
				id: 'agent-dashboard-agents',
				'aria-labelledby': 'agent-dashboard-feed-title',
			},
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '最近更新' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-feed-title' }, text: 'GitHub 信息流' });
		heading.createEl('p', { text: '来自 AI agent 相关仓库的实时搜索结果。' });
		const feedStatus = header.createDiv({ cls: 'agent-dashboard-feed-status' });
		feedStatus.createSpan({ cls: 'agent-dashboard-status-dot', attr: { 'aria-hidden': 'true' } });
		feedStatus.createSpan({ text: data.feed.length > 0 ? '已同步' : '暂无数据' });

		const list = card.createDiv({ cls: 'agent-dashboard-feed-list' });
		this.feedListEl = list;
		if (data.feed.length === 0) {
			this.renderEmptyState(list, '暂无 GitHub 信息流，点击刷新重试。');
			return;
		}
		this.feedFilterEmptyEl = list.createDiv({
			cls: 'agent-dashboard-empty-state',
			text: '没有匹配的信息流。',
		});
		this.feedFilterEmptyEl.hidden = true;

		data.feed.forEach((item) => {
			const row = list.createEl('article', {
				cls: 'agent-dashboard-feed-item',
				attr: { 'aria-label': `${item.repo}，${item.description}，${item.signal}` },
			});
			row.dataset.searchText = `${item.repo} ${item.description} ${item.meta} ${item.signal}`;
			const icon = row.createSpan({
				cls: 'agent-dashboard-feed-icon',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(icon, 'git-branch');
			const copy = row.createDiv({ cls: 'agent-dashboard-feed-copy' });
			copy.createSpan({ cls: 'agent-dashboard-feed-repo', text: item.repo });
			copy.createSpan({ cls: 'agent-dashboard-feed-description', text: item.description });
			copy.createSpan({ cls: 'agent-dashboard-feed-meta', text: item.meta });
			row.createSpan({ cls: 'agent-dashboard-feed-signal', text: item.signal });
		});
		this.updateSearchVisibility();
	}

	private async handleRefresh(button: HTMLButtonElement): Promise<void> {
		if (button.disabled) {
			return;
		}
		button.disabled = true;
		button.addClass('is-spinning');
		this.setFeedback('正在刷新 Vault 和外部信息流。');
		try {
			const refreshed = await this.refresh(true);
			if (refreshed && !this.isClosed) {
				this.setFeedback('刷新完成，数据来自当前 Vault。');
			}
		} finally {
			button.disabled = false;
		}
	}

	private async handleAction(action: DashboardAction, button: HTMLButtonElement): Promise<void> {
		if (this.runningAction) {
			this.setFeedback('已有操作正在执行，请稍候。');
			return;
		}

		this.runningAction = action.id;
		button.disabled = true;
		button.addClass('is-queued');
		const state = button.querySelector('.agent-dashboard-action-state');
		new Notice(formatDashboardActionMessage(action.label, 'running'));
		state?.setText('进行中');
		this.setFeedback(`${action.label} 正在执行。`);

		try {
			let path: string | null = null;
			switch (action.id) {
				case 'new-diary':
					path = await this.actionService.createDiary();
					break;
				case 'deep-research':
					path = await this.actionService.runDeepResearch();
					break;
				case 'pull-rss':
					path = await this.actionService.pullRssSummary();
					break;
				case 'github-feeds':
					path = await this.actionService.pullGitHubPicks();
					break;
				case 'inbox-ingest':
					this.openInboxModal();
					return;
				case 'vault-lint':
					path = await this.actionService.runVaultLint();
					break;
			}

			const completionMessage = path ? `${action.label} 已完成：${path}` : `${action.label} 已完成。`;
			const refreshed = await this.refresh();
			new Notice(formatDashboardActionMessage(action.label, 'success', path ?? undefined));
			if (refreshed && !this.isClosed) {
				this.setFeedback(completionMessage);
			}
		} catch (error) {
			showActionError(error);
			this.setFeedback(`${action.label} 失败：${this.getErrorMessage(error)}`);
		} finally {
			this.runningAction = null;
			button.disabled = false;
			button.removeClass('is-queued');
			state?.setText('就绪');
		}
	}

	private openInboxModal(): void {
		this.setFeedback('等待输入要导入 Inbox 的内容。');
		new InboxIngestModal(this.app, async (content) => {
			const path = await this.actionService.ingestInbox(content);
			if (!this.isClosed) {
				this.setFeedback(`已导入：${path}`);
				await this.refresh();
			}
			return path;
		}).open();
	}

	private async openTaskSource(task: DashboardTask): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.sourcePath);
		if (!(file instanceof TFile)) {
			this.setFeedback(`找不到任务来源：${task.sourcePath}`);
			return;
		}
		await this.app.workspace.getLeaf('tab').openFile(file);
	}

	private renderEmptyState(parent: HTMLElement, message: string): void {
		parent.createDiv({ cls: 'agent-dashboard-empty-state', text: message });
	}

	private setSyncState(label: string, timestamp: string): void {
		this.liveLabelEl?.setText(label);
		this.syncTimeEl?.setText(`最后同步 ${this.formatTime(timestamp)}`);
		this.sidebarSyncEl?.setText(this.formatTime(timestamp));
	}

	private setFeedback(message: string): void {
		this.feedbackEl?.setText(message);
	}

	private scrollToSection(id: string): void {
		const target = this.contentEl.querySelector<HTMLElement>(`#${id}`);
		target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	private updateSearchVisibility(): void {
		this.updateListSearchVisibility(
			this.taskListEl,
			this.taskFilterEmptyEl,
			'.agent-dashboard-task-row',
		);
		this.updateListSearchVisibility(
			this.feedListEl,
			this.feedFilterEmptyEl,
			'.agent-dashboard-feed-item',
		);
	}

	private updateListSearchVisibility(
		list: HTMLElement | null,
		emptyState: HTMLElement | null,
		rowSelector: string,
	): void {
		if (!list || !emptyState) {
			return;
		}

		let visibleCount = 0;
		list.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
			const visible = matchesDashboardQuery(this.searchQuery, [row.dataset.searchText ?? '']);
			row.hidden = !visible;
			row.setAttr('aria-hidden', String(!visible));
			if (visible) {
				visibleCount += 1;
			}
		});
		emptyState.hidden = visibleCount > 0;
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer === null) {
			return;
		}
		this.containerEl.ownerDocument.defaultView?.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
	}

	private parseDate(value: string): Date {
		return new Date(`${value}T00:00:00`);
	}

	private toDateKey(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private formatDate(date: Date): string {
		return date.toLocaleDateString('zh-CN', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			weekday: 'long',
		});
	}

	private formatTime(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return '--:--';
		}
		return date.toLocaleTimeString('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		});
	}

	private formatMonthRange(startValue: string, endValue: string): string {
		const start = this.parseDate(startValue);
		const end = this.parseDate(endValue);
		const format = (date: Date): string => date.toLocaleDateString('zh-CN', {
			year: 'numeric',
			month: 'short',
		});
		return `${format(start)} - ${format(end)}`;
	}

	private formatPercent(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	private heatLevel(count: number, maxCount: number): number {
		if (count <= 0) {
			return 0;
		}
		return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
	}

	private healthStatus(score: number): string {
		if (score >= 80) {
			return 'Vault 状态良好';
		}
		if (score >= 60) {
			return 'Vault 状态需要留意';
		}
		return 'Vault 需要整理';
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : '未知错误';
	}
}
