import { MarkdownView, Plugin } from 'obsidian';
import {
	AgentDashboardSettingTab,
	DEFAULT_SETTINGS,
	AgentDashboardSettings,
} from './settings';
import { AgentActionService } from './services/agentActionService';
import { DashboardService } from './services/dashboardService';
import {
	AgentDashboardView,
	VIEW_TYPE_AGENT_DASHBOARD,
} from './views/AgentDashboardView';

export default class AgentDashboardPlugin extends Plugin {
	settings!: AgentDashboardSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		const dashboardService = new DashboardService(this.app);
		const actionService = new AgentActionService(
			this.app,
			dashboardService,
			() => this.settings.hermesPath,
		);

		this.registerView(
			VIEW_TYPE_AGENT_DASHBOARD,
			(leaf) => new AgentDashboardView(leaf, dashboardService, actionService),
		);

		this.registerEvent(this.app.vault.on('create', () => this.refreshDashboardViews()));
		this.registerEvent(this.app.vault.on('modify', () => this.refreshDashboardViews()));
		this.registerEvent(this.app.vault.on('delete', () => this.refreshDashboardViews()));

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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AgentDashboardSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
