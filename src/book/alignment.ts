// Turns what a person reads off the calibration sheet into the offsets, rotation and scale of a layout. Pure arithmetic, no PDF.
//
// The sheet is printed on both sides and always uses the WHOLE paper (the half sheet, or the whole letter sheet for two-up). Five marks
// sit on it: top (W/2, m), bottom (W/2, H-m), left (m, H/2), right (W-m, H/2) and the centre (W/2, H/2), m = 8 mm. Side 1 has a fine +
// at each. Side 2 has, at each of the four edge points, a see-through scale (where side 1's + shows through), at the centre a +, two
// 100 mm lines, and four fold scales: two across the horizontal centre line (y = H/2, at x = W/2 -/+ 38) and two across the vertical one
// (x = W/2, at y = H/2 -/+ 38). Folding the sheet top edge to bottom edge puts the crease on the paper's own middle, y = H/2, so the number
// where it crosses a horizontal-fold scale says how far the print's H/2 is from the paper's. The same for the left edge to the right edge.
//
// Everything below is in the BACK's view, centred on the sheet: x to the right, y UP, in mm, and angles counter-clockwise, because that is
// how the back's offsets and rotation are defined. A front mark at x on the front shows through at W - x on the back, and the marks are
// symmetric, so a back scale's position is also the position its mark shows through at.
//
// Let Rf be how far the front's print is from where it should be (its offset plus the printer's error), and Rb the same for the back
// (which also turns by phi about the centre, taking a point q to q + phi * (-q.y, q.x)). The front's x is mirrored in the back's view, so
// for a scale at q:
//
//     see-through = (what shows through) - (the scale's zero) = (phi * q.y - Rb.x - Rf.x,  Rf.y - Rb.y - phi * q.x)
//
//   phi, the back's turn against the front:  from the two x readings, (top - bottom) / (q_top.y - q_bottom.y) with q.y apart H - 2m;
//                                            from the two y readings, (left - right) / (q_right.x - q_left.x) with q.x apart W - 2m. Both: mean.
//   d = Rf' - Rb, the back's translation against the front:  x: reading - phi * q.y,  y: reading + phi * q.x  (averaged)
//
// The crease is on the paper's middle, which is the origin; a fold scale's zero is where the print puts it, the back's own error away
// from there (its centre line moved by Rb, and by the turn: a point q moves by phi * (-q.y, q.x)). A fold reading is + up or + right,
// as seen on side 2, from the scale's zero to the crease, so it is minus that error:
//     horizontal fold, scale at q = (qx, 0):   reading = -(Rb.y + phi * qx)       so Rb.y = -reading - phi * qx
//     vertical fold,   scale at q = (0, qy):   reading = -(Rb.x - phi * qy)       so Rb.x = -reading + phi * qy
//   The two scales of a line are on opposite sides of the centre, so the turn cancels in their mean: Rb = -mean(readings). With one
//   scale of a pair only, the turn is taken out with phi from the see-through (0 if that wasn't read). A print 1.1 mm too low reads +1.1.
//
// What to do about it:
//   rotation: turn the back by -phi.
//   back offset: against the paper when a fold was read, else against the front (move by d).
//   front offset: only when the back was also read against the paper: the front's error is what is left, Rf = d + Rb, in the front's
//                 own view (x mirrored).
// Whether the front also needs a rotation against the paper is not measured.
import { LAYOUT_LIMITS } from './book';
import { EDGE_NAMES, SHEET_H_MM, SHEET_W_MM, type LayoutProfile, type SheetLayout } from './impose';

export type Offsets = Pick<LayoutProfile, 'front_offset_x_mm' | 'front_offset_y_mm' | 'back_offset_x_mm' | 'back_offset_y_mm'>;
export interface Pt { x: number; y: number }

// ---- where things are on the sheet --------------------------------------------------------------------------------
// Positions are in mm on the PDF page, from its top left, y down.

export const SCALE_RANGE_MM = 5;
/** How far from the paper's edge the four edge marks are. */
export const MARK_FROM_EDGE_MM = 8;
/** The two lines to measure, mm: one parallel to the 8.5 in edge, one to the other. */
export const LINE_MM = 100;

export const sheetHeight = (layout: SheetLayout) => (layout === 'letter_two_up' ? 2 * SHEET_H_MM : SHEET_H_MM);

