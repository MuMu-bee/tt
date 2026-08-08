export interface VaultReaderPort {
	readMarkdown(path: string): Promise<string>;
	listMarkdownPaths(): string[];
}
