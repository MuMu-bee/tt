import type { RequestContext } from '../application/requestContext.ts';
import type { ErrorCode } from '../application/contracts.ts';
import type { AuditSink } from '../ports/auditSink.ts';
import type { WritePort } from '../ports/writePort.ts';
import type { PersistenceGate } from './persistenceGate.ts';
import { sha256Hex } from '../utils/sha256.ts';

export type GeneratedContentKind = 'diary' | 'inbox' | 'report' | 'research' | 'vision' | 'project' | 'memory';

export interface GeneratedWriteOptions {
	path: string;
	content: string;
	kind: GeneratedContentKind;
	context: RequestContext;
	/** Existing files are skipped unless this is true. Defaults to false. */
	overwrite?: boolean;
}

export interface GeneratedWriteResult {
	path: string;
	status: 'applied' | 'skipped' | 'failed';
	before_hash: string;
	after_hash?: string;
	error_code?: ErrorCode;
}

/**
 * Unified write path for plugin-generated Markdown content (daily notes, inbox
 * notes, research/image/project reports, memory snapshots). Business services
 * must route through here instead of calling the Obsidian Vault API directly.
 */
export class WorkbenchWriteService {
	private readonly port: WritePort;
	private readonly audit: AuditSink;
	private readonly gate: PersistenceGate;

	constructor(port: WritePort, audit: AuditSink, gate: PersistenceGate) {
		this.port = port;
		this.audit = audit;
		this.gate = gate;
	}

	async writeGenerated(options: GeneratedWriteOptions): Promise<GeneratedWriteResult> {
		const path = normalizeGeneratedPath(options.path);
		const childContext = options.context.child ? options.context.child() : options.context;

		if (!this.gate.isPersistenceReady()) {
			return { path, status: 'failed', before_hash: '', error_code: 'PERSISTENCE_DEGRADED' };
		}

		const before = await this.safeRead(path, childContext);
		const beforeHash = before === '' ? '' : sha256Hex(before);
		if (before !== '' && !options.overwrite) {
			return { path, status: 'skipped', before_hash: beforeHash };
		}

		try {
			if (before === '') {
				if (!this.port.create) {
					return { path, status: 'failed', before_hash: beforeHash, error_code: 'WRITE_FAILED' };
				}
				await this.port.create(path, options.content, childContext);
			} else {
				await this.port.writeAtomic(path, options.content, childContext);
			}
		} catch {
			await this.appendAudit(path, options.kind, 'failed', beforeHash, undefined, 'WRITE_FAILED', childContext);
			return { path, status: 'failed', before_hash: beforeHash, error_code: 'WRITE_FAILED' };
		}

		const after = await this.safeRead(path, childContext);
		const afterHash = after === '' ? '' : sha256Hex(after);
		try {
			await this.appendAudit(path, options.kind, 'applied', beforeHash, afterHash, undefined, childContext);
		} catch (error) {
			console.error('[agent-dashboard] 生成物审计写入失败（目标文件已写入）。', error);
			return { path, status: 'failed', before_hash: beforeHash, after_hash: afterHash, error_code: 'AUDIT_FAILED' };
		}
		return { path, status: 'applied', before_hash: beforeHash, after_hash: afterHash };
	}

	private async safeRead(path: string, context: RequestContext): Promise<string> {
		try {
			return await this.port.read(path, context);
		} catch {
			return '';
		}
	}

	private async appendAudit(
		path: string,
		action: GeneratedContentKind,
		result: string,
		beforeHash: string,
		afterHash: string | undefined,
		errorCode: ErrorCode | undefined,
		context: RequestContext,
	): Promise<void> {
		await this.audit.append({
			request_id: context.request_id,
			actor: context.actor,
			action,
			path,
			before_hash: beforeHash,
			after_hash: afterHash,
			result,
			created_at: new Date().toISOString(),
			...(errorCode ? { error_code: errorCode } : {}),
		}, context);
	}

	private message(error: unknown): string {
		return error instanceof Error ? error.message : '写入失败';
	}
}

function normalizeGeneratedPath(path: string): string {
	const normalized = path.split('\\').join('/').replace(/\/+/gu, '/');
	return normalized.replace(/^\.\/+/u, '').replace(/\/+$/u, '');
}
