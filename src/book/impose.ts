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
  /** Creep: each sheet shifts toward the fold by (sheets outside it) x this. */
  paper_thickness_mm: number;
  /** Added to everything on the back side (print-second); +x moves right, +y moves up, as seen on the back. */
  back_offset_x_mm: number;
  back_offset_y_mm: number;
  /** How many signatures to split the book into. */
  signatures: number;
}

export const DEFAULT_PRINT: PrintSettings = { paper_thickness_mm: 0.14, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 1 };

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

/** Sheets wrapped around this one times the paper thickness. */
export const creepFor = (sheetIndex: number, s: Pick<PrintSettings, 'paper_thickness_mm'>) => sheetIndex * s.paper_thickness_mm;

export function impose(totalPages: number, s: Pick<PrintSettings, 'paper_thickness_mm'>, signatures = 1): Signature[] {
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

/** Sheet position (mm) of a page's top-left corner. Pages shift toward the fold by `creep`: the left page right, the right page left. */
export function pageOrigin(isRight: boolean, creep: number): { x: number; y: number } {
  const y = (SHEET_H_MM - PAGE_H_MM) / 2;
  return isRight ? { x: FOLD_X_MM - creep, y } : { x: FOLD_X_MM - PAGE_W_MM + creep, y };
}

/** Why these settings can't be printed, or null if they can. `sheets` is the biggest signature, in sheets. */
export function checkPrintSettings(s: PrintSettings, sheets: number): string | null {
  if (!Number.isFinite(s.paper_thickness_mm) || s.paper_thickness_mm < 0) return 'Paper thickness must be zero or more.';
  if (!Number.isFinite(s.back_offset_x_mm) || !Number.isFinite(s.back_offset_y_mm)) return 'The back-side offset must be a number.';
  if (!Number.isInteger(s.signatures) || s.signatures < 1) return 'Signatures must be a whole number, at least 1.';
  const creep = (sheets - 1) * s.paper_thickness_mm;
  if (creep >= GRID_X_MM) {
    return `Creep of ${creep.toFixed(2)} mm would push content past the fold (the page margin is ${GRID_X_MM} mm). Lower the paper thickness or use more signatures.`;
  }
  return null;
}
