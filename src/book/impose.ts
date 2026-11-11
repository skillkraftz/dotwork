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

/**
 * How the sheets are laid on the paper. A half-letter sheet is the paper cut in half (5.5" x 8.5"), one book's sheet per paper
 * sheet. Letter two-up puts two half-letter sheets on one portrait letter sheet, a top book and a bottom book, so the printer can
 * duplex automatically; each half is laid out exactly as a half-letter sheet is.
 */
export type SheetLayout = 'half_letter' | 'letter_two_up';
export const SHEET_LAYOUTS: readonly SheetLayout[] = ['half_letter', 'letter_two_up'];
export const LAYOUT_NAMES: Record<SheetLayout, string> = { half_letter: 'Half letter', letter_two_up: 'Letter, two-up' };

/**
 * How the sheet is turned for its second side. Auto duplex: the printer flips the paper itself (print-duplex.pdf, each sheet's front then its
 * back). By hand: the owner prints one side, puts the stack back and prints the other (print-first.pdf, then print-second.pdf). A printer places
 * the back differently in the two, so each has its own offsets. Chosen per layout.
 */
export type PrintMethod = 'auto' | 'hand';
export const PRINT_METHODS: readonly PrintMethod[] = ['auto', 'hand'];
export const METHOD_NAMES: Record<PrintMethod, string> = { auto: 'Printer flips the paper (auto duplex)', hand: 'I flip the paper by hand' };
/** The method as it reads in a footer or a sentence. */
export const METHOD_SHORT: Record<PrintMethod, string> = { auto: 'auto duplex', hand: 'by hand' };
export const DEFAULT_METHOD: Record<SheetLayout, PrintMethod> = { half_letter: 'hand', letter_two_up: 'auto' };

/** The names of the book's cover files for a print method: auto duplex, one two-page file; by hand, a file for each pass. */
export const coverFileNames = (method: PrintMethod) => (method === 'auto' ? ['cover-duplex.pdf'] : ['cover-outside.pdf', 'cover-inside.pdf']);

/** The paper a file is printed on: the book's interior pages, or the (heavier) cover stock, which a printer places differently. */
export type PaperSet = 'inside' | 'cover';
export const PAPER_SETS: readonly PaperSet[] = ['inside', 'cover'];
export const PAPER_NAMES: Record<PaperSet, string> = { inside: 'Inside paper', cover: 'Cover paper' };

/** The paper's edges as the owner knows them: the 8.5 in edge is the sheet's top and bottom edge as the PDF is drawn, the other its left and right. Calibrate names its readings by these, never by across and down. */
export const EDGE_NAMES: Record<SheetLayout, { x: string; y: string }> = { half_letter: { x: '8.5 in', y: '5.5 in' }, letter_two_up: { x: '8.5 in', y: '11 in' } };

/** How the owner's printer is set for a layout (page scaling and paper size): in summary.txt and in the Calibrate wizard. */
export const PAPER_SETTINGS: Record<SheetLayout, string> = {
  half_letter: 'page scaling None (Actual size), paper size Statement (Borderless)',
  letter_two_up: 'page scaling None (Actual size), paper size Letter (not borderless)',
};

/**
 * What a layout needs to cancel what the printer does to it, measured against the paper. Offsets: +x moves right and +y moves up, as
 * seen on that side. The front takes the first pass (print-first, print-duplex fronts, cover-outside and the front calibration
 * page); the back takes the second. Scale: percent of the true size, about the sheet's centre, on both sides.
 */
export interface LayoutProfile {
  front_offset_x_mm: number;
  front_offset_y_mm: number;
  back_offset_x_mm: number;
  back_offset_y_mm: number;
  scale_x_pct: number;
  scale_y_pct: number;
  /** Degrees the back pass is turned about the sheet's centre (the letter sheet's, for two-up), + counter-clockwise as seen on the back. */
  back_rotation_deg: number;
  /**
   * How thick strokes parallel to the paper's 8.5 in edge are drawn, as a percent of their drawn width (strokes across it are as drawn; angled
   * ones in between). A printer can lay down a horizontal line thicker than a vertical one of the same width; the calibration sheet's line pairs show it.
   * Applied in the printer stage (src/print/correct.ts). Dots and text are never affected.
   */
  line_weight_x_pct: number;
  /**
   * How close to each edge of the paper the printer really prints, per side of the sheet, in mm, as seen on that side: the last number fully
   * printed on the calibration sheet's edge scales (two-up only; 3 until measured). Content nearer the edge than this is lost. They place
   * the two books on a two-up sheet (src/print/placement.ts) and drive the edge check (edge.ts).
   */
  inset_front_left_mm: number;
  inset_front_right_mm: number;
  inset_front_top_mm: number;
  inset_front_bottom_mm: number;
  inset_back_left_mm: number;
  inset_back_right_mm: number;
  inset_back_top_mm: number;
  inset_back_bottom_mm: number;
}

