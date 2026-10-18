import { emptyPage, type Page } from '../format/types';
import { readPage } from '../format/read';
import { withSide, type Spread, type SpreadSide } from '../format/spread';
import type { ValidationIssue } from '../format/validate';
import { DEFAULT_PRINT, type PrintSettings } from './impose';

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
  cover: { front: Page | null; back: Page | null };
}

export const DEFAULT_PAGE_COUNT = 52;
export const MIN_PAGES = 4;
export const MAX_PAGES = 400;

/** The nearest multiple of 4 that holds `n` pages, within the limits. */
export const roundPageCount = (n: number) => Math.min(MAX_PAGES, Math.max(MIN_PAGES, Math.ceil((Number.isFinite(n) ? n : DEFAULT_PAGE_COUNT) / 4) * 4));

export function emptyBook(pageCount = DEFAULT_PAGE_COUNT): Book {
  const count = roundPageCount(pageCount);
  return {
    format: 'dotwork-book',
    version: 1,
    name: 'Untitled book',
    page_count: count,
    page_numbers: true,
    print: { ...DEFAULT_PRINT },
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

/** Put a copy of the page in the slot, turned to face the way that slot faces. null empties it. */
export function setSlot(book: Book, slot: number, page: Page | null): void {
  const put = page && withSide(page, slotSide(slot));
  if (slot === 0) book.cover.front = put;
  else if (slot === book.page_count + 1) book.cover.back = put;
  else book.pages[slot - 1] = put;
}

/** Fill slots from..to (inclusive) with one design. A spread puts its left page on left slots and its right page on right slots. */
export function fillSlots(book: Book, from: number, to: number, design: Page | Spread): void {
  const lo = Math.max(0, Math.min(from, to)), hi = Math.min(book.page_count + 1, Math.max(from, to));
  for (let slot = lo; slot <= hi; slot++) {
    setSlot(book, slot, design.format === 'dotwork-spread' ? design[slotSide(slot)] : design);
  }
}

/** Change the page count (rounded to a multiple of 4). Pages beyond the new end are dropped. */
export function resizeBook(book: Book, pageCount: number): void {
  const count = roundPageCount(pageCount);
  book.pages = Array.from({ length: count }, (_, i) => book.pages[i] ?? null);
  book.page_count = count;
  if (book.cover.back) book.cover.back = withSide(book.cover.back, 'right');
}

/** How many pages (not covers) hold a design that would be lost by shrinking to `pageCount`. */
export const pagesLostByResize = (book: Book, pageCount: number) =>
  book.pages.slice(roundPageCount(pageCount)).filter((p) => p !== null).length;

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
    const num = (key: string, ok: (v: number) => boolean, what: string) => {
      const v = print[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || !ok(v)) fail('print-setting', `print.${key}`, `"${key}" must be ${what}, got ${JSON.stringify(v)}.`);
    };
    num('paper_thickness_mm', (v) => v >= 0 && v <= 1, 'a number from 0 to 1');
    num('back_offset_x_mm', (v) => Math.abs(v) <= 10, 'a number from -10 to 10');
    num('back_offset_y_mm', (v) => Math.abs(v) <= 10, 'a number from -10 to 10');
    num('signatures', (v) => Number.isInteger(v) && v >= 1 && v <= 20, 'a whole number from 1 to 20');
  }

  let converted = false;
  const readSlot = (raw: unknown, path: string, side: SpreadSide): Page | null => {
    if (raw === null) return null;
    const r = readPage(raw);
    if (!r.ok) {
      for (const i of r.issues) issues.push({ ...i, path: i.path === '(file)' ? path : `${path}.${i.path}` });
      return null;
    }
    converted ||= r.converted;
    if (r.page.side !== side) fail('book-side', `${path}.side`, `This page sits on a ${side}-hand page, so it must have "side": "${side}" (got ${JSON.stringify(r.page.side)}).`);
    return r.page;
  };

  let pages: (Page | null)[] = [];
  if (!Array.isArray(input.pages)) fail('pages-array', 'pages', '"pages" is required and must be an array.');
  else if (countOk && input.pages.length !== count) fail('pages-length', 'pages', `"pages" must hold exactly page_count (${count}) entries, got ${input.pages.length}.`);
  else pages = input.pages.map((raw: unknown, i: number) => readSlot(raw, `pages[${i}]`, slotSide(i + 1)));

  let cover = { front: null as Page | null, back: null as Page | null };
  if (!isObject(input.cover)) fail('cover', 'cover', '"cover" is required and must be an object with "front" and "back".');
  else {
    for (const k of ['front', 'back'] as const) if (!(k in input.cover)) fail('cover', `cover.${k}`, `"cover.${k}" is required (a page, or null).`);
    cover = { front: readSlot(input.cover.front ?? null, 'cover.front', 'left'), back: readSlot(input.cover.back ?? null, 'cover.back', 'right') };
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    converted,
    book: { format: 'dotwork-book', version: 1, name: input.name as string, page_count: count as number, page_numbers: input.page_numbers as boolean, print: print as unknown as PrintSettings, pages, cover },
  };
}

/** The page that stands in for a slot with nothing in it. */
export const blankPage = (side: SpreadSide): Page => ({ ...emptyPage(), name: 'Blank', identity: '', side });

/** The design shown on book page n (1-based, or a cover slot): what is in the slot, or a blank page, turned to face the way that slot faces. */
export function bookPage(book: Book, slot: number): Page {
  return withSide(getSlot(book, slot) ?? blankPage(slotSide(slot)), slotSide(slot));
}
