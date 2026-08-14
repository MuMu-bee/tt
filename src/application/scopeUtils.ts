import type { SearchScope } from './contracts';

/**
 * Path-level scope checks shared by the keyword index and the semantic
 * search adapter. Tag filtering needs per-document tag data, so callers
 * apply it after this check.
 */
export function allowsPath(path: string, scope: SearchScope | undefined): boolean {
	if (!scope) return true;
	const normalizedPath = path.replaceAll('\\', '/');
	const matches = (value: string): boolean => {
		const normalizedValue = value.replaceAll('\\', '/').replace(/\/$/u, '');
		return normalizedPath === normalizedValue || normalizedPath.startsWith(`${normalizedValue}/`);
	};
	if (scope.excludes?.some((value) => matches(value))) return false;
	if (scope.kind === 'global') return true;
	if (scope.kind === 'file') return normalizedPath === (scope.value ?? '').replaceAll('\\', '/');
	if (scope.kind === 'prefix') return normalizedPath.startsWith((scope.value ?? '').replaceAll('\\', '/'));
	return true; // tag 过滤依赖文档标签数据，由调用方（索引）补充
}