export type MarkName = 'top' | 'bottom' | 'left' | 'right' | 'centre';

/** The five marks, on the whole paper (the half sheet, or the whole letter sheet for two-up). */
export function crosshairs(layout: SheetLayout): Record<MarkName, Pt> {
  const W = SHEET_W_MM, H = sheetHeight(layout), m = MARK_FROM_EDGE_MM;
  return { top: { x: W / 2, y: m }, bottom: { x: W / 2, y: H - m }, left: { x: m, y: H / 2 }, right: { x: W - m, y: H / 2 }, centre: { x: W / 2, y: H / 2 } };
}

/** How far side 2's marks' captions reach (mm), and how far from them anything else on the sheet must stay. */
export const MARK_CLEAR_MM = 10;
/**
 * The box (sheet mm from the top left, y down) that holds everything a mark draws, on side 1 (just its +) or side 2 (scale and
 * caption). The samples, the 100 mm lines and the instructions stay MARK_CLEAR_MM from these.
 */
export function markZone(layout: SheetLayout, name: MarkName, side: 1 | 2): { x0: number; y0: number; x1: number; y1: number } {
  const W = SHEET_W_MM, H = sheetHeight(layout), p = crosshairs(layout)[name];
  if (side === 1 || name === 'centre') return { x0: p.x - 3, y0: p.y - 3, x1: p.x + 3, y1: p.y + 3 };
  if (name === 'top') return { x0: p.x - 6.5, y0: 2, x1: p.x + 31, y1: 14.5 };
  if (name === 'bottom') return { x0: p.x - 6.5, y0: H - 14.5, x1: p.x + 31, y1: H - 2 };
  const y = { y0: p.y - 7, y1: p.y + 7 };
  return name === 'left' ? { x0: 0, x1: 38, ...y } : { x0: W - 38, x1: W, ...y };
}

/** The fold instruction, as the sheet's side 2 and the Calibrate step both say it. */
export const FOLD_HOW = 'Fold the sheet top edge to bottom edge, crease hard, open it, and read where the crease crosses each horizontal-fold scale. Then fold left edge to right edge and read the vertical-fold scales.';

/** How far from the centre + each fold scale is, along its centre line: clear of the + (at least 25 mm), the marks and the 100 mm lines. */
export const FOLD_FROM_CENTRE_MM = 38;
export type FoldName = 'left' | 'right' | 'top' | 'bottom';
/**
 * The four fold scales, where each one's zero is. 'left' and 'right' are across the horizontal centre line (y = H/2, read after folding the
 * top edge to the bottom edge; they run up the sheet); 'top' and 'bottom' across the vertical one (x = W/2, left edge to the right edge; they run right).
 */
export function foldScales(layout: SheetLayout): Record<FoldName, Pt> {
  const W = SHEET_W_MM, H = sheetHeight(layout), f = FOLD_FROM_CENTRE_MM;
  return { left: { x: W / 2 - f, y: H / 2 }, right: { x: W / 2 + f, y: H / 2 }, top: { x: W / 2, y: H / 2 - f }, bottom: { x: W / 2, y: H / 2 + f } };
}

/** A position on the PDF page, as it is measured here: from the sheet's centre, x right, y up. */
export const fromCentre = (layout: SheetLayout, p: Pt): Pt => ({ x: p.x - SHEET_W_MM / 2, y: sheetHeight(layout) / 2 - p.y });

// ---- readings -------------------------------------------------------------------------------------------------------

/** What was read; null (or left empty) for a reading that wasn't made. mm. The see-through ones are + right and + up, as seen on the back. */
export interface SheetReadings {
  /** Where side 1's + shows through the scale at the top and bottom (x) and at the left and right (y). */
  topX: number | null; bottomX: number | null; leftY: number | null; rightY: number | null;
  /**
   * Where the crease crosses the fold scales, from the scale's zero, + up (the two across the horizontal centre line, after folding the top
   * edge to the bottom edge) or + right (the two across the vertical one, left edge to right edge), as seen on side 2. 0 is right.
   */
  hFoldLeft: number | null; hFoldRight: number | null; vFoldTop: number | null; vFoldBottom: number | null;
  /** The two 100 mm lines, measured with a ruler, mm: parallel to the 8.5 in edge, and to the other. */
  longX: number | null; longY: number | null;
}
export const NO_READINGS: SheetReadings = { topX: null, bottomX: null, leftY: null, rightY: null, hFoldLeft: null, hFoldRight: null, vFoldTop: null, vFoldBottom: null, longX: null, longY: null };

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

