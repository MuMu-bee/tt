import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
	AgentDashboardSettingTab,
	DEFAULT_SETTINGS,
	AgentDashboardSettings,
} from './settings';
import { WORKBENCH_DIRS, normalizeProjectTrackerSettings } from './data/dashboardTypes';
import { OpenAiModel } from './adapters/openAiModel';
import { isMarkdownPath } from './services/indexLifecycleService';
import { composeRuntime } from './services/runtimeComposition';
import { createRequestContext } from './application/requestContext';
import { AgentActionService } from './services/agentActionService';
import { ChatService } from './services/chatService';
import { VaultContextService } from './services/vaultContext';
import { DashboardService } from './services/dashboardService';
import { ProjectTracker } from './services/projectTracker';
import { ProjectReportService } from './services/projectReportService';
import { VisionService } from './services/visionService';
import { ResearchService } from './services/researchService';
import { MemoryPublishService } from './services/memoryPublishService';
import { TaskCoordinator } from './services/taskCoordinator';
import { PatrolService } from './services/patrolService';
import { CacheStore } from './services/cacheStore';
import type { WorkbenchWriteService } from './services/workbenchWriteService';
import { VaultMemoryStorage } from './adapters/vaultMemoryStorage';
import { ConversationStore } from './adapters/conversationStore';
import { AtomStore } from './adapters/atomStore';
import { SceneStore } from './adapters/sceneStore';
import { PersonaStore } from './adapters/personaStore';
import { MemoryPipeline } from './services/memoryPipeline';
import { MemoryExtractionService } from './services/memoryExtractionService';
import { SceneExtractionService } from './services/sceneExtractionService';
import { PersonaGenerationService } from './services/personaGenerationService';
import { ObsidianSecretFile } from './adapters/obsidianSecretFile';
import { applySecrets, EMPTY_SECRETS, migrateSecrets, stripSecrets, type Secrets } from './services/secretService';
import {
	AgentDashboardView,
	VIEW_TYPE_AGENT_DASHBOARD,
} from './views/AgentDashboardView';
import { ProjectTrackerSettingsModal } from './ui/ProjectTrackerSettingsModal';

const AUTO_REPORT_POLL_MS = 60_000;

export default class AgentDashboardPlugin extends Plugin {
	settings!: AgentDashboardSettings;
	private projectTracker!: ProjectTracker;
	private taskCoordinator?: TaskCoordinator;
	private autoReportInFlight = false;
	private autoProjectCheckInterval: number | null = null;
	private secretFile?: ObsidianSecretFile;
	private secrets: Secrets = EMPTY_SECRETS;

