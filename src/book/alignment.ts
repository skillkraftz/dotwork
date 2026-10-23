// Turns what a person reads off the calibration sheet into the offsets, rotation and scale of a layout. Pure arithmetic, no PDF.
//
// The sheet is printed on both sides. Side 1 (the front) has four crosshairs; side 2 (the back) has a mm scale where each one shows
// through when held to a light, a scale for the fold's crease, a ruler at the paper's top and bottom edge and two long lines.
//
// Everything below is in the BACK's view, centred on the sheet (the letter sheet's centre for two-up): x to the right, y UP, in mm,
// and angles counter-clockwise, because that is how the back's offsets and rotation are defined. A front crosshair at x on the front
// shows through at W - x on the back, so the crosshairs are placed symmetrically and a back scale's position is also the position its
// crosshair shows through at.
//
// Let Rf be how far the front's print is from where it should be (its offset plus the printer's error), and Rb the same for the back
// (which also turns by phi). The front's x is mirrored in the back's view, so for a scale at q:
//
//     reading = (what shows through) - (the scale's zero) = (phi * q.y - Rb.x - Rf.x,  Rf.y - Rb.y - phi * q.x)
//
//   phi, the back's turn against the front:  from two x readings, (top - bottom) / (q_top.y - q_bottom.y);
//                                            from two y readings, (left - right) / (q_right.x - q_left.x). Both: their mean.
//   d = Rf' - Rb, the back's translation against the front:  x: reading - phi * q.y,  y: reading + phi * q.x  (averaged)
//   The crease is the paper's own x = 0:      crease = phi * q.y - Rb.x        so Rb.x = phi * q.y - crease
//   The margins are the box line to the edge: top = 3.85 + (down), bottom = 3.85 + (up)    so Rb.y = (bottom - top) / 2
//
// What to do about it:
//   rotation: turn the back by -phi.
//   back offset: against the paper when the crease or the margins were read (move by -Rb), else against the front (move by d).
//   front offset: only when the back was also read against the paper: the front's error is what is left, Rf = d + Rb, in the front's
//                 own view (x mirrored).
// Whether the front also needs a rotation against the paper is not measured.
import { GRID_Y_MM } from '../format/types';
import { LAYOUT_LIMITS } from './book';
import { EDGE_NAMES, SHEET_H_MM, SHEET_W_MM, type LayoutProfile, type SheetLayout } from './impose';

export type Offsets = Pick<LayoutProfile, 'front_offset_x_mm' | 'front_offset_y_mm' | 'back_offset_x_mm' | 'back_offset_y_mm'>;
export interface Pt { x: number; y: number }

// ---- where things are on the sheet --------------------------------------------------------------------------------
// Positions are in mm on the PDF page, from its top left, y down.

export const SCALE_RANGE_MM = 5;
/** How far from the paper's top and bottom edge the x scales sit, and from its left and right edge the y scales. */
export const CROSS_FROM_TOP_MM = 12.85, CROSS_FROM_SIDE_MM = 15;
/** The long lines' lengths: along the 8.5 in edge, and along the other (the 5.5 in edge, or the 11 in edge across both halves of two-up). */
export const LONG_LINE_MM: Record<SheetLayout, { x: number; y: number }> = {
  half_letter: { x: 190, y: 120 },
  letter_two_up: { x: 190, y: 260 },
};

export const sheetHeight = (layout: SheetLayout) => (layout === 'letter_two_up' ? 2 * SHEET_H_MM : SHEET_H_MM);

/**
 * Where the four crosshairs are (and so the four scales on the back). The top and bottom ones are on the fold, near the paper's top and
 * bottom edge: on two-up the bottom half's bottom, which doubles the lever that shows a turn. The left and right ones are mid-height of
 * the top half, away from the cut marks.
 */
export function crosshairs(layout: SheetLayout): Record<'top' | 'bottom' | 'left' | 'right', Pt> {
  return {
    top: { x: SHEET_W_MM / 2, y: CROSS_FROM_TOP_MM },
    bottom: { x: SHEET_W_MM / 2, y: sheetHeight(layout) - CROSS_FROM_TOP_MM },
    left: { x: CROSS_FROM_SIDE_MM, y: SHEET_H_MM / 2 },
    right: { x: SHEET_W_MM - CROSS_FROM_SIDE_MM, y: SHEET_H_MM / 2 },
  };
}
/** The fold scale: on the fold, at the sheet's centre. */
export const foldScaleAt = (layout: SheetLayout): Pt => ({ x: SHEET_W_MM / 2, y: sheetHeight(layout) / 2 });

/** A position on the PDF page, as it is measured here: from the sheet's centre, x right, y up. */
export const fromCentre = (layout: SheetLayout, p: Pt): Pt => ({ x: p.x - SHEET_W_MM / 2, y: sheetHeight(layout) / 2 - p.y });

// ---- readings -------------------------------------------------------------------------------------------------------

/** What was read; null (or left empty) for a reading that wasn't made. mm, + is right and + is up, as seen on the back. */
export interface SheetReadings {
  /** Where the front's crosshairs show through, on the scale at the top and bottom edge (x) and at the left and right edge (y). */
  topX: number | null; bottomX: number | null; leftY: number | null; rightY: number | null;
  /** Where the crease crosses the fold scale. */
  crease: number | null;
  /** The margin at the paper's top and bottom edge on the ruler; 3.85 is right. */
  topMargin: number | null; bottomMargin: number | null;
  /** The two long lines, measured with a ruler, mm. */
  longX: number | null; longY: number | null;
}
export const NO_READINGS: SheetReadings = { topX: null, bottomX: null, leftY: null, rightY: null, crease: null, topMargin: null, bottomMargin: null, longX: null, longY: null };

