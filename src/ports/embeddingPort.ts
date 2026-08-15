import type { RequestContext } from '../application/requestContext';
import type { Health } from '../application/contracts';
export interface EmbeddingPort { embed(texts: string[], context: RequestContext): Promise<number[][]>; health(context: RequestContext): Promise<Health>; }
