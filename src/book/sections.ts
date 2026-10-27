import type { ValidationIssue } from '../format/validate';
import { groupBlock, type Child, type GroupBlock } from './outline';
import { readOutline } from './outlineread';

// A section is a group kept in the Library: its blocks and their repeats, but not the repeat or pin of the place it is put.
// Placing a section in a book adds a group. See docs/library-format.md.

export interface Section {
  format: 'dotwork-section';
  version: 1;
  name: string;
  children: Child[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A section from before the outline keeps a list of `pages` with dates. It is not read: the Library lists it as Old format. */
export const isOldSection = (data: unknown): boolean => isObject(data) && !('children' in data);

/** The group a section adds to a book: its blocks, repeated once. */
export const sectionGroup = (s: Section): GroupBlock => groupBlock(s.name, structuredClone(s.children));

export type ReadSectionResult = { ok: true; section: Section } | { ok: false; issues: ValidationIssue[] };

/** Check a section: its blocks are read as the children of a group. */
export function readSection(input: unknown): ReadSectionResult {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });
  if (!isObject(input)) return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: 'A section must be a JSON object.' }] };
  if (input.format !== 'dotwork-section') fail('format', 'format', `"format" must be "dotwork-section", got ${JSON.stringify(input.format)}.`);
  if (input.version !== 1) fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 1.`);
  if (typeof input.name !== 'string') fail('name', 'name', '"name" is required and must be a string.');
  const read = readOutline([{ type: 'group', name: 'section', children: input.children, repeat: { times: 1 } }], (rule, path, message) => fail(rule, path.replace(/^outline\[0\]\.children/, 'children'), message));
  if (issues.length || !read) return { ok: false, issues };
  return { ok: true, section: { format: 'dotwork-section', version: 1, name: input.name as string, children: (read[0] as GroupBlock).children } };
}
