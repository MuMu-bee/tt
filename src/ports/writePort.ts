import type { RequestContext } from '../application/requestContext';
export interface WritePort { read(path: string, context: RequestContext): Promise<string>; writeAtomic(path: string, content: string, context: RequestContext): Promise<void>; }
