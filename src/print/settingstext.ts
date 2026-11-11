// The print settings as plain text: printed in the footer of every calibration page, in calibration.txt and in
// summary.txt, so a sheet or a zip says what produced it. One function, so they always agree.
import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import { LAYOUT_NAMES, METHOD_SHORT, PAPER_NAMES, methodOf, profileOf, type LayoutProfile, type PaperSet, type PrintSettings } from '../book/impose';
import { APP_VERSION } from '../version';

/** How each print setting is named in the text. Typed on every setting, so a new one can't be left out of the summary. */
export const PRINT_LABELS: Record<keyof PrintSettings | 'signatures', string> = {
  creep_per_sheet_mm: 'creep per sheet',
  fore_edge_shift_mm: 'fore-edge shift',
  cover_fore_edge_shift_mm: 'cover shift',
  target_fore_edge_margin_mm: 'target margin',
  trim_margin_mm: 'trimmed top/bottom margin',
  signatures: 'signatures',
  sheet_layout: 'sheet layout',
  print_method: 'print method',
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
  line_weight_x_pct: 'line weight x',
  inset_front_left_mm: 'front left',
  inset_front_right_mm: 'front right',
  inset_front_top_mm: 'front top',
  inset_front_bottom_mm: 'front bottom',
  inset_back_left_mm: 'back left',
  inset_back_right_mm: 'back right',
  inset_back_top_mm: 'back top',
  inset_back_bottom_mm: 'back bottom',
};

/** 'YYYY-MM-DD' in the local time zone. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What a file is made for, on one short line: the layout, the print method and the paper set ("Half letter | by hand | inside paper"). */
export const madeFor = (p: PrintSettings, paper: PaperSet) => `${LAYOUT_NAMES[p.sheet_layout]} | ${METHOD_SHORT[methodOf(p)]} | ${PAPER_NAMES[paper].toLowerCase()}`;

/** Nine short lines (eleven on two-up: and the printable insets) (each fits a page's width at footer size): the app and date, what it is made for, the scale, the creep and shifts, the front and back offsets with the scale, and the tones. `paper` picks the offsets and scale shown. */
export function settingsLines(p: PrintSettings, now: Date, signatures?: number, paper: PaperSet = 'inside'): string[] {
  const L = PRINT_LABELS, A = LAYOUT_LABELS, l = profileOf(p, paper);
  return [
    `Dotwork ${APP_VERSION} | ${isoDay(now)} | page ${PAGE_W_MM} x ${PAGE_H_MM} mm`,
    `made for ${madeFor(p, paper)}`,
    `${A.scale_x_pct} ${l.scale_x_pct}% | ${A.scale_y_pct} ${l.scale_y_pct}%`,
    `${L.creep_per_sheet_mm} ${p.creep_per_sheet_mm} mm${signatures === undefined ? '' : ` | ${L.signatures} ${signatures}`} | ${A.line_weight_x_pct} ${l.line_weight_x_pct}%`,
    `${L.fore_edge_shift_mm} ${p.fore_edge_shift_mm} | ${L.cover_fore_edge_shift_mm} ${p.cover_fore_edge_shift_mm} | ${L.target_fore_edge_margin_mm} ${p.target_fore_edge_margin_mm} mm`,
    `${A.front_offset_x_mm} ${l.front_offset_x_mm} mm | ${A.front_offset_y_mm} ${l.front_offset_y_mm} mm`,
    `${A.back_offset_x_mm} ${l.back_offset_x_mm} mm | ${A.back_offset_y_mm} ${l.back_offset_y_mm} mm | ${A.back_rotation_deg} ${l.back_rotation_deg}°`,
    `${L.trim_margin_mm} ${p.trim_margin_mm} mm`,
    ...(p.sheet_layout === 'letter_two_up' ? [
      `printable insets (mm) front: ${l.inset_front_left_mm} left | ${l.inset_front_right_mm} right | ${l.inset_front_top_mm} top | ${l.inset_front_bottom_mm} bottom`,
      `printable insets (mm) back: ${l.inset_back_left_mm} left | ${l.inset_back_right_mm} right | ${l.inset_back_top_mm} top | ${l.inset_back_bottom_mm} bottom`,
    ] : []),
    `tones (% black) ${L.shade_light_pct} ${p.shade_light_pct} | ${L.shade_medium_pct} ${p.shade_medium_pct} | ${L.shade_dark_pct} ${p.shade_dark_pct} | ${L.gray_text_pct} ${p.gray_text_pct}`,
  ];
}
