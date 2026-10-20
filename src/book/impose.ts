// Saddle-stitch imposition for half-letter sheets with manual duplex.
// A port of journal-system's pocketjournal/imposition.py: keep the two in step.
//
// Each sheet carries a two-page spread on each side, landscape, centered on the
// sheet's fold line. A signature of 4n pages nests n sheets. Sheet 0 is the
// outermost. Sheet k of n (0-based) carries, with p = 1..4n the signature page:
//
//     front: left = 4n - 2k,      right = 2k + 1
//     back:  left = 2k + 2,       right = 4n - 2k - 1
//
// Manual duplex: print-first holds the sheet fronts in REVERSE order,
// print-second the sheet backs in FORWARD order.
//
// Lengths are millimeters. Positions are measured on the sheet from its top-left
// corner, y down (journal-system measures from the bottom-left, y up).

import { PAGE_H_MM, PAGE_W_MM, GRID_X_MM } from '../format/types';

export const SHEET_W_MM = 215.9; // letter cut in half: 8.5" x 5.5", landscape
export const SHEET_H_MM = 139.7;
export const FOLD_X_MM = SHEET_W_MM / 2;
/** The strip at each side of the sheet that is trimmed away after binding. */
export const TRIM_ZONE_MM = FOLD_X_MM - PAGE_W_MM;

/** What the printer and paper need. The defaults are the owner's measured printer and paper. */
export interface PrintSettings {
  /**
   * Creep: each sheet's content moves toward the fold by (sheets outside it) x this, relative to the sheet outside it. In a thick
   * book the spine is round and paper is used up going round it, so this is often more than the paper's thickness (about 1.5x).
   * Found by the creep test.
   */
  creep_per_sheet_mm: number;
  /** Moves the content of every interior page away from the fold by this (left pages left, right pages right), so the trimmed fore-edge margin lands on the target. */
  fore_edge_shift_mm: number;
  /** The same, for cover.pdf. */
  cover_fore_edge_shift_mm: number;
  /** The fore-edge margin (content box to the trimmed edge) the creep test aims for. Used by the Calibrate wizard and marked on the test's rulers. */
  target_fore_edge_margin_mm: number;
  /**
   * Added to everything on one side of the sheet, to cancel what the printer does to it. Measured against the paper (the fold
   * at its centre, the margins even), not against the other side. +x moves right and +y moves up, as seen on that side.
   * The front takes print-first.pdf, cover.pdf and the front calibration page; the back takes print-second.pdf.
   */
  front_offset_x_mm: number;
  front_offset_y_mm: number;
  back_offset_x_mm: number;
  back_offset_y_mm: number;
  /** How many signatures to split the book into. */
  signatures: number;
  /**
   * How dark the printed PDFs draw the light, medium and dark shade tones and the gray text, as a percent of black
   * (0 is white, 100 is black). The editor and PNGs keep the fixed grays; see src/print/tones.ts.
   */
  shade_light_pct: number;
  shade_medium_pct: number;
  shade_dark_pct: number;
  gray_text_pct: number;
}

/**
 * The defaults are the owner's measured printer and paper, kept here in case the saved printer profile is cleared; the tones are
 * today's grays (#efefef, #dcdcdc, #bdbdbd, #808080). The creep and the two fore-edge shifts are PROVISIONAL: computed from the
 * owner's readings (cover 5.7, sheet 1 5.5, sheet 13 3.6 mm, printed with creep 0.14 and no shift) until the next creep test confirms them.
 */
export const DEFAULT_PRINT: PrintSettings = {
  creep_per_sheet_mm: 0.30, fore_edge_shift_mm: 2.0, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5,
  front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, signatures: 1,
  shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
};

/** A book page number (1-based), or null for a blank filler page. */
export type PageRef = number | null;
export interface SheetSide { left: PageRef; right: PageRef }
export interface Sheet {
  /** 0 is the outermost sheet of its signature. */
  index: number;
  /** mm the pages shift toward the fold. */
  creep: number;
  front: SheetSide;
  back: SheetSide;
}
export interface Signature {
  /** 1-based. */
  number: number;
  /** First book page in this signature. */
  firstPage: number;
  /** A multiple of 4; includes filler pages. */
  pages: number;
  sheets: Sheet[];
}

/** Pages per signature, each a multiple of 4. Pages are split evenly and rounded up; fewer signatures come back if the pages run out. */
export function signatureSizes(totalPages: number, signatures = 1): number[] {
  if (totalPages < 1 || signatures < 1) throw new Error('need at least one page and one signature');
  const per = Math.ceil(Math.ceil(totalPages / signatures) / 4) * 4;
  const sizes: number[] = [];
  for (let left = totalPages; left > 0; left -= per) sizes.push(per);
  return sizes;
}

