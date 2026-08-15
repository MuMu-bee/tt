import { sha256Hex } from '../utils/sha256.ts';
import type { RequestContext } from '../application/requestContext.ts';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../application/featureFlags.ts';
import type { ChangeKind, RefreshStatus, WriteRequest, WriteResult } from '../application/contracts.ts';
import type { WritePort } from '../ports/writePort.ts';
import type { AuditSink } from '../ports/auditSink.ts';
import type { IndexLifecycleService } from './indexLifecycleService.ts';
import type { PersistenceGate } from './persistenceGate.ts';
import { parseVaultDocument } from '../domain/vault-document.ts';
import { inferZone } from '../domain/zones.ts';

export class WriteService {
  private readonly persistenceGate?: PersistenceGate;
  private readonly port: WritePort;
  private readonly audit: AuditSink;
  private readonly lifecycle?: IndexLifecycleService;
  private readonly flags: FeatureFlags;
  private persistenceReady = true;
  constructor(port: WritePort, audit: AuditSink, lifecycle?: IndexLifecycleService, flags: FeatureFlags = DEFAULT_FEATURE_FLAGS, persistenceGate?: PersistenceGate) {
    this.port = port;
    this.audit = audit;
    this.lifecycle = lifecycle;
    this.flags = flags;
    this.persistenceGate = persistenceGate;
  }
  setPersistenceReady(ready: boolean): void { this.persistenceReady = ready; }

  async write(request: WriteRequest, context: RequestContext): Promise<WriteResult> {
    if (!this.persistenceReady) return this.result(request, 'skipped', 'FEATURE_DISABLED');
    if (!this.flags.new_write_pipeline) return this.result(request, 'skipped', 'FEATURE_DISABLED');
    if (this.persistenceGate && !this.persistenceGate.isWritable()) return this.result(request, 'failed', 'PERSISTENCE_DEGRADED');
    if (!this.allowed(request.kind)) return this.result(request, 'failed', 'OUT_OF_WHITELIST');
    if (request.zone === 'fiction' || request.zone === 'unknown') return this.result(request, 'proposal_only', 'FICTION_PROPOSAL_ONLY');
    if (request.dry_run) return this.result(request, 'skipped');
    const current = await this.port.read(request.path, context.child ? context.child() : context);
    const beforeHash = hash(current);
    if (beforeHash !== request.before_hash) return this.result(request, 'conflict', 'HASH_CONFLICT', beforeHash);

    /* Re-infer the zone from the actual file content so callers cannot bypass
       proposal-only zones by self-reporting a different zone. */
    const actualZone = inferZone(request.path, parseVaultDocument(request.path, current).frontmatter);
    if (actualZone === 'fiction' || actualZone === 'unknown') return this.result(request, 'proposal_only', 'FICTION_PROPOSAL_ONLY');

    let result: WriteResult;
    try {
      await this.port.writeAtomic(request.path, request.content, context.child ? context.child() : context);
      const after = await this.port.read(request.path, context.child ? context.child() : context);
      const afterHash = hash(after);
      let refresh: RefreshStatus | undefined;
      try { await this.lifecycle?.modify(request.path, context.child ? context.child() : context); refresh = { status: 'succeeded', paths: [request.path] }; } catch (error) { refresh = { status: 'failed', paths: [request.path], error: this.message(error) }; }
      result = { path: request.path, status: refresh?.status === 'failed' ? 'failed' : 'applied', before_hash: beforeHash, after_hash: afterHash, refresh, ...(refresh?.status === 'failed' ? { error_code: 'INDEX_REFRESH_FAILED' as const } : {}) };
    } catch {
      const failedResult = this.result(request, 'failed', 'WRITE_FAILED', beforeHash);
      try { await this.appendAudit(request, failedResult, context); } catch { /* audit of a failed write is best-effort */ }
      return failedResult;
    }

    /* Audit failure must not masquerade as a write failure: the file is already written.
       Report AUDIT_FAILED with the after-hash preserved so the write stays recoverable. */
    try {
      await this.appendAudit(request, result, context);
    } catch (error) {
      console.error('[agent-dashboard] 审计持久化失败（目标文件已写入）。', error);
      this.setPersistenceReady(false);
      return { ...result, status: 'failed', error_code: 'AUDIT_FAILED' };
    }
    return result;
  }
  private async appendAudit(request: WriteRequest, result: WriteResult, context: RequestContext): Promise<void> { await this.audit.append({ request_id: context.request_id, actor: context.actor, action: request.kind, path: request.path, before_hash: result.before_hash, after_hash: result.after_hash, result: result.status, created_at: new Date().toISOString(), error_code: result.error_code }, context.child ? context.child() : context); }
  private result(request: WriteRequest, status: WriteResult['status'], errorCode?: WriteResult['error_code'], beforeHash = request.before_hash): WriteResult { return { path: request.path, status, before_hash: beforeHash, ...(errorCode ? { error_code: errorCode } : {}) }; }
  private allowed(kind: ChangeKind): boolean { return ['frontmatter-add', 'tag-add', 'bidirectional-link-add', 'format-normalize'].includes(kind); }
  private message(error: unknown): string { return error instanceof Error ? error.message : '索引刷新失败'; }
}
function hash(value: string): string { return sha256Hex(value); }
