// The printer stage: the correction for one side of a sheet, applied to a display list (display.ts) before it is drawn.
//
// It moves POSITIONS only: the scale (per axis), the rotation and the offset take endpoints, rectangle corners, dot centres, text
// anchors and path points to where mapPoint (sheets.ts) says. Widths, dot diameters, font sizes and glyph shapes are never scaled, so a
// printer that stretches one axis can't thicken lines or squash dots and letters. Text turns with the sheet's rotation but is
// never stretched. The one thing that does change a width is the line weight by direction (below), which is its own setting.
import type { Seg } from '../format/path';
import { dotsAsSet, type Item, type Pt } from './display';
import type { PrintSettings } from '../book/impose';
import { lineWeightOf, mapPoint, transformOf, type SheetTransform } from './sheets';

/** Strokes parallel to the paper's 8.5 in edge are drawn `along` times as thick; ones across it as drawn; angled ones in between, by cos² of the angle. */
export function weightFactor(dx: number, dy: number, along: number): number {
  const len2 = dx * dx + dy * dy;
  return len2 === 0 ? 1 : 1 + (along - 1) * ((dx * dx) / len2);
}

/** What a side does to a sheet `w` x `h` mm, and the line weight along the 8.5 in edge (1 is as drawn). */
export function correct(items: readonly Item[], t: SheetTransform, w: number, h: number, along = 1): Item[] {
  const at = (p: Pt): Pt => mapPoint(t, w, h, p);
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  // How a distance on the sheet is carried: the same turn, scale and sign as mapPoint, without the move.
  const carry = (dx: number, dy: number): [number, number] => [t.sx * cos * dx + t.sy * sin * dy, -t.sx * sin * dx + t.sy * cos * dy];
  const degrees = (t.rot * 180) / Math.PI;
  const mapSegs = (segs: readonly Seg[]): Seg[] => segs.map((s): Seg => {
    if (s[0] === 'Z') return s;
    const out: number[] = [];
    for (let n = 1; n < s.length; n += 2) { const p = at({ x: s[n] as number, y: s[n + 1] as number }); out.push(p.x, p.y); }
    return [s[0], ...out] as Seg;
  });

  return items.map((i): Item => {
    switch (i.k) {
      case 'line': {
        const a = at({ x: i.x1, y: i.y1 }), b = at({ x: i.x2, y: i.y2 });
        return { ...i, x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: i.fixed ? i.w : i.w * weightFactor(b.x - a.x, b.y - a.y, along) };
      }
      case 'rect': {
        const a = at({ x: i.x, y: i.y }), b = at({ x: i.x + i.w, y: i.y + i.h });
        if (t.rot === 0) return { k: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), c: i.c };
        return { k: 'poly', c: i.c, pts: [a, at({ x: i.x + i.w, y: i.y }), b, at({ x: i.x, y: i.y + i.h })] };
      }
      case 'poly': return { ...i, pts: i.pts.map(at) };
      case 'dots':
      case 'dotset': {
        const set = i.k === 'dots' ? dotsAsSet(i) : i, o = at({ x: set.x, y: set.y });
        // The dots keep their size; only their centres are carried. Same lattice, same side: the same key, so one form serves every page.
        return { ...set, x: o.x, y: o.y, pts: set.pts.map(([x, y]) => carry(x, y)), key: `${set.key}|${t.sx}|${t.sy}|${t.rot}` };
      }
      case 'text': {
        const p = at({ x: i.x, y: i.y });
        return { ...i, x: p.x, y: p.y, rot: i.rot + degrees };
      }
      case 'path': return { ...i, segs: mapSegs(i.segs) };
      case 'clip': return { k: 'clip', pts: i.pts.map(at) };
      case 'unclip': return i;
    }
  });
}

/** A list as one side of a `w` x `h` sheet prints it, under the printer profile: the scale, the rotation (back only), the offset and the line weight. */
export const printSide = (items: readonly Item[], print: Pick<PrintSettings, 'sheet_layout' | 'layouts'>, side: 'front' | 'back', w: number, h: number): Item[] =>
  correct(items, transformOf(print, side), w, h, lineWeightOf(print));