/** The four insets of one side of a sheet. */
export interface Insets { left: number; right: number; top: number; bottom: number }
/** Until measured, a printer is taken to print up to 3 mm from every edge. */
export const DEFAULT_INSET_MM = 3;
export const DEFAULT_INSETS = {
  inset_front_left_mm: DEFAULT_INSET_MM, inset_front_right_mm: DEFAULT_INSET_MM, inset_front_top_mm: DEFAULT_INSET_MM, inset_front_bottom_mm: DEFAULT_INSET_MM,
  inset_back_left_mm: DEFAULT_INSET_MM, inset_back_right_mm: DEFAULT_INSET_MM, inset_back_top_mm: DEFAULT_INSET_MM, inset_back_bottom_mm: DEFAULT_INSET_MM,
} as const;

/** One layout's profiles: by print method, then by paper. */
export type LayoutSets = Record<PrintMethod, Record<PaperSet, LayoutProfile>>;

/** The same profile for every method and both papers (copies): what a profile saved before the methods and papers existed means. */
export const everywhere = (p: LayoutProfile): LayoutSets => ({
  auto: { inside: { ...p }, cover: { ...p } },
  hand: { inside: { ...p }, cover: { ...p } },
});

/** What the printer and paper need: the printer profile. It lives in the browser, never in a book. The defaults are the owner's measured printer and paper. */
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
  /** The sheet layout the files are made for. */
  sheet_layout: SheetLayout;
  /** How each layout's sheets are turned for the second side. */
  print_method: Record<SheetLayout, PrintMethod>;
  /** The offsets and the scale of each layout, for each print method and each paper: a printer places and sizes each paper size, mode and paper differently. */
  layouts: Record<SheetLayout, LayoutSets>;
  /**
   * How dark the printed PDFs draw the light, medium and dark shade tones and the gray text, as a percent of black
   * (0 is white, 100 is black). The editor and PNGs keep the fixed grays; see src/print/tones.ts.
   */
  shade_light_pct: number;
  shade_medium_pct: number;
  shade_dark_pct: number;
  gray_text_pct: number;
  /**
   * Two-up only: the margin between the grid (rows 0 to 43, 132 mm) and the cut top and bottom edge of each book. A book is cut to 132 + 2 x this
   * tall. The default, 3.85, is the page's own margin: the two books fill the letter sheet. A smaller one leaves waste above Book 1 and below Book 2,
   * which placement.ts splits so everything lands inside the printable insets.
   */
  trim_margin_mm: number;
}

/**
 * The defaults are the owner's measured printer and paper, kept here in case the saved printer profile is cleared; the tones are
 * today's grays (#efefef, #dcdcdc, #bdbdbd, #808080). The creep and the two fore-edge shifts are PROVISIONAL: computed from the
 * owner's readings (cover 5.7, sheet 1 5.5, sheet 13 3.6 mm, printed with creep 0.14 and no shift) until the next creep test confirms them.
 */
