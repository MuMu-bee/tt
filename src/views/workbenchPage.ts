import { setIcon } from 'obsidian';
import { createRequestContext } from '../application/requestContext';
import type { AuditRecord, Proposal } from '../application/contracts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts';
import type { ProposalService } from '../services/proposalService';
import type { ApprovalService } from '../services/approvalService';
import type { ProposalApplyService } from '../services/proposalApplyService';
import type { OrganizeService } from '../services/organizeService';
import type { AuditQueryPort } from './AgentDashboardView';
import {
	changeKindLabel,
	persistenceBanner,
	proposalActions,
	proposalStatusLabel,
	zoneLabel,
} from './proposalViewState';

export interface WorkbenchPageHost {
	proposals: ProposalService;
	approvals: ApprovalService;
	applyService: ProposalApplyService;
	organize: OrganizeService;
	audit: AuditQueryPort;
	persistence: PersistenceRuntimeStatus;
	workbenchStatusEl: HTMLElement | null;
	persistenceBannerEl: HTMLElement | null;
	workbenchErrorEl: HTMLElement | null;
	proposalListEl: HTMLElement | null;
	auditListEl: HTMLElement | null;
	workbenchToken: number;
	organizeBusy: boolean;
	isClosed(): boolean;
	registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void;
	getErrorMessage: (error: unknown) => string;
	lifecycleStatusText(): string;
	formatDateTime(value: string): string;
	openSettings(): void;
}

export function renderWorkbench(host: WorkbenchPageHost, parent: HTMLElement): void {
	const card = parent.createEl('section', {
		cls: 'agent-dashboard-surface agent-dashboard-workbench-card',
		attr: { id: 'agent-dashboard-workbench', 'aria-labelledby': 'agent-dashboard-workbench-title' },
	});
	const header = card.createDiv({ cls: 'agent-dashboard-surface-header compact' });
	const heading = header.createDiv();
	heading.createSpan({ cls: 'agent-dashboard-eyebrow', text: '墨忆台 · 核心功能' });
	heading.createEl('h2', { attr: { id: 'agent-dashboard-workbench-title' }, text: '整理工作台' });
	host.workbenchStatusEl = heading.createEl('p', { text: host.lifecycleStatusText() });

	const generateButton = header.createEl('button', {
		cls: 'agent-dashboard-subtle-button',
		attr: { type: 'button', 'aria-label': '生成整理计划' },
	});
	generateButton.createSpan({ text: '生成整理计划' });
	host.registerDomEvent(generateButton, 'click', () => {
		void handleGeneratePlan(host, generateButton);
	});

	host.persistenceBannerEl = card.createDiv({ cls: 'agent-dashboard-persistence-banner' });
	renderPersistenceBanner(host);

	const organize = host.organize;
	const isAnyEnabled = organize && typeof organize === 'object' && 'plan' in organize;
	if (!isAnyEnabled) {
		const guideEl = card.createDiv({ cls: 'agent-dashboard-organize-guide' });
		guideEl.createSpan({ text: '💡 提示：生成整理方案前，请先在' });
		const settingsLink = guideEl.createEl('button', { cls: 'agent-dashboard-organize-guide-link', attr: { type: 'button' } });
		settingsLink.createSpan({ text: '设置 → 整理工作台 · 生成开关' });
		guideEl.createSpan({ text: '中开启至少一个规则（如 frontmatter、标签）。' });
		host.registerDomEvent(settingsLink, 'click', () => {
			host.openSettings();
		});
	}

	host.workbenchErrorEl = card.createDiv({
		cls: 'agent-dashboard-workbench-error',
		attr: { role: 'alert', 'aria-live': 'polite' },
	});
	host.workbenchErrorEl.hidden = true;

	const listHeading = card.createDiv({ cls: 'agent-dashboard-workbench-subheading' });
	listHeading.createEl('h3', { text: '整理方案' });
	host.proposalListEl = card.createDiv({ cls: 'agent-dashboard-proposal-list' });

	const auditDetails = card.createEl('details', { cls: 'agent-dashboard-audit-details' });
	auditDetails.createEl('summary', { text: '最近审计记录' });
	host.auditListEl = auditDetails.createDiv({ cls: 'agent-dashboard-audit-list' });

	void refreshWorkbench(host);
}

