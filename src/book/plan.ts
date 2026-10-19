import type { Page } from '../format/types';
import { getSlot, slotCount, type Book } from './book';

/** Which pages "apply to more pages" reaches. Page numbers are 1-based; the covers are never part of a range. */
export type Scope =
  | { mode: 'range'; from: number; to: number }
  | { mode: 'from'; to: number }
  | { mode: 'left'; from: number; to: number }
  | { mode: 'right'; from: number; to: number };

/** The interior pages a scope covers, in order. `current` is the page the scope starts from ("here"). */
export function scopeSlots(book: Book, scope: Scope, current: number): number[] {
  const last = book.page_count;
  const clamp = (n: number) => Math.min(last, Math.max(1, Math.round(n)));
  const lo = scope.mode === 'from' ? clamp(current) : clamp(Math.min(scope.from, scope.to));
  const hi = scope.mode === 'from' ? clamp(scope.to) : clamp(Math.max(scope.from, scope.to));
  const out: number[] = [];
  for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) {
    if (scope.mode === 'left' && n % 2) continue;
    if (scope.mode === 'right' && n % 2 === 0) continue;
    out.push(n);
  }
  return out;
}

/** A page's design, ignoring which side of the spine it was turned to. Equal keys mean the same design. */
export const designKey = (page: Page | null) => (page ? JSON.stringify({ ...page, side: undefined }) : '');

export const designName = (page: Page | null) => (page ? page.name.trim() || 'Untitled' : 'Blank');

/** Where a design goes: the pages in `targets` that would actually change, and how many of those hold something already. */
export function whatChanges(book: Book, targets: number[], design: Page | null): { changed: number[]; replaced: number } {
  const key = designKey(design);
  const changed = targets.filter((n) => designKey(getSlot(book, n)) !== key);
  return { changed, replaced: changed.filter((n) => getSlot(book, n) !== null).length };
}

/** A list of page numbers in words: "5, 7 and 9", or "6, 8, 10 … 30 (13 pages)" when long. */
export function listPages(pages: number[]): string {
  if (pages.length === 0) return 'no pages';
  if (pages.length === 1) return `page ${pages[0]}`;
  const consecutive = pages.every((n, i) => i === 0 || n === pages[i - 1] + 1);
  if (consecutive && pages.length > 3) return `pages ${pages[0]}–${pages[pages.length - 1]} (${pages.length} pages)`;
  if (pages.length <= 6) return `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
  return `pages ${pages.slice(0, 3).join(', ')} … ${pages[pages.length - 1]} (${pages.length} pages)`;
}

/** One row of the contents: a cover, one page, or a run of pages sharing a design. */
export interface ContentsRow {
  /** First and last slot of the row (equal for a single page). */
  from: number;
  to: number;
  name: string;
  page: Page | null;
  cover: boolean;
}

/** The book as contents rows: front cover, runs of consecutive interior pages with the same design, back cover. */
export function contentsRows(book: Book): ContentsRow[] {
  const rows: ContentsRow[] = [];
  const last = slotCount(book) - 1;
  const row = (from: number, to: number, cover: boolean): ContentsRow => ({ from, to, name: designName(getSlot(book, from)), page: getSlot(book, from), cover });
  rows.push(row(0, 0, true));
  let start = 1;
  for (let n = 2; n <= book.page_count + 1; n++) {
    if (n <= book.page_count && designKey(getSlot(book, n)) === designKey(getSlot(book, start))) continue;
    rows.push(row(start, n - 1, false));
    start = n;
  }
  rows.push(row(last, last, true));
  return rows;
}

/** The two slots of the opening that holds `slot`: the left (even) one and the right (odd) one. */
export const opening = (slot: number): [number, number] => [slot - (slot % 2), slot - (slot % 2) + 1];

/** What a slot is called to a person: "Inside front cover", "Page 5". */
export function slotLabel(book: Book, slot: number): string {
  if (slot === 0) return 'Inside front cover';
  if (slot === book.page_count + 1) return 'Inside back cover';
  return `Page ${slot}`;
}
