// Turns what a person reads off the alignment sheet into the front and back offsets. Pure arithmetic, no PDF.
//
// A side's offset is measured against the PAPER, not against the other side: the fold of the spread must land on the
// sheet's centre (which is where the sheet folds edge to edge) and the margins at the top and bottom must be even.
//
// x: the scale at the fold is printed with the offset applied, zero where the spread's fold lands. Folding the sheet edge to
//    edge puts the crease on the paper's centre. The crease reads r on the scale (+ to the right, as seen on that side), so
//    the fold landed r to the left of where the crease is: move the side right by r.   new = old + r
// y: the rulers at the top and bottom edge count margin outward from the page's box line: the paper edge falls at the
//    margin there is. The expected margin is GRID_Y. Too big a margin at the top means the page is too low: move up.
//    Both edges read: move up by half of (top - bottom). That centres the page, so a sheet cut a little tall or short
//    (the cut dimension is the sheet's height) cancels out. One edge read: that margin is brought back to GRID_Y.
import { GRID_Y_MM } from '../format/types';
import { LAYOUT_LIMITS } from './book';
import type { LayoutProfile } from './impose';

export type Offsets = Pick<LayoutProfile, 'front_offset_x_mm' | 'front_offset_y_mm' | 'back_offset_x_mm' | 'back_offset_y_mm'>;

/** What was read on one side of the sheet; null (or left empty) for a reading that wasn't made. */
export interface SideReadings {
  /** Where the crease crosses the fold scale, mm, + to the right as seen on that side. */
  fold: number | null;
  /** The margin at the paper's top edge on the ruler, mm; at the bottom edge the same. */
  top: number | null;
  bottom: number | null;
}
export const NO_READINGS: SideReadings = { fold: null, top: null, bottom: null };

const round = (v: number) => Math.round(v * 100) / 100;
const limit = (v: number) => Math.min(LAYOUT_LIMITS.front_offset_x_mm.max, Math.max(LAYOUT_LIMITS.front_offset_x_mm.min, v));

/** The new x offset of a side: the old one plus the crease's reading. */
export const xFromReading = (old: number, fold: number | null) => limit(round(fold === null ? old : old + fold));

/** The new y offset of a side (+ up) from its top and bottom margins; see the top of this file. */
export function yFromReadings(old: number, top: number | null, bottom: number | null): number {
  if (top !== null && bottom !== null) return limit(round(old + (top - bottom) / 2));
  if (top !== null) return limit(round(old + top - GRID_Y_MM));
  if (bottom !== null) return limit(round(old + GRID_Y_MM - bottom));
  return old;
}

/** The four offsets after the readings. `printed` are the offsets the sheet was printed with (they are in its footer). */
export function offsetsFromReadings(printed: Offsets, front: SideReadings, back: SideReadings): Offsets {
  return {
    front_offset_x_mm: xFromReading(printed.front_offset_x_mm, front.fold),
    front_offset_y_mm: yFromReadings(printed.front_offset_y_mm, front.top, front.bottom),
    back_offset_x_mm: xFromReading(printed.back_offset_x_mm, back.fold),
    back_offset_y_mm: yFromReadings(printed.back_offset_y_mm, back.top, back.bottom),
  };
}

// ---- size ----------------------------------------------------------------------------------------------------------
// The size sheet prints a line that should measure 100.0 mm across and another down. Printed at `printed` percent, a printer that
// is true would give `printed` mm; measuring m instead means it sizes by m / printed, so the scale that cancels it is 100 x printed / m.

/** The scale (%) a measured 100 mm line asks for, kept within the limits; the old one if nothing was measured. */
export function scaleFromReading(old: number, printed: number, measured: number | null): number {
  if (measured === null || !(measured > 0)) return old;
  return Math.min(LAYOUT_LIMITS.scale_x_pct.max, Math.max(LAYOUT_LIMITS.scale_x_pct.min, Math.round((10000 * printed) / measured) / 100));
}
