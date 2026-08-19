import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import type AgentDashboardPlugin from '../main';
import type { ProjectDotColor } from '../data/dashboardTypes';
import { parseRepoFullName } from '../application/githubTracker';

const COLOR_OPTIONS: Record<ProjectDotColor, string> = {
	red: '红',
	orange: '橙',
	blue: '蓝',
	purple: '紫',
	green: '绿',
	muted: '灰',
};

export class ProjectTrackerSettingsModal extends Modal {
	constructor(app: App, private readonly plugin: AgentDashboardPlugin) {
		super(app);
	}

	onOpen(): void {
		this.rerender();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private rerender(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('agent-dashboard-project-settings-modal');
		contentEl.createEl('h2', { text: 'GitHub 项目追踪设置' });

		this.renderAiSettings(contentEl);
		this.renderTrackerSettings(contentEl);
		this.renderGroups(contentEl);
		this.renderProjects(contentEl);
		this.renderFooter(contentEl);
	}

	private renderAiSettings(parent: HTMLElement): void {
		new Setting(parent).setName('AI 摘要模型').setHeading();
		new Setting(parent)
			.setName('使用本地模型')
			.setDesc('开启后使用本地 Ollama；关闭后使用云端 OpenAI 兼容 API。')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.agent.useLocal).onChange((value) => {
				this.plugin.settings.agent.useLocal = value;
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('云端 API 地址')
			.setDesc('OpenAI 兼容的 API base URL。')
			.addText((text) => text.setPlaceholder('https://api.stepfun.com/v1').setValue(this.plugin.settings.agent.baseUrl).onChange((value) => {
				this.plugin.settings.agent.baseUrl = value.trim();
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('云端 API Key')
			.setDesc('保存在 secrets.json，不会写入 data.json。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('sk-...').setValue(this.plugin.settings.agent.apiKey).onChange((value) => {
					this.plugin.settings.agent.apiKey = value.trim();
					void this.plugin.saveSettings();
				});
			});
		new Setting(parent)
			.setName('云端模型名称')
			.addText((text) => text.setPlaceholder('step-1-flash').setValue(this.plugin.settings.agent.model).onChange((value) => {
				this.plugin.settings.agent.model = value.trim();
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('Ollama 地址')
			.addText((text) => text.setPlaceholder('http://localhost:11434').setValue(this.plugin.settings.agent.ollamaUrl).onChange((value) => {
				this.plugin.settings.agent.ollamaUrl = value.trim();
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('Ollama 模型')
			.addText((text) => text.setPlaceholder('qwen3:8b').setValue(this.plugin.settings.agent.ollamaModel).onChange((value) => {
				this.plugin.settings.agent.ollamaModel = value.trim();
				void this.plugin.saveSettings();
			}));
	}

	private renderTrackerSettings(parent: HTMLElement): void {
		new Setting(parent).setName('追踪与检查').setHeading();
		new Setting(parent)
			.setName('GitHub Token')
			.setDesc('全局只读令牌；私有仓库可在下方按项目单独填写。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('github_pat_...').setValue(this.plugin.settings.projectTracker.githubToken).onChange((value) => {
					this.plugin.settings.projectTracker.githubToken = value.trim();
					void this.plugin.saveSettings();
				});
			});
		new Setting(parent)
			.setName('自动检查频率')
			.addDropdown((dropdown) => dropdown.addOptions({ '0': '关闭自动检查', '30': '每 30 分钟', '60': '每 60 分钟', '180': '每 3 小时', '1440': '每天' }).setValue(String(this.plugin.settings.projectTracker.autoCheckMinutes)).onChange((value) => {
				this.plugin.settings.projectTracker.autoCheckMinutes = Number(value);
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('久未检查阈值')
			.addDropdown((dropdown) => dropdown.addOptions({ '3': '3 天', '7': '7 天', '14': '14 天', '30': '30 天' }).setValue(String(this.plugin.settings.projectTracker.staleAfterDays)).onChange((value) => {
				this.plugin.settings.projectTracker.staleAfterDays = Number(value);
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('笔记沉淀目录')
			.addText((text) => text.setPlaceholder('Projects').setValue(this.plugin.settings.projectTracker.noteFolder).onChange((value) => {
				this.plugin.settings.projectTracker.noteFolder = value.trim() || 'Projects';
				void this.plugin.saveSettings();
			}));
		new Setting(parent)
			.setName('每日自动生成报告')
			.addToggle((toggle) => toggle.setValue(this.plugin.settings.projectTracker.autoReport).onChange((value) => {
				this.plugin.settings.projectTracker.autoReport = value;
				void this.plugin.saveSettings();
			}));
	}

	private renderGroups(parent: HTMLElement): void {
		new Setting(parent).setName('优先级分组').setHeading();
		const groups = this.plugin.settings.projectTracker.groups;
		groups.forEach((group, index) => {
			const setting = new Setting(parent);
			setting.setName('分组 ' + String(index + 1));
			const row = setting.controlEl.createDiv({ cls: 'agent-dashboard-project-setting-row' });
			const nameInput = row.createEl('input', { attr: { type: 'text', 'aria-label': '分组名称' } });
			nameInput.value = group.name;
			nameInput.addEventListener('input', () => {
				group.name = nameInput.value.trim() || group.name;
				void this.plugin.saveSettings();
			});
			const color = row.createEl('select', { attr: { 'aria-label': '分组颜色' } });
			Object.entries(COLOR_OPTIONS).forEach(([value, label]) => color.createEl('option', { attr: { value }, text: label }));
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
				groups.splice(index, 1);
				this.plugin.settings.projectTracker.projects.forEach((project) => {
					if (project.groupId === removedId) project.groupId = this.firstGroupId();
				});
				void (async () => {
					await this.plugin.saveSettings();
					this.rerender();
				})();
			});
		});

		let newNameInput: HTMLInputElement | null = null;
		let newColor: HTMLSelectElement | null = null;
		const addSetting = new Setting(parent);
		addSetting.setName('新增分组');
		const addRow = addSetting.controlEl.createDiv({ cls: 'agent-dashboard-project-setting-row' });
		newNameInput = addRow.createEl('input', { attr: { type: 'text', placeholder: '分组名称' } });
		newColor = addRow.createEl('select', { attr: { 'aria-label': '分组颜色' } });
		Object.entries(COLOR_OPTIONS).forEach(([value, label]) => newColor?.createEl('option', { attr: { value }, text: label }));
		const addButton = addRow.createEl('button', { text: '添加', attr: { type: 'button' } });
		addButton.addEventListener('click', () => {
			this.plugin.settings.projectTracker.groups.push({
				id: 'g' + Date.now(),
				name: newNameInput?.value.trim() || '新分组',
				dotColor: (newColor?.value as ProjectDotColor) ?? 'muted',
				order: this.nextGroupOrder(),
			});
			void (async () => {
				await this.plugin.saveSettings();
				this.rerender();
			})();
		});
	}

	private renderProjects(parent: HTMLElement): void {
		new Setting(parent).setName('关注的项目').setHeading();
		const projects = this.plugin.settings.projectTracker.projects;
		const groups = this.plugin.settings.projectTracker.groups;
		projects.forEach((project, index) => {
			const setting = new Setting(parent);
			setting.setName(project.repo);
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
				void this.plugin.saveSettings();
			});

			const token = row.createEl('input', { attr: { type: 'password', 'aria-label': '独立 Token', placeholder: '独立 Token' } });
			token.value = project.token ?? '';
			token.addEventListener('input', () => {
				project.token = token.value.trim();
				void this.plugin.saveSettings();
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
					this.rerender();
				})();
			});
		});

		let repoInput: TextComponent | null = null;
		new Setting(parent)
			.addText((text) => {
				repoInput = text;
				text.setPlaceholder('所有者/仓库名');
			})
			.addButton((button) => button.setButtonText('添加').onClick(() => {
				const value = repoInput?.getValue().trim() ?? '';
				if (!value) return;
				try {
					parseRepoFullName(value);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : '仓库格式不正确');
					return;
				}
				if (!projects.some((project) => project.repo === value)) {
					projects.push({ repo: value, groupId: this.firstGroupId(), enabled: true, series: '', token: '', useGlobalToken: true });
					void (async () => {
						await this.plugin.saveSettings();
						this.rerender();
					})();
				} else {
					this.rerender();
				}
			}));
	}

	private renderFooter(parent: HTMLElement): void {
		new Setting(parent)
			.addButton((button) => button.setButtonText('完成').setCta().onClick(() => this.close()));
	}

	private firstGroupId(): string {
		return this.plugin.settings.projectTracker.groups[0]?.id ?? 'p1';
	}

	private nextGroupOrder(): number {
		return Math.max(0, ...this.plugin.settings.projectTracker.groups.map((group) => group.order)) + 1;
	}
}
