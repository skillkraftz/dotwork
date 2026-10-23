// How a sheet of paper is laid out for printing: the half-letter sheet (today's output) or the letter sheet that holds two of them.
//
//   Letter, two-up: a portrait letter sheet, 215.9 x 279.4 mm, holds two half-letter sheets, the top half (Book 1) and the
//   bottom half (Book 2). Each half is laid out exactly as a half-letter sheet is: same imposition, creep, shifts, the fold at
//   its centre. Duplex flips on the long edge: the top stays the top and left and right swap. A paper point at (x, y) on the
//   front is at (W - x, y) on the back, so each half's back is the same y range of the back page, drawn as the half-letter back
//   is (whose left page is the one behind the front's right page). The back never needs to be mirrored.
//
// Positions are millimeters from the PDF page's top left, y down.
import { type PDFFont, concatTransformationMatrix, popGraphicsState, pushGraphicsState, degrees } from 'pdf-lib';
import { COLS, GRID_X_MM, GRID_Y_MM, PITCH_MM, ROWS } from '../format/types';
import { SHEET_H_MM, SHEET_W_MM, offsetOf, pageOrigin, profileOf, type PrintSettings, type SheetLayout } from '../book/impose';
import { color, mmToPt, type Fonts } from './draw';
import type { PdfPage } from './export';

export const LETTER_W_MM = SHEET_W_MM; // 8.5 in
export const LETTER_H_MM = 2 * SHEET_H_MM; // 11 in
/** Printers can't print closer than this to the edge of letter paper (with normal margins). */
export const EDGE_MM = 3;

export const isTwoUp = (layout: SheetLayout) => layout === 'letter_two_up';
/** The PDF page for one sheet. */
export const sheetSize = (layout: SheetLayout) => (isTwoUp(layout) ? { w: LETTER_W_MM, h: LETTER_H_MM } : { w: SHEET_W_MM, h: SHEET_H_MM });
/** Where each half-letter sheet's top edge is on the PDF page: one for half letter, the top and the bottom half for two-up. */
export const halfTops = (layout: SheetLayout): number[] => (isTwoUp(layout) ? [0, SHEET_H_MM] : [0]);
export const BOOK_LABELS = ['Book 1', 'Book 2'] as const;

/** A paper point on the front of a sheet, where it is on the back after a long-edge duplex flip. */
export const backPoint = (p: { x: number; y: number }, w = LETTER_W_MM) => ({ x: w - p.x, y: p.y });
/** The part of the back page behind a half of the front: the same y range (top stays top). */
export const backRegion = (half: number) => ({ y: halfTops('letter_two_up')[half], h: SHEET_H_MM });

// ---- scale and offset --------------------------------------------------------------------------------------------

/** What is done to everything on one side of a sheet: scaled about the sheet's centre, then moved by the offset (dy is +down). */
export interface SheetTransform { sx: number; sy: number; dx: number; dy: number }

/** The transform of a side of the sheet, from the selected layout's scale and its front or back offset. */
export function transformOf(print: Pick<PrintSettings, 'sheet_layout' | 'layouts'>, side: 'front' | 'back'): SheetTransform {
  const p = profileOf(print), off = offsetOf(print, side);
  return { sx: p.scale_x_pct / 100, sy: p.scale_y_pct / 100, dx: off.x, dy: -off.y };
}

/** Where a point on a w x h sheet lands. */
export const mapPoint = (t: SheetTransform, w: number, h: number, p: { x: number; y: number }) =>
  ({ x: w / 2 + t.sx * (p.x - w / 2) + t.dx, y: h / 2 + t.sy * (p.y - h / 2) + t.dy });

/**
 * Draw a whole PDF page under a transform. `draw` gets the offset to add to its coordinates: the offset when the scale is 100%
 * (so that output is exactly what it was before scale existed), else 0 and the page's matrix does the work.
 */
export function onSheet(pdf: PdfPage, w: number, h: number, t: SheetTransform, draw: (dx: number, dy: number) => void) {
  if (t.sx === 1 && t.sy === 1) { draw(t.dx, t.dy); return; }
  pdf.pushOperators(pushGraphicsState(), concatTransformationMatrix(t.sx, 0, 0, t.sy, mmToPt(w / 2 * (1 - t.sx) + t.dx), mmToPt(h / 2 * (1 - t.sy) - t.dy)));
  draw(0, 0);
  pdf.pushOperators(popGraphicsState());
}

// ---- cut marks and labels (two-up) ---------------------------------------------------------------------------------

const MARK_FROM_MM = 8, MARK_TO_MM = 16, MARK_W_MM = 0.15; // in the side trim zones, which are cut off when trimming
const LABEL_SIZE_MM = 2.4, LABEL_BASE_X_MM = 11, LABEL_FROM_Y_MM = 12, LABEL_MAX_MM = 110;

