// The print settings as plain text: printed in the footer of every calibration page, in calibration.txt and in
// summary.txt, so a sheet or a zip says what produced it. One function, so they always agree.
import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import { LAYOUT_NAMES, profileOf, type LayoutProfile, type PrintSettings } from '../book/impose';
import { APP_VERSION } from '../version';

/** How each print setting is named in the text. Typed on every setting, so a new one can't be left out of the summary. */
export const PRINT_LABELS: Record<keyof PrintSettings | 'signatures', string> = {
  creep_per_sheet_mm: 'creep per sheet',
  fore_edge_shift_mm: 'fore-edge shift',
  cover_fore_edge_shift_mm: 'cover shift',
  target_fore_edge_margin_mm: 'target margin',
  signatures: 'signatures',
  sheet_layout: 'sheet layout',
  layouts: 'layouts',
  shade_light_pct: 'light',
  shade_medium_pct: 'medium',
  shade_dark_pct: 'dark',
  gray_text_pct: 'gray text',
};

/** How each layout setting is named in the text. */
export const LAYOUT_LABELS: Record<keyof LayoutProfile, string> = {
  front_offset_x_mm: 'front offset x',
  front_offset_y_mm: 'front offset y',
  back_offset_x_mm: 'back offset x',
  back_offset_y_mm: 'back offset y',
  back_rotation_deg: 'back rotation',
  scale_x_pct: 'scale x',
  scale_y_pct: 'scale y',
};

/** 'YYYY-MM-DD' in the local time zone. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Seven short lines (each fits a page's width at footer size): the app and date, the layout, the creep and shifts, the front and back offsets with the scale, and the tones. */
export function settingsLines(p: PrintSettings, now: Date, signatures?: number): string[] {
  const L = PRINT_LABELS, A = LAYOUT_LABELS, l = profileOf(p);
  return [
    `Dotwork ${APP_VERSION} | ${isoDay(now)} | page ${PAGE_W_MM} x ${PAGE_H_MM} mm`,
    `${L.sheet_layout} ${LAYOUT_NAMES[p.sheet_layout]} | ${A.scale_x_pct} ${l.scale_x_pct}% | ${A.scale_y_pct} ${l.scale_y_pct}%`,
    `${L.creep_per_sheet_mm} ${p.creep_per_sheet_mm} mm${signatures === undefined ? '' : ` | ${L.signatures} ${signatures}`}`,
    `${L.fore_edge_shift_mm} ${p.fore_edge_shift_mm} | ${L.cover_fore_edge_shift_mm} ${p.cover_fore_edge_shift_mm} | ${L.target_fore_edge_margin_mm} ${p.target_fore_edge_margin_mm} mm`,
    `${A.front_offset_x_mm} ${l.front_offset_x_mm} mm | ${A.front_offset_y_mm} ${l.front_offset_y_mm} mm`,
    `${A.back_offset_x_mm} ${l.back_offset_x_mm} mm | ${A.back_offset_y_mm} ${l.back_offset_y_mm} mm | ${A.back_rotation_deg} ${l.back_rotation_deg}°`,
    `tones (% black) ${L.shade_light_pct} ${p.shade_light_pct} | ${L.shade_medium_pct} ${p.shade_medium_pct} | ${L.shade_dark_pct} ${p.shade_dark_pct} | ${L.gray_text_pct} ${p.gray_text_pct}`,
  ];
}
