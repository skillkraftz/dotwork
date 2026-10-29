import { emptyPage, type Page } from '../format/types';
import { readPage } from '../format/read';
import { expandRead, type Reading } from '../format/tokens';
import { calendarProblem, readingOf, spansOf, type Calendar } from '../format/calendar';
import { withSide, type SpreadSide } from '../format/spread';
import { headerOf, hitsCorner } from '../format/bounds';
import type { ValidationIssue } from '../format/validate';
import type { LayoutProfile } from './impose';
import { layoutOutline, type Block, type Layout } from './outline';
import { readOutline } from './outlineread';

/** A book: a page count, an outline of blocks that makes its pages, and the four cover pages. See docs/book-format.md. */
export interface Book {
  format: 'dotwork-book';
  version: 1;
  name: string;
  /** Interior pages; a multiple of 4. */
  page_count: number;
  page_numbers: boolean;
  /** The book file holds the design only: the one thing about printing that belongs to the book is how many signatures it is split into. Everything else is the printer profile (printer.ts). */
  print: { signatures: number };
  /** The interior pages as blocks, in order (see outline.ts). It is replaced when it changes, never edited in place. */
  outline: Block[];
  /** The days the pages are dated from. A book without one is undated: its date tokens print blank. Replaced when it changes, never edited in place. */
  calendar?: Calendar;
  /** front and back are the inside covers; the outside covers are optional (missing means blank). */
  cover: { front: Page | null; back: Page | null; outside_front?: Page | null; outside_back?: Page | null };
}

/** What the printer profile may hold for each print setting (and the signatures a book may have): the settings fields keep to these. */
export const PRINT_LIMITS = {
  creep_per_sheet_mm: { min: 0, max: 1 },
  fore_edge_shift_mm: { min: -10, max: 10 },
  cover_fore_edge_shift_mm: { min: -10, max: 10 },
  target_fore_edge_margin_mm: { min: 1, max: 10 },
  signatures: { min: 1, max: 20 },
  shade_light_pct: { min: 0, max: 100 },
  shade_medium_pct: { min: 0, max: 100 },
  shade_dark_pct: { min: 0, max: 100 },
  gray_text_pct: { min: 0, max: 100 },
} as const;

/** The limits of each layout's offsets and scale. */
export const LAYOUT_LIMITS = {
  front_offset_x_mm: { min: -10, max: 10 },
  front_offset_y_mm: { min: -10, max: 10 },
  back_offset_x_mm: { min: -10, max: 10 },
  back_offset_y_mm: { min: -10, max: 10 },
  scale_x_pct: { min: 95, max: 105 },
  scale_y_pct: { min: 95, max: 105 },
  back_rotation_deg: { min: -1.5, max: 1.5 },
  line_weight_x_pct: { min: 80, max: 120 },
} as const satisfies Record<keyof LayoutProfile, { min: number; max: number }>;

export const DEFAULT_PAGE_COUNT = 52;
export const MIN_PAGES = 4;
export const MAX_PAGES = 400;

/** The nearest multiple of 4 that holds `n` pages, within the limits. */
export const roundPageCount = (n: number) => Math.min(MAX_PAGES, Math.max(MIN_PAGES, Math.ceil((Number.isFinite(n) ? n : DEFAULT_PAGE_COUNT) / 4) * 4));

/** A blank book: no blocks, so every page is blank. */
export function emptyBook(pageCount = DEFAULT_PAGE_COUNT): Book {
  return {
    format: 'dotwork-book',
    version: 1,
    name: 'Untitled book',
    page_count: roundPageCount(pageCount),
    page_numbers: true,
    print: { signatures: 1 },
    outline: [],
    cover: { front: null, back: null },
  };
}

// ---- slots ---------------------------------------------------------------
// Slot -1 is the outside front cover, slot 0 the inside front cover, slots 1..N the pages, slot N+1 the inside back cover and
// slot N+2 the outside back cover. Odd slots are right-hand pages and even slots left-hand pages, so the inside covers sit
// beside page 1 (right) and page N (left) when the book is open; the outside front cover is a right page and the outside back
// cover a left page, so that they sit side by side on the sheet that prints the outsides (back | front).

