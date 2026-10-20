// The print settings as plain text: printed in the footer of every calibration page, in calibration.txt and in
// summary.txt, so a sheet or a zip says what produced it. One function, so they always agree.
import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Book } from '../book/book';
import type { PrintSettings } from '../book/impose';
import { APP_VERSION } from '../version';

/** How each print setting is named in the text. Typed on every setting, so a new one can't be left out of the summary. */
export const PRINT_LABELS: Record<keyof PrintSettings, string> = {
  paper_thickness_mm: 'paper thickness',
  signatures: 'signatures',
  front_offset_x_mm: 'front offset x',
  front_offset_y_mm: 'front offset y',
  back_offset_x_mm: 'back offset x',
  back_offset_y_mm: 'back offset y',
  shade_light_pct: 'light',
  shade_medium_pct: 'medium',
  shade_dark_pct: 'dark',
  gray_text_pct: 'gray text',
};

/** 'YYYY-MM-DD' in the local time zone. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Five short lines (each fits a page's width at footer size): the app and date, the paper, the front and back offsets and the tones. */
export function settingsLines(book: Book, now: Date): string[] {
  const p = book.print, L = PRINT_LABELS;
  return [
    `Dotwork ${APP_VERSION} | ${isoDay(now)} | page ${PAGE_W_MM} x ${PAGE_H_MM} mm`,
    `${L.paper_thickness_mm} ${p.paper_thickness_mm} mm | ${L.signatures} ${p.signatures}`,
    `${L.front_offset_x_mm} ${p.front_offset_x_mm} mm | ${L.front_offset_y_mm} ${p.front_offset_y_mm} mm`,
    `${L.back_offset_x_mm} ${p.back_offset_x_mm} mm | ${L.back_offset_y_mm} ${p.back_offset_y_mm} mm`,
    `tones (% black) ${L.shade_light_pct} ${p.shade_light_pct} | ${L.shade_medium_pct} ${p.shade_medium_pct} | ${L.shade_dark_pct} ${p.shade_dark_pct} | ${L.gray_text_pct} ${p.gray_text_pct}`,
  ];
}
