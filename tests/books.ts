import type { Book } from '../src/book/book';
import { pageBlock } from '../src/book/outline';
import type { Page } from '../src/format/types';

/** Put designs on the first pages of a book: entry i is page i + 1 (null is a blank page). The outline is one ×1 page block for each. */
export function withPages(book: Book, pages: (Page | null)[]): Book {
  book.outline = pages.map((p) => pageBlock(p));
  return book;
}

/** Put designs on some pages by page number, leaving the pages before them blank: onPages(book, { 3: page }). */
export function onPages(book: Book, at: Record<number, Page | null>): Book {
  const last = Math.max(0, ...Object.keys(at).map(Number));
  return withPages(book, Array.from({ length: last }, (_, i) => at[i + 1] ?? null));
}
