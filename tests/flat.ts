import { DEFAULT_PRINT, clonePrint, profileOf, type LayoutProfile, type PrintSettings } from '../src/book/impose';
import { LAYOUT_LIMITS } from '../src/book/book';

const ZERO: LayoutProfile = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0 };

/** The print settings before the owner's calibration: no offsets, no fore-edge shift, 0.14 mm creep. Tests of the geometry start here so their numbers stay simple. */
export const FLAT: PrintSettings = {
  ...DEFAULT_PRINT, creep_per_sheet_mm: 0.14, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0,
  layouts: { half_letter: { ...ZERO }, letter_two_up: { ...ZERO } },
};

/** Change print settings; the offsets and scale go to the layout that is selected. */
export function setPrint(print: PrintSettings, change: Partial<PrintSettings> & Partial<LayoutProfile>): void {
  const profile = profileOf(print) as unknown as Record<string, number>, rest = print as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(change)) if (k in LAYOUT_LIMITS) profile[k] = v as number; else rest[k] = v;
}

export const flatTwoUp = (): PrintSettings => ({ ...clonePrint(FLAT), sheet_layout: 'letter_two_up' });
