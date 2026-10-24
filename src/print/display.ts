// The display list: what a page (or a calibration sheet) is made of once it is laid out, in millimetres from the top left of the
// PDF page, y down, before any printer correction. See docs/print-pipeline.md.
//
//   layout   pages and calibration content -> a list of these items          (layout.ts, calibrate.ts, sheets.ts)
//   printer  the side's scale, rotation and offset move the POSITIONS in it   (correct.ts)
//   pdf      the list is drawn                                                (draw.ts)
import type { Seg } from '../format/path';

export interface Pt { x: number; y: number }
export type Cap = 'butt' | 'round' | 'square';
export type FontName = 'regular' | 'bold';

export type Item =
  /** A straight stroke. `fixed` is left out of the line-weight-by-direction correction (the calibration ladder). */
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; c: string; cap: Cap; fixed?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; c: string }
  | { k: 'poly'; pts: Pt[]; c: string }
  /** Round dots on a lattice: the pattern's top-left is (x, y); `cols` and `rows` are mm from it; `d` is the dot's diameter. */
  | { k: 'dots'; x: number; y: number; cols: number[]; rows: number[]; d: number; c: string }
  /** The same dots after correction: their centres in mm from (x, y), and a key that is the same for the same shape. */
  | { k: 'dotset'; x: number; y: number; pts: [number, number][]; d: number; c: string; key: string }
  /** A run of text, aligned about its anchor (x, y) on the baseline, turned `rot` degrees counter-clockwise about it. */
  | { k: 'text'; str: string; x: number; y: number; size: number; font: FontName; c: string; align: 'start' | 'middle' | 'end'; rot: number }
  /** Absolute M, L, C and Z in mm. Filled, stroked, or both. */
  | { k: 'path'; segs: Seg[]; fill?: string; stroke?: { w: number; c: string; cap: Cap } }
  /** Everything up to the matching `unclip` is cut off outside this polygon. */
  | { k: 'clip'; pts: Pt[] }
  | { k: 'unclip' };

export const rectPts = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

/** The dots as a set with a key, so identical patterns are written once (see draw.ts). */
export function dotsAsSet(i: Extract<Item, { k: 'dots' }>): Extract<Item, { k: 'dotset' }> {
  const pts: [number, number][] = [];
  for (const x of i.cols) for (const y of i.rows) pts.push([x, y]);
  return { k: 'dotset', x: i.x, y: i.y, pts, d: i.d, c: i.c, key: `${i.d}|${i.c}|${i.cols.join(',')}|${i.rows.join(',')}` };
}

/** The box (x0, y0, x1, y1) that holds everything the items draw, or null if they draw nothing. Text is a monospaced estimate (0.6 em per character). */
export function boundsOf(items: readonly Item[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let b: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const add = (x: number, y: number, r = 0) => {
    b = b ? { x0: Math.min(b.x0, x - r), y0: Math.min(b.y0, y - r), x1: Math.max(b.x1, x + r), y1: Math.max(b.y1, y + r) } : { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  };
  for (const i of items) {
    switch (i.k) {
      case 'line': add(i.x1, i.y1, i.w / 2); add(i.x2, i.y2, i.w / 2); break;
      case 'rect': add(i.x, i.y); add(i.x + i.w, i.y + i.h); break;
      case 'poly': i.pts.forEach((p) => add(p.x, p.y)); break;
      case 'dots': {
        if (!i.cols.length || !i.rows.length) break;
        const r = i.d / 2;
        add(i.x + i.cols[0], i.y + i.rows[0], r); add(i.x + i.cols[i.cols.length - 1], i.y + i.rows[i.rows.length - 1], r);
        break;
      }
      case 'dotset': i.pts.forEach(([x, y]) => add(i.x + x, i.y + y, i.d / 2)); break;
      case 'text': {
        const len = i.str.length * 0.6 * i.size, back = i.align === 'start' ? 0 : i.align === 'middle' ? len / 2 : len;
        const a = (i.rot * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a); // the text's direction on the page (y down)
        for (const s of [-back, len - back]) for (const up of [0, 0.8 * i.size]) add(i.x + s * ux + up * uy, i.y + s * uy - up * ux);
        break;
      }
      case 'path': {
        const r = (i.stroke?.w ?? 0) / 2;
        for (const s of i.segs) for (let n = 1; n < s.length; n += 2) add(s[n] as number, s[n + 1] as number, r);
        break;
      }
      default: break;
    }
  }
  return b;
}
