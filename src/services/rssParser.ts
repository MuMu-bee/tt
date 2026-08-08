import type { RssFeedItem } from '../data/dashboardTypes';

export function parseRssXml(xml: string): RssFeedItem[] {
	const items: RssFeedItem[] = [];
	const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

	for (const match of xml.matchAll(itemPattern)) {
		const block = match[1];
		if (block === undefined) {
			continue;
		}
		const title = readTag(block, 'title');
		const link = readTag(block, 'link');
		if (!title || !link) {
			continue;
		}
		items.push({
			title,
			link,
			description: readTag(block, 'description') ?? '',
			publishedAt: readTag(block, 'pubDate') ?? '',
		});
		if (items.length === 5) {
			break;
		}
	}

	return items;
}

function readTag(block: string, tag: string): string | undefined {
	const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
	const match = pattern.exec(block);
	if (!match?.[1]) {
		return undefined;
	}
	return cleanXmlText(match[1]);
}

function cleanXmlText(value: string): string {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(code))
		.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeCodePoint(value: string, radix = 10): string {
	const codePoint = Number.parseInt(value, radix);
	return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
		? String.fromCodePoint(codePoint)
		: '';
}
