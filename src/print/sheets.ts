// How a sheet of paper is laid out for printing: the half-letter sheet (today's output) or the letter sheet that holds two of them.
//
//   Letter, two-up: a portrait letter sheet, 215.9 x 279.4 mm, holds two half-letter sheets, the top half (Book 1) and the
//   bottom half (Book 2). Each half is laid out exactly as a half-letter sheet is: same imposition, creep, shifts, the fold at
//   its centre. Duplex flips on the long edge: the top stays the top and left and right swap. A paper point at (x, y) on the
//   front is at (W - x, y) on the back, so each half's back is the same y range of the back page, drawn as the half-letter back
//   is (whose left page is the one behind the front's right page). The back never needs to be mirrored.
//
// Positions are millimeters from the PDF page's top left, y down.
import type { PDFFont } from 'pdf-lib';
import { SHEET_H_MM, SHEET_W_MM, offsetOf, profileOf, type PrintSettings, type SheetLayout } from '../book/impose';
import { mmToPt } from './draw';
import type { Item } from './display';

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

/**
 * What is done to everything on one side of a sheet: scaled about the sheet's centre, turned about it (`rot`, radians, + counter-clockwise
 * as seen on that side; only the back is turned), then moved by the offset (dy is +down). It moves positions only (see correct.ts).
 */
export interface SheetTransform { sx: number; sy: number; rot: number; dx: number; dy: number }

/** The transform of a side of the sheet, from the selected layout's scale and its front or back offset; the back also takes the layout's rotation. */
export function transformOf(print: Pick<PrintSettings, 'sheet_layout' | 'layouts'>, side: 'front' | 'back'): SheetTransform {
  const p = profileOf(print), off = offsetOf(print, side);
  return { sx: p.scale_x_pct / 100, sy: p.scale_y_pct / 100, rot: side === 'back' ? (p.back_rotation_deg * Math.PI) / 180 : 0, dx: off.x, dy: -off.y };
}

/** The line weight along the 8.5 in edge of the selected layout, as a factor (1 is as drawn). */
export const lineWeightOf = (print: Pick<PrintSettings, 'sheet_layout' | 'layouts'>) => profileOf(print).line_weight_x_pct / 100;

/** Where a point on a w x h sheet (x right, y down) lands. */
export function mapPoint(t: SheetTransform, w: number, h: number, p: { x: number; y: number }) {
  const u = t.sx * (p.x - w / 2), v = t.sy * (p.y - h / 2), c = Math.cos(t.rot), s = Math.sin(t.rot);
  // With y down, a counter-clockwise turn as seen on the sheet takes (u, v) to (u cos + v sin, -u sin + v cos).
  return { x: w / 2 + u * c + v * s + t.dx, y: h / 2 - u * s + v * c + t.dy };
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

/** The marks where to cut, drawn once on the middle line of a two-up page, on both sides. */
export function cutMarks(): Item[] {
  return [[MARK_FROM_MM, MARK_TO_MM], [LETTER_W_MM - MARK_TO_MM, LETTER_W_MM - MARK_FROM_MM]].map(([a, b]): Item => (
    { k: 'line', x1: a, y1: SHEET_H_MM, x2: b, y2: SHEET_H_MM, w: MARK_W_MM, c: '#000000', cap: 'butt' }));
}

/** The label text, running up the left trim zone of the half whose top is `top`, readable from the left. */
export function halfLabelItem(text: string, top: number): Item {
  return { k: 'text', str: text, x: LABEL_BASE_X_MM, y: top + SHEET_H_MM - LABEL_FROM_Y_MM, size: LABEL_SIZE_MM, font: 'regular', c: '#000000', align: 'start', rot: 90 };
}

/** The boxes (x, y, w, h) a two-up page draws that are not book pages: the marks and the labels. Used by the edge check (edge.ts). */
export function trimZoneBoxes(): { name: string; x: number; y: number; w: number; h: number }[] {
  return [
    { name: 'a cut mark', x: MARK_FROM_MM, y: SHEET_H_MM - MARK_W_MM / 2, w: MARK_TO_MM - MARK_FROM_MM, h: MARK_W_MM },
    { name: 'a cut mark', x: LETTER_W_MM - MARK_TO_MM, y: SHEET_H_MM - MARK_W_MM / 2, w: MARK_TO_MM - MARK_FROM_MM, h: MARK_W_MM },
    ...halfTops('letter_two_up').map((top) => ({ name: 'a label', x: LABEL_BASE_X_MM - LABEL_SIZE_MM, y: top + SHEET_H_MM - LABEL_FROM_Y_MM - LABEL_MAX_MM, w: LABEL_SIZE_MM, h: LABEL_MAX_MM })),
  ];
}
