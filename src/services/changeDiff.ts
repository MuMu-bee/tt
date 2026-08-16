import type { ChangeKind, NoteRecord } from '../application/contracts.ts';

export interface ChangeDiff { before: string; after: string; diff: string }

/** Produces a conservative, local change. Returns null when no change is needed. */
export function createChangeDiff(note: NoteRecord, kind: ChangeKind, options: { frontmatterKey?: string; frontmatterValue?: string; tag?: string; linkTarget?: string } = {}): ChangeDiff | null {
  if (kind === 'frontmatter-add') return addFrontmatter(note.content, options.frontmatterKey ?? 'workbench', options.frontmatterValue ?? 'organized');
  if (kind === 'tag-add') return addTag(note.content, options.tag ?? 'organized');
  if (kind === 'bidirectional-link-add') {
    const target = options.linkTarget ?? frontmatterString(note.frontmatter, 'related');
    if (!target) return null;
    /* 禁止自链接：指向笔记自身标题或文件名的链接不建立任何真实关系。 */
    const basename = (note.path.split('/').pop() ?? '').replace(/\.md$/iu, '');
    if (target === note.title || target === basename) return null;
    return addLink(note.content, target);
  }
  return normalizeFormat(note.content);
}

function addFrontmatter(before: string, key: string, value: string): ChangeDiff | null {
  if (!key || /^\s*---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)/u.test(before) && new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`, 'mu').test(before.split(/\r?\n(?:---|\.\.\.)/u, 1)[0] ?? '')) return null;
  const line = `${key}: ${value}`;
  const match = /^(?:\uFEFF)?---\r?\n/u.exec(before);
  const after = match ? `${before.slice(0, match[0].length)}${line}\n${before.slice(match[0].length)}` : `---\n${line}\n---\n${before}`;
  return diff(before, after, `add frontmatter ${key}`);
}

function addTag(before: string, tag: string): ChangeDiff | null {
  const normalized = tag.replace(/^#/u, '').trim();
  if (!normalized || new RegExp(`(^|\\s)#${escapeRegExp(normalized)}(?:\\s|$)`, 'u').test(before)) return null;
  const after = `${before.replace(/\s*$/u, '')}\n\n#${normalized}\n`;
  return diff(before, after, `add tag #${normalized}`);
}

function addLink(before: string, target: string): ChangeDiff | null {
  const clean = target.replace(/^\[\[|\]\]$/gu, '').trim();
  if (!clean || before.includes(`[[${clean}]]`)) return null;
  const after = `${before.replace(/\s*$/u, '')}\n\nRelated: [[${clean}]]\n`;
  return diff(before, after, `add bidirectional link [[${clean}]]`);
}

function normalizeFormat(before: string): ChangeDiff | null {
  const after = before.replace(/\r\n/gu, '\n').replace(/[ \t]+\n/gu, '\n').replace(/\n*$/u, '\n');
  return diff(before, after, 'normalize Markdown line endings and trailing newline');
}

function diff(before: string, after: string, reason: string): ChangeDiff | null {
  if (before === after) return null;
  return { before, after, diff: `--- before\n+++ after\n@@ ${reason} @@\n-${before}\n+${after}` };
}
function frontmatterString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(candidate)) {
    const first = candidate.find((item): item is string => typeof item === 'string');
    return first;
  }
  return undefined;
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
