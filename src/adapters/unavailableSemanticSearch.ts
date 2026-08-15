import type { RequestContext } from '../application/requestContext.ts';
import type { SearchQuery, SearchResult, Health } from '../application/contracts.ts';
import type { SemanticSearchPort } from '../ports/semanticSearchPort.ts';

/** Null object used when semantic capabilities are disabled or unavailable. */
export class UnavailableSemanticSearch implements SemanticSearchPort {
  async health(_context: RequestContext): Promise<Health> {
    return { available: false, status: 'unavailable', reason: 'semantic provider unavailable', provider: 'none' };
  }

  async search(_query: SearchQuery, _context: RequestContext): Promise<SearchResult[]> {
    throw new Error('SEMANTIC_UNAVAILABLE: semantic provider unavailable');
  }
}
