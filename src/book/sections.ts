import type { Page } from '../format/types';
import { readPage } from '../format/read';
import { isDate } from '../format/dates';
import type { ValidationIssue } from '../format/validate';

// A section is a run of pages kept in the Library, with how its dates move each time it repeats. A book's recipe is a list
// of steps, each repeating a section. Both are described in docs/book-format.md. This file holds the types and their readers.

/** How a section's dates move from one repeat to the next. */
export const MOVES = ['none', 'day', 'week', 'month'] as const;
export type Move = (typeof MOVES)[number];
export const MOVE_LABEL: Record<Move, string> = { none: 'Stay the same', day: 'A day later', week: 'A week later', month: 'A month later' };

/** A run of pages, dated relative to its first dated page. */
export interface Section {
  format: 'dotwork-section';
  version: 1;
  name: string;
  /** Page designs, `null` for a blank page. */
  pages: (Page | null)[];
  /** One entry per page: its date as whole days after the section's first dated page, or null for an undated page. */
  days: (number | null)[];
  /** The weekday (0 is Sunday) of the first dated page, so that "each week of a month" starts every repeat on it. */
  weekday: number;
  move: Move;
  /** The section began on a left-hand page; a repeat starts on the same side. */
  left: boolean;
}

/** How often a step's section is placed. */
export type Repeat =
  | { kind: 'times'; count: number }
  /** Once for each week touching a month: the step's own `month` (YYYY-MM), else the recipe's. */
  | { kind: 'weeks'; month?: string; only_in_month: boolean }
  /** As many times as fit in what the other steps leave. At most one step may do this. */
  | { kind: 'fill' };

export interface Step {
  section: Section;
  repeat: Repeat;
  /** The first repeat's date for a times or fill step (YYYY-MM-DD); the 1st of the recipe's month when absent. */
  start?: string;
}

/** What the book builder made the pages from, so it can be run again for another month. */
export interface Recipe {
  /** The month the steps start from, 'YYYY-MM'. */
  month: string;
  /** The page that keeps parts on their side of the spine. A Notes page when absent. */
  gap?: Page;
  steps: Step[];
}

export const MAX_SECTION_PAGES = 100;
export const MAX_STEPS = 40;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isMonth = (v: unknown): v is string => typeof v === 'string' && isDate(`${v}-01`);

type Fail = (rule: string, path: string, message: string) => void;

/** Check a section: every page design inside it against the page format, and its dates and shape. */
function checkSection(raw: unknown, at: string, fail: Fail): Section | null {
  if (!isObject(raw)) { fail('section', at, 'A section must be an object.'); return null; }
  let ok = true;
  const bad = (rule: string, path: string, message: string) => { ok = false; fail(rule, `${at}${path}`, message); };
  if (raw.format !== 'dotwork-section') bad('format', '.format', `"format" must be "dotwork-section", got ${JSON.stringify(raw.format)}.`);
  if (raw.version !== 1) bad('version', '.version', `Unknown version ${JSON.stringify(raw.version)}; this reader understands version 1.`);
  if (typeof raw.name !== 'string') bad('name', '.name', '"name" is required and must be a string.');
  if (!Number.isInteger(raw.weekday) || (raw.weekday as number) < 0 || (raw.weekday as number) > 6) bad('weekday', '.weekday', `"weekday" must be a whole number from 0 (Sunday) to 6, got ${JSON.stringify(raw.weekday)}.`);
  if (!MOVES.includes(raw.move as Move)) bad('move', '.move', `"move" must be one of ${MOVES.join(', ')}, got ${JSON.stringify(raw.move)}.`);
  if (typeof raw.left !== 'boolean') bad('left', '.left', '"left" must be true or false.');
  const list = raw.pages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SECTION_PAGES) {
    bad('pages', '.pages', `"pages" must be a list of 1 to ${MAX_SECTION_PAGES} pages (a page, or null for a blank one).`);
    return null;
  }
  const days = raw.days;
  if (!Array.isArray(days) || days.length !== list.length || days.some((d) => d !== null && !Number.isInteger(d))) {
    bad('days', '.days', '"days" must hold one whole number of days, or null, for each page.');
  }
  const pages = list.map((p: unknown, i: number) => {
    if (p === null) return null;
    const r = readPage(p);
    if (r.ok) return r.page;
    ok = false;
    for (const issue of r.issues) fail(issue.rule, `${at}.pages[${i}]${issue.path === '(file)' ? '' : '.' + issue.path}`, issue.message);
    return null;
  });
  if (!ok) return null;
  return {
    format: 'dotwork-section', version: 1, name: raw.name as string, pages, days: days as (number | null)[],
    weekday: raw.weekday as number, move: raw.move as Move, left: raw.left as boolean,
  };
}

