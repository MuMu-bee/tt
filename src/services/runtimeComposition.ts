import { sha256Hex } from '../utils/sha256.ts';
import type { App } from 'obsidian';
import type { AgentDashboardSettings } from '../settings.ts';
import { toSearchConfig } from '../application/featureFlags.ts';
import { UnavailableSemanticSearch } from '../adapters/unavailableSemanticSearch.ts';
import { OllamaSemanticSearch } from '../adapters/ollamaSemanticSearch.ts';
import { OllamaEmbedding } from '../adapters/ollamaEmbedding.ts';
import { ObsidianVaultReader } from '../adapters/obsidianVaultReader.ts';
import { ObsidianWritePort } from '../adapters/obsidianWritePort.ts';
import { InMemoryVaultIndex } from '../adapters/in-memory-vault-index.ts';
import { SearchService } from './searchService.ts';
import { IndexLifecycleService } from './indexLifecycleService.ts';
import { WriteService } from './writeService.ts';
import { OrganizeService, type OrganizePort } from './organizeService.ts';
import { AuditService } from './auditService.ts';
import type { AuditRecord, NoteRecord, SearchScope, VaultZone } from '../application/contracts.ts';
import { ScopeService } from './scopeService.ts';
import { parseVaultDocument } from '../domain/vault-document.ts';
import { JsonlProposalStore } from '../adapters/jsonlProposalStore.ts';
import { JsonlApprovalStore } from '../adapters/jsonlApprovalStore.ts';
import { JsonlAuditStore } from '../adapters/jsonlAuditStore.ts';
import { JsonlAuditSink } from '../adapters/jsonlAuditSink.ts';
import { ObsidianJsonlStorage } from '../adapters/obsidianJsonlStorage.ts';
import { ProposalService } from './proposalService.ts';
import { ApprovalService } from './approvalService.ts';
import { ProposalApplyService } from './proposalApplyService.ts';
import { createRequestContext, type RequestContext } from '../application/requestContext.ts';
import type { PersistenceRuntimeStatus } from '../application/persistenceContracts.ts';
import { PersistenceGate } from './persistenceGate.ts';

export interface RuntimeAuditQuery { listRecent(limit: number, context: RequestContext): Promise<AuditRecord[]>; }
export interface RuntimeServices { reader: ObsidianVaultReader; index: InMemoryVaultIndex; lifecycle: IndexLifecycleService; search: SearchService; write: WriteService; organize: OrganizeService; proposals: ProposalService; approvals: ApprovalService; apply: ProposalApplyService; persistence: PersistenceRuntimeStatus; restore(context: RequestContext): Promise<PersistenceRuntimeStatus>; audit: RuntimeAuditQuery; }
export async function composeRuntime(app: App, settings: AgentDashboardSettings): Promise<RuntimeServices> {
  const reader = new ObsidianVaultReader(app); const index = new InMemoryVaultIndex(reader); const lifecycle = new IndexLifecycleService(reader, index); const flags = settings.featureFlags;
  const semantic = flags.semantic_search ? new OllamaSemanticSearch(reader, new OllamaEmbedding(settings.agent)) : new UnavailableSemanticSearch();
  const search = new SearchService(index, semantic, toSearchConfig(flags));
  const writePort = new ObsidianWritePort(app);
  const auditStore = new JsonlAuditStore(new ObsidianJsonlStorage(app, '_workbench/audit/events.jsonl'));
  const proposalStore = new JsonlProposalStore(new ObsidianJsonlStorage(app, '_workbench/proposals/records.jsonl'));
  const approvalStore = new JsonlApprovalStore(new ObsidianJsonlStorage(app, '_workbench/approvals/records.jsonl'));
  const persistenceGate = new PersistenceGate(flags.new_write_pipeline);
  const write = new WriteService(writePort, new AuditService(new JsonlAuditSink(auditStore)), lifecycle, flags, persistenceGate);
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
  const apply = new ProposalApplyService(proposalStore, approvalStore, write, writePort, persistenceGate);
  let persistence: PersistenceRuntimeStatus = { restored: false, write_enabled: false, degraded: true, stores: { proposals: { available: false, loaded: false, skipped_rows: 0 }, approvals: { available: false, loaded: false, skipped_rows: 0 }, audit: { available: false, loaded: false, skipped_rows: 0 } } };
  const restore = async (context: RequestContext): Promise<PersistenceRuntimeStatus> => {
    persistence = await persistenceGate.restore({ proposals: proposalStore, approvals: approvalStore, audit: auditStore }, context);
    write.setPersistenceReady(persistence.restored && !persistence.degraded);
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
  };
  return { reader, index, lifecycle, search, write, organize, proposals, approvals, apply, persistence, restore, audit };
}

function inferZone(path: string, frontmatter: Record<string, unknown>): VaultZone {
  const declared = frontmatter.zone ?? frontmatter.type;
  if (declared === 'fiction' || declared === 'unknown') return declared;
  const normalized = path.replaceAll('\\\\', '/').toLocaleLowerCase();
  if (normalized.startsWith('fiction/') || normalized.startsWith('小说/')) return 'fiction';
  if (normalized.startsWith('unknown/') || normalized.startsWith('未分类/')) return 'unknown';
  return 'normal';
}

function extractLinks(raw: string): string[] {
  return [...raw.matchAll(/\[\[([^\]]+)\]\]/gu)].map((match) => match[1]).filter((value): value is string => Boolean(value));
}