export const FIRST_SLOT = -1;
export const lastSlot = (book: Book) => book.page_count + 2;
export const slotSide = (slot: number): SpreadSide => (slot % 2 ? 'right' : 'left');

const layouts = new WeakMap<readonly Block[], { count: number; calendar: Calendar | undefined; layout: Layout }>();

/** What is on every page of the book, worked out from its outline and calendar. Kept for as long as they and the page count are as they were. */
export function bookLayout(book: Book): Layout {
  const kept = layouts.get(book.outline);
  if (kept && kept.count === book.page_count && kept.calendar === book.calendar) return kept.layout;
  const layout = layoutOutline(book.outline, book.page_count, book.calendar);
  layouts.set(book.outline, { count: book.page_count, calendar: book.calendar, layout });
  return layout;
}

/** The design in a slot: a cover, or what the outline puts on that page (a gap page is a Notes page; null is blank). */
export function getSlot(book: Book, slot: number): Page | null {
  if (slot === FIRST_SLOT) return book.cover.outside_front ?? null;
  if (slot === 0) return book.cover.front;
  if (slot === book.page_count + 1) return book.cover.back;
  if (slot === lastSlot(book)) return book.cover.outside_back ?? null;
  return bookLayout(book).cells[slot - 1]?.page ?? null;
}

/** Whether a slot is one of the four cover pages (they print no page number). */
export const isCover = (book: Book, slot: number) => slot < 1 || slot > book.page_count;

/** Put a copy of the page on a cover, turned to face the way that cover faces. null empties it. Covers print no page number, so nothing is checked. */
export function setCover(book: Book, slot: number, page: Page | null): void {
  const put = page && withSide(page, slotSide(slot));
  if (slot === FIRST_SLOT) book.cover.outside_front = put;
  else if (slot === 0) book.cover.front = put;
  else if (slot === book.page_count + 1) book.cover.back = put;
  else if (slot === lastSlot(book)) book.cover.outside_back = put;
  else throw new Error(`Slot ${slot} is not a cover: the outline makes the pages.`);
}

/** Change the page count (rounded to a multiple of 4). The outline is kept; a book it no longer fits is over by the difference. */
export function resizeBook(book: Book, pageCount: number): void {
  book.page_count = roundPageCount(pageCount);
  if (book.cover.back) book.cover.back = withSide(book.cover.back, 'right');
}

/** What the four covers read: the calendar's first month (as a month page reads it), or null for an undated book, whose covers print blank. */
export const coverReading = (book: Book): Reading | null => {
  const first = book.calendar ? spansOf(book.calendar, 'month')[0] : undefined;
  return book.calendar && first ? readingOf(book.calendar, first) : null;
};

/**
 * How a slot turns date tokens into text: by what its block reads (a day, a week or a month of the calendar, see outline.ts). A page
 * with no calendar, a gap page and a page that reads nothing print their tokens blank, so the date can be written in by hand. The
 * covers read the calendar's first month.
 */
export const bookExpand = (book: Book, slot: number) => expandRead(isCover(book, slot) ? coverReading(book) : bookLayout(book).cells[slot - 1]?.read ?? null);

// ---- reading ---------------------------------------------------------------