function renderPersistenceBanner(host: WorkbenchPageHost): void {
	const bannerEl = host.persistenceBannerEl;
	if (!bannerEl) {
		return;
	}
	bannerEl.empty();
	const state = persistenceBanner(host.persistence);
	bannerEl.addClass('is-' + state.tone);
	const title = bannerEl.createDiv({ cls: 'agent-dashboard-persistence-title' });
	title.setText(state.title);
	if (state.tone === 'danger') {
		const stores = bannerEl.createDiv({ cls: 'agent-dashboard-persistence-stores' });
		(['proposals', 'approvals', 'audit'] as const).forEach((key) => {
			const report = host.persistence.stores[key];
			const row = stores.createDiv({ cls: 'agent-dashboard-persistence-store' });
			row.createSpan({ cls: 'agent-dashboard-persistence-store-name', text: key });
			const parts: string[] = ['跳过 ' + report.skipped_rows + ' 行'];
			if (report.error) {
				parts.push(report.error);
			}
			row.createSpan({ cls: 'agent-dashboard-persistence-store-detail', text: parts.join(' · ') });
		});
	}
}

async function handleGeneratePlan(host: WorkbenchPageHost, button: HTMLButtonElement): Promise<void> {
	if (host.organizeBusy || button.disabled) {
		return;
	}
	host.organizeBusy = true;
	button.disabled = true;
	setWorkbenchStatus(host, '正在生成整理计划…');
	setWorkbenchError(host, '');
	try {
		const context = createRequestContext('user');
		const plan = await host.organize.plan({ kind: 'global' }, context);
		const created = await host.proposals.createFromPlan(plan, context);
		setWorkbenchStatus(host, '已生成 ' + created.length + ' 条整理方案');
		if (created.length === 0) {
			setWorkbenchError(host, '没有发现需要整理的笔记：请在设置中开启更多整理开关（如「补充标签」），或新建一篇没有 frontmatter/标签的笔记后再试。');
		}
		await refreshWorkbench(host);
	} catch (error) {
		setWorkbenchStatus(host, '生成整理计划失败');
		setWorkbenchError(host, host.getErrorMessage(error));
	} finally {
		host.organizeBusy = false;
		button.disabled = false;
	}
}

async function refreshWorkbench(host: WorkbenchPageHost): Promise<void> {
	if (host.isClosed()) {
		return;
	}
	const token = host.workbenchToken + 1;
	host.workbenchToken = token;
	try {
		const context = createRequestContext('user');
		const proposals = await host.proposals.list({}, context);
		const auditRecords = await host.audit.listRecent(20, context);
		if (host.isClosed() || token !== host.workbenchToken) {
			return;
		}
		renderPersistenceBanner(host);
		renderProposalList(host, proposals);
		renderAuditList(host, auditRecords);
	} catch (error) {
		if (host.isClosed() || token !== host.workbenchToken) {
			return;
		}
		setWorkbenchError(host, host.getErrorMessage(error));
	}
}

function renderProposalList(host: WorkbenchPageHost, proposals: Proposal[]): void {
	const list = host.proposalListEl;
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
		header.createSpan({ cls: 'agent-dashboard-proposal-group-icon', text: groupLabels[status]?.icon ?? '•', attr: { style: 'color:' + (groupLabels[status]?.color ?? 'var(--text-muted)') + ';' } });
		header.createSpan({ cls: 'agent-dashboard-proposal-group-label', text: groupLabels[status]?.label ?? status });
		header.createSpan({ cls: 'agent-dashboard-proposal-group-count', text: String(items.length) });
		items.forEach((proposal) => renderProposalItem(host, section, proposal));
	});
}

function renderProposalItem(host: WorkbenchPageHost, parent: HTMLElement, proposal: Proposal): void {
	const actions = proposalActions(proposal, host.persistence);
	const item = parent.createEl('article', {
		cls: 'agent-dashboard-proposal-item',
		attr: { 'data-status': proposal.status },
	});
	const topline = item.createDiv({ cls: 'agent-dashboard-proposal-topline' });

	const toggle = topline.createEl('button', {
		cls: 'agent-dashboard-proposal-toggle',
		attr: { type: 'button', 'aria-expanded': 'false', 'aria-label': '展开预览：' + proposal.target_path },
	});
	const copy = toggle.createDiv({ cls: 'agent-dashboard-proposal-copy' });
	copy.createEl('strong', { cls: 'agent-dashboard-proposal-path', text: proposal.target_path });
	copy.createSpan({
		cls: 'agent-dashboard-proposal-meta',
		text: zoneLabel(proposal.target_zone) + ' · ' + changeKindLabel(proposal.change_kind) + ' · ' + proposal.base_hash.slice(0, 8),
	});
	toggle.createSpan({ cls: 'agent-dashboard-status-badge', text: proposalStatusLabel(proposal.status) });
	const chevron = toggle.createSpan({ cls: 'agent-dashboard-proposal-chevron', attr: { 'aria-hidden': 'true' } });
	setIcon(chevron, 'chevron-down');

	const actionBar = topline.createDiv({ cls: 'agent-dashboard-proposal-actions' });
	if (proposal.status === 'pending') {
		renderProposalButton(host, actionBar, proposal, 'approve', actions.canApprove, actions.disabledReason);
		renderProposalButton(host, actionBar, proposal, 'reject', actions.canReject, actions.disabledReason);
	} else if (proposal.status === 'approved') {
		renderProposalButton(host, actionBar, proposal, 'apply', actions.canApply, actions.disabledReason);
	}
	if (actions.disabledReason) {
		actionBar.createSpan({ cls: 'agent-dashboard-proposal-disabled-reason', text: actions.disabledReason });
	}

	const preview = item.createDiv({ cls: 'agent-dashboard-proposal-preview' });
	preview.hidden = true;
	renderPreviewBlock(preview, '修改前', proposal.before);
	renderPreviewBlock(preview, '修改后', proposal.after);
	renderPreviewBlock(preview, '差异', proposal.diff);

	host.registerDomEvent(toggle, 'click', () => {
		const expanded = preview.hidden;
		preview.hidden = !expanded;
		toggle.setAttr('aria-expanded', String(expanded));
		toggle.classList.toggle('is-expanded', expanded);
	});
}

