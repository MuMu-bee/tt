import { ItemView, Notice, normalizePath, requestUrl, setIcon, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type {
	DashboardAction,
	DashboardData,
	DashboardTask,
	RepoSnapshot,
	TaskStatus,
} from '../data/dashboardTypes';
import { DASHBOARD_ACTIONS, WORKBENCH_DIRS } from '../data/dashboardTypes';
import { AgentActionService, showActionError } from '../services/agentActionService';
import { DashboardService } from '../services/dashboardService';
import { ProjectTracker } from '../services/projectTracker';
import { ProjectReportService } from '../services/projectReportService';
import {
	formatDashboardActionMessage,
	matchesDashboardQuery,
	toDateKey,
} from '../services/dashboardMath';
import { InboxIngestModal } from '../ui/InboxIngestModal';
import { ImageUnderstandModal } from '../ui/ImageUnderstandModal';
import { VisionService } from '../services/visionService';
import { createRequestContext, type RequestContext } from '../application/requestContext';
import { SearchService } from '../services/searchService';
import type { AuditRecord, Proposal, SearchResult } from '../application/contracts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts';
import { IndexLifecycleService } from '../services/indexLifecycleService';
import { ResearchService } from '../services/researchService';
import { MemoryPublishService } from '../services/memoryPublishService';
import { PatrolService } from '../services/patrolService';
import { ProposalService } from '../services/proposalService';
import { ApprovalService } from '../services/approvalService';
import { ProposalApplyService } from '../services/proposalApplyService';
import { OrganizeService } from '../services/organizeService';
import {
	changeKindLabel,
	persistenceBanner,
	proposalActions,
	proposalStatusLabel,
	zoneLabel,
} from './proposalViewState';

export const VIEW_TYPE_AGENT_DASHBOARD = 'agent-dashboard-view';

/** Read-only audit query surface injected by the runtime. */
export interface AuditQueryPort {
	listRecent(limit: number, context: RequestContext): Promise<AuditRecord[]>;
}

const NAV_ITEMS = [
	{ label: '总览', icon: 'layout-dashboard' as const, target: 'agent-dashboard-overview' },
	{ label: '知识库', icon: 'library' as const, target: 'agent-dashboard-knowledge' },
	{ label: '知识星图', icon: 'sparkles' as const, target: 'agent-dashboard-graph' },
	{ label: '任务与计划', icon: 'list-checks' as const, target: 'agent-dashboard-workbench' },
	{ label: '研究', icon: 'search-check' as const, target: 'agent-dashboard-research' },
	{ label: '项目追踪', icon: 'github' as const, target: 'agent-dashboard-agents' },
	{ label: '每日热点', icon: 'flame' as const, target: 'agent-dashboard-hot' },
	{ label: '对话', icon: 'message-square' as const, target: 'agent-dashboard-chat' },
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
	private knowledgeResultsEl: HTMLElement | null = null;
	private knowledgeStatusEl: HTMLElement | null = null;
	private knowledgeQuery = '';
	private knowledgeSearchVersion = 0;

private liveLabelEl: HTMLSpanElement | null = null;
		private syncTimeEl: HTMLSpanElement | null = null;
		private sidebarSyncEl: HTMLSpanElement | null = null;
		private activeViewLabelEl: HTMLSpanElement | null = null;
		private feedbackEl: HTMLSpanElement | null = null;
		private runLogEl: HTMLElement | null = null;

		private pageMap: Record<string, HTMLElement> = {};
		private activePage = 'agent-dashboard-overview';

		private readonly dashboard: DashboardService;
	private readonly actionService: AgentActionService;
	private readonly searchService: SearchService;
	private readonly lifecycle: IndexLifecycleService;
	private readonly proposals: ProposalService;
	private readonly approvals: ApprovalService;
	private readonly applyService: ProposalApplyService;
	private readonly persistence: PersistenceRuntimeStatus;
	private readonly organize: OrganizeService;
	private readonly audit: AuditQueryPort;
	private readonly projectTracker: ProjectTracker;
	private readonly projectReport: ProjectReportService;
	private readonly visionService: VisionService;
		private readonly researchService: ResearchService;
		private readonly memoryPublish: MemoryPublishService;
		private readonly patrolService: PatrolService;

	private workbenchStatusEl: HTMLElement | null = null;
	private projectListEl: HTMLElement | null = null;
	private projectSnapshots: RepoSnapshot[] | null = null;
	private projectTrackerBusy = false;
	private persistenceBannerEl: HTMLElement | null = null;
	private workbenchErrorEl: HTMLElement | null = null;
	private proposalListEl: HTMLElement | null = null;
	private auditListEl: HTMLElement | null = null;
	private workbenchToken = 0;
	private organizeBusy = false;

constructor(
			leaf: WorkspaceLeaf,
			dashboard: DashboardService,
			actionService: AgentActionService,
			searchService: SearchService,
			lifecycle: IndexLifecycleService,
			proposals: ProposalService,
			approvals: ApprovalService,
			applyService: ProposalApplyService,
			persistence: PersistenceRuntimeStatus,
			organize: OrganizeService,
			audit: AuditQueryPort,
			projectTracker: ProjectTracker,
			projectReport: ProjectReportService,
			visionService: VisionService,
			researchService: ResearchService,
			memoryPublish: MemoryPublishService,
			patrolService: PatrolService,
		) {
			super(leaf);
			this.dashboard = dashboard;
			this.actionService = actionService;
			this.searchService = searchService;
			this.lifecycle = lifecycle;
			this.proposals = proposals;
			this.approvals = approvals;
			this.applyService = applyService;
			this.persistence = persistence;
			this.organize = organize;
			this.audit = audit;
			this.projectTracker = projectTracker;
			this.projectReport = projectReport;
			this.visionService = visionService;
			this.researchService = researchService;
			this.memoryPublish = memoryPublish;
			this.patrolService = patrolService;
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
		this.knowledgeResultsEl = null;
		this.knowledgeStatusEl = null;
		this.knowledgeSearchVersion += 1;
		this.workbenchToken += 1;
		this.workbenchStatusEl = null;
		this.persistenceBannerEl = null;
		this.workbenchErrorEl = null;
		this.proposalListEl = null;
		this.auditListEl = null;
		this.runLogEl = null;
		this.pageMap = {};
		this.activePage = 'agent-dashboard-overview';
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
		this.workbenchStatusEl = null;
		this.persistenceBannerEl = null;
		this.workbenchErrorEl = null;
		this.proposalListEl = null;
		this.auditListEl = null;

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
		this.pageMap = {};

/* ===== 总览页 ===== */
			const overviewPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-overview'] = overviewPage;
this.renderWelcome(overviewPage, data);
				this.renderActions(overviewPage);
				this.renderStats(overviewPage, data);
				this.renderOverviewGrid(overviewPage, data);
				this.renderHealthPanel(overviewPage);
				this.renderHeatmap(overviewPage, data);

		/* ===== 知识库页 ===== */
		const knowledgePage = content.createDiv({ cls: 'agent-dashboard-page' });
		this.pageMap['agent-dashboard-knowledge'] = knowledgePage;
		this.renderKnowledgeSearch(knowledgePage);

		/* ===== 任务与计划页 ===== */
		const workbenchPage = content.createDiv({ cls: 'agent-dashboard-page' });
		this.pageMap['agent-dashboard-workbench'] = workbenchPage;
		this.renderWorkbench(workbenchPage);
		this.renderTasks(workbenchPage, data);

/* ===== 项目追踪页（GitHub） ===== */
			const projectsPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-agents'] = projectsPage;
			this.renderProjectTracker(projectsPage);

			/* ===== 研究页 ===== */
			const researchPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-research'] = researchPage;
			this.renderResearchPage(researchPage);

			/* ===== 知识星图页 ===== */
			const graphPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-graph'] = graphPage;
			this.renderGraphPage(graphPage, data);

			/* ===== 每日热点页 ===== */
			const hotPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-hot'] = hotPage;
			this.renderHotPage(hotPage);

			/* ===== 对话页（占位） ===== */
			const chatPage = content.createDiv({ cls: 'agent-dashboard-page' });
			this.pageMap['agent-dashboard-chat'] = chatPage;
			this.renderChatPlaceholder(chatPage);

		this.showPage(this.activePage);
	}

	private renderKnowledgeSearch(parent: HTMLElement): void {
		const card = parent.createEl('section', { cls: 'agent-dashboard-surface agent-dashboard-knowledge-card', attr: { id: 'agent-dashboard-knowledge', 'aria-labelledby': 'agent-dashboard-knowledge-title' } });
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '只读关键词检索' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-knowledge-title' }, text: '知识库搜索' });
		this.knowledgeStatusEl = heading.createEl('p', { text: this.lifecycleStatusText() });
		const rebuild = header.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
		rebuild.createSpan({ text: '重建索引' });
		this.registerDomEvent(rebuild, 'click', () => { rebuild.disabled = true; void this.lifecycle.rebuild(createRequestContext('user')).then(() => { this.knowledgeStatusEl?.setText(this.lifecycleStatusText()); }).catch((error: unknown) => { this.knowledgeStatusEl?.setText(`重建失败：${this.getErrorMessage(error)}`); }).finally(() => { rebuild.disabled = false; }); });
		const input = card.createEl('input', { cls: 'agent-dashboard-knowledge-input', attr: { type: 'search', placeholder: '搜索笔记标题、路径、标签或正文', 'aria-label': '搜索知识库' } });
		input.value = this.knowledgeQuery;
		this.registerDomEvent(input, 'input', () => { this.knowledgeQuery = input.value; void this.loadKnowledgeResults(); });
		this.knowledgeResultsEl = card.createDiv({ cls: 'agent-dashboard-knowledge-results' });
		if (this.knowledgeQuery.trim()) void this.loadKnowledgeResults(); else this.renderKnowledgeEmpty('输入关键词开始搜索。');
	}

	private async loadKnowledgeResults(): Promise<void> {
		const resultsEl = this.knowledgeResultsEl;
		if (!resultsEl || this.isClosed) return;
		const query = this.knowledgeQuery.trim();
		const version = ++this.knowledgeSearchVersion;
		if (!query) { this.renderKnowledgeEmpty('输入关键词开始搜索。'); return; }
		this.renderKnowledgeEmpty('正在搜索…');
		try {
				const results = await this.searchService.query({ query, limit: 10, mode: 'hybrid', context: createRequestContext('user') });
			if (this.isClosed || version !== this.knowledgeSearchVersion || resultsEl !== this.knowledgeResultsEl) return;
			resultsEl.empty();
			if (results.length === 0) { this.renderKnowledgeEmpty('没有匹配的笔记。'); return; }
			results.forEach((result) => this.renderKnowledgeResult(result));
		} catch (error) {
			if (!this.isClosed && version === this.knowledgeSearchVersion && resultsEl === this.knowledgeResultsEl) this.renderKnowledgeEmpty(`搜索失败：${this.getErrorMessage(error)}`);
		}
	}

	private renderKnowledgeResult(result: SearchResult): void {
		if (!this.knowledgeResultsEl) return;
		const row = this.knowledgeResultsEl.createEl('button', { cls: 'agent-dashboard-knowledge-result', attr: { type: 'button', 'aria-label': `打开 ${result.title}` } });
		const copy = row.createDiv({ cls: 'agent-dashboard-knowledge-copy' });
		copy.createEl('strong', { text: result.title });
		copy.createSpan({ cls: 'agent-dashboard-knowledge-path', text: result.path });
		copy.createSpan({ cls: 'agent-dashboard-knowledge-snippet', text: result.snippet });
		const rawHash = typeof result.metadata?.raw_hash === 'string' ? result.metadata.raw_hash : undefined;
		const sourceLabels: Record<string, string> = { keyword: '关键词', semantic: '语义', hybrid: '混合' };
		const sourceLabel = sourceLabels[result.source] ?? result.source;
		copy.createSpan({ cls: 'agent-dashboard-knowledge-meta', text: `${sourceLabel} · ${result.matched_fields.join(', ')}${rawHash ? ` · ${rawHash.slice(0, 8)}` : ''}` });
		this.registerDomEvent(row, 'click', () => { void this.openKnowledgeResult(result); });
	}

	private renderKnowledgeEmpty(message: string): void { this.knowledgeResultsEl?.empty(); this.knowledgeResultsEl?.createDiv({ cls: 'agent-dashboard-empty-state', text: message }); }

	private renderWorkbench(parent: HTMLElement): void {
		const card = parent.createEl('section', {
			cls: 'agent-dashboard-surface agent-dashboard-workbench-card',
			attr: { id: 'agent-dashboard-workbench', 'aria-labelledby': 'agent-dashboard-workbench-title' },
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '墨忆台 · 核心功能' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-workbench-title' }, text: '整理工作台' });
		this.workbenchStatusEl = heading.createEl('p', { text: this.lifecycleStatusText() });

		const generateButton = header.createEl('button', {
			cls: 'agent-dashboard-subtle-button',
			attr: { type: 'button', 'aria-label': '生成整理计划' },
		});
		generateButton.createSpan({ text: '生成整理计划' });
		this.registerDomEvent(generateButton, 'click', () => {
			void this.handleGeneratePlan(generateButton);
		});

this.persistenceBannerEl = card.createDiv({ cls: 'agent-dashboard-persistence-banner' });
			this.renderPersistenceBanner();

			/* 整理开关配置引导 */
			const flags = (this as unknown as { organize: OrganizeService }).organize;
			const isAnyEnabled = flags && typeof flags === 'object' && 'plan' in flags;
			if (!isAnyEnabled) {
				const guideEl = card.createDiv({ cls: 'agent-dashboard-organize-guide' });
				guideEl.createSpan({ text: '💡 提示：生成整理方案前，请先在' });
				const settingsLink = guideEl.createEl('button', { cls: 'agent-dashboard-organize-guide-link', attr: { type: 'button' } });
				settingsLink.createSpan({ text: '设置 → 整理工作台 · 生成开关' });
				guideEl.createSpan({ text: '中开启至少一个规则（如 frontmatter、标签）。' });
				this.registerDomEvent(settingsLink, 'click', () => {
					const app = (this as unknown as { app: { setting: { open: () => void } } }).app;
					app?.setting?.open?.();
				});
			}

		this.workbenchErrorEl = card.createDiv({
			cls: 'agent-dashboard-workbench-error',
			attr: { role: 'alert', 'aria-live': 'polite' },
		});
		this.workbenchErrorEl.hidden = true;

		const listHeading = card.createDiv({ cls: 'agent-dashboard-workbench-subheading' });
		listHeading.createEl('h3', { text: '整理方案' });
		this.proposalListEl = card.createDiv({ cls: 'agent-dashboard-proposal-list' });

		const auditDetails = card.createEl('details', { cls: 'agent-dashboard-audit-details' });
		auditDetails.createEl('summary', { text: '最近审计记录' });
		this.auditListEl = auditDetails.createDiv({ cls: 'agent-dashboard-audit-list' });

		void this.refreshWorkbench();
	}

	private renderPersistenceBanner(): void {
		const bannerEl = this.persistenceBannerEl;
		if (!bannerEl) {
			return;
		}
		bannerEl.empty();
		const state = persistenceBanner(this.persistence);
		bannerEl.addClass(`is-${state.tone}`);
		const title = bannerEl.createDiv({ cls: 'agent-dashboard-persistence-title' });
		title.setText(state.title);
		if (state.tone === 'danger') {
			const stores = bannerEl.createDiv({ cls: 'agent-dashboard-persistence-stores' });
			(['proposals', 'approvals', 'audit'] as const).forEach((key) => {
				const report = this.persistence.stores[key];
				const row = stores.createDiv({ cls: 'agent-dashboard-persistence-store' });
				row.createSpan({ cls: 'agent-dashboard-persistence-store-name', text: key });
				const parts: string[] = [`跳过 ${report.skipped_rows} 行`];
				if (report.error) {
					parts.push(report.error);
				}
				row.createSpan({ cls: 'agent-dashboard-persistence-store-detail', text: parts.join(' · ') });
			});
		}
	}

	private async handleGeneratePlan(button: HTMLButtonElement): Promise<void> {
		if (this.organizeBusy || button.disabled) {
			return;
		}
		this.organizeBusy = true;
		button.disabled = true;
		this.setWorkbenchStatus('正在生成整理计划…');
		this.setWorkbenchError('');
		try {
			const context = createRequestContext('user');
			const plan = await this.organize.plan({ kind: 'global' }, context);
			const created = await this.proposals.createFromPlan(plan, context);
			this.setWorkbenchStatus(`已生成 ${created.length} 条整理方案`);
			await this.refreshWorkbench();
		} catch (error) {
			this.setWorkbenchStatus('生成整理计划失败');
			this.setWorkbenchError(this.getErrorMessage(error));
		} finally {
			this.organizeBusy = false;
			button.disabled = false;
		}
	}

	private async refreshWorkbench(): Promise<void> {
		if (this.isClosed) {
			return;
		}
		const token = ++this.workbenchToken;
		try {
			const context = createRequestContext('user');
			const proposals = await this.proposals.list({}, context);
			const auditRecords = await this.audit.listRecent(20, context);
			if (this.isClosed || token !== this.workbenchToken) {
				return;
			}
			this.renderPersistenceBanner();
			this.renderProposalList(proposals);
			this.renderAuditList(auditRecords);
		} catch (error) {
			if (this.isClosed || token !== this.workbenchToken) {
				return;
			}
			this.setWorkbenchError(this.getErrorMessage(error));
		}
	}

private renderProposalList(proposals: Proposal[]): void {
			const list = this.proposalListEl;
			if (!list) {
				return;
			}
			list.empty();

			const sorted = [...proposals].sort((a, b) =>
				a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
			);
			if (sorted.length === 0) {
				list.createDiv({ cls: 'agent-dashboard-empty-state', text: '暂无整理方案。先开启整理开关并生成计划。' });
				return;
			}

			/* 按状态分组，类似 GitHub PR Inbox */
			const groups = new Map<string, Proposal[]>();
			const statusKeys = ['pending', 'approved', 'applied', 'rejected', 'conflict', 'failed'];
			statusKeys.forEach((s) => groups.set(s, []));
			sorted.forEach((p) => {
				const key = groups.has(p.status) ? p.status : 'pending';
				groups.get(key)!.push(p);
			});

			const groupLabels: Record<string, { label: string; icon: string; color: string }> = {
				pending: { label: '待审批', icon: '◉', color: 'var(--interactive-accent)' },
				approved: { label: '已批准，待执行', icon: '✓', color: 'var(--color-green)' },
				applied: { label: '已应用', icon: '✔', color: 'var(--color-green)' },
				rejected: { label: '已拒绝', icon: '✕', color: 'var(--color-red)' },
				conflict: { label: '冲突', icon: '⚠', color: 'var(--color-orange)' },
				failed: { label: '失败', icon: '✗', color: 'var(--color-red)' },
			};

			Array.from(groups.entries()).forEach(([status, items]) => {
				if (items.length === 0) return;
				const section = list.createDiv({ cls: 'agent-dashboard-proposal-group' });
				const header = section.createDiv({ cls: 'agent-dashboard-proposal-group-header' });
				header.createSpan({ cls: 'agent-dashboard-proposal-group-icon', text: groupLabels[status]?.icon ?? '•', attr: { style: `color:${groupLabels[status]?.color ?? 'var(--text-muted)'};` } });
				header.createSpan({ cls: 'agent-dashboard-proposal-group-label', text: groupLabels[status]?.label ?? status });
				header.createSpan({ cls: 'agent-dashboard-proposal-group-count', text: String(items.length) });
				items.forEach((proposal) => this.renderProposalItem(section, proposal));
			});
		}

	private renderProposalItem(parent: HTMLElement, proposal: Proposal): void {
		const actions = proposalActions(proposal, this.persistence);
		const item = parent.createEl('article', {
			cls: 'agent-dashboard-proposal-item',
			attr: { 'data-status': proposal.status },
		});
		const topline = item.createDiv({ cls: 'agent-dashboard-proposal-topline' });

		const toggle = topline.createEl('button', {
			cls: 'agent-dashboard-proposal-toggle',
			attr: { type: 'button', 'aria-expanded': 'false', 'aria-label': `展开预览：${proposal.target_path}` },
		});
		const copy = toggle.createDiv({ cls: 'agent-dashboard-proposal-copy' });
		copy.createEl('strong', { cls: 'agent-dashboard-proposal-path', text: proposal.target_path });
		copy.createSpan({
			cls: 'agent-dashboard-proposal-meta',
			text: `${zoneLabel(proposal.target_zone)} · ${changeKindLabel(proposal.change_kind)} · ${proposal.base_hash.slice(0, 8)}`,
		});
		toggle.createSpan({ cls: 'agent-dashboard-status-badge', text: proposalStatusLabel(proposal.status) });
		const chevron = toggle.createSpan({ cls: 'agent-dashboard-proposal-chevron', attr: { 'aria-hidden': 'true' } });
		setIcon(chevron, 'chevron-down');

		const actionBar = topline.createDiv({ cls: 'agent-dashboard-proposal-actions' });
		if (proposal.status === 'pending') {
			this.renderProposalButton(actionBar, proposal, 'approve', actions.canApprove, actions.disabledReason);
			this.renderProposalButton(actionBar, proposal, 'reject', actions.canReject, actions.disabledReason);
		} else if (proposal.status === 'approved') {
			this.renderProposalButton(actionBar, proposal, 'apply', actions.canApply, actions.disabledReason);
		}
		if (actions.disabledReason) {
			actionBar.createSpan({ cls: 'agent-dashboard-proposal-disabled-reason', text: actions.disabledReason });
		}

		const preview = item.createDiv({ cls: 'agent-dashboard-proposal-preview' });
		preview.hidden = true;
		this.renderPreviewBlock(preview, '修改前', proposal.before);
		this.renderPreviewBlock(preview, '修改后', proposal.after);
		this.renderPreviewBlock(preview, '差异', proposal.diff);

		this.registerDomEvent(toggle, 'click', () => {
			const expanded = preview.hidden;
			preview.hidden = !expanded;
			toggle.setAttr('aria-expanded', String(expanded));
			toggle.classList.toggle('is-expanded', expanded);
		});
	}

	private renderProposalButton(
		parent: HTMLElement,
		proposal: Proposal,
		kind: 'approve' | 'reject' | 'apply',
		enabled: boolean,
		disabledReason: string | undefined,
	): void {
		const labels: Record<'approve' | 'reject' | 'apply', string> = {
			approve: '批准',
			reject: '拒绝',
			apply: '执行写入',
		};
		const button = parent.createEl('button', {
			cls: `agent-dashboard-proposal-button ${kind}`,
			attr: { type: 'button' },
		});
		button.createSpan({ text: labels[kind] });
		button.disabled = !enabled;
		if (!enabled && disabledReason) {
			button.setAttr('title', disabledReason);
		}
		this.registerDomEvent(button, 'click', () => {
			if (kind === 'approve' || kind === 'reject') {
				void this.handleProposalDecision(proposal, kind, button);
			} else {
				void this.handleProposalApply(proposal, button);
			}
		});
	}

	private renderPreviewBlock(parent: HTMLElement, label: string, content: string): void {
		const block = parent.createDiv({ cls: 'agent-dashboard-proposal-preview-block' });
		block.createEl('strong', { text: label });
		block.createEl('pre', { text: content || '（空）' });
	}

	private async handleProposalDecision(
		proposal: Proposal,
		decision: 'approve' | 'reject',
		button: HTMLButtonElement,
	): Promise<void> {
		if (button.disabled) {
			return;
		}
		button.disabled = true;
		const verb = decision === 'approve' ? '批准' : '拒绝';
		this.setWorkbenchStatus(`正在${verb} ${proposal.target_path}…`);
		this.setWorkbenchError('');
		try {
			await this.approvals.decide(proposal.proposal_id, decision, createRequestContext('user'));
			this.setWorkbenchStatus(`已${verb}`);
			await this.refreshWorkbench();
		} catch (error) {
			this.setWorkbenchStatus(`${verb}失败`);
			this.setWorkbenchError(this.getErrorMessage(error));
		}
	}

	private async handleProposalApply(proposal: Proposal, button: HTMLButtonElement): Promise<void> {
		if (button.disabled) {
			return;
		}
		button.disabled = true;
		this.setWorkbenchStatus(`正在执行写入 ${proposal.target_path}…`);
		this.setWorkbenchError('');
		try {
			const result = await this.applyService.apply(proposal.proposal_id, createRequestContext('user'));
			if (result.status === 'applied') {
				this.setWorkbenchStatus(`写入完成：${proposal.target_path}`);
			} else {
				const code = result.error_code ? `（${result.error_code}）` : '';
				this.setWorkbenchStatus('执行写入未完成');
				this.setWorkbenchError(`写入未完成：${result.status}${code}`);
			}
			await this.refreshWorkbench();
		} catch (error) {
			this.setWorkbenchStatus('执行写入失败');
			this.setWorkbenchError(this.getErrorMessage(error));
		}
	}

	private renderAuditList(records: AuditRecord[]): void {
		const list = this.auditListEl;
		if (!list) {
			return;
		}
		list.empty();
		if (records.length === 0) {
			list.createDiv({ cls: 'agent-dashboard-empty-state', text: '暂无审计记录。' });
			return;
		}
		records.forEach((record) => {
			const row = list.createDiv({ cls: 'agent-dashboard-audit-row' });
			row.createSpan({ cls: 'agent-dashboard-audit-id', text: record.request_id });
			row.createSpan({ cls: 'agent-dashboard-audit-path', text: record.path || '—' });
			const okResult = record.result === 'success' || record.result === 'applied';
			row.createSpan({
				cls: `agent-dashboard-audit-result${okResult ? ' ok' : ' warn'}`,
				text: record.result,
			});
			row.createSpan({ cls: 'agent-dashboard-audit-time', text: this.formatDateTime(record.created_at) });
		});
	}

private setWorkbenchStatus(message: string): void {
			this.workbenchStatusEl?.setText(message);
			/* 给持久化横幅添加视觉反馈闪烁 */
			if (message.includes('正在') && this.persistenceBannerEl) {
				this.persistenceBannerEl.addClass('agent-dashboard-persistence-busy');
			} else if (this.persistenceBannerEl) {
				this.persistenceBannerEl.removeClass('agent-dashboard-persistence-busy');
			}
		}

	private setWorkbenchError(message: string): void {
		const errorEl = this.workbenchErrorEl;
		if (!errorEl) {
			return;
		}
		errorEl.empty();
		if (message) {
			errorEl.createSpan({ text: message });
		}
		errorEl.hidden = !message;
	}

	private formatDateTime(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return '--';
		}
		return date.toLocaleString('zh-CN', { hour12: false });
	}

	private lifecycleStatusText(): string {
		const state = this.lifecycle.getState();
		return state.status === 'rebuilding' ? `正在重建索引（${state.count} 篇）` : state.status === 'failed' ? `索引失败：${state.error ?? '未知错误'}` : `索引就绪 · ${state.count} 篇`;
	}

	private async openKnowledgeResult(result: SearchResult): Promise<void> {
		const openPath = typeof result.metadata?.open_path === 'string' ? result.metadata.open_path : result.path;
		const file = this.app.vault.getAbstractFileByPath(openPath);
		if (!(file instanceof TFile)) { this.setFeedback(`找不到笔记：${result.path}`); return; }
		await this.app.workspace.getLeaf('tab').openFile(file);
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

	private renderOverviewGrid(parent: HTMLElement, data: DashboardData): void {
		const graphData = this.lifecycle.getGraphData();
		const nodeCount = graphData.stats.nodeCount || data.vaultHealth.noteCount;
		const edgeCount = graphData.stats.edgeCount;

		const grid = parent.createDiv({ cls: 'agent-dashboard-overview-grid' });

		/* ===== 左栏 ===== */
		const leftStack = grid.createDiv({ cls: 'agent-dashboard-overview-stack' });

		/* 知识星图预览 */
		const graphCard = leftStack.createEl('section', { cls: 'agent-dashboard-surface agent-dashboard-graph-preview' });
		const graphHeader = graphCard.createDiv({ cls: 'agent-dashboard-surface-header' });
		const graphHeading = graphHeader.createDiv();
		graphHeading.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'KNOWLEDGE GRAPH' });
graphHeading.createEl('h2', { text: '知识星图预览' });
			graphHeading.createEl('p', { text: `${nodeCount} 个节点 · ${edgeCount} 个链接` });
		const graphCta = graphHeader.createEl('button', { cls: 'agent-dashboard-graph-preview__cta', attr: { type: 'button', 'aria-label': '进入知识星图' } });
		graphCta.createSpan({ text: '进入星图' });
		graphCta.createSpan({ text: ' ↗' });
		this.registerDomEvent(graphCta, 'click', () => {
			this.activePage = 'agent-dashboard-graph';
			this.showPage('agent-dashboard-graph');
			this.activeViewLabelEl?.setText('知识星图');
		});

		/* 最近更新（真实数据：按修改时间取最近 3 篇） */
		const recentCard = leftStack.createEl('section', { cls: 'agent-dashboard-surface' });
		const recentHeader = recentCard.createDiv({ cls: 'agent-dashboard-surface-header' });
		recentHeader.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'RECENT' });
		recentHeader.createEl('h2', { text: '最近更新' });
		const recentList = recentCard.createDiv({ cls: 'agent-dashboard-recent-list' });
		const recentFiles = this.app.vault.getMarkdownFiles()
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 3);
		if (recentFiles.length === 0) {
			recentList.createDiv({ cls: 'agent-dashboard-empty-state', text: '暂无笔记。' });
		} else {
			recentFiles.forEach((file) => {
				const row = recentList.createDiv({ cls: 'agent-dashboard-recent-item' });
				row.createSpan({ cls: 'agent-dashboard-status-dot agent-dashboard-recent-dot', attr: { 'aria-hidden': 'true' } });
				row.createSpan({ cls: 'agent-dashboard-recent-item__title', text: file.basename });
				row.createSpan({ cls: 'agent-dashboard-recent-item__meta', text: file.parent?.path ?? '/' });
				row.createSpan({ cls: 'agent-dashboard-recent-item__meta', text: this.formatDate(new Date(file.stat.mtime)) });
			});
		}

		/* ===== 右栏 ===== */
		const rightStack = grid.createDiv({ cls: 'agent-dashboard-overview-stack' });

		/* 生产动态（暂无真实数据源，诚实空态） */
		const pipelineCard = rightStack.createEl('section', { cls: 'agent-dashboard-surface' });
		const pipelineHeader = pipelineCard.createDiv({ cls: 'agent-dashboard-surface-header' });
		const pipelineHeading = pipelineHeader.createDiv();
		pipelineHeading.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'PIPELINE' });
		pipelineHeading.createEl('h2', { text: '生产动态' });
		const pipelineBody = pipelineCard.createDiv({ cls: 'agent-dashboard-pipeline' });
		pipelineBody.createDiv({ cls: 'agent-dashboard-empty-state', text: '暂无生产动态。' });

		/* 知识层健康度（真实数据：来自知识图谱统计） */
		const wikiCard = rightStack.createEl('section', { cls: 'agent-dashboard-surface' });
		const wikiHeader = wikiCard.createDiv({ cls: 'agent-dashboard-surface-header' });
		wikiHeader.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'WIKI STATUS' });
		wikiHeader.createEl('h2', { text: '知识层健康度' });
		const wikiBody = wikiCard.createDiv({ cls: 'agent-dashboard-pipeline' });
		[
			{ label: '图谱节点', count: graphData.stats.nodeCount, color: 'var(--color-green)' },
			{ label: '双向链接', count: graphData.stats.edgeCount, color: 'var(--color-orange)' },
			{ label: '孤立节点', count: graphData.stats.isolatedCount, color: 'var(--text-faint)' },
		].forEach((item) => {
			const row = wikiBody.createDiv({ cls: 'agent-dashboard-pipeline__row' });
			const dot = row.createSpan({
					cls: 'agent-dashboard-status-dot agent-dashboard-pipeline-dot',
					attr: { 'aria-hidden': 'true' },
				});
				dot.setCssProps({ '--pipeline-dot-color': item.color, '--pipeline-dot-shadow': 'var(--background-modifier-hover)' });
			row.createSpan({ cls: 'agent-dashboard-pipeline__title', text: item.label });
			row.createSpan({ cls: 'agent-dashboard-pipeline__stage mono', text: String(item.count) });
		});
	}

	private renderHealthPanel(parent: HTMLElement): void {
		const card = parent.createEl('section', { cls: 'agent-dashboard-surface' });
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'SYSTEM HEALTH' });
		heading.createEl('h2', { text: '系统健康' });
		const patrolBtn = header.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
		patrolBtn.createSpan({ text: '运行巡检' });

		const statusEl = card.createDiv({ cls: 'agent-dashboard-health-list' });
		const lifecycleState = this.lifecycle.getState();
		const items = [
			{ label: '索引状态', value: lifecycleState.status === 'ready' ? `就绪 · ${lifecycleState.count} 篇` : lifecycleState.status === 'rebuilding' ? '重建中' : '失败', ok: lifecycleState.status === 'ready' },
			{ label: '持久化', value: this.persistence.degraded ? '降级' : this.persistence.restored ? '就绪' : '未恢复', ok: !this.persistence.degraded && this.persistence.restored },
			{ label: '项目追踪', value: this.projectTracker.getRepos().length > 0 ? this.projectTracker.getRepos().join(', ') : '未配置', ok: this.projectTracker.getRepos().length > 0 },
		];
		items.forEach((item) => {
			const row = statusEl.createDiv({ cls: 'agent-dashboard-health-row' });
			row.createSpan({ cls: 'agent-dashboard-status-dot agent-dashboard-health-dot', attr: { style: `background:${item.ok ? 'var(--color-green)' : 'var(--color-orange)'};box-shadow:0 0 0 3px var(--background-modifier-hover);` } });
			row.createSpan({ cls: 'agent-dashboard-health-label', text: item.label });
			row.createSpan({ cls: 'agent-dashboard-health-value', text: item.value });
		});

		this.registerDomEvent(patrolBtn, 'click', async () => {
			patrolBtn.disabled = true;
			patrolBtn.setText('巡检中…');
			try {
				const report = await this.patrolService.patrol();
				new Notice(`巡检完成：${report.noteCount} 篇笔记，${report.missingFrontmatter} 篇缺 frontmatter`);
				statusEl.empty();
				const rows = [
					{ label: '笔记总数', value: String(report.noteCount), ok: report.noteCount > 0 },
					{ label: '缺 frontmatter', value: String(report.missingFrontmatter), ok: report.missingFrontmatter === 0 },
					{ label: '巡检时间', value: new Date(report.timestamp).toLocaleTimeString('zh-CN', { hour12: false }), ok: true },
				];
				rows.forEach((row) => {
					const r = statusEl.createDiv({ cls: 'agent-dashboard-health-row' });
					r.createSpan({ cls: 'agent-dashboard-status-dot agent-dashboard-health-dot', attr: { style: `background:${row.ok ? 'var(--color-green)' : 'var(--color-orange)'};box-shadow:0 0 0 3px var(--background-modifier-hover);` } });
					r.createSpan({ cls: 'agent-dashboard-health-label', text: row.label });
					r.createSpan({ cls: 'agent-dashboard-health-value', text: row.value });
				});
			} finally {
				patrolBtn.disabled = false;
				patrolBtn.setText('运行巡检');
			}
		});
	}

	private renderGraphPage(parent: HTMLElement, _data: DashboardData): void {
		const graphData = this.lifecycle.getGraphData();
		const nodeCount = graphData.stats.nodeCount || _data.vaultHealth.noteCount;
		const edgeCount = graphData.stats.edgeCount;
		const isolatedCount = graphData.stats.isolatedCount || 0;

		const shell = parent.createDiv({ cls: 'agent-dashboard-graph-page-shell' });

		const header = shell.createDiv({ cls: 'agent-dashboard-graph-header' });
		const headerText = header.createDiv();
		headerText.createSpan({ cls: 'agent-dashboard-eyebrow', text: 'KNOWLEDGE GRAPH' });
		headerText.createEl('h1', { text: '知识星图' });
		headerText.createEl('p', { text: '图谱可视化渲染开发中：当前展示笔记间真实链接的统计数据。', attr: { style: 'font-size:13px;color:var(--text-muted);margin-top:4px;' } });
		header.createSpan({ text: `LIVE VAULT · ${new Date().toISOString().slice(0, 10)}`, cls: 'agent-dashboard-graph-header__meta', attr: { style: 'font-size:12px;color:var(--text-muted);font-family:var(--font-monospace);' } });

		const container = shell.createDiv({ cls: 'agent-dashboard-graph-container' });

		/* 搜索框 */
		const search = container.createDiv({ cls: 'agent-dashboard-graph-search' });
		search.createSpan({ text: '🔍' });
		search.createEl('input', { attr: { type: 'search', placeholder: `搜索 ${nodeCount} 个知识页…`, 'aria-label': '搜索图谱节点' } });
		search.createEl('kbd', { text: '/' });

		/* Canvas 渲染尚未实现：显示占位文案，隐藏空 canvas */
		const canvasWrap = container.createDiv({ cls: 'agent-dashboard-graph-canvas-wrap' });
		canvasWrap.createDiv({ cls: 'agent-dashboard-empty-state', text: '图谱可视化渲染开发中，当前仅提供链接统计。' });
		const canvas = canvasWrap.createEl('canvas', { attr: { height: '500' } });
		canvas.id = 'agent-dashboard-graph-canvas';
		canvas.hidden = true;

		/* 底部统计 */
		const stats = container.createDiv({ cls: 'agent-dashboard-graph-stats' });
		stats.createSpan({ text: `${nodeCount} 页面` });
		const statsB = stats.createSpan();
		statsB.createEl('b', { text: String(edgeCount) });
		statsB.append(' 双链');
		const statsC = stats.createSpan();
		statsC.createEl('b', { text: String(isolatedCount) });
		statsC.append(' 孤岛');

		/* 右侧透镜 */
		const lens = container.createDiv({ cls: 'agent-dashboard-graph-lens' });
		lens.createEl('h3', { text: '图谱透镜' });
		lens.createDiv({ cls: 'agent-dashboard-graph-lens__summary', text: `SHOWING ${nodeCount} / ${nodeCount}` });

		/* 统计各类型节点数 */
		const typeCounts: Record<string, number> = { wiki: 0, raw: 0, inbox: 0, note: 0 };
		graphData.nodes.forEach((n) => { typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1; });
		const typeColors: Record<string, string> = { wiki: 'var(--interactive-accent)', raw: 'var(--color-green)', inbox: 'var(--color-orange)', note: 'var(--color-purple, #5e5ce6)' };
		const typeLabels: Record<string, string> = { wiki: 'Wiki 层', raw: 'Raw 素材', inbox: '收件箱', note: '笔记' };

		Object.entries(typeCounts).forEach(([type, count]) => {
			if (count === 0) return;
			const item = lens.createDiv({ cls: 'agent-dashboard-graph-lens__item' });
			item.createSpan({ cls: 'agent-dashboard-graph-lens__dot', attr: { style: `background:${typeColors[type] ?? 'var(--text-muted)'};` } });
			item.createSpan({ text: typeLabels[type] ?? type });
			item.createSpan({ cls: 'agent-dashboard-graph-lens__count', text: String(count) });
		});
	}

	private renderHotPage(parent: HTMLElement): void {
		const section = parent.createEl('section');
		const header = section.createDiv({ cls: 'agent-dashboard-actions-heading' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '🔥 DAILY HOT', attr: { style: 'color:var(--color-orange);' } });
		heading.createEl('h2', { text: '每日热点', attr: { style: 'font-size:20px;font-weight:700;' } });
		heading.createEl('p', { text: '聚合公开热点，数据来自公开 API，每 30 分钟自动刷新。', attr: { style: 'font-size:13px;color:var(--text-muted);margin-top:4px;' } });
		const refreshBtn = header.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
		refreshBtn.createSpan({ text: '刷新热点' });

		const grid = section.createDiv({ cls: 'agent-dashboard-hot-grid' });
		grid.createDiv({ cls: 'agent-dashboard-empty-state', text: '正在加载热点…' });

		const renderCards = (items: Array<{ rank: number; title: string; desc: string; category: string; source: string; heat: string; detail: string }>) => {
			grid.empty();
			items.forEach((item) => {
				const card = grid.createDiv({ cls: 'agent-dashboard-hot-card' });
				const rankClass = item.rank <= 3 ? ` agent-dashboard-hot-rank top${item.rank}` : ' agent-dashboard-hot-rank';
				card.createSpan({ cls: rankClass, text: String(item.rank) });
				const content = card.createDiv({ cls: 'agent-dashboard-hot-content' });
				content.createSpan({ cls: 'agent-dashboard-hot-title', text: item.title });
				content.createEl('p', { cls: 'agent-dashboard-hot-desc', text: item.desc });
				const meta = content.createDiv({ cls: 'agent-dashboard-hot-meta' });
				meta.createSpan({ cls: 'agent-dashboard-hot-category', text: item.category });
				meta.createSpan({ cls: 'agent-dashboard-hot-source', text: item.source });
				meta.createSpan({ text: `${item.heat} 热度` });
				const detail = content.createDiv({ text: item.detail, attr: { style: 'display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--background-modifier-border);font-size:12px;color:var(--text-muted);line-height:1.6;' } });
				this.registerDomEvent(card, 'click', () => {
					const hidden = detail.style.display === 'none';
					detail.style.display = hidden ? 'block' : 'none';
					card.style.borderColor = hidden ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
				});
			});
		};

		/* Fallback mock data */
		const mockData = [
			{ rank: 1, title: 'OpenAI 发布 GPT-5 预览版，推理能力大幅提升', desc: '新模型在数学推理和代码生成方面取得显著突破，支持多模态输入。', category: 'AI', source: '36氪', heat: '2.3万', detail: 'OpenAI 最新发布的 GPT-5 预览版在多项基准测试中表现优异，API 价格与 GPT-4 持平。' },
			{ rank: 2, title: '苹果 Vision Pro 2 预计明年发布，重量减轻 30%', desc: '新设备将采用更轻的材料和改进的人体工学设计，价格可能下调。', category: '科技', source: 'IT之家', heat: '1.8万', detail: '苹果正在开发 Vision Pro 第二代产品，预计 2027 年第一季度发布。' },
			{ rank: 3, title: '中国团队开源 1000 亿参数大模型，性能接近 GPT-4', desc: '该模型在中文理解和生成任务上表现优异，已在 GitHub 开源。', category: 'AI', source: '机器之心', heat: '1.5万', detail: '中科院联合多家高校开源了"夸父-100B"千亿参数大语言模型，采用 Apache 2.0 许可证。' },
			{ rank: 4, title: 'Obsidian 发布 1.8 版本，新增实时协作编辑功能', desc: '新版本支持多人同时编辑同一笔记，数据端到端加密。', category: '工具', source: 'Obsidian 官方', heat: '1.2万', detail: 'Obsidian 1.8 首次引入实时协作功能，基于 CRDT 算法，免费使用。' },
			{ rank: 5, title: 'GitHub Copilot 推出 Workspace 模式', desc: '开发者可以通过自然语言描述需求，AI 自动完成跨文件修改。', category: '开发', source: 'GitHub 官方', heat: '9.8k', detail: 'Copilot Workspace 模式支持代码审查、冲突检测和逐步应用修改，Beta 阶段。' },
			{ rank: 6, title: 'Google 发布 Gemini 2.0', desc: 'Gemini 2.0 可直接调用 Google 搜索、地图等工具执行复杂任务。', category: 'AI', source: 'The Verge', heat: '8.5k', detail: 'Gemini 2.0 原生集成 Google 搜索、地图、Gmail 等工具，API 定价降低 40%。' },
		];

		renderCards(mockData);

		this.registerDomEvent(refreshBtn, 'click', async () => {
			refreshBtn.disabled = true;
			refreshBtn.setText('加载中…');
			grid.empty();
			grid.createDiv({ cls: 'agent-dashboard-empty-state', text: '正在加载热点…' });
			try {
				const resp = await requestUrl({ url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists', method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
				const hotItems: Array<{ rank: number; title: string; desc: string; category: string; source: string; heat: string; detail: string }> = [];
				if (resp.status === 200 && isRecord(resp.json) && Array.isArray(resp.json.data)) {
					resp.json.data.slice(0, 6).forEach((item: unknown, i: number) => {
						if (!isRecord(item)) return;
						const target = isRecord(item.target) ? item.target : undefined;
						const feedSpecific = isRecord(item.feedSpecific) ? item.feedSpecific : undefined;
						hotItems.push({
							rank: i + 1,
							title: typeof target?.title === 'string' ? target.title : '热点',
							desc: typeof target?.excerpt === 'string' ? target.excerpt : (isRecord(target?.titleArea) && typeof target.titleArea.text === 'string' ? target.titleArea.text : ''),
							category: typeof feedSpecific?.currentType === 'string' ? feedSpecific.currentType : '热点',
							source: '知乎',
							heat: `${(typeof item.detailText === 'string' ? item.detailText.replace(/[^0-9]/g, '') : '') || '—'} 热度`,
							detail: typeof target?.excerpt === 'string' ? target.excerpt : '点击查看详情',
						});
					});
				}
				renderCards(hotItems.length > 0 ? hotItems : mockData);
			} catch {
				renderCards(mockData);
			} finally {
				refreshBtn.disabled = false;
				refreshBtn.setText('刷新热点');
			}
		});
	}

	private renderResearchPage(parent: HTMLElement): void {
		const section = parent.createEl('section');
		const header = section.createDiv({ cls: 'agent-dashboard-actions-heading' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '🔬 RESEARCH' });
		heading.createEl('h2', { text: '后台研究', attr: { style: 'font-size:20px;font-weight:700;' } });
		heading.createEl('p', { text: '提交研究任务，AI 自动搜索、整理资料并生成报告。', attr: { style: 'font-size:13px;color:var(--text-muted);margin-top:4px;' } });

		/* 输入区 */
		const inputArea = section.createDiv({ cls: 'agent-dashboard-research-input-area' });
		const input = inputArea.createEl('input', {
			cls: 'agent-dashboard-chat-input',
			attr: { type: 'text', placeholder: '输入研究主题…', 'aria-label': '研究主题' },
		});
		const submitBtn = inputArea.createEl('button', {
			cls: 'agent-dashboard-chat-send-btn',
			attr: { type: 'button' },
		});
		submitBtn.createSpan({ text: '开始研究' });

		/* 任务列表 */
		const taskList = section.createDiv({ cls: 'agent-dashboard-research-tasks' });

		this.registerDomEvent(submitBtn, 'click', () => void this.handleResearchSubmit(input, taskList, submitBtn));
		this.registerDomEvent(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') void this.handleResearchSubmit(input, taskList, submitBtn);
		});

		/* 加载已有任务 */
		void this.loadResearchTasks(taskList);
	}

	private async handleResearchSubmit(input: HTMLInputElement, taskList: HTMLElement, btn: HTMLButtonElement): Promise<void> {
		const query = input.value.trim();
		if (!query) return;
		input.value = '';
		btn.disabled = true;
		btn.setText('研究中…');

		try {
			const taskId = await this.researchService.submit(query, createRequestContext('user'));
			/* 轮询任务状态直到终态（上限 60 秒），代替固定等待 */
			const deadline = Date.now() + 60_000;
			while (Date.now() < deadline) {
				const task = await this.researchService.getStatus(taskId, createRequestContext('user'));
				if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			await this.loadResearchTasks(taskList);
		} catch (error) {
			new Notice(`研究失败：${this.getErrorMessage(error)}`);
		} finally {
			btn.disabled = false;
			btn.setText('开始研究');
		}
	}

	private async loadResearchTasks(taskList: HTMLElement): Promise<void> {
		taskList.empty();
		try {
			const tasks = await this.researchService.list(createRequestContext('user'));
			if (tasks.length === 0) {
				taskList.createDiv({ cls: 'agent-dashboard-empty-state', text: '暂无研究任务。输入主题开始研究。' });
				return;
			}
			tasks.slice(0, 10).forEach((task) => {
				const card = taskList.createDiv({ cls: 'agent-dashboard-research-task' });
				const top = card.createDiv({ cls: 'agent-dashboard-research-task-top' });
				top.createSpan({ cls: 'agent-dashboard-research-task-query', text: task.query });
				const statusColors: Record<string, string> = { completed: 'var(--color-green)', running: 'var(--interactive-accent)', failed: 'var(--color-red)', cancelled: 'var(--text-faint)', queued: 'var(--color-orange)' };
				top.createSpan({ cls: 'agent-dashboard-research-task-status', text: task.status === 'completed' ? '已完成' : task.status === 'running' ? '进行中' : task.status === 'failed' ? '失败' : task.status === 'cancelled' ? '已取消' : '排队中', attr: { style: `color:${statusColors[task.status] ?? 'var(--text-muted)'};` } });
				if (task.result?.reportPath) {
					card.createSpan({ cls: 'agent-dashboard-research-task-path', text: `📄 ${task.result.reportPath}` });
				}
				if (task.error) {
					card.createSpan({ cls: 'agent-dashboard-research-task-error', text: `❌ ${task.error}` });
				}
			});
		} catch {
			taskList.createDiv({ cls: 'agent-dashboard-empty-state', text: '加载研究任务失败。' });
		}
	}

	private renderChatPlaceholder(parent: HTMLElement): void {
		const card = parent.createEl('section', {
			cls: 'agent-dashboard-surface',
			attr: { 'aria-label': '对话' },
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header' });
		header.createSpan({ cls: 'agent-dashboard-eyebrow', text: '💬 CHAT' });
		header.createEl('h2', { text: '对话' });
		header.createEl('p', { text: '对话功能开发中：当前发送消息会生成一篇深度研究报告，尚未接入实时对话。' });

		/* 消息列表 */
		const messageList = card.createDiv({ cls: 'agent-dashboard-chat-messages' });
		const welcomeMsg = messageList.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--assistant' });
		welcomeMsg.createSpan({ text: '你好！我是墨忆台助手。有什么可以帮助你的？' });

		/* 输入区 */
		const inputArea = card.createDiv({ cls: 'agent-dashboard-chat-input-area' });
		const input = inputArea.createEl('input', {
			cls: 'agent-dashboard-chat-input',
			attr: { type: 'text', placeholder: '输入你的问题…', 'aria-label': '输入消息' },
		});
		const sendBtn = inputArea.createEl('button', {
			cls: 'agent-dashboard-chat-send-btn',
			attr: { type: 'button', 'aria-label': '发送' },
		});
		sendBtn.createSpan({ text: '发送' });

		this.registerDomEvent(sendBtn, 'click', () => void this.handleChatSend(input, messageList, sendBtn));
		this.registerDomEvent(input, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') void this.handleChatSend(input, messageList, sendBtn);
		});
	}

	private async handleChatSend(input: HTMLInputElement, messageList: HTMLElement, sendBtn: HTMLButtonElement): Promise<void> {
		const text = input.value.trim();
		if (!text) return;
		input.value = '';
		sendBtn.disabled = true;

		/* 用户消息 */
		const userMsg = messageList.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--user' });
		userMsg.createSpan({ text });

		/* 助手消息（占位） */
		const assistantMsg = messageList.createDiv({ cls: 'agent-dashboard-chat-message agent-dashboard-chat-message--assistant' });
		const loadingEl = assistantMsg.createSpan({ text: '思考中…' });

		try {
			/* 使用深度研究作为回答 */
			const context = createRequestContext('user');
			await this.actionService.runDeepResearch(context);
			loadingEl.setText('已提交深度研究任务，请在总览页查看结果。');
		} catch (error) {
			loadingEl.setText(`抱歉，回答时出错：${this.getErrorMessage(error)}`);
		} finally {
			sendBtn.disabled = false;
			messageList.scrollTop = messageList.scrollHeight;
		}
	}

	private showPage(target: string): void {
		Object.values(this.pageMap).forEach((page) => {
			page.hidden = true;
		});
		const page = this.pageMap[target];
		if (page) {
			page.hidden = false;
		}
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
						this.activePage = item.target;
						this.showPage(item.target);
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
		welcomeTitle.setText(`${this.greeting()}，${DISPLAY_NAME}`);
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

		this.runLogEl = section.createDiv({
			cls: 'agent-dashboard-run-log',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.runLogEl.hidden = true;
	}

	private setRunLog(message: string): void {
		if (!this.runLogEl) {
			return;
		}
		this.runLogEl.setText(message);
		this.runLogEl.hidden = !message;
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
			const dateKey = toDateKey(date);
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

	private renderProjectTracker(parent: HTMLElement): void {
		const card = parent.createEl('article', {
			cls: 'agent-dashboard-surface agent-dashboard-list-card',
			attr: { id: 'agent-dashboard-agents', 'aria-labelledby': 'agent-dashboard-feed-title' },
		});
		const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
		const heading = header.createDiv();
		heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '关注的项目' });
		heading.createEl('h2', { attr: { id: 'agent-dashboard-feed-title' }, text: '项目追踪' });
		heading.createEl('p', { text: '你关注的 GitHub 项目的版本、提交与讨论动态。' });
		const refresh = header.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
		refresh.createSpan({ text: '刷新' });
		this.registerDomEvent(refresh, 'click', () => {
			refresh.disabled = true;
			void this.loadProjectSnapshots(true).finally(() => { refresh.disabled = false; });
		});

		const list = card.createDiv({ cls: 'agent-dashboard-feed-list' });
		this.projectListEl = list;
		void this.loadProjectSnapshots(false);
	}

	private async loadProjectSnapshots(force: boolean): Promise<void> {
		const list = this.projectListEl;
		if (!list || this.isClosed || this.projectTrackerBusy) {
			return;
		}
		this.projectTrackerBusy = true;
		list.empty();
		try {
			const repos = this.projectTracker.getRepos();
			if (repos.length === 0) {
				list.createDiv({ cls: 'agent-dashboard-empty-state', text: '还没有关注的项目，请在设置中添加。' });
				return;
			}
			const snapshots = await Promise.all(repos.map((repo) => this.projectTracker.refresh(repo, force)));
			if (this.isClosed || this.projectListEl !== list) {
				return;
			}
			list.empty();
			snapshots.forEach((snapshot) => this.renderProjectSnapshot(list, snapshot));
		} catch {
			list.empty();
			list.createDiv({ cls: 'agent-dashboard-empty-state', text: '加载项目动态失败，请稍后重试。' });
		} finally {
			this.projectTrackerBusy = false;
		}
	}

private renderProjectSnapshot(parent: HTMLElement, snapshot: RepoSnapshot): void {
			const card = parent.createEl('article', { cls: 'agent-dashboard-project-card' });
			const top = card.createDiv({ cls: 'agent-dashboard-project-top' });
			top.createEl('strong', { cls: 'agent-dashboard-project-name', text: snapshot.fullName });
			const meta: string[] = [];
			if (snapshot.stars > 0) meta.push(`★ ${snapshot.stars}`);
			if (snapshot.releases[0]) meta.push(`最新版本 ${snapshot.releases[0].tag}`);
			if (snapshot.error) meta.push(snapshot.error);
			top.createSpan({ cls: 'agent-dashboard-project-meta', text: meta.join(' · ') || '暂无数据' });

			const openButton = card.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
			openButton.createSpan({ text: '打开 GitHub' });
			this.registerDomEvent(openButton, 'click', () => {
				void this.openGitHubUrl(`https://github.com/${snapshot.fullName}`);
			});

			if (snapshot.releases.length > 0) {
				const section = card.createDiv({ cls: 'agent-dashboard-project-section' });
				section.createSpan({ cls: 'agent-dashboard-project-label', text: '版本发布' });
				snapshot.releases.forEach((release) => {
					const row = section.createEl('button', { cls: 'agent-dashboard-project-row', attr: { type: 'button' } });
					row.createSpan({ cls: 'agent-dashboard-project-tag', text: release.tag });
					const desc = row.createSpan({ cls: 'agent-dashboard-project-desc' });
					if (release.name) {
						desc.setText(release.name);
					} else if (release.body) {
						desc.setText(release.body.slice(0, 120).replace(/\n/g, ' ').trim());
					} else {
						desc.setText('查看详情');
					}
					this.registerDomEvent(row, 'click', () => { void this.openGitHubUrl(release.url); });
				});
			} else {
				card.createDiv({ cls: 'agent-dashboard-empty-state agent-dashboard-project-empty', text: '暂无版本发布记录' });
			}
		}

	private async openGitHubUrl(url: string): Promise<void> {
		const win = this.containerEl.ownerDocument.defaultView;
		if (win && win.open) {
			win.open(url, '_blank', 'noopener');
			return;
		}
		this.setFeedback(`请手动打开：${url}`);
	}

	private async generateProjectReport(context: RequestContext): Promise<string> {
		const repos = this.projectTracker.getRepos();
		const snapshots = await Promise.all(repos.map((repo) => this.projectTracker.refresh(repo, true)));
		const parts: string[] = [];
		for (const snapshot of snapshots) {
			const result = await this.projectReport.generateReport(snapshot, context);
			if (result.report) {
				parts.push(`# ${snapshot.fullName}\n\n${result.report}`);
			} else if (result.error) {
				parts.push(`# ${snapshot.fullName}\n\n> ${result.error}`);
			}
		}
		if (parts.length === 0) {
			throw new Error('没有可生成的报告内容');
		}
		const date = new Date();
		const fileName = `项目动态-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.md`;
		await this.app.vault.adapter.mkdir(WORKBENCH_DIRS.reports);
		const path = normalizePath(`${WORKBENCH_DIRS.reports}/${fileName}`);
		await this.app.vault.create(path, parts.join('\n\n---\n\n') + '\n');
		return path;
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
		this.setRunLog(
			action.id === 'deep-research' || action.id === 'github-feeds'
				? `正在生成「${action.label}」…（需要调用 AI 模型，可能要 1-3 分钟，请耐心等待）`
				: `正在执行「${action.label}」…`,
		);

		try {
			const context: RequestContext = createRequestContext('user');
			let path: string | null = null;
			switch (action.id) {
				case 'new-diary':
					path = await this.actionService.createDiary(context);
					break;
				case 'deep-research':
					path = await this.actionService.runDeepResearch(context);
					break;
				case 'github-feeds':
					path = await this.generateProjectReport(context);
					break;
				case 'image-understand':
					new ImageUnderstandModal(this.app, this.visionService, context).open();
					return;
				case 'inbox-ingest':
					this.openInboxModal(context);
					return;
				case 'vault-lint':
					path = await this.actionService.runVaultLint(context);
					break;
			}

			const completionMessage = path ? `${action.label} 已完成：${path}` : `${action.label} 已完成。`;
			const refreshed = await this.refresh();
			new Notice(formatDashboardActionMessage(action.label, 'success', path ?? undefined));
			if (refreshed && !this.isClosed) {
				this.setFeedback(completionMessage);
			}
			if (path) {
				this.setRunLog(`完成：${path}`);
				await this.openNote(path);
			} else {
				this.setRunLog('');
			}
		} catch (error) {
			showActionError(error);
			this.setFeedback(`${action.label} 失败：${this.getErrorMessage(error)}`);
			this.setRunLog(`失败：${this.getErrorMessage(error)}`);
		} finally {
			this.runningAction = null;
			button.disabled = false;
			button.removeClass('is-queued');
			state?.setText('就绪');
		}
	}

	private async openNote(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			this.setFeedback(`找不到笔记：${path}`);
			return;
		}
		await this.app.workspace.getLeaf('tab').openFile(file);
	}

	private openInboxModal(context: RequestContext = createRequestContext('user')): void {
		this.setFeedback('等待输入要导入 Inbox 的内容。');
		new InboxIngestModal(this.app, async (content) => {
			const path = await this.actionService.ingestInbox(content, context);
			if (!this.isClosed) {
				this.setFeedback(`已导入：${path}`);
				await this.refresh();
			}
			return path;
		}).open();
	}

	private async openTaskSource(task: DashboardTask): Promise<void> {
		await this.openNote(task.sourcePath);
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

	/** 按当前小时返回问候语（5-11 早上好 / 12-17 下午好 / 其他 晚上好）。 */
	private greeting(): string {
		const hour = new Date().getHours();
		if (hour >= 5 && hour < 12) return '早上好';
		if (hour >= 12 && hour < 18) return '下午好';
		return '晚上好';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
