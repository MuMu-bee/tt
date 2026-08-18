import type { RequestContext } from '../application/requestContext';

/** Write-side port used by workbench services. Generated-content paths may not exist yet, so implementations MAY provide `create`. */
export interface WritePort {
	read(path: string, context: RequestContext): Promise<string>;
	writeAtomic(path: string, content: string, context: RequestContext): Promise<void>;
	/** Creates a new file (used by generated-content writes). Optional to keep legacy fakes compiling. */
	create?(path: string, content: string, context: RequestContext): Promise<void>;
}
