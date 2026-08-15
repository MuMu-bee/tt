import type { RequestContext } from '../application/requestContext';
import type { VaultDocument } from './vault-document';

export type KeywordField = 'title' | 'path' | 'frontmatter' | 'tags' | 'content';

export interface KeywordIndexEntry {
	document: VaultDocument;
	fields: Record<KeywordField, string>;
}

export interface KeywordSearchResult {
	title: string;
	path: string;
	snippet: string;
	matched_fields: KeywordField[];
	source: 'keyword';
	raw_hash: string;
	open_path: string;
	open: () => string;
	score: number;
}

/** Contract for a rebuildable, read-only keyword index. */
export interface KeywordSearchPort {
	buildAll(documents: VaultDocument[], context: RequestContext): Promise<void>;
	upsert(document: VaultDocument, context: RequestContext): Promise<void>;
	remove(path: string, context: RequestContext): Promise<void>;
	search(query: string, context: RequestContext): Promise<KeywordSearchResult[]>;
}

export function createKeywordEntry(document: VaultDocument): KeywordIndexEntry {
	return {
		document,
		fields: {
			title: document.title,
			path: document.path,
			frontmatter: stringifyFrontmatter(document.frontmatter),
			tags: document.tags.join(' '),
			content: document.body,
		},
	};
}

export function searchKeywordEntries(entries: Iterable<KeywordIndexEntry>, query: string): KeywordSearchResult[] {
	const terms = tokenize(query);
	if (terms.length === 0) return [];
	return [...entries]
		.map((entry) => scoreEntry(entry, terms))
		.filter((result): result is KeywordSearchResult => result !== null)
		.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function scoreEntry(entry: KeywordIndexEntry, terms: string[]): KeywordSearchResult | null {
	const matchedFields = (Object.keys(entry.fields) as KeywordField[]).filter((field) => {
		const value = entry.fields[field].toLocaleLowerCase();
		return terms.some((term) => value.includes(term));
	});
	if (matchedFields.length === 0) return null;
	const score = terms.reduce((total, term) => total + matchedFields.reduce((fieldTotal, field) => {
		return fieldTotal + (entry.fields[field].toLocaleLowerCase().includes(term) ? (field === 'title' ? 10 : 1) : 0);
	}, 0), 0);
	const snippet = createSnippet(entry.document.body, terms);
	return {
		title: entry.document.title,
		path: entry.document.path,
		snippet,
		matched_fields: matchedFields,
		source: 'keyword',
		raw_hash: entry.document.raw_hash,
		open_path: entry.document.path,
		open: () => entry.document.path,
		score,
	};
}

function tokenize(query: string): string[] {
	return [...new Set(query.toLocaleLowerCase().split(/\s+/u).map((term) => term.trim()).filter(Boolean))];
}

function createSnippet(body: string, terms: string[]): string {
	const normalized = body.replace(/\s+/gu, ' ').trim();
	const lower = normalized.toLocaleLowerCase();
	const matchIndex = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
	const start = Math.max(0, matchIndex - 100);
	const end = Math.min(normalized.length, start + 260);
	const prefix = start > 0 ? '…' : '';
	const suffix = end < normalized.length ? '…' : '';
	return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
	return Object.entries(frontmatter).map(([key, value]) => `${key} ${stringifyValue(value)}`).join(' ');
}

function stringifyValue(value: unknown): string {
	if (Array.isArray(value)) return value.map(stringifyValue).join(' ');
	if (typeof value === 'object' && value !== null) {
		return Object.entries(value as Record<string, unknown>)
			.map(([key, child]) => `${key} ${stringifyValue(child)}`)
			.join(' ');
	}
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return value.toString();
	}
	return '';
}