function renderProposalButton(
	host: WorkbenchPageHost,
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
		cls: 'agent-dashboard-proposal-button ' + kind,
		attr: { type: 'button' },
	});
	button.createSpan({ text: labels[kind] });
	button.disabled = !enabled;
	if (!enabled && disabledReason) {
		button.setAttr('title', disabledReason);
	}
	host.registerDomEvent(button, 'click', () => {
		if (kind === 'approve' || kind === 'reject') {
			void handleProposalDecision(host, proposal, kind, button);
		} else {
			void handleProposalApply(host, proposal, button);
		}
	});
}

function renderPreviewBlock(parent: HTMLElement, label: string, content: string): void {
	const block = parent.createDiv({ cls: 'agent-dashboard-proposal-preview-block' });
	block.createEl('strong', { text: label });
	block.createEl('pre', { text: content || '（空）' });
}

async function handleProposalDecision(
	host: WorkbenchPageHost,
	proposal: Proposal,
	decision: 'approve' | 'reject',
	button: HTMLButtonElement,
): Promise<void> {
	if (button.disabled) {
		return;
	}
	button.disabled = true;
	const verb = decision === 'approve' ? '批准' : '拒绝';
	setWorkbenchStatus(host, '正在' + verb + ' ' + proposal.target_path + '…');
	setWorkbenchError(host, '');
	try {
		await host.approvals.decide(proposal.proposal_id, decision, createRequestContext('user'));
		setWorkbenchStatus(host, '已' + verb);
		await refreshWorkbench(host);
	} catch (error) {
		setWorkbenchStatus(host, verb + '失败');
		setWorkbenchError(host, host.getErrorMessage(error));
	}
}

async function handleProposalApply(host: WorkbenchPageHost, proposal: Proposal, button: HTMLButtonElement): Promise<void> {
	if (button.disabled) {
		return;
	}
	button.disabled = true;
	setWorkbenchStatus(host, '正在执行写入 ' + proposal.target_path + '…');
	setWorkbenchError(host, '');
	try {
		const result = await host.applyService.apply(proposal.proposal_id, createRequestContext('user'));
		if (result.status === 'applied') {
			setWorkbenchStatus(host, '写入完成：' + proposal.target_path);
		} else {
			const code = result.error_code ? '（' + result.error_code + '）' : '';
			setWorkbenchStatus(host, '执行写入未完成');
			setWorkbenchError(host, '写入未完成：' + result.status + code);
		}
		await refreshWorkbench(host);
	} catch (error) {
		setWorkbenchStatus(host, '执行写入失败');
		setWorkbenchError(host, host.getErrorMessage(error));
	}
}

function renderAuditList(host: WorkbenchPageHost, records: AuditRecord[]): void {
	const list = host.auditListEl;
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
			cls: 'agent-dashboard-audit-result' + (okResult ? ' ok' : ' warn'),
			text: record.result,
		});
		row.createSpan({ cls: 'agent-dashboard-audit-time', text: host.formatDateTime(record.created_at) });
	});
}

function setWorkbenchStatus(host: WorkbenchPageHost, message: string): void {
	host.workbenchStatusEl?.setText(message);
	if (message.includes('正在') && host.persistenceBannerEl) {
		host.persistenceBannerEl.addClass('agent-dashboard-persistence-busy');
	} else if (host.persistenceBannerEl) {
		host.persistenceBannerEl.removeClass('agent-dashboard-persistence-busy');
	}
}

function setWorkbenchError(host: WorkbenchPageHost, message: string): void {
	const errorEl = host.workbenchErrorEl;
	if (!errorEl) {
		return;
	}
	errorEl.empty();
	if (message) {
		errorEl.createSpan({ text: message });
	}
	errorEl.hidden = !message;
}
