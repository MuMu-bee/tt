import { Notice, normalizePath } from 'obsidian';
import { createRequestContext, type RequestContext } from '../application/requestContext';
import { WORKBENCH_DIRS, type RepoSnapshot } from '../data/dashboardTypes';
import type { ProjectTracker } from '../services/projectTracker';
import type { ProjectReportService } from '../services/projectReportService';
import type { WorkbenchWriteService } from '../services/workbenchWriteService';
import { showActionError } from '../services/agentActionService';

export interface ProjectPageHost {
	projectTracker: ProjectTracker;
	projectReport: ProjectReportService;
	workbenchWrite: WorkbenchWriteService;
	projectListEl: HTMLElement | null;
	projectTrackerBusy: boolean;
	isClosed(): boolean;
	registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void;
	setFeedback(message: string): void;
	openNote(path: string): Promise<void>;
	formatDate(date: Date): string;
	openExternal(url: string): void;
}

export function renderProjectTracker(host: ProjectPageHost, parent: HTMLElement): void {
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
	host.registerDomEvent(refresh, 'click', () => {
		refresh.disabled = true;
		void loadProjectSnapshots(host, true).finally(() => { refresh.disabled = false; });
	});

	const list = card.createDiv({ cls: 'agent-dashboard-feed-list' });
	host.projectListEl = list;
	void loadProjectSnapshots(host, false);
}

async function loadProjectSnapshots(host: ProjectPageHost, force: boolean): Promise<void> {
	const list = host.projectListEl;
	if (!list || host.isClosed() || host.projectTrackerBusy) {
		return;
	}
	host.projectTrackerBusy = true;
	list.empty();
	try {
		const repos = host.projectTracker.getRepos();
		if (repos.length === 0) {
			list.createDiv({ cls: 'agent-dashboard-empty-state', text: '还没有关注的项目，请在设置中添加。' });
			return;
		}
		const snapshots = await Promise.all(repos.map((repo) => host.projectTracker.refresh(repo, force)));
		if (host.isClosed() || host.projectListEl !== list) {
			return;
		}
		list.empty();
		snapshots.forEach((snapshot) => renderProjectSnapshot(host, list, snapshot));
	} catch {
		list.empty();
		list.createDiv({ cls: 'agent-dashboard-empty-state', text: '加载项目动态失败，请稍后重试。' });
	} finally {
		host.projectTrackerBusy = false;
	}
}

