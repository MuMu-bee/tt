/** Extracts [[wikilinks]] from markdown body. */
export function extractLinks(body: string): string[] {
	const results: string[] = [];
	const seen = new Set<string>();
	const parts = body.split('[[');
	parts.forEach((segment) => {
		const end = segment.indexOf(']]');
		if (end === -1) return;
		const link = segment.slice(0, end).split('|')[0]?.trim() ?? '';
		if (link && !seen.has(link)) { seen.add(link); results.push(link); }
	});
	return results;
}