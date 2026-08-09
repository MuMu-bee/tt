import type { NoteRecord, SearchScope } from '../application/contracts';
export class ScopeService {
  snapshot(scope: SearchScope): SearchScope { return Object.freeze({ ...scope, includes: scope.includes ? [...scope.includes] : undefined, excludes: scope.excludes ? [...scope.excludes] : undefined, snapshot_id: scope.snapshot_id ?? `scope_${Date.now()}` }); }
  allows(note: NoteRecord, scope: SearchScope): boolean { const path = note.path.replaceAll('\\', '/'); if ((scope.excludes ?? []).some((value) => path === value || path.startsWith(value.endsWith('/') ? value : `${value}/`))) return false; if (scope.kind === 'global') return true; if (scope.kind === 'file') return path === scope.value; if (scope.kind === 'prefix') return path.startsWith(scope.value ?? ''); if (scope.kind === 'tag') return note.tags.includes(scope.value ?? ''); return false; }
}
