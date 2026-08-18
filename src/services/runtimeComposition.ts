import { sha256Hex } from '../utils/sha256.ts';
import type { App } from 'obsidian';
import type { AgentDashboardSettings } from '../settings.ts';
import { toSearchConfig } from '../application/featureFlags.ts';
import { OllamaSemanticSearch } from '../adapters/ollamaSemanticSearch.ts';
import { OllamaEmbedding } from '../adapters/ollamaEmbedding.ts';
import { ObsidianVaultReader } from '../adapters/obsidianVaultReader.ts';
import { ObsidianWritePort } from '../adapters/obsidianWritePort.ts';
import { InMemoryVaultIndex } from '../adapters/in-memory-vault-index.ts';
import { SearchService } from './searchService.ts';
import { IndexLifecycleService } from './indexLifecycleService.ts';
import { WriteService } from './writeService.ts';
import { OrganizeService, type OrganizePort } from './organizeService.ts';
import type { AuditRecord, NoteRecord, SearchScope } from '../application/contracts.ts';
import { ScopeService } from './scopeService.ts';
import { parseVaultDocument } from '../domain/vault-document.ts';
import { inferZone } from '../domain/zones.ts';
import { JsonlProposalStore } from '../adapters/jsonlProposalStore.ts';
import { JsonlApprovalStore } from '../adapters/jsonlApprovalStore.ts';
import { JsonlAuditStore } from '../adapters/jsonlAuditStore.ts';
import { JsonlAuditSink } from '../adapters/jsonlAuditSink.ts';
import { ObsidianJsonlStorage } from '../adapters/obsidianJsonlStorage.ts';
import { DualJsonlStorage } from '../adapters/dualJsonlStorage.ts';
import { ProposalService } from './proposalService.ts';
import { ApprovalService } from './approvalService.ts';
import { ProposalApplyService } from './proposalApplyService.ts';
import { RollbackService } from './rollbackService.ts';
import { WorkbenchWriteService } from './workbenchWriteService.ts';
import { createRequestContext, type RequestContext } from '../application/requestContext.ts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts.ts';
import { PersistenceGate } from './persistenceGate.ts';

