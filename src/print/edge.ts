// The edge check: content that would print closer than 3 mm to the edge of the letter sheet, where the print driver may cut it off.
// It is a warning, never a refusal: the files are made and the owner checks by printing that page. Only the two-up layout is checked
// (the half-letter layout prints borderless, to the edge).
//
// What is checked is what is drawn: each page is laid out (layout.ts), the box around its content is carried through the side's
// correction at every place the page lands (every sheet, with its creep and shifts, both sides, and the covers), and the gap to
// each edge of the sheet is measured. The nearest is named by book, page and row (or column, for the left and right edges).
import { COLS, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM as P, ROWS } from '../format/types';
import { FIRST_SLOT, bookExpand, bookPage, lastSlot, type Book } from '../book/book';
import { PAPER_SETS, pageOrigin, type PaperSet, type PrintSettings, type Signature } from '../book/impose';
import { boundsOf, type Item } from './display';
import { layoutPage } from './layout';
import { EDGE_MM, LETTER_H_MM, LETTER_W_MM, halfTops, isTwoUp, mapPoint, transformOf, trimZoneBoxes } from './sheets';

type Edge = 'left' | 'right' | 'top' | 'bottom';
type Side = 'front' | 'back';
interface Box { x0: number; y0: number; x1: number; y1: number }

/** The box around what a page draws, from its own top-left corner and inside its own edges (the page is clipped to them); null for a blank page. */
function contentBox(book: Book, slot: number): Box | null {
  const n = slot >= 1 && slot <= book.page_count ? slot : 0;
  const items: Item[] = [];
  layoutPage(bookPage(book, slot), { x: 0, y: 0, pageNumber: n && book.page_numbers ? String(n) : null, expand: bookExpand(book, slot) }, items);
  const b = boundsOf(items);
  if (!b) return null;
  return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(PAGE_W_MM, b.x1), y1: Math.min(PAGE_H_MM, b.y1) };
}

const slotName = (book: Book, slot: number) =>
  slot === FIRST_SLOT ? 'the outside front cover' : slot === 0 ? 'the inside front cover' : slot === book.page_count + 1 ? 'the inside back cover' : slot === lastSlot(book) ? 'the outside back cover' : `page ${slot}`;

/** The row (or column) of the page's grid that holds `mm`, counted from 0. Row 0 is the header. */
const cell = (mm: number, origin: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor((mm - origin) / P + 1e-9)));

interface Hit { gap: number; who: string; what: string; side: Side; edge: Edge; others: Set<string> }

/**
 * The warnings for a two-up export: one for each book, side of the sheet and edge where content would print within 3 mm of the edge,
 * naming the closest page and its row or column, and the other pages as close. Empty on the half-letter layout.
 */
