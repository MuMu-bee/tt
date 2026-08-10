/**
 * Pure view-state helpers for the 整理工作台 (Memory Workbench) section.
 *
 * This module MUST stay free of any obsidian import so it can run under
 * `node --experimental-strip-types` in the test suite. All functions here are
 * deterministic and operate only on plain data.
 */
import type { ChangeKind, Proposal, ProposalStatus, VaultZone } from '../application/contracts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts';

/** Chinese labels for every proposal status. */
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
	pending: '待审批',
	approved: '已批准',
	rejected: '已拒绝',
	applied: '已应用',
	conflict: '冲突',
	failed: '失败',
	expired: '过期',
	'pending-compensation': '待补偿',
};

/** Returns the Chinese label for a proposal status. */
export function proposalStatusLabel(status: ProposalStatus): string {
	return PROPOSAL_STATUS_LABELS[status] ?? status;
}

/** Chinese labels for the change kinds produced by the organizer. */
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
	'frontmatter-add': '补全 frontmatter',
	'tag-add': '补充标签',
	'bidirectional-link-add': '补充反向链接',
	'format-normalize': '格式规范化',
};

/** Returns the Chinese label for a change kind. */
export function changeKindLabel(kind: ChangeKind): string {
	return CHANGE_KIND_LABELS[kind] ?? kind;
}

/** Chinese labels for vault zones. */
export const ZONE_LABELS: Record<VaultZone, string> = {
	normal: '常规',
	fiction: '虚构',
	unknown: '未分类',
};

/** Returns the Chinese label for a vault zone. */
export function zoneLabel(zone: VaultZone): string {
	return ZONE_LABELS[zone] ?? zone;
}

/** Which proposal actions are currently available to the user. */
export interface ProposalActionState {
	canApprove: boolean;
	canReject: boolean;
	canApply: boolean;
	/** Present when persistence blocks every write-related action. */
	disabledReason?: string;
}

/**
 * Computes which actions are available for a proposal given the current
 * persistence status. When persistence is degraded or not yet restored, every
 * write-related action (approve/reject/apply) is disabled with a reason;
 * read-only actions are never affected.
 */
export function proposalActions(
	proposal: Proposal,
	persistence: PersistenceRuntimeStatus,
): ProposalActionState {
	if (persistence.degraded) {
		return {
			canApprove: false,
			canReject: false,
			canApply: false,
			disabledReason: '持久化降级，审批与写入已阻断',
		};
	}
	if (!persistence.restored) {
		return {
			canApprove: false,
			canReject: false,
			canApply: false,
			disabledReason: '持久化尚未恢复，审批与写入已阻断',
		};
	}

	switch (proposal.status) {
		case 'pending':
			return { canApprove: true, canReject: true, canApply: false };
		case 'approved':
			return { canApprove: false, canReject: false, canApply: true };
		default:
			// rejected / applied / conflict / failed / expired are read-only.
			return { canApprove: false, canReject: false, canApply: false };
	}
}

/** Visual tone plus copy for the always-visible persistence banner. */
export interface PersistenceBannerState {
	tone: 'ok' | 'danger' | 'pending';
	title: string;
	/** Extra detail (store-level reasons) rendered below the title. */
	detail?: string;
}

const PERSISTENCE_STORE_KEYS = ['proposals', 'approvals', 'audit'] as const;

/**
 * Derives the banner copy for a persistence runtime status.
 * - restored && !degraded → healthy
 * - restored=false && !degraded → still recovering (transient startup state)
 * - otherwise → degraded with the concrete per-store reason
 */
export function persistenceBanner(persistence: PersistenceRuntimeStatus): PersistenceBannerState {
	if (persistence.restored && !persistence.degraded) {
		return { tone: 'ok', title: '持久化已就绪，写入已启用' };
	}
	if (!persistence.restored && !persistence.degraded) {
		return { tone: 'pending', title: '正在恢复…' };
	}

	const reasons: string[] = [];
	for (const key of PERSISTENCE_STORE_KEYS) {
		const report = persistence.stores[key];
		if (report.error) {
			reasons.push(`${key}: ${report.error}`);
		} else if (!report.available || !report.loaded) {
			reasons.push(`${key}: 未恢复`);
		}
	}
	const reason = reasons.length > 0 ? reasons.join('；') : '存储不可用';
	return { tone: 'danger', title: `持久化降级：${reason}，审批与写入已阻断` };
}
