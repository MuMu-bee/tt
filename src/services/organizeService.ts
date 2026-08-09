import { createRequestContext, createRequestId, type RequestContext } from '../application/requestContext.ts';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../application/featureFlags.ts';
import type { ChangeKind, NoteRecord, OrganizePlan, PlannedChange, SearchScope } from '../application/contracts.ts';
import { ScopeService } from './scopeService.ts';

export interface OrganizePort { scan(scope: SearchScope, context: RequestContext): Promise<NoteRecord[]>; }
export class OrganizeService {
  private readonly scopeService: ScopeService;
  private readonly scanner: OrganizePort;
  private readonly flags: FeatureFlags;
  constructor(scanner: OrganizePort, flags: FeatureFlags = DEFAULT_FEATURE_FLAGS, scopeService = new ScopeService()) {
    this.scanner = scanner;
    this.flags = flags;
    this.scopeService = scopeService;
  }
  async plan(scope: SearchScope, context: RequestContext): Promise<OrganizePlan> { const snapshot = this.scopeService.snapshot(scope); const notes = await this.scanner.scan(snapshot, context.child ? context.child() : createRequestContext(context.actor, context.request_id)); const changes: PlannedChange[] = []; notes.forEach((note) => { if (!this.scopeService.allows(note, snapshot)) return; const kinds: ChangeKind[] = ['frontmatter-add', 'tag-add', 'bidirectional-link-add', 'format-normalize']; kinds.forEach((kind) => { if (!this.enabled(kind)) return; const change = this.createChange(note, kind); if (change) changes.push(change); }); }); return { plan_id: createRequestId(), request_id: context.request_id, changes, scope_snapshot: snapshot, created_at: new Date().toISOString() }; }
  private enabled(kind: ChangeKind): boolean { if (kind === 'frontmatter-add') return this.flags.organize.frontmatter; if (kind === 'tag-add') return this.flags.organize.tags; if (kind === 'bidirectional-link-add') return this.flags.organize.links; return this.flags.organize.format; }
  private createChange(note: NoteRecord, kind: ChangeKind): PlannedChange | null { const proposalOnly = note.zone === 'fiction' || note.zone === 'unknown'; return { path: note.path, kind, before: note.content, after: note.content, diff: '', reason: proposalOnly ? 'zone requires proposal only' : 'whitelisted organizer rule', status: proposalOnly ? 'proposal_only' : 'planned', before_hash: note.hash, zone: note.zone }; }
}
