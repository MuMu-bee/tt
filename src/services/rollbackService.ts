import { App, normalizePath, TFile } from 'obsidian';
import type { RequestContext } from '../application/requestContext.ts';
import { createRequestContext } from '../application/requestContext.ts';
import { sha256Hex } from '../utils/sha256.ts';

export interface RollbackEntry {
	path: string;
	before: string;
	after: string;
	before_hash: string;
	after_hash: string;
	appliedAt: string;
}

const SNAPSHOTS_DIR = '_workbench/snapshots/';

/** Saves before/after snapshots on writes and provides rollback. */
export class RollbackService {
	private readonly app: App;
	private readonly auditSink?: import('../ports/auditSink').AuditSink;

	constructor(app: App, auditSink?: import('../ports/auditSink').AuditSink) {
		this.app = app;
		this.auditSink = auditSink;
	}

	/** Saves a snapshot before applying a write. */
	async snapshot(path: string, before: string, after: string, context: RequestContext = createRequestContext('background-task')): Promise<void> {
		try {
			await this.app.vault.adapter.mkdir(SNAPSHOTS_DIR);
			const entry: RollbackEntry = {
				path,
				before,
				after,
				before_hash: sha256Hex(before),
				after_hash: sha256Hex(after),
				appliedAt: new Date().toISOString(),
			};
			const fileName = `rollback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
			await this.app.vault.create(normalizePath(`${SNAPSHOTS_DIR}${fileName}`), JSON.stringify(entry, null, 2));
		} catch {
			/* Snapshot failure is non-fatal */
		}
	}

	/** Rolls back a path to its latest snapshot before content. */
	async rollback(path: string, context: RequestContext = createRequestContext('user')): Promise<{ rolledBack: boolean; message: string }> {
		try {
			const list = await this.app.vault.adapter.list(SNAPSHOTS_DIR);
			const files = list.files.filter((f: string) => f.endsWith('.json')).sort().reverse();

			for (const file of files) {
				const content = await this.app.vault.adapter.read(file);
				const entry = JSON.parse(content) as RollbackEntry;
				if (entry.path !== path) continue;

				/* Only rollback if current content matches the after state */
				const target = this.app.vault.getAbstractFileByPath(path);
				if (!(target instanceof TFile)) {
					return { rolledBack: false, message: `找不到文件：${path}` };
				}
				const current = await this.app.vault.read(target);
				if (sha256Hex(current) !== entry.after_hash) {
					return { rolledBack: false, message: '文件已被修改，无法回滚（避免覆盖你的新内容）' };
				}

				await this.app.vault.modify(target, entry.before);
				if (this.auditSink) {
					try {
						await this.auditSink.append({
							request_id: context.request_id,
							actor: context.actor,
							action: 'rollback',
							path,
							before_hash: entry.after_hash,
							after_hash: entry.before_hash,
							result: 'rollback',
							created_at: new Date().toISOString(),
						}, context);
					} catch {
						/* 审计失败不影响回滚本身 */
					}
				}
				return { rolledBack: true, message: `已回滚 ${path} 到修改前状态` };
			}
			return { rolledBack: false, message: `未找到 ${path} 的回滚快照` };
		} catch (error) {
			return { rolledBack: false, message: `回滚失败：${error instanceof Error ? error.message : '未知错误'}` };
		}
	}
}
