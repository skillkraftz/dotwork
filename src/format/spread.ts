import { emptyPage, type Page } from './types';
import { readPage } from './read';
import type { ValidationIssue } from './validate';

/** A left page and a right page that sit either side of the spine. */
export interface Spread {
  format: 'dotwork-spread';
  version: 2;
  name: string;
  left: Page;
  right: Page;
}

export type SpreadSide = 'left' | 'right';

export type ReadSpreadResult =
  | { ok: true; spread: Spread }
  | { ok: false; issues: ValidationIssue[] };

/** A copy of the page that belongs on the given side of a spread. */
export function withSide(page: Page, side: SpreadSide): Page {
  return { ...structuredClone(page), side };
}

/** Pair two pages into a spread, putting each on its side whatever side it was designed for. */
export function buildSpread(name: string, left: Page, right: Page): Spread {
  return { format: 'dotwork-spread', version: 2, name, left: withSide(left, 'left'), right: withSide(right, 'right') };
}

export function emptySpread(): Spread {
  return buildSpread('Untitled spread', { ...emptyPage(), name: 'Left page' }, { ...emptyPage(), name: 'Right page' });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check a parsed JSON value against the spread rules; each page must be a valid page on its own side. */
export function readSpread(input: unknown): ReadSpreadResult {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });
  if (!isObject(input)) {
    return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: 'A spread file must be a JSON object.' }] };
  }
  if (input.format !== 'dotwork-spread') fail('format', 'format', `"format" must be "dotwork-spread", got ${JSON.stringify(input.format)}.`);
  if (input.version !== 2) fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 2.`);
  if (typeof input.name !== 'string') fail('name', 'name', '"name" is required and must be a string.');

  const pages: Partial<Record<SpreadSide, Page>> = {};
  for (const side of ['left', 'right'] as const) {
    const r = readPage(input[side]);
    if (!r.ok) {
      for (const i of r.issues) issues.push({ ...i, path: i.path === '(file)' ? side : `${side}.${i.path}` });
      continue;
    }
    if (r.page.side !== side) {
      fail('spread-side', `${side}.side`, `The ${side} page must have "side": "${side}" (got ${JSON.stringify(r.page.side)}).`);
    }
    pages[side] = r.page;
  }
  if (issues.length || !pages.left || !pages.right) return { ok: false, issues };
  return { ok: true, spread: { format: 'dotwork-spread', version: 2, name: input.name as string, left: pages.left, right: pages.right } };
}