export const DEFAULT_PRINT: PrintSettings = {
  creep_per_sheet_mm: 0.30, fore_edge_shift_mm: 2.0, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5, trim_margin_mm: 3.85,
  sheet_layout: 'half_letter',
  print_method: { ...DEFAULT_METHOD },
  layouts: {
    half_letter: everywhere({ front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0, line_weight_x_pct: 100, ...DEFAULT_INSETS }),
    letter_two_up: everywhere({ front_offset_x_mm: -0.25, front_offset_y_mm: -1.55, back_offset_x_mm: -0.4, back_offset_y_mm: 1, scale_x_pct: 100, scale_y_pct: 101.01, back_rotation_deg: -0.183, line_weight_x_pct: 100, ...DEFAULT_INSETS }),
  },
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

/** Sheet indexes in print order for printing by hand: [print-first fronts, print-second backs]. */
export function duplexOrder(sheets: number): [number[], number[]] {
  const forward = Array.from({ length: sheets }, (_, i) => i);
  return [[...forward].reverse(), forward];
}

/** One side of one sheet, in print order. */
export interface SheetSideRef { sheet: number; side: 'front' | 'back' }

/**
 * The order the sides of sheets `only` (default: all `n`) go through the printer. By hand: every front, the innermost sheet first (print-first),
 * then every back, the outermost first (print-second). Auto duplex: each sheet's front then its back, from the outermost sheet (print-duplex).
 */
export function printOrder(n: number, method: PrintMethod, only: readonly number[] = Array.from({ length: n }, (_, i) => i)): SheetSideRef[] {
  const [fronts, backs] = duplexOrder(n), keep = (k: number) => only.includes(k);
  if (method === 'hand') return [...fronts.filter(keep).map((sheet) => ({ sheet, side: 'front' as const })), ...backs.filter(keep).map((sheet) => ({ sheet, side: 'back' as const }))];
  return backs.filter(keep).flatMap((sheet) => [{ sheet, side: 'front' as const }, { sheet, side: 'back' as const }]);
}

/** A copy of the print settings that shares nothing with the original. */
export const clonePrint = (p: PrintSettings): PrintSettings => ({
  ...p,
  print_method: { ...p.print_method },
  layouts: Object.fromEntries(SHEET_LAYOUTS.map((l) => [l, Object.fromEntries(PRINT_METHODS.map((m) => [m, Object.fromEntries(PAPER_SETS.map((k) => [k, { ...p.layouts[l][m][k] }]))]))])) as Record<SheetLayout, LayoutSets>,
});

/** What picks a profile: the layout, its print method, and (with the paper) the profile itself. */
export type Layouts = Pick<PrintSettings, 'sheet_layout' | 'print_method' | 'layouts'>;

/** The selected layout's print method. */
export const methodOf = (s: Pick<PrintSettings, 'sheet_layout' | 'print_method'>): PrintMethod => s.print_method[s.sheet_layout];

/** The offsets and scale of the selected layout and its method, for the inside paper or the cover paper. */
export const profileOf = (s: Layouts, paper: PaperSet = 'inside'): LayoutProfile => s.layouts[s.sheet_layout][methodOf(s)][paper];

/** The printable insets of a side of the sheet, for the selected layout and method and the paper. */
export function insetsOf(s: Layouts, side: 'front' | 'back', paper: PaperSet = 'inside'): Insets {
  const p = profileOf(s, paper);
  return side === 'front'
    ? { left: p.inset_front_left_mm, right: p.inset_front_right_mm, top: p.inset_front_top_mm, bottom: p.inset_front_bottom_mm }
    : { left: p.inset_back_left_mm, right: p.inset_back_right_mm, top: p.inset_back_top_mm, bottom: p.inset_back_bottom_mm };
}

/** The offset a side of the sheet takes, in mm: +x right, +y up, as seen on that side. */
export function offsetOf(s: Layouts, side: 'front' | 'back', paper: PaperSet = 'inside') {
  const p = profileOf(s, paper);
  return side === 'front' ? { x: p.front_offset_x_mm, y: p.front_offset_y_mm } : { x: p.back_offset_x_mm, y: p.back_offset_y_mm };
}

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
  for (const layout of SHEET_LAYOUTS) for (const method of PRINT_METHODS) for (const paper of PAPER_SETS) {
    const l = s.layouts[layout][method][paper];
    if (![l.front_offset_x_mm, l.front_offset_y_mm, l.back_offset_x_mm, l.back_offset_y_mm].every(Number.isFinite)) return `The ${LAYOUT_NAMES[layout].toLowerCase()} ${METHOD_SHORT[method]} ${paper} offsets must be numbers.`;
    if (![l.scale_x_pct, l.scale_y_pct].every((v) => Number.isFinite(v) && v >= 95 && v <= 105)) return `The ${LAYOUT_NAMES[layout].toLowerCase()} ${METHOD_SHORT[method]} ${paper} scale must be a percentage from 95 to 105.`;
    if (!Number.isFinite(l.back_rotation_deg) || Math.abs(l.back_rotation_deg) > 1.5) return `The ${LAYOUT_NAMES[layout].toLowerCase()} ${METHOD_SHORT[method]} ${paper} back rotation must be a number of degrees from -1.5 to 1.5.`;
    if (!Number.isFinite(l.line_weight_x_pct) || l.line_weight_x_pct < 80 || l.line_weight_x_pct > 120) return `The ${LAYOUT_NAMES[layout].toLowerCase()} ${METHOD_SHORT[method]} ${paper} line weight must be a percentage from 80 to 120.`;
  }
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
