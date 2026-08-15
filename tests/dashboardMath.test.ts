import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	bucketCreationDates,
	calculateHealthScore,
	countTaskMetrics,
	formatDashboardActionMessage,
	isCacheFresh,
	matchesDashboardQuery,
	parseTaskLine,
} from '../src/services/dashboardMath.ts';

test('calculates the confirmed weighted health score', () => {
	const score = calculateHealthScore({
		noteCount: 50,
		frontmatterRatio: 0.8,
		tagRatio: 0.5,
		inboxCount: 4,
		taskCompletionRatio: 0.5,
	});

	assert.equal(score, 64);
});

test('parses Obsidian task status and supported due-date syntax', () => {
	assert.deepEqual(parseTaskLine('- [ ] Read report 📅 2026-08-02'), {
		title: 'Read report',
		completed: false,
		dueDate: '2026-08-02',
	});
	assert.deepEqual(parseTaskLine('- [x] Ship dashboard'), {
		title: 'Ship dashboard',
		completed: true,
	});
	assert.equal(parseTaskLine('not a task'), null);
	assert.equal(parseTaskLine('- [?] Not a supported task marker'), null);
});

test('counts completion, today tasks, and overdue tasks', () => {
	const metrics = countTaskMetrics(
		[
			{ completed: false, dueDate: '2026-08-02', sourceDate: '2026-08-03' },
			{ completed: true, dueDate: '2026-08-01', sourceDate: '2026-08-03' },
			{ completed: false, sourceDate: '2026-08-02' },
			{ completed: true, sourceDate: '2026-08-03' },
		],
		'2026-08-03',
	);

	assert.deepEqual(metrics, {
		total: 4,
		completed: 2,
		completionRate: 50,
		today: 3,
		overdue: 1,
	});
});

test('buckets file creation timestamps by local calendar date', () => {
	const files = [
		{ ctime: new Date(2026, 7, 1, 9).getTime() },
		{ ctime: new Date(2026, 7, 1, 18).getTime() },
		{ ctime: new Date(2026, 7, 3, 10).getTime() },
	];

	assert.deepEqual(bucketCreationDates(files, '2026-08-01', '2026-08-03'), {
		'2026-08-01': 2,
		'2026-08-02': 0,
		'2026-08-03': 1,
	});
});

test('treats cache entries as fresh for less than one hour', () => {
	const now = Date.parse('2026-08-03T10:00:00.000Z');

	assert.equal(isCacheFresh('2026-08-03T09:30:00.000Z', now, 60 * 60 * 1000), true);
	assert.equal(isCacheFresh('2026-08-03T08:59:59.999Z', now, 60 * 60 * 1000), false);
});

test('matches dashboard search queries across visible text', () => {
	assert.equal(matchesDashboardQuery('', ['Today task', 'GitHub feed']), true);
	assert.equal(matchesDashboardQuery('  GITHUB  ', ['Today task', 'GitHub feed']), true);
	assert.equal(matchesDashboardQuery('research', ['Today task', 'GitHub feed']), false);
});

test('formats visible action progress and completion feedback', () => {
	assert.equal(formatDashboardActionMessage('新建日记', 'running'), '新建日记正在执行。');
	assert.equal(
		formatDashboardActionMessage('Vault 检查', 'success', 'Reports/vault-lint-2026-08-04.md'),
		'Vault 检查已完成：Reports/vault-lint-2026-08-04.md',
	);
});

test('keeps the Obsidian dashboard view vertically scrollable', () => {
	const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

	assert.match(
		styles,
		/\.workspace-leaf-content\[data-type="agent-dashboard-view"\] \.view-content \{[\s\S]*?height: 100%;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/,
	);
});
