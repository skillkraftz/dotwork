// Where the two books go on a two-up letter sheet. The books touch at one shared cut; each is cut to 132 + 2 x margin tall (the grid, rows 0
// to 43, plus the trimmed top/bottom margin on both sides). What is left of the sheet's height is waste above Book 1 and below Book 2, and
// this module splits it so the grid, on both sides of the sheet and on both sides, lies inside that side's printable insets.
// Pure arithmetic on the printer profile: no PDF, no pages.
//
//   sheet y:   0 ........ a ........ a + Bh ........ a + 2 Bh ........ H
//              waste top | Book 1    | Book 2       | waste bottom
//
// The grid's top is at a + margin and Book 2's grid bottom at a + 2 Bh - margin, in the sheet's own (uncorrected) positions; the check maps
// grid's sheet positions with the insets (distances on the paper: the corrections put content at its sheet position there). Half letter has one book on a
// sheet its own size and nothing to place.
import { GRID_Y_MM, PITCH_MM as P, ROWS } from '../format/types';
import { PAPER_SETS, SHEET_H_MM, insetsOf, type PrintSettings } from '../book/impose';
import { LETTER_H_MM, isTwoUp } from './sheets';

/** The grid's height: rows 0 to 43. */
export const GRID_H_MM = ROWS * P;
/** The margin that makes today's layout: the page's own, from its top edge to the grid. */
export const PAGE_MARGIN_MM = GRID_Y_MM;
export interface Placement {
  /** The trimmed top/bottom margin used. */
  margin: number;
  /** Each book's cut height: 132 + 2 x margin. */
  bookHeight: number;
  /** Where each book's page box (139.7 mm tall, grid 3.85 mm below its top) has its top edge on the sheet: pages are laid out from here. */
  pageTops: number[];
  /** The cuts, mm from the sheet's top edge: the top trim, between the books, the bottom trim. */
  cuts: number[];
  /** The waste above Book 1 and below Book 2. */
  wasteTop: number;
  wasteBottom: number;
  /** False if no split puts the grid inside the insets (the files are still made, with this split). */
  fits: boolean;
  /** When it does not fit: the largest margin (to 0.01 mm) that would, or null if no margin does. */
  largestMargin: number | null;
}

/**
 * The sheet y range the grid's top and bottom may take: [lowest top, highest bottom]. The insets are distances on the paper, and the offsets, scale
 * and rotation are there to put content at its uncorrected sheet position on the paper, so the positions are compared with the insets as they are.
 * The cover is sewn around the pages and cut in the same cuts, so the stricter inset of the two papers at each edge and side counts.
 */
export function gridRange(print: PrintSettings): { top: number; bottom: number } {
  let top = 0, bottom = LETTER_H_MM;
  for (const paper of PAPER_SETS) for (const side of ['front', 'back'] as const) {
    const inset = insetsOf(print, side, paper);
    top = Math.max(top, inset.top);
    bottom = Math.min(bottom, LETTER_H_MM - inset.bottom);
  }
  return { top, bottom };
}

/** The split of `waste` mm between the top and the bottom: even if that is allowed, else as near even as is allowed. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const nearestEven = (waste: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, waste / 2));

/**
 * Where the books go (one placement for the interior and the covers). The waste is split evenly when the grid fits inside the insets that way, else as near even as fits; if
 * no split fits the books are balanced between the two violations and `fits` is false, with the largest margin that would fit.
 */
export function placeBooks(print: PrintSettings): Placement {
  if (!isTwoUp(print.sheet_layout)) {
    return { margin: PAGE_MARGIN_MM, bookHeight: SHEET_H_MM, pageTops: [0], cuts: [0, SHEET_H_MM], wasteTop: 0, wasteBottom: 0, fits: true, largestMargin: null };
  }
  const H = LETTER_H_MM, m = print.trim_margin_mm, bookHeight = GRID_H_MM + 2 * m, waste = H - 2 * bookHeight;
  const range = gridRange(print), eps = 1e-9;
  // The grid's top is at a + m and Book 2's grid bottom at H - b - m, with a + b = waste.
  const wantTop = Math.max(0, range.top - m), wantBottom = Math.max(0, H - m - range.bottom);
  const lo = wantTop, hi = waste - wantBottom;
  const fits = lo <= hi + eps && waste >= -eps;
  const wasteTop = fits ? nearestEven(waste, lo, hi) : Math.min(Math.max(waste, 0), Math.max(0, (waste - wantBottom + wantTop) / 2));
  const top = round(wasteTop);
  // The largest margin that fits: the four limits that lo <= hi and 0 <= waste put on it, each solved for the margin.
  const largest = Math.min((H - 2 * GRID_H_MM) / 4, (H - 2 * GRID_H_MM - range.top) / 3, (range.bottom - 2 * GRID_H_MM) / 3, (range.bottom - 2 * GRID_H_MM - range.top) / 2);
  return {
    margin: m, bookHeight,
    pageTops: [top + m - PAGE_MARGIN_MM, top + bookHeight + m - PAGE_MARGIN_MM].map(round),
    cuts: [top, top + bookHeight, top + 2 * bookHeight].map(round),
    wasteTop: top, wasteBottom: round(waste - top),
    fits, largestMargin: fits || largest < 0 ? null : Math.floor(largest * 100 + 1e-6) / 100,
  };
}

/** What to tell the owner when the grid does not fit inside the insets, or null when it does. */
export function placementWarning(p: Placement): string | null {
  if (p.fits) return null;
  const fix = p.largestMargin === null ? 'No trimmed margin fits: check the printable insets, or the offsets and scale.' : `The largest trimmed top/bottom margin that would fit is ${p.largestMargin} mm.`;
  return `The books don't fit inside the printable area at a trimmed top/bottom margin of ${p.margin} mm, so some of the top or bottom row may be cut off. ${fix}`;
}
