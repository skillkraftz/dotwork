import { DEFAULTS, TONE_LETTERS, type Shade, type ToneLetter } from './types';

/** A tint the shade draws: the blank tone draws nothing. */
export type Tint = Exclude<ToneLetter, 'B'>;
export interface ShadeRect { x: number; y: number; w: number; h: number; tone: Tint }

/** Why a `tones` value can't be used, or null: it is one or more of the letters L, M, D and B. */
export function tonesProblem(tones: unknown): string | null {
  if (typeof tones !== 'string' || !/^[LMDB]+$/.test(tones)) {
    return `"tones" must be one or more of the letters ${TONE_LETTERS.join(', ')} (light, medium, dark, blank), got ${JSON.stringify(tones)}.`;
  }
  return null;
}

/** What a person typed, kept to the letters a shade can use: capitals only, anything else dropped. */
export const cleanTones = (typed: string) => typed.toUpperCase().replace(/[^LMDB]/g, '');

/** The tone of the step at row `r` and column `c` (counted in steps of `every` cells from the shade's corner). */
export function toneAt(e: Pick<Shade, 'tones' | 'along'>, r: number, c: number): ToneLetter {
  const along = e.along ?? DEFAULTS.along;
  const n = along === 'rows' ? r : along === 'columns' ? c : r + c;
  return e.tones[n % e.tones.length] as ToneLetter;
}

/**
 * The filled rectangles of a shade, in cells, with neighbours of the same tone joined so nothing shows a seam.
 * Rows and columns take the next tone at every step; a checker takes tone number (row + column) mod the number of tones.
 */
export function shadeRects(e: Shade): ShadeRect[] {
  const step = e.every ?? DEFAULTS.every;
  const nr = Math.ceil(e.h / step), nc = Math.ceil(e.w / step);
  const out: ShadeRect[] = [];
  const open = new Map<string, ShadeRect>(); // rects that the previous row ended, by column span and tone: they can grow down
  for (let r = 0; r < nr; r++) {
    const y = e.y + r * step, h = Math.min(step, e.h - r * step);
    const row: ShadeRect[] = [];
    for (let c = 0; c < nc; c++) {
      const tone = toneAt(e, r, c);
      if (tone === 'B') continue;
      const x = e.x + c * step, w = Math.min(step, e.w - c * step);
      const last = row[row.length - 1];
      if (last && last.tone === tone && last.x + last.w === x) last.w += w;
      else row.push({ x, y, w, h, tone });
    }
    const next = new Map<string, ShadeRect>();
    for (const rect of row) {
      const key = `${rect.x}|${rect.w}|${rect.tone}`;
      const above = open.get(key);
      if (above && above.y + above.h === rect.y) { above.h += rect.h; next.set(key, above); } else { out.push(rect); next.set(key, rect); }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return out;
}
