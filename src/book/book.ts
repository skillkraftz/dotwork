import { emptyPage, type Page } from '../format/types';
import { readPage } from '../format/read';
import { isDate } from '../format/dates';
import { expandFor, usesDates } from '../format/tokens';
import { withSide, type SpreadSide } from '../format/spread';
import { headerOf, hitsCorner } from '../format/bounds';
import type { ValidationIssue } from '../format/validate';
import { DEFAULT_PRINT, type PrintSettings } from './impose';
import { readRecipe, type Recipe } from './sections';

/** A book: a page count, a design for every page you have filled, and the two inside covers. See docs/book-format.md. */
export interface Book {
  format: 'dotwork-book';
  version: 1;
  name: string;
  /** Interior pages; a multiple of 4. */
  page_count: number;
  page_numbers: boolean;
  print: PrintSettings;
  /** Index 0 is page 1. null leaves the page blank. */
  pages: (Page | null)[];
  /** Index 0 is page 1: the date its tokens are filled from, as 'YYYY-MM-DD', or null. Missing means no page has a date. */
  dates?: (string | null)[];
  cover: { front: Page | null; back: Page | null };
  /** The steps the book builder made the pages from, so it can be run again for another month. See docs/book-format.md. */
  recipe?: Recipe;
}

/** What a book file may hold for each print setting: the file format's limits, which the settings fields keep to. */
export const PRINT_LIMITS = {
  creep_per_sheet_mm: { min: 0, max: 1 },
  fore_edge_shift_mm: { min: -10, max: 10 },
  cover_fore_edge_shift_mm: { min: -10, max: 10 },
  target_fore_edge_margin_mm: { min: 1, max: 10 },
  front_offset_x_mm: { min: -10, max: 10 },
  front_offset_y_mm: { min: -10, max: 10 },
  back_offset_x_mm: { min: -10, max: 10 },
  back_offset_y_mm: { min: -10, max: 10 },
  signatures: { min: 1, max: 20 },
  shade_light_pct: { min: 0, max: 100 },
  shade_medium_pct: { min: 0, max: 100 },
  shade_dark_pct: { min: 0, max: 100 },
  gray_text_pct: { min: 0, max: 100 },
} as const;

export const DEFAULT_PAGE_COUNT = 52;
export const MIN_PAGES = 4;
export const MAX_PAGES = 400;

/** The nearest multiple of 4 that holds `n` pages, within the limits. */
export const roundPageCount = (n: number) => Math.min(MAX_PAGES, Math.max(MIN_PAGES, Math.ceil((Number.isFinite(n) ? n : DEFAULT_PAGE_COUNT) / 4) * 4));

/** A blank book. New books start from the printer's saved settings when given them (see printer.ts), else the defaults. */
export function emptyBook(pageCount = DEFAULT_PAGE_COUNT, print: PrintSettings = DEFAULT_PRINT): Book {
  const count = roundPageCount(pageCount);
  return {
    format: 'dotwork-book',
    version: 1,
    name: 'Untitled book',
    page_count: count,
    page_numbers: true,
    print: { ...print },
    pages: Array.from({ length: count }, () => null),
    cover: { front: null, back: null },
  };
}

// ---- slots ---------------------------------------------------------------
// Slot 0 is the inside front cover, slots 1..N the pages, slot N+1 the inside back cover.
// Odd slots are right-hand pages and even slots left-hand pages, so the covers sit
// beside page 1 (right) and page N (left) when the book is open.

export const slotCount = (book: Book) => book.page_count + 2;
export const slotSide = (slot: number): SpreadSide => (slot % 2 ? 'right' : 'left');

export function getSlot(book: Book, slot: number): Page | null {
  if (slot === 0) return book.cover.front;
  if (slot === book.page_count + 1) return book.cover.back;
  return book.pages[slot - 1] ?? null;
}

const isCover = (book: Book, slot: number) => slot === 0 || slot === book.page_count + 1;

/**
 * Put a copy of the page in the slot, turned to face the way that slot faces. null empties it.
 * The page number's corner is at the outer edge, so it moves when the side changes. If the copy would then cover the
 * number, its page number is turned off (the design you placed is untouched) and this returns true. The inside covers
 * never print a number, so they are not checked.
 */
