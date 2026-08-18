import type { SearchScope } from './contracts';

/**
 * Path-level scope checks shared by the keyword index and the semantic
 * search adapter. Tag filtering needs per-document tag data, so callers
 * apply it after this check.
 */
export function allowsPath(path: string, scope: SearchScope | undefined): boolean {
	if (!scope) return true;
	const normalizedPath = path.replaceAll('\\', '/');
	const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/u, '');
	const matches = (value: string): boolean => {
		const normalizedValue = normalize(value);
		return normalizedPath === normalizedValue || normalizedPath.startsWith(normalizedValue + '/');
	};
	if (scope.excludes?.some((value) => matches(value))) return false;
	/* Explicit includes act as a whitelist: any match is sufficient. */
	if (scope.includes && scope.includes.length > 0) return scope.includes.some((value) => matches(value));
	if (scope.kind === 'global') return true;
	if (scope.kind === 'file') return normalizedPath === normalize(scope.value ?? '');
	if (scope.kind === 'prefix') {
		const prefix = normalize(scope.value ?? '');
		return normalizedPath === prefix || normalizedPath.startsWith(prefix + '/');
	}
	return true; // tag 过滤依赖文档标签数据，由调用方（索引）补充
}
