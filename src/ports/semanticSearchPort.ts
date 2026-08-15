import type { RequestContext } from '../application/requestContext';
import type { Health, SearchQuery, SearchResult } from '../application/contracts';
export interface SemanticSearchPort { health(context: RequestContext): Promise<Health>; search(query: SearchQuery, context: RequestContext): Promise<SearchResult[]>; }
