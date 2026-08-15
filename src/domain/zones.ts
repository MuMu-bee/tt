import type { VaultZone } from '../application/contracts';

/**
 * Infers a note's zone from its path and declared frontmatter.
 * Pure function: no obsidian dependency, safe for tests and services.
 */
export function inferZone(path: string, frontmatter: Record<string, unknown>): VaultZone {
	const declared = frontmatter.zone ?? frontmatter.type;
	if (declared === 'fiction' || declared === 'unknown') return declared;
	const normalized = path.replaceAll('\\', '/').toLocaleLowerCase();
	if (normalized.startsWith('fiction/') || normalized.startsWith('小说/')) return 'fiction';
	if (normalized.startsWith('unknown/') || normalized.startsWith('未分类/')) return 'unknown';
	return 'normal';
}
