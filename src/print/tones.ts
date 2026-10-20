// The grays the printed PDFs use for shade tones and gray text. They come from the book's print settings, so a person
// can match them to what their printer actually shows. The editor, preview and PNG export keep the fixed grays in render.ts.
import { SHADE_TONES, TEXT_COLORS } from '../render';
import type { PrintSettings } from '../book/impose';

export interface PrintTones {
  shade: { L: string; M: string; D: string };
  grayText: string;
}

/** A gray as '#rrggbb' from a percent of black: 0 is white, 100 is black. */
export function grayHex(pct: number): string {
  const v = Math.round(255 * (1 - Math.min(100, Math.max(0, pct)) / 100)).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

/** The fixed grays used on screen and in PNGs. */
export const SCREEN_TONES: PrintTones = { shade: SHADE_TONES, grayText: TEXT_COLORS.gray };

export const tonesOf = (p: Pick<PrintSettings, 'shade_light_pct' | 'shade_medium_pct' | 'shade_dark_pct' | 'gray_text_pct'>): PrintTones => ({
  shade: { L: grayHex(p.shade_light_pct), M: grayHex(p.shade_medium_pct), D: grayHex(p.shade_dark_pct) },
  grayText: grayHex(p.gray_text_pct),
});