function renderProjectSnapshot(host: ProjectPageHost, parent: HTMLElement, snapshot: RepoSnapshot): void {
	const card = parent.createEl('article', { cls: 'agent-dashboard-project-card' });
	const top = card.createDiv({ cls: 'agent-dashboard-project-top' });
	top.createEl('strong', { cls: 'agent-dashboard-project-name', text: snapshot.fullName });
	const meta: string[] = [];
	if (snapshot.stars > 0) meta.push('★ ' + snapshot.stars);
	if (snapshot.releases[0]) meta.push('最新版本 ' + snapshot.releases[0].tag);
	if (snapshot.error) meta.push(snapshot.error);
	top.createSpan({ cls: 'agent-dashboard-project-meta', text: meta.join(' · ') || '暂无数据' });

	const openButton = card.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
	openButton.createSpan({ text: '打开 GitHub' });
	host.registerDomEvent(openButton, 'click', () => {
		host.openExternal('https://github.com/' + snapshot.fullName);
	});

	const summaryEl = card.createDiv({ cls: 'agent-dashboard-project-summary' });
	summaryEl.createSpan({ cls: 'agent-dashboard-project-label', text: '🤖 AI 中文摘要（更新了什么）' });
	const summaryBody = summaryEl.createDiv({ cls: 'agent-dashboard-project-summary-body', text: '正在生成摘要…' });
	void loadProjectSummary(host, snapshot, summaryBody);

	const reportButton = card.createEl('button', { cls: 'agent-dashboard-subtle-button', attr: { type: 'button' } });
	reportButton.createSpan({ text: '保存完整报告' });
	host.registerDomEvent(reportButton, 'click', () => {
		reportButton.disabled = true;
		reportButton.setText('生成中…');
		void generateProjectReport(host, createRequestContext('user'))
			.then((path) => {
				new Notice('报告已生成：' + path);
				void host.openNote(path);
			})
			.catch((error: unknown) => {
				showActionError(error);
			})
			.finally(() => {
				reportButton.disabled = false;
				reportButton.setText('保存完整报告');
			});
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
			host.registerDomEvent(row, 'click', () => { host.openExternal(release.url); });
		});
	} else {
		card.createDiv({ cls: 'agent-dashboard-empty-state agent-dashboard-project-empty', text: '暂无版本发布记录' });
	}

	if (snapshot.commits.length > 0) {
		const section = card.createDiv({ cls: 'agent-dashboard-project-section' });
		section.createSpan({ cls: 'agent-dashboard-project-label', text: '最近提交' });
		snapshot.commits.slice(0, 8).forEach((commit) => {
			const row = section.createEl('button', { cls: 'agent-dashboard-project-row', attr: { type: 'button' } });
			row.createSpan({ cls: 'agent-dashboard-project-tag', text: commit.sha });
			const desc = row.createSpan({ cls: 'agent-dashboard-project-desc' });
			desc.setText(commit.message + (commit.date ? ' · ' + host.formatDate(new Date(commit.date)) : ''));
			host.registerDomEvent(row, 'click', () => { host.openExternal(commit.url); });
		});
	} else if (!snapshot.error) {
		card.createDiv({ cls: 'agent-dashboard-empty-state agent-dashboard-project-empty', text: '暂无提交记录' });
	}

	if (snapshot.issues.length > 0) {
		const section = card.createDiv({ cls: 'agent-dashboard-project-section' });
		section.createSpan({ cls: 'agent-dashboard-project-label', text: '讨论动态' });
		snapshot.issues.slice(0, 8).forEach((issue) => {
			const row = section.createEl('button', { cls: 'agent-dashboard-project-row', attr: { type: 'button' } });
			row.createSpan({ cls: 'agent-dashboard-project-tag ' + (issue.state === 'open' ? 'is-open' : 'is-closed'), text: issue.kind === 'pr' ? 'PR' : 'Issue' });
			const desc = row.createSpan({ cls: 'agent-dashboard-project-desc' });
			desc.setText(issue.title);
			host.registerDomEvent(row, 'click', () => { host.openExternal(issue.url); });
		});
	} else if (!snapshot.error) {
		card.createDiv({ cls: 'agent-dashboard-empty-state agent-dashboard-project-empty', text: '暂无讨论动态' });
	}
}

export async function generateProjectReport(host: ProjectPageHost, context: RequestContext): Promise<string> {
	const repos = host.projectTracker.getRepos();
	const snapshots = await Promise.all(repos.map((repo) => host.projectTracker.refresh(repo, true)));
	const parts: string[] = [];
	for (const snapshot of snapshots) {
		const result = await host.projectReport.generateReport(snapshot, context);
		if (result.report) {
			parts.push('# ' + snapshot.fullName + '\n\n' + result.report);
		} else if (result.error) {
			parts.push('# ' + snapshot.fullName + '\n\n> ' + result.error);
		}
	}
	if (parts.length === 0) {
		throw new Error('没有可生成的报告内容');
	}
	const date = new Date();
	const stamp = [
		date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'),
		String(date.getHours()).padStart(2, '0') + '-' + String(date.getMinutes()).padStart(2, '0') + '-' + String(date.getSeconds()).padStart(2, '0'),
	].join('-');
	const fileName = '项目动态-' + stamp + '.md';
	const path = normalizePath(WORKBENCH_DIRS.reports + '/' + fileName);
	const result = await host.workbenchWrite.writeGenerated({
		path,
		content: parts.join('\n\n---\n\n') + '\n',
		kind: 'project',
		context,
	});
	if (result.status === 'failed') {
		throw new Error(result.error_code ?? '项目报告写入失败');
	}
	return result.path;
}

async function loadProjectSummary(host: ProjectPageHost, snapshot: RepoSnapshot, el: HTMLElement): Promise<void> {
	try {
		const cached = await host.projectTracker.readSummary(snapshot.fullName);
		if (cached) {
			el.setText(cached);
			return;
		}
		const result = await host.projectReport.generateReport(snapshot, createRequestContext('background-task'));
		if (host.isClosed()) return;
		if (result.report) {
			const text = result.report
				.replace(/[#*>`-]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			await host.projectTracker.writeSummary(snapshot.fullName, text);
			el.setText(text);
		} else if (result.error) {
			el.setText('摘要生成失败：' + result.error);
		} else {
			el.setText('该项目最近没有可总结的动态。');
		}
	} catch {
		if (!host.isClosed()) {
			el.setText('摘要生成失败：模型未配置或网络异常（请在「设置 → 墨忆台 · 模型设置」中配置）。');
		}
	}
}
