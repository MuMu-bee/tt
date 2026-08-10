import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proposal, ProposalStatus } from '../src/application/contracts.ts';
import type { PersistenceRuntimeStatus } from '../src/application/persistenceContracts.ts';
import {
	persistenceBanner,
	proposalActions,
	proposalStatusLabel,
} from '../src/views/proposalViewState.ts';

function makeProposal(status: ProposalStatus = 'pending'): Proposal {
	return {
		proposal_id: 'proposal-1',
		request_id: 'request-1',
		target_path: 'notes/a.md',
		target_zone: 'normal',
		change_kind: 'tag-add',
		base_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
		before: 'before',
		after: 'after',
		diff: '+tag',
		reason: 'test',
		created_at: '2026-08-08T00:00:00.000Z',
		status,
		requires_approval: true,
		schema_version: 1,
	};
}

function healthyPersistence(): PersistenceRuntimeStatus {
	return {
		restored: true,
		write_enabled: true,
		degraded: false,
		stores: {
			proposals: { available: true, loaded: true, skipped_rows: 0 },
			approvals: { available: true, loaded: true, skipped_rows: 0 },
			audit: { available: true, loaded: true, skipped_rows: 0 },
		},
	};
}

function degradedPersistence(): PersistenceRuntimeStatus {
	return {
		restored: false,
		write_enabled: false,
		degraded: true,
		stores: {
			proposals: { available: false, loaded: false, skipped_rows: 3, error: 'proposal restore failed' },
			approvals: { available: true, loaded: true, skipped_rows: 0 },
			audit: { available: true, loaded: true, skipped_rows: 0 },
		},
	};
}

function notRestoredPersistence(): PersistenceRuntimeStatus {
	return {
		restored: false,
		write_enabled: false,
		degraded: false,
		stores: {
			proposals: { available: false, loaded: false, skipped_rows: 0 },
			approvals: { available: false, loaded: false, skipped_rows: 0 },
			audit: { available: false, loaded: false, skipped_rows: 0 },
		},
	};
}

test('proposalStatusLabel maps every status to simplified Chinese', () => {
	assert.equal(proposalStatusLabel('pending'), '待审批');
	assert.equal(proposalStatusLabel('approved'), '已批准');
	assert.equal(proposalStatusLabel('rejected'), '已拒绝');
	assert.equal(proposalStatusLabel('applied'), '已应用');
	assert.equal(proposalStatusLabel('conflict'), '冲突');
	assert.equal(proposalStatusLabel('failed'), '失败');
	assert.equal(proposalStatusLabel('expired'), '过期');
	assert.equal(proposalStatusLabel('pending-compensation'), '待补偿');
});

test('pending proposal is actionable when persistence is healthy', () => {
	const state = proposalActions(makeProposal('pending'), healthyPersistence());
	assert.equal(state.canApprove, true);
	assert.equal(state.canReject, true);
	assert.equal(state.canApply, false);
	assert.equal(state.disabledReason, undefined);
});

test('approved proposal can only be applied when persistence is healthy', () => {
	const state = proposalActions(makeProposal('approved'), healthyPersistence());
	assert.equal(state.canApprove, false);
	assert.equal(state.canReject, false);
	assert.equal(state.canApply, true);
	assert.equal(state.disabledReason, undefined);
});

test('terminal and read-only statuses expose no actions when persistence is healthy', () => {
	for (const status of ['rejected', 'applied', 'conflict', 'failed', 'expired'] as const) {
		const state = proposalActions(makeProposal(status), healthyPersistence());
		assert.equal(state.canApprove, false, `${status} should not allow approve`);
		assert.equal(state.canReject, false, `${status} should not allow reject`);
		assert.equal(state.canApply, false, `${status} should not allow apply`);
		assert.equal(state.disabledReason, undefined, `${status} should have no disabled reason`);
	}
});

test('degraded persistence disables approve/reject/apply with a reason', () => {
	const persistence = degradedPersistence();
	for (const status of ['pending', 'approved', 'conflict'] as const) {
		const state = proposalActions(makeProposal(status), persistence);
		assert.equal(state.canApprove, false, `${status} approve disabled in degraded mode`);
		assert.equal(state.canReject, false, `${status} reject disabled in degraded mode`);
		assert.equal(state.canApply, false, `${status} apply disabled in degraded mode`);
		assert.ok(state.disabledReason, `${status} should include a disabled reason`);
		assert.match(state.disabledReason ?? '', /持久化降级/);
	}
});

test('restored=false (still recovering) disables approve/reject/apply with a reason', () => {
	const persistence = notRestoredPersistence();
	const state = proposalActions(makeProposal('pending'), persistence);
	assert.equal(state.canApprove, false);
	assert.equal(state.canReject, false);
	assert.equal(state.canApply, false);
	assert.ok(state.disabledReason);
	assert.match(state.disabledReason ?? '', /尚未恢复/);
});

test('degraded=true with restored=true still blocks every action', () => {
	const persistence: PersistenceRuntimeStatus = {
		...healthyPersistence(),
		degraded: true,
	};
	const state = proposalActions(makeProposal('pending'), persistence);
	assert.equal(state.canApprove, false);
	assert.equal(state.canReject, false);
	assert.equal(state.canApply, false);
	assert.match(state.disabledReason ?? '', /持久化降级/);
});

test('persistenceBanner returns expected copy for healthy, degraded and pending states', () => {
	assert.deepEqual(persistenceBanner(healthyPersistence()), {
		tone: 'ok',
		title: '持久化已就绪，写入已启用',
	});
	const degraded = persistenceBanner(degradedPersistence());
	assert.equal(degraded.tone, 'danger');
	assert.match(degraded.title, /持久化降级/);
	assert.match(degraded.title, /审批与写入已阻断/);
	assert.match(degraded.title, /proposal restore failed/);
	assert.deepEqual(persistenceBanner(notRestoredPersistence()), {
		tone: 'pending',
		title: '正在恢复…',
	});
});