/**
 * The back's own error against the paper, from the fold readings: how far its print is from where it should be (x right, y up). `phi` is
 * the back's turn (from the see-through, 0 if unknown); it only matters when one scale of a pair was read, since two cancel it.
 */
export function backAgainstPaper(layout: SheetLayout, r: SheetReadings, phi = 0): { x: number | null; y: number | null } {
  const at = foldScales(layout), pos = (n: FoldName) => fromCentre(layout, at[n]);
  const ys = [known(r.hFoldLeft) ? -r.hFoldLeft - phi * pos('left').x : null, known(r.hFoldRight) ? -r.hFoldRight - phi * pos('right').x : null].filter(known);
  const xs = [known(r.vFoldTop) ? -r.vFoldTop + phi * pos('top').y : null, known(r.vFoldBottom) ? -r.vFoldBottom + phi * pos('bottom').y : null].filter(known);
  return { x: xs.length ? mean(xs) : null, y: ys.length ? mean(ys) : null };
}

/**
 * What the sheet and the Calibrate step call each scale and line, in the same words: the paper's edges of the layout, never across and
 * down, and directions as seen on side 2.
 */
export function scaleCaptions(layout: SheetLayout) {
  const e = EDGE_NAMES[layout], line = (edge: string) => `parallel to the ${edge} edge: should measure ${LINE_MM.toFixed(1)} mm`;
  return {
    top: 'see-through top x', bottom: 'see-through bottom x', left: 'see-through left y', right: 'see-through right y',
    hFoldLeft: 'horizontal fold, left scale', hFoldRight: 'horizontal fold, right scale', vFoldTop: 'vertical fold, top scale', vFoldBottom: 'vertical fold, bottom scale',
    longX: line(e.x), longY: line(e.y),
  };
}

/** The scale (%) a measured line asks for: a line of `nominal` mm printed at `printed` % that measures `measured` mm. The old one if nothing was measured. */
export function scaleFromReading(old: number, printed: number, measured: number | null, nominal = LINE_MM): number {
  if (measured === null || !(measured > 0)) return old;
  return within(round((printed * nominal) / measured), 'scale_x_pct');
}

/**
 * The layout's settings after the readings. `printed` are the settings the sheet was printed with (they are in its footer): every
 * reading is relative to them. A setting with no reading to go on is the printed one.
 */
export function sheetResult(layout: SheetLayout, printed: LayoutProfile, r: SheetReadings): LayoutProfile {
  const { phi, dx, dy } = seeThrough(layout, r);
  const rb = backAgainstPaper(layout, r, phi ?? 0);
  const next = { ...printed };
  if (phi !== null) next.back_rotation_deg = within(round(printed.back_rotation_deg - (phi * 180) / Math.PI, 3), 'back_rotation_deg');
  // The back: against the paper if a fold was read, else against the front.
  const bx = rb.x !== null ? -rb.x : dx, by = rb.y !== null ? -rb.y : dy;
  if (bx !== null) next.back_offset_x_mm = within(round(printed.back_offset_x_mm + bx), 'back_offset_x_mm');
  if (by !== null) next.back_offset_y_mm = within(round(printed.back_offset_y_mm + by), 'back_offset_y_mm');
  // The front: what is left of the see-through once the back's own error is taken out. Its x is mirrored in the back's view.
  if (rb.x !== null && dx !== null) next.front_offset_x_mm = within(round(printed.front_offset_x_mm + dx + rb.x), 'front_offset_x_mm');
  if (rb.y !== null && dy !== null) next.front_offset_y_mm = within(round(printed.front_offset_y_mm - dy - rb.y), 'front_offset_y_mm');
  next.scale_x_pct = scaleFromReading(printed.scale_x_pct, printed.scale_x_pct, r.longX, LINE_MM);
  next.scale_y_pct = scaleFromReading(printed.scale_y_pct, printed.scale_y_pct, r.longY, LINE_MM);
  return next;
}