const known = (v: number | null): v is number => v !== null;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const within = (v: number, key: keyof typeof LAYOUT_LIMITS) => Math.min(LAYOUT_LIMITS[key].max, Math.max(LAYOUT_LIMITS[key].min, v));

/** What the see-through readings say: the back's turn against the front (radians, + counter-clockwise) and its translation against the front. */
export function seeThrough(layout: SheetLayout, r: SheetReadings): { phi: number | null; dx: number | null; dy: number | null } {
  const c = crosshairs(layout), top = fromCentre(layout, c.top), bottom = fromCentre(layout, c.bottom), left = fromCentre(layout, c.left), right = fromCentre(layout, c.right);
  const turns: number[] = [];
  if (known(r.topX) && known(r.bottomX)) turns.push((r.topX - r.bottomX) / (top.y - bottom.y));
  if (known(r.leftY) && known(r.rightY)) turns.push((r.leftY - r.rightY) / (right.x - left.x));
  const phi = turns.length ? mean(turns) : null, t = phi ?? 0;
  const xs = [known(r.topX) ? r.topX - t * top.y : null, known(r.bottomX) ? r.bottomX - t * bottom.y : null].filter(known);
  const ys = [known(r.leftY) ? r.leftY + t * left.x : null, known(r.rightY) ? r.rightY + t * right.x : null].filter(known);
  return { phi, dx: xs.length ? mean(xs) : null, dy: ys.length ? mean(ys) : null };
}

/** The back's own error against the paper, from the crease and the margins: how far its print is from where it should be (x right, y up). */
export function backAgainstPaper(layout: SheetLayout, r: SheetReadings, phi: number | null): { x: number | null; y: number | null } {
  const at = fromCentre(layout, foldScaleAt(layout));
  let y: number | null = null;
  if (known(r.topMargin) && known(r.bottomMargin)) y = (r.bottomMargin - r.topMargin) / 2;
  else if (known(r.topMargin)) y = GRID_Y_MM - r.topMargin;
  else if (known(r.bottomMargin)) y = r.bottomMargin - GRID_Y_MM;
  return { x: known(r.crease) ? (phi ?? 0) * at.y - r.crease : null, y };
}

/**
 * What the sheet and the Calibrate step call each scale, line and ruler: the paper's edges of the layout, never across and down. The sheet
 * prints these next to the scales and the step's inputs use the same words.
 */
export function scaleCaptions(layout: SheetLayout) {
  const e = EDGE_NAMES[layout];
  return {
    top: `x, top ${e.x} edge`, bottom: `x, bottom ${e.x} edge`, left: `y, left ${e.y} edge`, right: `y, right ${e.y} edge`,
    crease: 'crease', topMargin: `margin, top ${e.x} edge`, bottomMargin: `margin, bottom ${e.x} edge`,
    longX: `${e.x} edge: should measure ${LONG_LINE_MM[layout].x.toFixed(1)} mm`, longY: `${e.y} edge: should measure ${LONG_LINE_MM[layout].y.toFixed(1)} mm`,
  };
}

/** The scale (%) a measured line asks for: a line of `nominal` mm printed at `printed` % that measures `measured` mm. The old one if nothing was measured. */
export function scaleFromReading(old: number, printed: number, measured: number | null, nominal = 100): number {
  if (measured === null || !(measured > 0)) return old;
  return within(round((printed * nominal) / measured), 'scale_x_pct');
}

/**
 * The layout's settings after the readings. `printed` are the settings the sheet was printed with (they are in its footer): every
 * reading is relative to them. A setting with no reading to go on is the printed one.
 */
export function sheetResult(layout: SheetLayout, printed: LayoutProfile, r: SheetReadings): LayoutProfile {
  const { phi, dx, dy } = seeThrough(layout, r);
  const rb = backAgainstPaper(layout, r, phi);
  const next = { ...printed };
  if (phi !== null) next.back_rotation_deg = within(round(printed.back_rotation_deg - (phi * 180) / Math.PI, 3), 'back_rotation_deg');
  // The back: against the paper if that was read, else against the front.
  const bx = rb.x !== null ? -rb.x : dx, by = rb.y !== null ? -rb.y : dy;
  if (bx !== null) next.back_offset_x_mm = within(round(printed.back_offset_x_mm + bx), 'back_offset_x_mm');
  if (by !== null) next.back_offset_y_mm = within(round(printed.back_offset_y_mm + by), 'back_offset_y_mm');
  // The front: what is left of the see-through once the back's own error is taken out. Its x is mirrored in the back's view.
  if (rb.x !== null && dx !== null) next.front_offset_x_mm = within(round(printed.front_offset_x_mm + dx + rb.x), 'front_offset_x_mm');
  if (rb.y !== null && dy !== null) next.front_offset_y_mm = within(round(printed.front_offset_y_mm - dy - rb.y), 'front_offset_y_mm');
  next.scale_x_pct = scaleFromReading(printed.scale_x_pct, printed.scale_x_pct, r.longX, LONG_LINE_MM[layout].x);
  next.scale_y_pct = scaleFromReading(printed.scale_y_pct, printed.scale_y_pct, r.longY, LONG_LINE_MM[layout].y);
  return next;
}
