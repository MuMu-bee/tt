import { Notice, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import type { App } from 'obsidian';
import type AgentDashboardPlugin from './main';
import type { AgentConfig, ProjectDotColor, ProjectGroup, ProjectTrackerSettings, TrackedProject } from './data/dashboardTypes';
import { DEFAULT_AGENT_CONFIG, DEFAULT_PROJECT_TRACKER_SETTINGS, normalizeProjectTrackerSettings } from './data/dashboardTypes';
import { OpenAiModel } from './adapters/openAiModel';
import { createRequestContext } from './application/requestContext';
import { parseRepoFullName } from './application/githubTracker';

import type { FeatureFlags } from './application/featureFlags';
import { DEFAULT_FEATURE_FLAGS } from './application/featureFlags';

export interface AgentDashboardSettings {
	agent: AgentConfig;
	featureFlags: FeatureFlags;
	projectTracker: ProjectTrackerSettings;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	agent: { ...DEFAULT_AGENT_CONFIG },
	featureFlags: { ...DEFAULT_FEATURE_FLAGS, organize: { ...DEFAULT_FEATURE_FLAGS.organize } },
	projectTracker: normalizeProjectTrackerSettings(DEFAULT_PROJECT_TRACKER_SETTINGS),
};

export class AgentDashboardSettingTab extends PluginSettingTab {
	private saveTimer: number | null = null;

	constructor(
		app: App,
		private readonly plugin: AgentDashboardPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
			.setDesc(`云端 LLM 的 API 密钥。密钥保存在插件目录的 secrets.json（权限 0600），不再写入 data.json。`)
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

		new Setting(containerEl)
			.setName('Embedding 模型')
			.setDesc('本地语义搜索用的向量模型，如 bge-m3，需已在 Ollama 中安装。')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_AGENT_CONFIG.ollamaEmbeddingModel)
					.setValue(this.plugin.settings.agent.ollamaEmbeddingModel)
					.onChange(async (value) => {
						this.plugin.settings.agent.ollamaEmbeddingModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('视觉模型名称')
			.setDesc('用于「图片理解」的云端视觉模型，如 step-1o-turbo-vision。留空则图片理解不可用。')
			.addText((text) =>
				text
					.setPlaceholder('step-1o-turbo-vision')
					.setValue(this.plugin.settings.agent.visionModel)
					.onChange(async (value) => {
						this.plugin.settings.agent.visionModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('测试模型连接')
			.setDesc('用当前设置（云端或本地）调用一次模型，验证 key 和地址是否可用。')
			.addButton((button) =>
				button
					.setButtonText('测试连接')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('测试中…');
						try {
							const model = new OpenAiModel(this.plugin.settings.agent);
							await model.generate('请只回复：连接成功', createRequestContext('user'));
							new Notice('模型连接成功');
						} catch (error) {
							const message = error instanceof Error ? error.message : '未知错误';
							new Notice(`模型连接失败：${message}`);
						} finally {
							button.setDisabled(false);
							button.setButtonText('测试连接');
						}
					}),
			);

		// ===== 项目追踪 =====
		new Setting(containerEl)
			.setName('项目追踪')
			.setHeading();

		new Setting(containerEl)
			.setName('GitHub Token')
			.setDesc('全局只读令牌，用于提高 API 频率限制。私有仓库可在下方按项目单独填写。保存在 secrets.json（权限 0600）。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('github_pat_...')
					.setValue(this.plugin.settings.projectTracker.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.projectTracker.githubToken = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('自动检查频率')
			.setDesc('项目追踪看板的自动检查间隔。关闭后仍可手动点击「刷新」。')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ '0': '关闭自动检查', '30': '每 30 分钟', '60': '每 60 分钟', '180': '每 3 小时', '1440': '每天' })
					.setValue(String(this.plugin.settings.projectTracker.autoCheckMinutes))
					.onChange(async (value) => {
						this.plugin.settings.projectTracker.autoCheckMinutes = Number(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('久未检查阈值')
			.setDesc('距上次检查超过该天数的项目会进入「久未检查」状态。')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ '3': '3 天', '7': '7 天', '14': '14 天', '30': '30 天' })
					.setValue(String(this.plugin.settings.projectTracker.staleAfterDays))
					.onChange(async (value) => {
						this.plugin.settings.projectTracker.staleAfterDays = Number(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('笔记沉淀目录')
			.setDesc('每项目变更日志与全局索引写入的 Vault 目录，默认 Projects。')
			.addText((text) =>
				text
					.setPlaceholder('Projects')
					.setValue(this.plugin.settings.projectTracker.noteFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectTracker.noteFolder = value.trim() || 'Projects';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('每日自动生成报告')
			.setDesc('每天 8 点后打开 Obsidian 时，自动生成一份中文项目动态报告。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.projectTracker.autoReport)
					.onChange(async (value) => {
						this.plugin.settings.projectTracker.autoReport = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('优先级分组')
			.setDesc('看板按分组顺序展示。可改名、改颜色、增删分组。')
			.setHeading();
		this.renderProjectGroups(containerEl);

		new Setting(containerEl)
			.setName('关注的项目')
			.setDesc('格式为 所有者/仓库名，如 HKUDS/DeepTutor。可设优先级、系列、启停与独立 Token。')
			.setHeading();
		this.renderProjectList(containerEl);

		let repoInput: TextComponent | null = null;
		new Setting(containerEl)
			.addText((text) => {
				repoInput = text;
				text.setPlaceholder('所有者/仓库名');
			})
			.addButton((button) =>
				button
					.setButtonText('添加')
					.onClick(async () => {
						const value = repoInput?.getValue().trim() ?? '';
						if (!value) return;
						try {
							parseRepoFullName(value);
						} catch (error) {
							new Notice(error instanceof Error ? error.message : '仓库格式不正确');
							return;
						}
						const projects = this.plugin.settings.projectTracker.projects;
						if (!projects.some((project) => project.repo === value)) {
							projects.push({ repo: value, groupId: this.firstGroupId(), enabled: true, series: '', token: '', useGlobalToken: true });
							await this.plugin.saveSettings();
						}
						this.display();
					}),
			);

		// ===== 知识库搜索 =====
		new Setting(containerEl)
			.setName('知识库搜索')
			.setHeading();

		new Setting(containerEl)
			.setName('语义搜索')
			.setDesc('开启后使用本地 Ollama 的 Embedding 模型做语义匹配；关闭或 Ollama 不可用时自动降级为关键词搜索。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.semantic_search)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.semantic_search = value;
						await this.plugin.saveSettings();
					}),
			);

		// ===== 记忆系统 =====
		new Setting(containerEl)
			.setName('记忆系统')
			.setHeading();

		new Setting(containerEl)
			.setName('启用记忆系统')
			.setDesc('总开关。开启后对话记忆（_memory/）才会写入和召回；默认关闭以保证旧行为不变。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.memory.enabled)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.memory.enabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('捕获对话（L0）')
			.setDesc('把每轮对话原样追加到 _memory/conversations/。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.memory.captureL0)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.memory.captureL0 = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('自动提炼（L1/L2/L3）')
			.setDesc('从对话中自动提炼原子记忆、场景与人格画像（Phase 3 将完整启用）。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.memory.autoExtract)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.memory.autoExtract = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('对话自动召回')
			.setDesc('发送消息前自动按 L3→L2→L1→L0 注入记忆上下文。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.memory.autoRecall)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.memory.autoRecall = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('召回深度')
			.setDesc('每轮预注入的记忆深度上限。')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ l1: 'L1 原子', l2: 'L2 场景', l3: 'L3 人格' })
					.setValue(this.plugin.settings.featureFlags.memory.recallDepth)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.memory.recallDepth = value as 'l1' | 'l2' | 'l3';
						await this.plugin.saveSettings();
					}),
			);

		// ===== 整理工作台 · 生成开关 =====
		new Setting(containerEl)
			.setName('整理工作台 · 生成开关')
			.setHeading();

		new Setting(containerEl)
			.setName('补全 frontmatter')
			.setDesc('为缺少 frontmatter 的笔记生成补全方案，生成整理计划后需逐条批准。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.organize.frontmatter)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.organize.frontmatter = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('补充标签')
			.setDesc('为缺少标签的笔记生成补充标签方案。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.organize.tags)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.organize.tags = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('补充反向链接')
			.setDesc('为 frontmatter 中设置了 related 字段的笔记生成补充链接方案（指向 related 笔记，自链接自动跳过）。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.organize.links)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.organize.links = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('格式规范化')
			.setDesc('为格式不规范的笔记生成规范化方案。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.organize.format)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.organize.format = value;
						await this.plugin.saveSettings();
					}),
			);

		// ===== 整理工作台 · 写入开关 =====
		new Setting(containerEl)
			.setName('整理工作台 · 写入开关')
			.setHeading();

		new Setting(containerEl)
			.setName('启用受控写入')
			.setDesc('批准后的方案可执行写入（apply）。保持关闭时只生成和审批方案，不修改任何笔记。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.featureFlags.new_write_pipeline)
					.onChange(async (value) => {
						this.plugin.settings.featureFlags.new_write_pipeline = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveSettings();
		}, 350);
	}

	private flushSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		void this.plugin.saveSettings();
	}

	private groupOptions(): Record<string, string> {
		return Object.fromEntries(this.plugin.settings.projectTracker.groups.map((group) => [group.id, group.name]));
	}

	private colorOptions(): Record<string, string> {
		return { red: '红', orange: '橙', blue: '蓝', purple: '紫', green: '绿', muted: '灰' };
	}

	private firstGroupId(): string {
		return this.plugin.settings.projectTracker.groups[0]?.id ?? 'p1';
	}

	private nextGroupOrder(): number {
		const orders = this.plugin.settings.projectTracker.groups.map((group) => group.order);
		return Math.max(0, ...orders) + 1;
	}

	private renderProjectGroups(containerEl: HTMLElement): void {
		const groups = this.plugin.settings.projectTracker.groups;
		groups.forEach((group: ProjectGroup, index: number) => {
			const setting = new Setting(containerEl);
			setting.setName('分组 ' + String(index + 1));
			setting.setDesc('名称与颜色；删除分组时其项目会回到第一个分组。');
			const row = setting.controlEl.createDiv({ cls: 'agent-dashboard-project-setting-row' });
			const nameInput = row.createEl('input', { attr: { type: 'text', 'aria-label': '分组名称' } });
			nameInput.value = group.name;
			nameInput.addEventListener('input', () => {
				group.name = nameInput.value.trim() || group.name;
				this.scheduleSave();
			});
			const color = row.createEl('select', { attr: { 'aria-label': '分组颜色' } });
			Object.entries(this.colorOptions()).forEach(([value, label]) => color.createEl('option', { attr: { value }, text: label }));
			color.value = group.dotColor;
			color.addEventListener('change', () => {
				group.dotColor = color.value as ProjectDotColor;
				void this.plugin.saveSettings();
			});
			const remove = row.createEl('button', { text: '删除', attr: { type: 'button' } });
			remove.addEventListener('click', () => {
				if (groups.length <= 1) {
					new Notice('至少保留一个优先级分组。');
					return;
				}
				const removedId = group.id;
				this.plugin.settings.projectTracker.groups.splice(index, 1);
				this.plugin.settings.projectTracker.projects.forEach((project) => {
					if (project.groupId === removedId) project.groupId = this.firstGroupId();
				});
				void (async () => {
					await this.plugin.saveSettings();
					this.display();
				})();
			});
		});

		let newNameInput: HTMLInputElement | null = null;
		let newColor: HTMLSelectElement | null = null;
		const addSetting = new Setting(containerEl);
		addSetting.setName('新增分组');
		addSetting.setDesc('新分组会追加到看板末尾。');
		const addRow = addSetting.controlEl.createDiv({ cls: 'agent-dashboard-project-setting-row' });
		newNameInput = addRow.createEl('input', { attr: { type: 'text', placeholder: '分组名称' } });
		newColor = addRow.createEl('select', { attr: { 'aria-label': '分组颜色' } });
		Object.entries(this.colorOptions()).forEach(([value, label]) => newColor?.createEl('option', { attr: { value }, text: label }));
		const addButton = addRow.createEl('button', { text: '添加', attr: { type: 'button' } });
		addButton.addEventListener('click', () => {
			const name = newNameInput?.value.trim() || '新分组';
			this.plugin.settings.projectTracker.groups.push({
				id: 'g' + Date.now(),
				name,
				dotColor: (newColor?.value as ProjectDotColor) ?? 'muted',
				order: this.nextGroupOrder(),
			});
			void (async () => {
				await this.plugin.saveSettings();
				this.display();
			})();
		});
	}

	private renderProjectList(containerEl: HTMLElement): void {
		const projects = this.plugin.settings.projectTracker.projects;
		const groups = this.plugin.settings.projectTracker.groups;
		projects.forEach((project: TrackedProject, index: number) => {
			const setting = new Setting(containerEl);
			setting.setName(project.repo);
			setting.setDesc('优先级分组、系列标签、启停与独立 Token。');
			const row = setting.controlEl.createDiv({ cls: 'agent-dashboard-project-setting-row agent-dashboard-project-setting-row--wrap' });

			const group = row.createEl('select', { attr: { 'aria-label': '优先级分组' } });
			groups.forEach((candidate) => group.createEl('option', { attr: { value: candidate.id }, text: candidate.name }));
			group.value = project.groupId;
			group.addEventListener('change', () => {
				project.groupId = group.value;
				void this.plugin.saveSettings();
			});

			const enabled = row.createEl('label', { cls: 'agent-dashboard-inline-toggle' });
			const checkbox = enabled.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = project.enabled;
			enabled.createSpan({ text: '启用' });
			checkbox.addEventListener('change', () => {
				project.enabled = checkbox.checked;
				void this.plugin.saveSettings();
			});

			const series = row.createEl('input', { attr: { type: 'text', 'aria-label': '系列', placeholder: '系列' } });
			series.value = project.series;
			series.addEventListener('input', () => {
				project.series = series.value.trim();
				this.scheduleSave();
			});

			const token = row.createEl('input', { attr: { type: 'password', 'aria-label': '独立 Token', placeholder: '独立 Token' } });
			token.value = project.token ?? '';
			token.addEventListener('input', () => {
				project.token = token.value.trim();
				this.scheduleSave();
			});
			token.addEventListener('blur', () => {
				this.flushSave();
			});

			const noGlobal = row.createEl('label', { cls: 'agent-dashboard-inline-toggle' });
			const noGlobalCheckbox = noGlobal.createEl('input', { attr: { type: 'checkbox' } });
			noGlobalCheckbox.checked = project.useGlobalToken === false;
			noGlobal.createSpan({ text: '忽略全局 Token' });
			noGlobalCheckbox.addEventListener('change', () => {
				project.useGlobalToken = !noGlobalCheckbox.checked;
				void this.plugin.saveSettings();
			});

			const remove = row.createEl('button', { text: '删除', attr: { type: 'button' } });
			remove.addEventListener('click', () => {
				projects.splice(index, 1);
				void (async () => {
					await this.plugin.saveSettings();
					this.display();
				})();
			});
		});
	}
}