export type ReadSectionResult = { ok: true; section: Section } | { ok: false; issues: ValidationIssue[] };

export function readSection(input: unknown): ReadSectionResult {
  const issues: ValidationIssue[] = [];
  const section = checkSection(input, '', (rule, path, message) => issues.push({ rule, path: path || '(file)', message }));
  return section && !issues.length ? { ok: true, section } : { ok: false, issues };
}

/** Check a recipe: its month, gap page and steps (each with a whole section inside). */
export function readRecipe(raw: unknown, fail: Fail): Recipe | undefined {
  if (!isObject(raw)) { fail('recipe', 'recipe', '"recipe" must be an object.'); return undefined; }
  let ok = true;
  const bad = (path: string, message: string) => { ok = false; fail('recipe', `recipe${path}`, message); };
  if (!isMonth(raw.month)) bad('.month', `"month" must be a month written YYYY-MM, got ${JSON.stringify(raw.month)}.`);
  let gap: Page | undefined;
  if (raw.gap !== undefined) {
    const r = readPage(raw.gap);
    if (r.ok) gap = r.page; else { ok = false; for (const i of r.issues) fail(i.rule, `recipe.gap.${i.path}`, i.message); }
  }
  const steps: Step[] = [];
  if (!Array.isArray(raw.steps) || raw.steps.length > MAX_STEPS) bad('.steps', `"steps" must be a list of at most ${MAX_STEPS} steps.`);
  else raw.steps.forEach((s: unknown, i: number) => {
    const at = `.steps[${i}]`;
    if (!isObject(s)) return bad(at, 'A step must be an object.');
    const section = checkSection(s.section, `recipe${at}.section`, fail);
    if (!section) ok = false;
    const r = s.repeat;
    let repeat: Repeat | undefined;
    if (!isObject(r)) bad(`${at}.repeat`, '"repeat" must be an object with a "kind" of times, weeks or fill.');
    else if (r.kind === 'times') {
      if (!Number.isInteger(r.count) || (r.count as number) < 1 || (r.count as number) > 400) bad(`${at}.repeat.count`, `"count" must be a whole number from 1 to 400, got ${JSON.stringify(r.count)}.`);
      else repeat = { kind: 'times', count: r.count as number };
    } else if (r.kind === 'weeks') {
      if (r.month !== undefined && !isMonth(r.month)) bad(`${at}.repeat.month`, `"month" must be a month written YYYY-MM, got ${JSON.stringify(r.month)}.`);
      else if (typeof r.only_in_month !== 'boolean') bad(`${at}.repeat.only_in_month`, '"only_in_month" must be true or false.');
      else repeat = { kind: 'weeks', ...(r.month ? { month: r.month as string } : {}), only_in_month: r.only_in_month };
    } else if (r.kind === 'fill') repeat = { kind: 'fill' };
    else bad(`${at}.repeat.kind`, `"kind" must be times, weeks or fill, got ${JSON.stringify(r.kind)}.`);
    if (s.start !== undefined && !isDate(s.start)) bad(`${at}.start`, `"start" must be a real day written YYYY-MM-DD, got ${JSON.stringify(s.start)}.`);
    if (section && repeat) steps.push({ section, repeat, ...(s.start ? { start: s.start as string } : {}) });
  });
  if (steps.filter((s) => s.repeat.kind === 'fill').length > 1) bad('.steps', 'Only one step may fill what is left.');
  if (!ok || typeof raw.month !== 'string') return undefined;
  return { month: raw.month, ...(gap ? { gap } : {}), steps };
}