export function edgeWarnings(books: { top: Book; bottom: Book }, print: PrintSettings, topSigs: Signature[], bottomSigs: Signature[]): string[] {
  if (!isTwoUp(print.sheet_layout)) return [];
  const W = LETTER_W_MM, H = LETTER_H_MM, tops = halfTops('letter_two_up');
  const hits = new Map<string, Hit>();
  const gapsOf = (side: Side, box: Box, ox: number, oy: number, paper: PaperSet): [Edge, number][] => {
    const t = transformOf(print, side, paper);
    const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => mapPoint(t, W, H, { x: x + ox, y: y + oy }));
    return [['left', Math.min(...corners.map((p) => p.x))], ['right', W - Math.max(...corners.map((p) => p.x))], ['top', Math.min(...corners.map((p) => p.y))], ['bottom', H - Math.max(...corners.map((p) => p.y))]];
  };
  const note = (key: string, hit: Omit<Hit, 'others'>) => {
    const have = hits.get(key);
    if (!have) { hits.set(key, { ...hit, others: new Set() }); return; }
    const closer = hit.gap < have.gap, loser = closer ? have.who : hit.who;
    if (closer) Object.assign(have, hit);
    have.others.add(loser);
  };

  const cache = new Map<string, Box | null>();
  const place = (slot: number, bookIndex: number, side: Side, isRight: boolean, creep: number, shift: number, paper: PaperSet = 'inside') => {
    const book = bookIndex ? books.bottom : books.top, key = `${bookIndex}|${slot}`;
    if (!cache.has(key)) cache.set(key, contentBox(book, slot));
    const box = cache.get(key);
    if (!box) return;
    const o = pageOrigin(isRight, creep, shift), top = tops[bookIndex];
    for (const [edge, gap] of gapsOf(side, box, o.x, top + o.y, paper)) {
      if (gap >= EDGE_MM) continue;
      const near = edge === 'top' ? `row ${cell(box.y0, GRID_Y_MM, ROWS)}` : edge === 'bottom' ? `row ${cell(box.y1 - 1e-6, GRID_Y_MM, ROWS)}` : edge === 'left' ? `column ${cell(box.x0, GRID_X_MM, COLS)}` : `column ${cell(box.x1 - 1e-6, GRID_X_MM, COLS)}`;
      const row = near === 'row 0' ? 'row 0 (the header)' : near;
      note(`${bookIndex}|${side}|${edge}`, { gap, who: slotName(book, slot), what: `Book ${bookIndex + 1}, ${slotName(book, slot)}, ${row}`, side, edge });
    }
  };

  const sigsOf = [topSigs, bottomSigs];
  [0, 1].forEach((bookIndex) => {
    const book = bookIndex ? books.bottom : books.top;
    for (const sig of sigsOf[bookIndex]) {
      for (const sheet of sig.sheets) {
        for (const side of ['front', 'back'] as const) {
          if (sheet[side].left !== null) place(sheet[side].left, bookIndex, side, false, sheet.creep, print.fore_edge_shift_mm);
          if (sheet[side].right !== null) place(sheet[side].right, bookIndex, side, true, sheet.creep, print.fore_edge_shift_mm);
        }
      }
    }
    // The covers: the outside is printed first (the front), the inside second (the back).
    place(lastSlot(book), bookIndex, 'front', false, 0, print.cover_fore_edge_shift_mm, 'cover');
    place(FIRST_SLOT, bookIndex, 'front', true, 0, print.cover_fore_edge_shift_mm, 'cover');
    place(0, bookIndex, 'back', false, 0, print.cover_fore_edge_shift_mm, 'cover');
    place(book.page_count + 1, bookIndex, 'back', true, 0, print.cover_fore_edge_shift_mm, 'cover');
  });

  const out: string[] = [];
  for (const [, hit] of [...hits.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const others = [...hit.others];
    const alike = others.length > 6 ? `${others.slice(0, 6).join(', ')} and ${others.length - 6} more are` : `${others.join(', ')} ${others.length === 1 ? 'is' : 'are'}`;
    out.push(`${hit.what}: on the ${hit.side} of the letter sheet it prints ${Math.max(0, hit.gap).toFixed(2)} mm from the ${hit.edge} edge. The print driver may cut it off; check by printing that page.${others.length ? ` ${alike} about as close.` : ''}`);
  }

  // The cut marks and the labels are not pages, but they are printed and trimmed away: warn the same way.
  for (const paper of PAPER_SETS) for (const side of ['front', 'back'] as const) {
    const t = transformOf(print, side, paper);
    for (const b of trimZoneBoxes()) {
      const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => mapPoint(t, W, H, { x, y }));
      const gaps: [Edge, number][] = [['left', Math.min(...corners.map((p) => p.x))], ['right', W - Math.max(...corners.map((p) => p.x))], ['top', Math.min(...corners.map((p) => p.y))], ['bottom', H - Math.max(...corners.map((p) => p.y))]];
      const [edge, gap] = gaps.reduce((m, g) => (g[1] < m[1] ? g : m));
      if (gap < EDGE_MM) out.push(`On the ${side} of the letter sheet ${b.name} prints ${Math.max(0, gap).toFixed(2)} mm from the ${edge} edge. The print driver may cut it off; check by printing a sheet.`);
    }
  }
  return [...new Set(out)];
}
