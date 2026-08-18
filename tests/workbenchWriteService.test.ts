import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, type RequestContext } from '../src/application/requestContext.ts';
import type { AuditEvent, AuditWriteStatus } from '../src/application/contracts.ts';
import type { AuditSink } from '../src/ports/auditSink.ts';
import type { WritePort } from '../src/ports/writePort.ts';
import { PersistenceGate } from '../src/services/persistenceGate.ts';
import { WorkbenchWriteService } from '../src/services/workbenchWriteService.ts';
import type { PersistenceRestoreReport, RestorablePersistenceStore } from '../src/ports/persistencePort.ts';

class FakeWritePort implements WritePort {
	files = new Map<string, string>();
	failWrite = false;

	async read(path: string, _context: RequestContext): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error('missing');
		return content;
	}

	async writeAtomic(path: string, content: string, _context: RequestContext): Promise<void> {
		if (this.failWrite) throw new Error('write unavailable');
		if (!this.files.has(path)) throw new Error('missing');
		this.files.set(path, content);
	}

	async create(path: string, content: string, _context: RequestContext): Promise<void> {
		if (this.failWrite) throw new Error('write unavailable');
		if (this.files.has(path)) throw new Error('exists');
		this.files.set(path, content);
	}
}

class FakeAuditSink implements AuditSink {
	events: AuditEvent[] = [];
	failAppend = false;

	async append(event: AuditEvent, _context: RequestContext): Promise<void> {
		if (this.failAppend) throw new Error('audit unavailable');
		this.events.push(event);
	}

	async query(_filter: Partial<AuditEvent>, _context: RequestContext): Promise<AuditEvent[]> {
		return this.events;
	}

	async retry(_recordId: string, _context: RequestContext): Promise<AuditWriteStatus> {
		return 'success';
	}
}

const ctx = (): RequestContext => createRequestContext('workbench-agent');

function healthyStore(): RestorablePersistenceStore {
	return {
		async restore(): Promise<PersistenceRestoreReport> {
			return { available: true, loaded: true, skipped_rows: 0 };
		},
		async health() {
			return { available: true, loaded: true, skipped_rows: 0, healthy: true };
		},
	};
}

async function readyGate(): Promise<PersistenceGate> {
	const gate = new PersistenceGate(false);
	await gate.restore({ proposals: healthyStore(), approvals: healthyStore(), audit: healthyStore() }, ctx());
	return gate;
}

function makeService(port: FakeWritePort, audit: FakeAuditSink, gate: PersistenceGate): WorkbenchWriteService {
	return new WorkbenchWriteService(port, audit, gate);
}

test('workbench write creates a generated file and audits it', async () => {
	const port = new FakeWritePort();
	const audit = new FakeAuditSink();
	const service = makeService(port, audit, await readyGate());

	const result = await service.writeGenerated({
		path: 'Reports/测试.md',
		content: '# 测试',
		kind: 'report',
		context: ctx(),
	});

	assert.equal(result.status, 'applied');
	assert.equal(port.files.get('Reports/测试.md'), '# 测试');
	assert.equal(typeof result.after_hash, 'string');
	assert.equal(audit.events.length, 1);
	assert.equal(audit.events[0]?.action, 'report');
	assert.equal(audit.events[0]?.result, 'applied');
});

test('workbench write skips existing files unless overwrite is set', async () => {
	const port = new FakeWritePort();
	const audit = new FakeAuditSink();
	const service = makeService(port, audit, await readyGate());
	port.files.set('Daily/2026-08-18.md', 'old');

	const skipped = await service.writeGenerated({
		path: 'Daily/2026-08-18.md',
		content: 'new',
		kind: 'diary',
		context: ctx(),
	});
	assert.equal(skipped.status, 'skipped');
	assert.equal(port.files.get('Daily/2026-08-18.md'), 'old');

	const applied = await service.writeGenerated({
		path: 'Daily/2026-08-18.md',
		content: 'new',
		kind: 'diary',
		context: ctx(),
		overwrite: true,
	});
	assert.equal(applied.status, 'applied');
	assert.equal(port.files.get('Daily/2026-08-18.md'), 'new');
});

test('workbench write blocks when persistence is degraded', async () => {
	const port = new FakeWritePort();
	const audit = new FakeAuditSink();
	const service = makeService(port, audit, new PersistenceGate(false));

	const result = await service.writeGenerated({
		path: 'Reports/x.md',
		content: 'x',
		kind: 'report',
		context: ctx(),
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error_code, 'PERSISTENCE_DEGRADED');
	assert.equal(port.files.size, 0);
	assert.equal(audit.events.length, 0);
});

test('workbench write reports write failure and audits the failed attempt', async () => {
	const port = new FakeWritePort();
	port.failWrite = true;
	const audit = new FakeAuditSink();
	const service = makeService(port, audit, await readyGate());

	const result = await service.writeGenerated({
		path: 'Reports/fail.md',
		content: 'x',
		kind: 'report',
		context: ctx(),
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error_code, 'WRITE_FAILED');
	assert.equal(audit.events.length, 1);
	assert.equal(audit.events[0]?.result, 'failed');
});

test('workbench write reports audit failure after the file is written', async () => {
	const port = new FakeWritePort();
	const audit = new FakeAuditSink();
	audit.failAppend = true;
	const service = makeService(port, audit, await readyGate());

	const result = await service.writeGenerated({
		path: 'Reports/audit-fail.md',
		content: 'x',
		kind: 'report',
		context: ctx(),
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error_code, 'AUDIT_FAILED');
	// The file itself is still written; only the audit could not be persisted.
	assert.equal(port.files.get('Reports/audit-fail.md'), 'x');
});