export function setSlot(book: Book, slot: number, page: Page | null): boolean {
  const put = page && withSide(page, slotSide(slot));
  let numberOff = false;
  if (put && !isCover(book, slot) && put.page_number !== false && put.elements.some((el) => hitsCorner(el, headerOf(put)))) {
    put.page_number = false;
    numberOff = true;
  }
  if (slot === 0) book.cover.front = put;
  else if (slot === book.page_count + 1) book.cover.back = put;
  else book.pages[slot - 1] = put;
  // A page that prints nothing from a date has no use for one.
  if (!isCover(book, slot) && dateOf(book, slot) && !usesDates(put)) setDates(book, slot, [null]);
  return numberOff;
}

/** A left and a right page: a spread, or the two pages of an opening (either may be blank). */
export interface Facing { left: Page | null; right: Page | null }
/** What can be put on slots: one page, a left/right pair, or null to empty them. */
export type Design = Page | Facing | null;

const isFacing = (d: Design): d is Facing => d !== null && 'left' in d;

/** The page a design puts on a slot: a pair gives its left page to left slots and its right page to right slots. */
export const designAt = (design: Design, slot: number): Page | null => (isFacing(design) ? design[slotSide(slot)] : design);

/** Put the design on each of the slots. Returns the slots whose page number had to be turned off. */
export function applyDesign(book: Book, slots: number[], design: Design): number[] {
  return slots.filter((slot) => setSlot(book, slot, designAt(design, slot)));
}

/** Fill slots from..to (inclusive) with one design. Returns the slots whose page number had to be turned off. */
export function fillSlots(book: Book, from: number, to: number, design: Design): number[] {
  const lo = Math.max(0, Math.min(from, to)), hi = Math.min(book.page_count + 1, Math.max(from, to));
  return applyDesign(book, Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i), design);
}

/** Change the page count (rounded to a multiple of 4). Pages beyond the new end are dropped. */
export function resizeBook(book: Book, pageCount: number): void {
  const count = roundPageCount(pageCount);
  book.pages = Array.from({ length: count }, (_, i) => book.pages[i] ?? null);
  if (book.dates) book.dates = Array.from({ length: count }, (_, i) => book.dates![i] ?? null);
  book.page_count = count;
  if (book.cover.back) book.cover.back = withSide(book.cover.back, 'right');
}

/** How many pages (not covers) hold a design that would be lost by shrinking to `pageCount`. */
export const pagesLostByResize = (book: Book, pageCount: number) =>
  book.pages.slice(roundPageCount(pageCount)).filter((p) => p !== null).length;

// ---- dates -----------------------------------------------------------------

/** The date of interior page `slot`, or null (undated pages, and the covers, have none). */
export const dateOf = (book: Book, slot: number): string | null => (slot >= 1 && slot <= book.page_count ? book.dates?.[slot - 1] ?? null : null);

/** Give consecutive pages starting at `from` these dates (null clears a page). Pages beyond the end are ignored; a book with no dates left drops the list. */
export function setDates(book: Book, from: number, dates: (string | null)[]): void {
  const all = Array.from({ length: book.page_count }, (_, i) => book.dates?.[i] ?? null);
  dates.forEach((d, k) => { if (from + k >= 1 && from + k <= book.page_count) all[from + k - 1] = d; });
  if (all.some(Boolean)) book.dates = all; else delete book.dates;
}

/**
 * Rearrange pages: slot `slots[i]` takes what slot `sources[i]` held, its design and its date (dates go with their page).
 * Returns the slots whose page number had to be turned off.
 */
function carry(book: Book, slots: number[], sources: number[]): number[] {
  const held = sources.map((s) => ({ page: getSlot(book, s), date: dateOf(book, s) }));
  const off = slots.filter((slot, i) => setSlot(book, slot, held[i].page));
  slots.forEach((slot, i) => setDates(book, slot, [held[i].date]));
  return off;
}

/** Swap two pages, each keeping its date. */
export const swapPages = (book: Book, a: number, b: number): number[] => carry(book, [a, b], [b, a]);

/** Take page `from` out and put it back at `to`, the pages between shifting by one; every page keeps its date. */
export function movePage(book: Book, from: number, to: number): number[] {
  if (from === to) return [];
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const slots = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return carry(book, slots, from < to ? [...slots.slice(1), from] : [from, ...slots.slice(0, -1)]);
}

