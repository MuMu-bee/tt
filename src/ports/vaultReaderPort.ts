import type { RequestContext } from '../application/requestContext';

/** Read-only access to Markdown source files. Implementations must never write. */
export interface VaultReaderPort {
	readMarkdown(path: string, context: RequestContext): Promise<string>;
	listMarkdownPaths(context: RequestContext): Promise<string[]>;
}
