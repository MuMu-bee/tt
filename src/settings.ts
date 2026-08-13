import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type AgentDashboardPlugin from './main';
import type { AgentConfig } from './data/dashboardTypes';
import { DEFAULT_AGENT_CONFIG } from './data/dashboardTypes';

export interface AgentDashboardSettings {
	hermesPath: string;
	agent: AgentConfig;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	hermesPath: '',
	agent: { ...DEFAULT_AGENT_CONFIG },
};

export class AgentDashboardSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AgentDashboardPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('智能体命令')
			.setHeading();

		new Setting(containerEl)
			.setName('Hermes 命令路径')
			.setDesc('桌面端执行深度研究和信息流摘要时使用。留空则自动查找 hermes 命令。')
			.addText((text) =>
				text
					.setPlaceholder('Hermes')
					.setValue(this.plugin.settings.hermesPath)
					.onChange(async (value) => {
						this.plugin.settings.hermesPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// ===== 墨忆台 Agent 设置 =====
		new Setting(containerEl)
			.setName('墨忆台 · 模型设置')
			.setHeading();

		new Setting(containerEl)
			.setName('使用本地模型')
			.setDesc('开启后使用本地 Ollama，关闭后使用云端 API。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.agent.useLocal)
					.onChange(async (value) => {
						this.plugin.settings.agent.useLocal = value;
						await this.plugin.saveSettings();
					}),
			);

		// Cloud API settings
		new Setting(containerEl)
			.setName('云端 API 地址')
			.setDesc('OpenAI 兼容的 API base URL（如阶跃、MiMo、OpenCode-Go）。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_AGENT_CONFIG.baseUrl)
					.setValue(this.plugin.settings.agent.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.agent.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('云端 API Key')
			.setDesc(`云端 LLM 的 API 密钥。注意：密钥以明文保存在插件数据文件（${this.app.vault.configDir}/plugins/agent-dashboard/data.json）中，请勿在共享设备上使用。`)
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.agent.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.agent.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('云端模型名称')
			.setDesc('如 step-1-flash、mimo-v2.5-pro 等。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_AGENT_CONFIG.model)
					.setValue(this.plugin.settings.agent.model)
					.onChange(async (value) => {
						this.plugin.settings.agent.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Ollama settings
		new Setting(containerEl)
			.setName('Ollama 地址')
			.setDesc('本地 Ollama 服务地址。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_AGENT_CONFIG.ollamaUrl)
					.setValue(this.plugin.settings.agent.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.agent.ollamaUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Ollama 模型名称')
			.setDesc('本地 Ollama 模型，如 qwen3:8b。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_AGENT_CONFIG.ollamaModel)
					.setValue(this.plugin.settings.agent.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.agent.ollamaModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
