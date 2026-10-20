import { DEFAULT_PRINT, type PrintSettings } from '../src/book/impose';

/** The print settings before the owner's calibration: no offsets, no fore-edge shift, 0.14 mm creep. Tests of the geometry start here so their numbers stay simple. */
export const FLAT: PrintSettings = {
  ...DEFAULT_PRINT, creep_per_sheet_mm: 0.14, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0,
  front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0,
};
