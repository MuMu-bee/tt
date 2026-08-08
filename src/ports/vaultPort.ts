import type { RequestContext } from '../application/requestContext';

export interface VaultFile {
	path: string;
	basename: string;
	extension: string;
	ctime: number;
	mtime: number;
	frontmatter: Record<string, unknown>;
	tags: string[];
	linksOut: Record<string, number>;
}

export interface VaultPort {
	listMarkdownFiles(context: RequestContext): Promise<VaultFile[]>;
	read(path: string, context: RequestContext): Promise<string>;
	exists(path: string, context: RequestContext): Promise<boolean>;
	ensureFolder(path: string, context: RequestContext): Promise<void>;
	write(path: string, content: string, context: RequestContext): Promise<void>;
}
