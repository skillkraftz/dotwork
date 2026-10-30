// The printer stage: the correction for one side of a sheet, applied to a display list (display.ts) before it is drawn.
//
// It moves POSITIONS only. Each item is PLACED where mapPoint (sheets.ts) says its centre goes (scale per axis, rotation about the sheet's
// centre, offset), and is never turned: a horizontal or vertical line stays exactly horizontal or vertical, a rectangle stays axis-aligned,
// glyphs stay upright. The back's rotation is tiny (at most 1.5 degrees); turning a line by it makes the printer draw a long staircase,
// so the rotation is applied to where things are, not to what they are. The scale does stretch an item's extent (a 100 mm line prints
// 100 mm times the scale), but widths, dot diameters, font sizes and glyph shapes are never scaled. The one thing that changes a width
// is the line weight by direction (below), which is its own setting.
import type { Seg } from '../format/path';
import { dotsAsSet, type Item, type Pt } from './display';
import type { Layouts, PaperSet } from '../book/impose';
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
  // How a distance between two dots is carried (turned and scaled): dots are items on their own, each placed where its centre goes.
  const carry = (dx: number, dy: number): [number, number] => [t.sx * cos * dx + t.sy * sin * dy, -t.sx * sin * dx + t.sy * cos * dy];
  /** Points placed about their centre: the centre goes where mapPoint says, the points keep their shape (scaled, not turned). */
  const place = (pts: readonly Pt[]): Pt[] => {
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, m = at({ x: cx, y: cy });
    return pts.map((p) => ({ x: m.x + t.sx * (p.x - cx), y: m.y + t.sy * (p.y - cy) }));
  };
  const placeSegs = (segs: readonly Seg[]): Seg[] => {
    const pts: Pt[] = segs.flatMap((s) => (s[0] === 'Z' ? [] : Array.from({ length: (s.length - 1) / 2 }, (_, n) => ({ x: s[1 + 2 * n] as number, y: s[2 + 2 * n] as number }))));
    if (!pts.length) return [...segs];
    const moved = place(pts);
    let k = 0;
    return segs.map((s): Seg => {
      if (s[0] === 'Z') return s;
      const out: number[] = [];
      for (let n = 1; n < s.length; n += 2) { out.push(moved[k].x, moved[k].y); k++; }
      return [s[0], ...out] as Seg;
    });
  };

  return items.map((i): Item => {
    switch (i.k) {
      case 'line': {
        const [a, b] = place([{ x: i.x1, y: i.y1 }, { x: i.x2, y: i.y2 }]);
        return { ...i, x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: i.fixed ? i.w : i.w * weightFactor(b.x - a.x, b.y - a.y, along) };
      }
      case 'rect': {
        const [a, b] = place([{ x: i.x, y: i.y }, { x: i.x + i.w, y: i.y + i.h }]);
        return { k: 'rect', x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, c: i.c };
      }
      case 'image': {
        // Placed like a rectangle: its centre goes where it goes and it stays upright (its pixels are turned only by the design's own rotate).
        const [a, b] = place([{ x: i.x, y: i.y }, { x: i.x + i.w, y: i.y + i.h }]);
        return { ...i, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      }
      case 'poly': return { ...i, pts: place(i.pts) };
      case 'dots':
      case 'dotset': {
        const set = i.k === 'dots' ? dotsAsSet(i) : i, o = at({ x: set.x, y: set.y });
        // The dots keep their size and stay round; each centre goes where it goes. Same lattice, same side: the same key, so one form serves every page.
        return { ...set, x: o.x, y: o.y, pts: set.pts.map(([x, y]) => carry(x, y)), key: `${set.key}|${t.sx}|${t.sy}|${t.rot}` };
      }
      case 'text': {
        // The anchor moves; the glyphs stay upright (or as the design turned them).
        const p = at({ x: i.x, y: i.y });
        return { ...i, x: p.x, y: p.y };
      }
      case 'path': return { ...i, segs: placeSegs(i.segs) };
      case 'clip': return { k: 'clip', pts: place(i.pts) };
      case 'unclip': return i;
    }
  });
}

/** A list as one side of a `w` x `h` sheet prints it, under the printer profile (its layout, print method and paper): the scale, the rotation (back only), the offset and the line weight. */
export const printSide = (items: readonly Item[], print: Layouts, side: 'front' | 'back', w: number, h: number, paper: PaperSet = 'inside'): Item[] =>
  correct(items, transformOf(print, side, paper), w, h, lineWeightOf(print, paper));