	async onload(): Promise<void> {
		this.secretFile = new ObsidianSecretFile(this.manifest.dir ?? this.app.vault.configDir + '/plugins/agent-dashboard');
		await this.loadSettings();

		const dashboardService = new DashboardService(this.app);
		const runtime = await composeRuntime(this.app, this.settings);
		const searchService = runtime.search;
		const lifecycle = runtime.lifecycle;
		void lifecycle.rebuild(createRequestContext('background-task')).catch(() => undefined);
		const model = new OpenAiModel(this.settings.agent);
		const actionService = new AgentActionService(this.app, dashboardService, model, runtime.workbenchWrite);
		const memoryStorage = new VaultMemoryStorage(this.app);
		const conversationStore = new ConversationStore(memoryStorage);
		const atomStore = new AtomStore(memoryStorage);
		const sceneStore = new SceneStore(memoryStorage);
		const personaStore = new PersonaStore(memoryStorage);
		const memoryPipeline = new MemoryPipeline({
			conversations: conversationStore,
			atoms: atomStore,
			scenes: sceneStore,
			persona: personaStore,
			extractor: new MemoryExtractionService(model),
			sceneExtractor: new SceneExtractionService(model, sceneStore),
			personaGenerator: new PersonaGenerationService(model, personaStore),
			flags: this.settings.featureFlags.memory,
		});
		const chatService = new ChatService(
			this.settings.agent,
			new VaultContextService(this.app, searchService),
			memoryPipeline,
			memoryPipeline,
			this.settings.featureFlags.memory,
		);
		this.projectTracker = new ProjectTracker(
			new CacheStore(this.app.vault),
			this.settings.projectTracker,
		);
		const projectReport = new ProjectReportService(model, this.app, runtime.workbenchWrite);
		const visionService = new VisionService(this.app, model, runtime.workbenchWrite);
		const researchService = new ResearchService(runtime.workbenchWrite);
		const memoryPublish = new MemoryPublishService(this.app, runtime.auditSink);

		/* V0.5: TaskCoordinator + PatrolService */
		const taskCoordinator = new TaskCoordinator();
		this.taskCoordinator = taskCoordinator;
		const patrolService = new PatrolService(this.app, lifecycle, runtime.proposals);
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
				chatService,
				runtime.workbenchWrite,
				() => { new ProjectTrackerSettingsModal(this.app, this).open(); },
			),
		);

		this.setupAutoProjectReport(this.projectTracker, projectReport, runtime.workbenchWrite);
		this.setupAutoProjectCheck(this.projectTracker);

		/* 过滤插件自身缓存目录（dashboard/），避免缓存写入触发无限刷新循环。 */
		const isPluginCachePath = (path: string): boolean => path.startsWith('dashboard/');
		this.registerEvent(this.app.vault.on('create', (file) => { if (isPluginCachePath(file.path)) return; if (isMarkdownPath(file.path)) void lifecycle.create(file.path).catch(() => undefined); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('modify', (file) => { if (isPluginCachePath(file.path)) return; if (isMarkdownPath(file.path)) void lifecycle.modify(file.path).catch(() => undefined); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('delete', (file) => { if (isPluginCachePath(file.path)) return; void lifecycle.delete(file.path).catch(() => undefined); this.refreshDashboardViews(); }));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { if (isPluginCachePath(file.path)) return; void lifecycle.rename(oldPath, file.path).catch(() => undefined); this.refreshDashboardViews(); }));
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

		this.addCommand({
			id: 'rollback-active-file',
			name: '回滚当前文件到修改前',
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView || !markdownView.file) {
					return false;
				}
				if (!checking) {
					void runtime.rollback(markdownView.file.path, createRequestContext('user')).then((result) => {
						new Notice(result.message);
					});
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
	/** Polls tracked projects on the configured interval so the board has fresh baselines. */
	private setupAutoProjectCheck(projectTracker: ProjectTracker): void {
		this.clearAutoProjectCheck();
		const minutes = this.settings.projectTracker.autoCheckMinutes;
		if (!Number.isFinite(minutes) || minutes <= 0) return;
		let inFlight = false;
		const run = (): void => {
			if (inFlight) return;
			inFlight = true;
			void projectTracker.checkAll(true)
				.catch(() => undefined)
				.finally(() => { inFlight = false; });
		};
		this.autoProjectCheckInterval = window.setInterval(run, minutes * 60_000);
		run();
	}

	private clearAutoProjectCheck(): void {
		if (this.autoProjectCheckInterval !== null) {
			window.clearInterval(this.autoProjectCheckInterval);
			this.autoProjectCheckInterval = null;
		}
	}

	private setupAutoProjectReport(
		projectTracker: ProjectTracker,
		projectReport: ProjectReportService,
		workbenchWrite: WorkbenchWriteService,
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
			const file = this.app.vault.getAbstractFileByPath(`${WORKBENCH_DIRS.reports}/${todayReportName()}`);
			return !(file instanceof TFile);
		};

		const runIfDue = (): void => {
			if (this.autoReportInFlight) return;
			this.autoReportInFlight = true;
			void (async () => {
				try {
					const due = await shouldRun();
					if (!due) return;
					const results = await projectTracker.checkAll(true);
					const parts: string[] = [];
					for (const item of results) {
						const result = await projectReport.generateReport(item.snapshot, createRequestContext('background-task'));
						if (result.report) {
							parts.push('# ' + item.snapshot.fullName + '\n\n' + result.report);
						} else if (result.error) {
							parts.push('# ' + item.snapshot.fullName + '\n\n> ' + result.error);
						}
					}
					if (parts.length > 0) {
						const result = await workbenchWrite.writeGenerated({
							path: WORKBENCH_DIRS.reports + '/' + todayReportName(),
							content: parts.join('\n\n---\n\n') + '\n',
							kind: 'project',
							context: createRequestContext('background-task'),
						});
						if (result.status === 'failed') {
							console.error('[agent-dashboard] 自动日报写入失败。', result.error_code);
						}
					}
				} catch {
					/* 自动日报失败静默，避免影响插件运行 */
				} finally {
					this.autoReportInFlight = false;
				}
			})();
		};

		runIfDue();
		this.registerInterval(window.setInterval(runIfDue, AUTO_REPORT_POLL_MS));
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

	onunload(): void {
		this.taskCoordinator?.dispose();
		this.clearAutoProjectCheck();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<AgentDashboardSettings> | null;
		const s = stored ?? {};
		let settings: AgentDashboardSettings = {
			agent: { ...DEFAULT_SETTINGS.agent, ...(s.agent ?? {}) },
			projectTracker: normalizeProjectTrackerSettings(s.projectTracker),
			featureFlags: {
				...DEFAULT_SETTINGS.featureFlags,
				...(s.featureFlags ?? {}),
				organize: { ...DEFAULT_SETTINGS.featureFlags.organize, ...(s.featureFlags?.organize ?? {}) },
				memory: { ...DEFAULT_SETTINGS.featureFlags.memory, ...(s.featureFlags?.memory ?? {}) },
			},
		};
		const fromFile = this.secretFile ? await this.secretFile.read() : null;
		const migrated = migrateSecrets(settings, fromFile);
		if (migrated.migrated) {
			settings = migrated.settings;
			this.secrets = migrated.secrets;
			await this.saveData(settings);
			if (this.secretFile) await this.secretFile.write(this.secrets);
		} else {
			this.secrets = fromFile ?? EMPTY_SECRETS;
		}
		this.settings = applySecrets(settings, this.secrets);
	}

	async saveSettings(): Promise<void> {
		this.secrets = {
			agentApiKey: this.settings.agent.apiKey,
			githubToken: this.settings.projectTracker.githubToken,
			githubTokens: Object.fromEntries(
				this.settings.projectTracker.projects
					.filter((project) => project.token)
					.map((project) => [project.repo, project.token ?? '']),
			),
		};
		await this.saveData(stripSecrets(this.settings));
		if (this.secretFile) await this.secretFile.write(this.secrets);
		this.projectTracker?.setSettings(this.settings.projectTracker);
		this.setupAutoProjectCheck(this.projectTracker);
		this.refreshDashboardViews();
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