/** The label of a half: "Book 1 | name | sheet 3 of 13 | front". Its text, cut to fit the trim zone's length. */
export function halfLabel(font: PDFFont, slot: 0 | 1, ...rest: string[]): string {
  const full = [BOOK_LABELS[slot], ...rest].join(' | ');
  let text = full;
  while (text.length > 1 && font.widthOfTextAtSize(text, mmToPt(LABEL_SIZE_MM)) > mmToPt(LABEL_MAX_MM)) text = text.slice(0, -1);
  return text === full ? full : text.trimEnd() + '…';
}

/** The marks where to cut, drawn once on the middle line of a two-up page, on both sides; and one label along the left trim zone of each half. */
export function drawCutMarks(pdf: PdfPage, dx: number, dy: number) {
  const y = mmToPt(LETTER_H_MM - (SHEET_H_MM + dy));
  for (const [a, b] of [[MARK_FROM_MM, MARK_TO_MM], [LETTER_W_MM - MARK_TO_MM, LETTER_W_MM - MARK_FROM_MM]]) {
    pdf.drawLine({ start: { x: mmToPt(a + dx), y }, end: { x: mmToPt(b + dx), y }, thickness: mmToPt(MARK_W_MM), color: color('#000000') });
  }
}

/** The label text, running up the left trim zone of the half whose top is `top`, readable from the left. */
export function drawHalfLabel(pdf: PdfPage, fonts: Fonts, text: string, top: number, dx: number, dy: number) {
  const y = LETTER_H_MM - (top + SHEET_H_MM - LABEL_FROM_Y_MM + dy);
  pdf.drawText(text, { x: mmToPt(LABEL_BASE_X_MM + dx), y: mmToPt(y), size: mmToPt(LABEL_SIZE_MM), font: fonts.regular, color: color('#000000'), rotate: degrees(90) });
}

/** The boxes (x, y, w, h) a two-up page draws that are not book pages: the marks and the labels. Used by the edge check. */
export function trimZoneBoxes(): { name: string; x: number; y: number; w: number; h: number }[] {
  return [
    { name: 'a cut mark', x: MARK_FROM_MM, y: SHEET_H_MM - MARK_W_MM / 2, w: MARK_TO_MM - MARK_FROM_MM, h: MARK_W_MM },
    { name: 'a cut mark', x: LETTER_W_MM - MARK_TO_MM, y: SHEET_H_MM - MARK_W_MM / 2, w: MARK_TO_MM - MARK_FROM_MM, h: MARK_W_MM },
    ...halfTops('letter_two_up').map((top) => ({ name: 'a label', x: LABEL_BASE_X_MM - LABEL_SIZE_MM, y: top + SHEET_H_MM - LABEL_FROM_Y_MM - LABEL_MAX_MM, w: LABEL_SIZE_MM, h: LABEL_MAX_MM })),
  ];
}

// ---- the 3 mm edge check -------------------------------------------------------------------------------------------

/** What is on the sheet, to be kept off its edges: the content boxes of the pages at the extremes of creep and shift. */
export interface EdgeInput {
  print: Pick<PrintSettings, 'sheet_layout' | 'layouts'>;
  /** How far each page moves toward the fold, mm, at its extremes (creep minus shift; negative is away from the fold). */
  toward: number[];
}

/** Why a two-up page would print closer than 3 mm to the letter sheet's edge, or null if it is fine (or the layout is half letter). */
export function edgeProblem({ print, toward }: EdgeInput): string | null {
  if (!isTwoUp(print.sheet_layout)) return null;
  const boxes = [...trimZoneBoxes()];
  const gridW = COLS * PITCH_MM, gridH = ROWS * PITCH_MM;
  for (const t of toward) {
    for (const isRight of [false, true]) {
      const o = pageOrigin(isRight, t);
      for (const top of halfTops('letter_two_up')) boxes.push({ name: 'a page’s content', x: o.x + GRID_X_MM, y: top + o.y + GRID_Y_MM, w: gridW, h: gridH });
    }
  }
  for (const side of ['front', 'back'] as const) {
    const t = transformOf(print, side);
    for (const b of boxes) {
      const a = mapPoint(t, LETTER_W_MM, LETTER_H_MM, { x: b.x, y: b.y }), z = mapPoint(t, LETTER_W_MM, LETTER_H_MM, { x: b.x + b.w, y: b.y + b.h });
      const gaps: [string, number][] = [['left', a.x], ['right', LETTER_W_MM - z.x], ['top', a.y], ['bottom', LETTER_H_MM - z.y]];
      const [edge, gap] = gaps.reduce((m, g) => (g[1] < m[1] ? g : m));
      if (gap < EDGE_MM) {
        return `On the ${side} of the letter sheet ${b.name} would be ${Math.max(0, gap).toFixed(2)} mm from the ${edge} edge; printers need at least ${EDGE_MM} mm. Lower the ${side} offset or the scale of the two-up layout.`;
      }
    }
  }
  return null;
}