export interface RuntimeAuditQuery {
  listRecent(limit: number, context: RequestContext): Promise<AuditRecord[]>;
  listPendingCompensation(context: RequestContext): Promise<AuditRecord[]>;
  retry(recordId: string, context: RequestContext): Promise<import('../application/contracts.ts').AuditWriteStatus>;
}
export interface RuntimeServices { reader: ObsidianVaultReader; index: InMemoryVaultIndex; lifecycle: IndexLifecycleService; search: SearchService; write: WriteService; workbenchWrite: WorkbenchWriteService; organize: OrganizeService; proposals: ProposalService; approvals: ApprovalService; apply: ProposalApplyService; persistence: PersistenceRuntimeStatus; restore(context: RequestContext): Promise<PersistenceRuntimeStatus>; audit: RuntimeAuditQuery; auditSink: import('../ports/auditSink.ts').AuditSink; rollback: (path: string, context: RequestContext) => Promise<{ rolledBack: boolean; message: string }>; }
export async function composeRuntime(app: App, settings: AgentDashboardSettings): Promise<RuntimeServices> {
  const reader = new ObsidianVaultReader(app); const index = new InMemoryVaultIndex(reader); const lifecycle = new IndexLifecycleService(reader, index); const flags = settings.featureFlags;
  /* Semantic adapter is resolved lazily so enabling the flag in settings takes effect without reloading the plugin. */
  let semanticAdapter: import('../ports/semanticSearchPort.ts').SemanticSearchPort | undefined;
  const semanticProvider = (): import('../ports/semanticSearchPort.ts').SemanticSearchPort | undefined => {
    if (!settings.featureFlags.semantic_search) return undefined;
    semanticAdapter ??= new OllamaSemanticSearch(reader, new OllamaEmbedding(settings.agent));
    return semanticAdapter;
  };
  const search = new SearchService(index, semanticProvider, toSearchConfig(settings.featureFlags), () => ({ semantic_search_enabled: settings.featureFlags.semantic_search, semantic_fallback_enabled: settings.featureFlags.semantic_fallback }));
  const writePort = new ObsidianWritePort(app);
  const auditStore = new JsonlAuditStore(new ObsidianJsonlStorage(app, '_workbench/audit/events.jsonl'));
  const auditDual = new DualJsonlStorage(app, '_workbench/audit/events.jsonl', 'audit/events.jsonl');
  const proposalStore = new JsonlProposalStore(new ObsidianJsonlStorage(app, '_workbench/proposals/records.jsonl'));
  const approvalStore = new JsonlApprovalStore(new ObsidianJsonlStorage(app, '_workbench/approvals/records.jsonl'));
  const persistenceGate = new PersistenceGate(() => settings.featureFlags.new_write_pipeline);
  /* Dual-write audit sink: writes to Vault store + plugin data dir mirror */
  const baseSink = new JsonlAuditSink(auditStore);
  const auditSink: import('../ports/auditSink.ts').AuditSink = {
    append: async (event: AuditRecord, ctx: RequestContext): Promise<void> => {
      const auditId = await baseSink.appendAndGetId(event, ctx);
      /* Secondary mirror only: the Vault file is owned by JsonlAuditStore. */
      const mirrored = await auditDual.writeSecondary(JSON.stringify(event), ctx);
      if (!mirrored) {
        console.error('[agent-dashboard] 审计镜像（插件数据目录）写入失败，记录已标记为待补偿。', auditDual.getStatus());
        await baseSink.markCompensation(auditId, ctx);
      }
    },
    query: async (filter: import('../application/contracts.ts').AuditFilter, ctx: RequestContext) => baseSink.query(filter, ctx),
    retry: async (recordId: string, ctx: RequestContext) => {
      const status = await auditStore.retry(recordId, ctx);
      if (status === 'success') {
        const record = (await auditStore.query({}, ctx)).find((item) => item.audit_id === recordId);
        if (record) await auditDual.writeSecondary(JSON.stringify(record), ctx);
      }
      return status;
    },
  };
  const write = new WriteService(writePort, auditSink, lifecycle, flags, persistenceGate);
  const workbenchWrite = new WorkbenchWriteService(writePort, auditSink, persistenceGate);
  const scopeService = new ScopeService();
  const scanner: OrganizePort = { scan: async (scope: SearchScope, context) => {
    const notes: NoteRecord[] = [];
    for (const path of await reader.listMarkdownPaths(context)) {
      const raw = await reader.readMarkdown(path, context);
      const parsed = parseVaultDocument(path, raw);
      const zone = inferZone(path, parsed.frontmatter);
      notes.push({ path, title: parsed.title, content: raw, frontmatter: parsed.frontmatter, tags: parsed.tags, links: extractLinks(raw), hash: sha256Hex(raw), zone });
    }
    const snapshot = scopeService.snapshot(scope);
    return notes.filter((note) => scopeService.allows(note, snapshot));
  } };
  const organize = new OrganizeService(scanner, flags);
  const proposals = new ProposalService(proposalStore);
  const approvals = new ApprovalService(proposalStore, approvalStore);
  const rollback = new RollbackService(app, auditSink);
  const apply = new ProposalApplyService(proposalStore, approvalStore, write, writePort, persistenceGate, async (path, before, after, ctx) => { await rollback.snapshot(path, before, after, ctx); }, auditSink);
  let persistence: PersistenceRuntimeStatus = { restored: false, write_enabled: false, degraded: true, stores: { proposals: { available: false, loaded: false, skipped_rows: 0 }, approvals: { available: false, loaded: false, skipped_rows: 0 }, audit: { available: false, loaded: false, skipped_rows: 0 } } };
  const restore = async (context: RequestContext): Promise<PersistenceRuntimeStatus> => {
    persistence = await persistenceGate.restore({ proposals: proposalStore, approvals: approvalStore, audit: auditStore }, context);
    write.setPersistenceReady(persistence.restored && !persistence.degraded);
    if (persistence.restored) {
      try { await approvals.reconcile(context.child ? context.child() : context); } catch (error) { console.error('[agent-dashboard] 审批对账失败（非致命）。', error); }
    }
    return persistence;
  };
  persistence = await restore(createRequestContext('background-task'));
  const audit: RuntimeAuditQuery = {
    listRecent: async (limit: number, context: RequestContext): Promise<AuditRecord[]> => {
      const records = await auditStore.query({}, context);
      return [...records]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, Math.max(0, limit));
    },
    listPendingCompensation: (context: RequestContext): Promise<AuditRecord[]> => auditStore.listPendingCompensation(context),
    retry: (recordId: string, context: RequestContext): Promise<import('../application/contracts.ts').AuditWriteStatus> => auditStore.retry(recordId, context),
  };
  return { reader, index, lifecycle, search, write, workbenchWrite, organize, proposals, approvals, apply, persistence, restore, audit, auditSink, rollback: (path: string, ctx: RequestContext) => rollback.rollback(path, ctx) };
}

function extractLinks(raw: string): string[] {
  return [...raw.matchAll(/\[\[([^\]]+)\]\]/gu)].map((match) => match[1]).filter((value): value is string => Boolean(value));
}
