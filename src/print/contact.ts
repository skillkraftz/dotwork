import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import { pageContent } from '../render';
import { FIRST_SLOT, bookExpand, bookPage, isCover, lastSlot, slotCount, type Book } from '../book/book';

const COLUMNS = 4;
const GAP = 6, MARGIN = 10, TITLE = 14, CAPTION = 6;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ContactSheet { svg: string; width: number; height: number }

/** A preview of the whole book: every spread as it opens, in order, with the inside covers beside the first and last pages. Sizes in mm. */
export function contactSheet(book: Book, fontCss = ''): ContactSheet {
  // Each cell is a left and a right slot. The outside covers, if either is designed, are the last cell, laid out as cover-outside.pdf prints them (back | front).
  const cells: { slots: [number, number]; caption: string }[] = Array.from({ length: slotCount(book) / 2 }, (_, s) => ({
    slots: [s * 2, s * 2 + 1] as [number, number],
    caption: s === 0 ? 'Inside front cover · 1' : s === slotCount(book) / 2 - 1 ? `${book.page_count} · Inside back cover` : `${s * 2} · ${s * 2 + 1}`,
  }));
  if (book.cover.outside_front || book.cover.outside_back) cells.push({ slots: [lastSlot(book), FIRST_SLOT], caption: 'Outside back cover · Outside front cover' });
  const cols = Math.min(COLUMNS, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const cellW = PAGE_W_MM * 2, cellH = PAGE_H_MM + CAPTION;
  const width = MARGIN * 2 + cols * cellW + (cols - 1) * GAP;
  const height = MARGIN * 2 + TITLE + rows * cellH + (rows - 1) * GAP;
  let body = '';
  cells.forEach(({ slots, caption }, s) => {
    const x = MARGIN + (s % cols) * (cellW + GAP), y = MARGIN + TITLE + Math.floor(s / cols) * (cellH + GAP);
    let cell = '';
    slots.forEach((slot, i) => {
      const page = bookPage(book, slot);
      const n = isCover(book, slot) || !book.page_numbers ? null : String(slot);
      cell += `<g transform="translate(${i * PAGE_W_MM} 0)">${pageContent(page, { mode: 'export', pageNumber: n, expand: bookExpand(book, slot) })}</g>`;
    });
    cell += `<rect x="0" y="0" width="${cellW}" height="${PAGE_H_MM}" fill="none" stroke="#a8a8a8" stroke-width="0.4"/><path d="M${PAGE_W_MM} 0V${PAGE_H_MM}" stroke="#a8a8a8" stroke-width="0.4"/>`;
    cell += `<text x="${cellW / 2}" y="${PAGE_H_MM + 4}" text-anchor="middle" font-size="3" fill="#666">${esc(caption)}</text>`;
    body += `<g transform="translate(${x} ${y})">${cell}</g>`;
  });
  const title = `<text x="${MARGIN}" y="${MARGIN + 6}" font-size="5" font-weight="700" fill="#000">${esc(book.name)}</text>` +
    `<text x="${width - MARGIN}" y="${MARGIN + 6}" font-size="3.4" text-anchor="end" fill="#666">${book.page_count} pages · ${book.pages.filter(Boolean).length} designed</text>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">` +
    `<style>${fontCss}</style><g font-family="'Courier Prime', 'Courier New', monospace">` +
    `<rect width="${width}" height="${height}" fill="#f3f3f3"/>${title}${body}</g></svg>`;
  return { svg, width, height };
}
