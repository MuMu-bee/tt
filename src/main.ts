import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
	AgentDashboardSettingTab,
	DEFAULT_SETTINGS,
	AgentDashboardSettings,
} from './settings';
import { OpenAiModel } from './adapters/openAiModel';
import { isMarkdownPath } from './services/indexLifecycleService';
import { composeRuntime } from './services/runtimeComposition';
import { createRequestContext } from './application/requestContext';
import { AgentActionService } from './services/agentActionService';
import { DashboardService } from './services/dashboardService';
import { ProjectTracker } from './services/projectTracker';
import { ProjectReportService } from './services/projectReportService';
import { VisionService } from './services/visionService';
import { ResearchService } from './services/researchService';
import { MemoryPublishService } from './services/memoryPublishService';
import { TaskCoordinator } from './services/taskCoordinator';
import { PatrolService } from './services/patrolService';
import { CacheStore } from './services/cacheStore';
import {
	AgentDashboardView,
	VIEW_TYPE_AGENT_DASHBOARD,
} from './views/AgentDashboardView';

export default class AgentDashboardPlugin extends Plugin {
	settings!: AgentDashboardSettings;
	private projectTracker!: ProjectTracker;

	async onload(): Promise<void> {
		await this.loadSettings();

		const dashboardService = new DashboardService(this.app);
		const runtime = await composeRuntime(this.app, this.settings);
		const searchService = runtime.search;
		const lifecycle = runtime.lifecycle;
		void lifecycle.rebuild(createRequestContext('background-task')).catch(() => undefined);
		const model = new OpenAiModel(this.settings.agent);
		const actionService = new AgentActionService(this.app, dashboardService, model);
		this.projectTracker = new ProjectTracker(
			new CacheStore(this.app.vault),
			this.settings.projectTracker.githubToken,
			this.settings.projectTracker.repos,
		);
		const projectReport = new ProjectReportService(model);
		const visionService = new VisionService(this.app, model);
			const researchService = new ResearchService(this.app);
			const memoryPublish = new MemoryPublishService(this.app);

			/* V0.5: TaskCoordinator + PatrolService */
			const taskCoordinator = new TaskCoordinator();
			const patrolService = new PatrolService(this.app, lifecycle);
			taskCoordinator.register({
				id: 'patrol',
				name: '定时巡检',
				description: '定期检查 Vault 健康状态、缺失 frontmatter 和索引状态',
				intervalMs: 30 * 60 * 1000,
				status: 'idle',
				lastRun: null,
				nextRun: null,
				runCount: 0,
				handler: async () => {
					const report = await patrolService.patrol();
					new Notice(`巡检完成：${report.noteCount} 篇笔记，${report.missingFrontmatter} 篇缺 frontmatter`);
				},
			});
			taskCoordinator.start('patrol');

		this.registerView(
			VIEW_TYPE_AGENT_DASHBOARD,
(leaf) => new AgentDashboardView(
					leaf,
					dashboardService,
					actionService,
					searchService,
					lifecycle,
					runtime.proposals,
					runtime.approvals,
					runtime.apply,
					runtime.persistence,
					runtime.organize,
					runtime.audit,
					this.projectTracker,
					projectReport,
					visionService,
					researchService,
					memoryPublish,
					patrolService,
				),
		);

		this.setupAutoProjectReport(this.projectTracker, projectReport);

		this.registerEvent(this.app.vault.on('create', (file) => { if (isMarkdownPath(file.path)) void lifecycle.create(file.path).catch(() => undefined); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('modify', (file) => { if (isMarkdownPath(file.path)) void lifecycle.modify(file.path).catch(() => undefined); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('delete', (file) => { void lifecycle.delete(file.path); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void lifecycle.rename(oldPath, file.path); this.refreshDashboardViews(); }));
		this.addCommand({ id: 'rebuild-memory-index', name: '重建知识库索引', callback: () => { void lifecycle.rebuild(createRequestContext('user')).catch(() => undefined); } });

		const ribbonIcon = this.addRibbonIcon(
			'layout-dashboard',
			'打开智能体工作台',
			() => {
				void this.activateDashboardView();
			},
		);
		ribbonIcon.setAttr('aria-label', '打开智能体工作台');

		this.addCommand({
			id: 'open-dashboard',
			name: '打开智能体工作台',
			callback: () => {
				void this.activateDashboardView();
			},
		});

		this.addCommand({
			id: 'open-modal-simple',
			name: '打开工作台（兼容入口）',
			callback: () => {
				void this.activateDashboardView();
			},
		});
		this.addCommand({
			id: 'replace-selected',
			name: '刷新仪表盘数据',
			callback: () => {
				this.refreshDashboardViews(true);
			},
		});
		this.addCommand({
			id: 'open-modal-complex',
			name: '在活动编辑器中打开工作台',
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) {
					return false;
				}
				if (!checking) {
					void this.activateDashboardView();
				}
				return true;
			},
		});

		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
	}

	/**
	 * Generates the daily project report once per day at/after 08:00 when the
	 * auto-report setting is enabled and no report for today exists yet.
	 */
	private setupAutoProjectReport(
		projectTracker: ProjectTracker,
		projectReport: ProjectReportService,
	): void {
		const dateKey = (date: Date): string =>
			`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

		const todayReportName = (): string => `项目动态-${dateKey(new Date())}.md`;

		const shouldRun = async (): Promise<boolean> => {
			const settings = this.settings;
			if (!settings.projectTracker.autoReport) {
				return false;
			}
			const now = new Date();
			if (now.getHours() < 8) {
				return false;
			}
			const file = this.app.vault.getAbstractFileByPath(`Reports/${todayReportName()}`);
			return !(file instanceof TFile);
		};

		const runIfDue = (): void => {
			void shouldRun().then((due) => {
				if (!due) {
					return;
				}
				const repos = this.settings.projectTracker.repos;
				void Promise.all(repos.map((repo) => projectTracker.refresh(repo, true)))
					.then(async (snapshots) => {
						const parts: string[] = [];
						for (const snapshot of snapshots) {
							const result = await projectReport.generateReport(snapshot, createRequestContext('background-task'));
							if (result.report) {
								parts.push(`# ${snapshot.fullName}\n\n${result.report}`);
							} else if (result.error) {
								parts.push(`# ${snapshot.fullName}\n\n> ${result.error}`);
							}
						}
						if (parts.length > 0) {
							await this.app.vault.adapter.mkdir('Reports');
							await this.app.vault.create(`Reports/${todayReportName()}`, parts.join('\n\n---\n\n') + '\n');
						}
					})
					.catch(() => undefined);
			});
		};

		this.registerInterval(window.setInterval(runIfDue, 60_000));
		// Also run shortly after startup if it is already due today.
		window.setTimeout(runIfDue, 30_000);
	}

	async activateDashboardView(): Promise<void> {
		const { workspace } = this.app;
		const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_AGENT_DASHBOARD)[0];
		if (existingLeaf) {
			await workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_AGENT_DASHBOARD, active: true });
		await workspace.revealLeaf(leaf);
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<AgentDashboardSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...stored,
			featureFlags: {
				...DEFAULT_SETTINGS.featureFlags,
				...(stored?.featureFlags ?? {}),
				organize: { ...DEFAULT_SETTINGS.featureFlags.organize, ...(stored?.featureFlags?.organize ?? {}) },
			},
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.projectTracker?.setRepos(this.settings.projectTracker.repos);
	}

	private refreshDashboardViews(forceFeeds = false): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_DASHBOARD).forEach((leaf) => {
			if (!(leaf.view instanceof AgentDashboardView)) {
				return;
			}
			if (forceFeeds) {
				void leaf.view.refresh(true);
				return;
			}
			leaf.view.scheduleRefresh();
		});
	}
}