export type ReadBookResult =
  | { ok: true; book: Book }
  | { ok: false; issues: ValidationIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check a parsed JSON value against the book rules; every page inside is checked against the page format. */
export function readBook(input: unknown): ReadBookResult {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });
  if (!isObject(input)) return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: 'A book file must be a JSON object.' }] };
  if (input.format !== 'dotwork-book') fail('format', 'format', `"format" must be "dotwork-book", got ${JSON.stringify(input.format)}.`);
  if (input.version !== 1) fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 1.`);
  if (typeof input.name !== 'string') fail('name', 'name', '"name" is required and must be a string.');
  const count = input.page_count;
  const countOk = typeof count === 'number' && Number.isInteger(count) && count >= MIN_PAGES && count <= MAX_PAGES && count % 4 === 0;
  if (!countOk) fail('page-count', 'page_count', `"page_count" must be a multiple of 4 from ${MIN_PAGES} to ${MAX_PAGES}, got ${JSON.stringify(count)}.`);
  if (typeof input.page_numbers !== 'boolean') fail('page-numbers', 'page_numbers', '"page_numbers" is required and must be true or false.');

  // Only the signatures count, and only when they make sense. Whatever else is under "print" is ignored: printer settings never decide whether a book opens.
  const saved = isObject(input.print) ? input.print.signatures : undefined;
  const signatures = typeof saved === 'number' && Number.isInteger(saved) && saved >= PRINT_LIMITS.signatures.min && saved <= PRINT_LIMITS.signatures.max ? saved : 1;

  // The covers print no page number, so the page-number corner is not reserved on them.
  const readSlot = (raw: unknown, path: string, side: SpreadSide): Page | null => {
    if (raw === null) return null;
    const r = readPage(isObject(raw) ? { ...raw, page_number: false } : raw);
    if (!r.ok) {
      for (const i of r.issues) issues.push({ ...i, path: i.path === '(file)' ? path : `${path}.${i.path}` });
      return null;
    }
    if (isObject(raw)) r.page.page_number = raw.page_number === false ? false : undefined;
    if (r.page.side !== side) fail('book-side', `${path}.side`, `This page sits on a ${side}-hand page, so it must have "side": "${side}" (got ${JSON.stringify(r.page.side)}).`);
    return r.page;
  };

  const outline = readOutline(input.outline, fail);
  let calendar: Calendar | undefined;
  if (input.calendar !== undefined) {
    const problem = calendarProblem(input.calendar);
    if (problem) fail('calendar', 'calendar', problem);
    else { const c = input.calendar as Calendar; calendar = { start: c.start, end: c.end, week_starts: c.week_starts }; }
  }

  let cover: Book['cover'] = { front: null, back: null };
  if (!isObject(input.cover)) fail('cover', 'cover', '"cover" is required and must be an object with "front" and "back".');
  else {
    for (const k of ['front', 'back'] as const) if (!(k in input.cover)) fail('cover', `cover.${k}`, `"cover.${k}" is required (a page, or null).`);
    cover = { front: readSlot(input.cover.front ?? null, 'cover.front', 'left'), back: readSlot(input.cover.back ?? null, 'cover.back', 'right') };
    // The outside covers are optional. Seen from outside, the front cover is the right page and the back cover the left page.
    if (input.cover.outside_front !== undefined) cover.outside_front = readSlot(input.cover.outside_front, 'cover.outside_front', 'right');
    if (input.cover.outside_back !== undefined) cover.outside_back = readSlot(input.cover.outside_back, 'cover.outside_back', 'left');
  }
  if (issues.length || !outline) return { ok: false, issues };
  return {
    ok: true,
    book: { format: 'dotwork-book', version: 1, name: input.name as string, page_count: count as number, page_numbers: input.page_numbers as boolean, print: { signatures }, outline, ...(calendar ? { calendar } : {}), cover },
  };
}

/** A book from before the outline: it keeps its pages in a list, so it is not read. The Library lists it as Old format. */
export const isOldBook = (data: unknown): boolean => isObject(data) && !('outline' in data);

/** Why a layout's offsets and scale break the book format. */
export function layoutIssues(raw: unknown, path: string): ValidationIssue[] {
  if (!isObject(raw)) return [{ rule: 'print-setting', path, message: `"${path}" must be an object with the offsets and scale.` }];
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(LAYOUT_LIMITS) as (keyof typeof LAYOUT_LIMITS)[]) {
    const { min, max } = LAYOUT_LIMITS[key], v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) issues.push({ rule: 'print-setting', path: `${path}.${key}`, message: `"${key}" must be a number from ${min} to ${max}, got ${JSON.stringify(v)}.` });
  }
  return issues;
}

/** The page that stands in for a slot with nothing in it. */
export const blankPage = (side: SpreadSide): Page => ({ ...emptyPage(), name: 'Blank', identity: '', side });

/**
 * The design shown on book page n (1-based, or a cover slot): what the outline puts there, or a blank page, turned to face the way
 * that slot faces. If turning a page puts something over the page number's corner (see `page-format.md`), its number is turned off.
 */
export function bookPage(book: Book, slot: number): Page {
  const side = slotSide(slot);
  const turned = withSide(getSlot(book, slot) ?? blankPage(side), side);
  if (!isCover(book, slot) && turned.page_number !== false && turned.elements.some((el) => hitsCorner(el, headerOf(turned)))) turned.page_number = false;
  return turned;
}