/** How the tokens on a slot's page become text: filled from its date, or left blank. */
export const bookExpand = (book: Book, slot: number) => expandFor(dateOf(book, slot));

// ---- reading ---------------------------------------------------------------

export type ReadBookResult =
  | { ok: true; book: Book; converted: boolean }
  | { ok: false; issues: ValidationIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check a parsed JSON value against the book rules; every page inside is checked against the page format and the side of its slot. */
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

  const print = isObject(input.print) ? input.print : undefined;
  if (!print) fail('print', 'print', '"print" is required and must be an object.');
  else {
    for (const key of Object.keys(PRINT_LIMITS) as (keyof typeof PRINT_LIMITS)[]) {
      const { min, max } = PRINT_LIMITS[key], v = print[key];
      const whole = key === 'signatures';
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
        fail('print-setting', `print.${key}`, `"${key}" must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}, got ${JSON.stringify(v)}.`);
      }
    }
  }

  let converted = false;
  // The inside covers print no page number, so the page-number corner is not reserved on them.
  const readSlot = (raw: unknown, path: string, side: SpreadSide, cover = false): Page | null => {
    if (raw === null) return null;
    const r = readPage(cover && isObject(raw) ? { ...raw, page_number: false } : raw);
    if (!r.ok) {
      for (const i of r.issues) issues.push({ ...i, path: i.path === '(file)' ? path : `${path}.${i.path}` });
      return null;
    }
    converted ||= r.converted;
    if (cover && isObject(raw)) r.page.page_number = raw.page_number === false ? false : undefined;
    if (r.page.side !== side) fail('book-side', `${path}.side`, `This page sits on a ${side}-hand page, so it must have "side": "${side}" (got ${JSON.stringify(r.page.side)}).`);
    return r.page;
  };

  let pages: (Page | null)[] = [];
  if (!Array.isArray(input.pages)) fail('pages-array', 'pages', '"pages" is required and must be an array.');
  else if (countOk && input.pages.length !== count) fail('pages-length', 'pages', `"pages" must hold exactly page_count (${count}) entries, got ${input.pages.length}.`);
  else pages = input.pages.map((raw: unknown, i: number) => readSlot(raw, `pages[${i}]`, slotSide(i + 1)));

  let dates: (string | null)[] | undefined;
  if (input.dates !== undefined) {
    if (!Array.isArray(input.dates)) fail('dates', 'dates', '"dates" must be a list with one date (YYYY-MM-DD) or null for each page.');
    else if (countOk && input.dates.length !== count) fail('dates', 'dates', `"dates" must hold exactly page_count (${count}) entries, got ${input.dates.length}.`);
    else {
      input.dates.forEach((d: unknown, i: number) => {
        if (d !== null && !isDate(d)) fail('dates', `dates[${i}]`, `A date must be a real day written YYYY-MM-DD, or null (got ${JSON.stringify(d)}).`);
      });
      dates = input.dates as (string | null)[];
    }
  }

  let recipe: Recipe | undefined;
  if (input.recipe !== undefined) recipe = readRecipe(input.recipe, fail);

  let cover = { front: null as Page | null, back: null as Page | null };
  if (!isObject(input.cover)) fail('cover', 'cover', '"cover" is required and must be an object with "front" and "back".');
  else {
    for (const k of ['front', 'back'] as const) if (!(k in input.cover)) fail('cover', `cover.${k}`, `"cover.${k}" is required (a page, or null).`);
    cover = { front: readSlot(input.cover.front ?? null, 'cover.front', 'left', true), back: readSlot(input.cover.back ?? null, 'cover.back', 'right', true) };
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    converted,
    book: { format: 'dotwork-book', version: 1, name: input.name as string, page_count: count as number, page_numbers: input.page_numbers as boolean, print: print as unknown as PrintSettings, pages, ...(dates ? { dates } : {}), cover, ...(recipe ? { recipe } : {}) },
  };
}

/** The page that stands in for a slot with nothing in it. */
export const blankPage = (side: SpreadSide): Page => ({ ...emptyPage(), name: 'Blank', identity: '', side });

/** The design shown on book page n (1-based, or a cover slot): what is in the slot, or a blank page, turned to face the way that slot faces. */
export function bookPage(book: Book, slot: number): Page {
  return withSide(getSlot(book, slot) ?? blankPage(slotSide(slot)), slotSide(slot));
}
