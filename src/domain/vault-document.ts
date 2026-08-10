import { sha256Hex } from '../utils/sha256.ts';

/** Markdown document and its lossless source metadata used by the read-only index. */
export interface VaultDocument {
	path: string;
	title: string;
	frontmatter: Record<string, unknown>;
	tags: string[];
	body: string;
	raw: string;
	raw_hash: string;
}

/** Parses one Markdown document without mutating or normalizing its source text. */
export function parseVaultDocument(path: string, raw: string): VaultDocument {
	const frontmatterResult = parseYamlFrontmatter(raw);
	const body = frontmatterResult.body;
	const titleMatch = /^\s*#\s+(.+?)\s*$/m.exec(body);
	const basename = path.split('/').pop() ?? path;
	const title = titleMatch?.[1] ?? basename.replace(/\.md$/iu, '');
	const tags = extractTags(frontmatterResult.frontmatter, body);
	return {
		path,
		title: title.trim(),
		frontmatter: frontmatterResult.frontmatter,
		tags,
		body,
		raw,
		raw_hash: hashRaw(raw),
	};
}

/** Returns a stable SHA-256 digest of the original UTF-8 source bytes. */
export function hashRaw(raw: string): string {
	return sha256Hex(raw);
}

export interface FrontmatterResult {
	frontmatter: Record<string, unknown>;
	body: string;
}

/** Parses optional YAML frontmatter; malformed or missing frontmatter is treated as empty. */
export function parseYamlFrontmatter(raw: string): FrontmatterResult {
	const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(raw);
	if (!match) return { frontmatter: {}, body: raw };
	return {
		frontmatter: parseYamlMap(match[1] ?? ''),
		body: raw.slice(match[0].length),
	};
}

interface YamlLine {
	indent: number;
	text: string;
}

function parseYamlMap(source: string): Record<string, unknown> {
	const lines: YamlLine[] = source.split(/\r?\n/).flatMap((line) => {
		const text = line.trim();
		if (!text || text.startsWith('#')) return [];
		const indent = line.length - line.trimStart().length;
		return [{ indent, text }];
	});
	const result = parseBlock(lines, 0, lines[0]?.indent ?? 0).value;
	return isRecord(result) ? result : {};
}

function parseBlock(lines: YamlLine[], start: number, indent: number): { value: unknown; next: number } {
	const isArray = lines[start]?.indent === indent && lines[start]?.text.startsWith('-');
	const value: Record<string, unknown> | unknown[] = isArray ? [] : {};
	const arrayValue = value as unknown[];
	const objectValue = value as Record<string, unknown>;
	let index = start;
	while (index < lines.length) {
		const line = lines[index];
		if (!line || line.indent < indent) break;
		if (line.indent > indent) break;
		const nextLine = lines[index + 1];
		if (isArray) {
			if (!line.text.startsWith('-')) break;
			const itemText = line.text.slice(1).trim();
			if (!itemText) {
				const childIndent = nextLine?.indent;
				const child = childIndent !== undefined && childIndent > indent
					? parseBlock(lines, index + 1, childIndent)
					: { value: null, next: index + 1 };
				arrayValue.push(child.value);
				index = child.next;
				continue;
			}
			const pair = splitKeyValue(itemText);
			if (pair) {
				const object: Record<string, unknown> = { [pair.key]: pair.value ? parseScalar(pair.value) : null };
				const childIndent = nextLine?.indent;
				if (!pair.value && childIndent !== undefined && childIndent > indent) {
					const child = parseBlock(lines, index + 1, childIndent);
					object[pair.key] = child.value;
					index = child.next;
				} else {
					index += 1;
				}
				arrayValue.push(object);
				continue;
			}
			arrayValue.push(parseScalar(itemText));
			index += 1;
			continue;
		}
		const pair = splitKeyValue(line.text);
		if (!pair) {
			index += 1;
			continue;
		}
		if (pair.value) {
			objectValue[pair.key] = parseScalar(pair.value);
			index += 1;
			continue;
		}
		const childIndent = nextLine?.indent;
		if (childIndent !== undefined && childIndent > indent) {
			const child = parseBlock(lines, index + 1, childIndent);
			objectValue[pair.key] = child.value;
			index = child.next;
		} else {
			objectValue[pair.key] = null;
			index += 1;
		}
	}
	return { value, next: index };
}

function splitKeyValue(text: string): { key: string; value: string } | null {
	const separator = text.indexOf(':');
	if (separator <= 0) return null;
	return { key: text.slice(0, separator).trim(), value: text.slice(separator + 1).trim() };
}

function parseScalar(value: string): unknown {
	const unquoted = value.replace(/^(['"])([\s\S]*)\1$/u, '$2');
	if (unquoted !== value) return unquoted;
	if (value === 'null' || value === '~') return null;
	if (value === 'true' || value === 'True' || value === 'TRUE') return true;
	if (value === 'false' || value === 'False' || value === 'FALSE') return false;
	if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(value)) return Number(value);
	if (value.startsWith('[') && value.endsWith(']')) {
		return splitInline(value.slice(1, -1)).map((item) => parseScalar(item.trim())).filter((item) => item !== '');
	}
	return value;
}

function splitInline(value: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote = '';
	for (const character of value) {
		if ((character === '"' || character === "'") && !quote) quote = character;
		else if (character === quote) quote = '';
		if (character === ',' && !quote) {
			parts.push(current);
			current = '';
		} else current += character;
	}
	if (current.trim()) parts.push(current);
	return parts;
}

function extractTags(frontmatter: Record<string, unknown>, body: string): string[] {
	const value = frontmatter.tags;
	const frontmatterTags = Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: typeof value === 'string' ? value.split(/[ ,]+/u) : [];
	const inlineTags = body.split(/\r?\n/u)
		.filter((line) => !/^\s*#{1,6}\s/u.test(line))
		.flatMap((line) => [...line.matchAll(/(^|\s)#(?!#)([\p{L}\p{N}_/-]+)/gu)].map((match) => match[2]))
		.filter((tag): tag is string => Boolean(tag));
	return [...new Set([...frontmatterTags, ...inlineTags].map((tag) => tag.replace(/^#/u, '')))].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
