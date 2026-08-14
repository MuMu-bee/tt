import type { RequestContext } from '../application/requestContext.ts';

/** Small storage abstraction used by JSONL persistence adapters. */
export interface JsonlTextStorage {
  read(context: RequestContext): Promise<string>;
  write(value: string, context: RequestContext): Promise<void>;
}