/** Sheets wrapped around this one times the creep per sheet. */
export const creepFor = (sheetIndex: number, s: Pick<PrintSettings, 'creep_per_sheet_mm'>) => sheetIndex * s.creep_per_sheet_mm;

export function impose(totalPages: number, s: Pick<PrintSettings, 'creep_per_sheet_mm'>, signatures = 1): Signature[] {
  const result: Signature[] = [];
  let first = 1;
  signatureSizes(totalPages, signatures).forEach((pages, i) => {
    const book = (local: number): PageRef => (first + local - 1 <= totalPages ? first + local - 1 : null);
    const n = pages / 4;
    const sheets: Sheet[] = [];
    for (let k = 0; k < n; k++) {
      sheets.push({
        index: k,
        creep: creepFor(k, s),
        front: { left: book(4 * n - 2 * k), right: book(2 * k + 1) },
        back: { left: book(2 * k + 2), right: book(4 * n - 2 * k - 1) },
      });
    }
    result.push({ number: i + 1, firstPage: first, pages, sheets });
    first += pages;
  });
  return result;
}

/** Sheet indexes in print order: [print-first fronts, print-second backs]. */
export function duplexOrder(sheets: number): [number[], number[]] {
  const forward = Array.from({ length: sheets }, (_, i) => i);
  return [[...forward].reverse(), forward];
}

/** The offset a side of the sheet takes, in mm: +x right, +y up, as seen on that side. */
export const offsetOf = (s: Pick<PrintSettings, 'front_offset_x_mm' | 'front_offset_y_mm' | 'back_offset_x_mm' | 'back_offset_y_mm'>, side: 'front' | 'back') =>
  side === 'front' ? { x: s.front_offset_x_mm, y: s.front_offset_y_mm } : { x: s.back_offset_x_mm, y: s.back_offset_y_mm };

/**
 * Sheet position (mm) of a page's top-left corner. Pages shift toward the fold by `creep` (the left page right, the right page
 * left) and away from it by `shift`, the fore-edge shift. The front/back offset is added by the caller.
 */
export function pageOrigin(isRight: boolean, creep: number, shift = 0): { x: number; y: number } {
  const y = (SHEET_H_MM - PAGE_H_MM) / 2, toward = creep - shift;
  return isRight ? { x: FOLD_X_MM - toward, y } : { x: FOLD_X_MM - PAGE_W_MM + toward, y };
}

/** How far a page's content sits from the fold on the paper (its spine-side margin), when the page moves `toward` the fold by that much. */
export const spineMargin = (toward: number) => GRID_X_MM - toward;

/** Why these settings can't be printed, or null if they can. `sheets` is the biggest signature, in sheets. */
export function checkPrintSettings(s: PrintSettings, sheets: number): string | null {
  const numbers = [s.creep_per_sheet_mm, s.fore_edge_shift_mm, s.cover_fore_edge_shift_mm, s.target_fore_edge_margin_mm];
  if (!numbers.every(Number.isFinite)) return 'The creep, shifts and target margin must be numbers.';
  if (s.creep_per_sheet_mm < 0) return 'Creep per sheet must be zero or more.';
  if (![s.front_offset_x_mm, s.front_offset_y_mm, s.back_offset_x_mm, s.back_offset_y_mm].every(Number.isFinite)) return 'The offsets must be numbers.';
  if (!Number.isInteger(s.signatures) || s.signatures < 1) return 'Signatures must be a whole number, at least 1.';
  for (const key of ['shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct'] as const) {
    if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] > 100) return 'Each tone must be a percentage from 0 to 100.';
  }
  // How far the content moves toward the fold: linear in the sheet, so the first and last sheet are the extremes. The cover moves by minus its shift.
  const inner = (sheets - 1) * s.creep_per_sheet_mm - s.fore_edge_shift_mm;
  const outerRoom = FOLD_X_MM - (PAGE_W_MM - GRID_X_MM); // the content's fore-edge may go this far toward the sheet's edge, no further
  const cases: [string, number][] = [['sheet 1', -s.fore_edge_shift_mm], [`sheet ${sheets}`, inner], ['the cover', -s.cover_fore_edge_shift_mm]];
  for (const [where, toward] of cases) {
    if (spineMargin(toward) <= 0) {
      return `The content on ${where} would be ${(-spineMargin(toward)).toFixed(2)} mm past the fold (its spine-side margin is ${GRID_X_MM} mm on the page). Lower the creep per sheet, raise the fore-edge shift or use more signatures.`;
    }
    if (-toward > outerRoom) return `The content on ${where} would be ${(-toward - outerRoom).toFixed(2)} mm off the paper at the fore-edge. Lower the ${where === 'the cover' ? 'cover ' : ''}fore-edge shift.`;
  }
  return null;
}
