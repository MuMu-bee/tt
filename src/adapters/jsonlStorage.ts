import type { RequestContext } from '../application/requestContext.ts';
import type { WritePort } from '../ports/writePort.ts';

/** Small storage abstraction used by JSONL persistence adapters. */
export interface JsonlTextStorage {
  read(context: RequestContext): Promise<string>;
  write(value: string, context: RequestContext): Promise<void>;
}

/** Adapts the application write port to a named JSONL document. */
export class WritePortJsonlStorage implements JsonlTextStorage {
  private readonly port: WritePort;
  private readonly path: string;

  constructor(port: WritePort, path: string) {
    this.port = port;
    this.path = path;
  }

  read(context: RequestContext): Promise<string> {
    return this.port.read(this.path, context);
  }

  write(value: string, context: RequestContext): Promise<void> {
    return this.port.writeAtomic(this.path, value, context);
  }
}
