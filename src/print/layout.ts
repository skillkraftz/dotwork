// The layout stage for a book page: turns a page into display-list items in sheet millimetres (see display.ts), with the page's
// top-left corner at (x, y). Mirrors src/render.ts (the SVG); the sizes, weights and grays come from there so the screen, the PNG
// and the PDF match. Nothing here knows about printers or PDFs.
import {
  DEFAULTS, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM as P,
  type Art, type Box, type Checkboxes, type Page, type PageElement, type Pattern, type Rule, type Shade, type Sequence, type Text,
} from '../format/types';
import { TEXT_INSET_MM, TEXT_SIZE_MM } from '../format/bounds';
import {
  BASELINE_MM, DOT_MM, artColor, GRAY_DOT, HEADER_BASELINE_MM, HEADER_COLOR, LINE, TEXT_COLORS, headerItems, iconPlacement, itemCenter, ticks,
} from '../render';
import { shadeRects } from '../format/shade';
import { artPaths } from '../format/art';
import { compose, parseStored, parseSvgPath, transformSegs, type Matrix, type Seg } from '../format/path';
import { isIcons, sequenceItems } from '../format/sequence';
import { resolveWeek, shownOn } from '../format/week';
import type { Expander } from '../format/tokens';
import { ICONS } from '../icons/icons';
import { SCREEN_TONES, type PrintTones } from './tones';
import { rectPts, type Cap, type FontName, type Item } from './display';

export interface PageLayoutOptions {
  /** Where the page's top-left corner lands on the sheet, in mm from the top-left of the PDF page. */
  x: number;
  y: number;
  pageNumber: string | null;
  expand: Expander;
  /** The grays of shade tones and gray text. Defaults to the fixed grays of the screen. */
  tones?: PrintTones;
}

const iconSegs = new Map<string, Seg[]>();
/** An icon's path data as segments (read once). */
function iconPath(d: string): Seg[] {
  let segs = iconSegs.get(d);
  if (!segs) iconSegs.set(d, (segs = parseSvgPath(d) ?? []));
  return segs;
}

/** Lay out one page, clipped to its own box so nothing can land outside it, onto `out`. */
export function layoutPage(page: Page, o: PageLayoutOptions, out: Item[]): void {
  // Grid-relative mm (y down) to sheet mm.
  const ox = o.x + GRID_X_MM, oy = o.y + GRID_Y_MM;
  const tones = o.tones ?? SCREEN_TONES;
  const textColor = (tone: keyof typeof TEXT_COLORS) => (tone === 'gray' ? tones.grayText : TEXT_COLORS[tone]);

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: string, cap: Cap = 'butt') =>
    out.push({ k: 'line', x1: ox + x1, y1: oy + y1, x2: ox + x2, y2: oy + y2, w, c, cap });
  const fillRect = (x: number, y: number, w: number, h: number, c: string) => out.push({ k: 'rect', x: ox + x, y: oy + y, w, h, c });
  const dots = (x0: number, y0: number, cols: number[], rows: number[], radius: number) => {
    if (!cols.length || !rows.length) return;
    out.push({ k: 'dots', x: ox + x0, y: oy + y0, cols: cols.map((x) => x - x0), rows: rows.map((y) => y - y0), d: radius * 2, c: GRAY_DOT });
  };
  const text = (str: string, size: number, font: FontName, c: string, at: { x: number; y: number }, align: 'start' | 'middle' | 'end', rotate: 0 | 90 | 270) =>
    out.push({ k: 'text', str, x: ox + at.x, y: oy + at.y, size, font, c, align, rot: rotate === 270 ? -90 : rotate });

  const shade = (e: Shade) => {
    for (const r of shadeRects(e)) fillRect(r.x * P, r.y * P, r.w * P, r.h * P, tones.shade[r.tone]);
  };

  const pattern = (e: Pattern) => {
    const step = e.every ?? DEFAULTS.every;
    const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
    const first = e.first === true;
    const rows = (start: boolean) => ticks(e.y, e.h, step, start).map((y) => y * P);
    const cols = (start: boolean) => ticks(e.x, e.w, step, start).map((x) => x * P);
    const l = LINE[e.weight ?? DEFAULTS.patternWeight];
    const hs = (start: boolean) => rows(start).forEach((y) => line(x0, y, x1, y, l.w, l.c));
    const vs = (start: boolean) => cols(start).forEach((x) => line(x, y0, x, y1, l.w, l.c));
    switch (e.pattern) {
      case 'lines': hs(first); break;
      case 'vlines': vs(first); break;
      case 'grid': hs(true); vs(true); break;
      case 'dots': dots(x0, y0, cols(true), rows(true), DOT_MM[e.dots ?? DEFAULTS.dots] / 2); break;
    }
  };

  const box = (e: Box) => {
    const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
    const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
    const seg = { top: [x0, y0, x1, y0], bottom: [x0, y1, x1, y1], left: [x0, y0, x0, y1], right: [x1, y0, x1, y1] } as const;
    for (const s of e.sides ?? ['top', 'bottom', 'left', 'right']) line(...seg[s], w, '#000000', 'square');
  };

  const rule = (e: Rule) => {
    const l = LINE[e.weight ?? DEFAULTS.ruleWeight];
    line(e.x1 * P, e.y1 * P, e.x2 * P, e.y2 * P, l.w, l.c, e.weight === 'hair' ? 'butt' : 'square');
  };

  const checkboxes = (e: Checkboxes) => {
    const size = (e.size ?? DEFAULTS.checkSize) * P;
    const every = e.every ?? DEFAULTS.every;
    const across = (e.direction ?? DEFAULTS.direction) === 'across';
    const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
    for (let i = 0; i < e.count; i++) {
      const cx = (e.x + (across ? i * every : 0)) * P + (P - size) / 2, cy = (e.y + (across ? 0 : i * every)) * P + (P - size) / 2;
      // An outlined square is four strokes with squared ends, so its corners are filled and each side takes its own line weight.
      line(cx, cy, cx + size, cy, w, '#000000', 'square');
      line(cx, cy + size, cx + size, cy + size, w, '#000000', 'square');
      line(cx, cy, cx, cy + size, w, '#000000', 'square');
      line(cx + size, cy, cx + size, cy + size, w, '#000000', 'square');
    }
  };

  const label = (e: Text) => {
    const size = TEXT_SIZE_MM[e.size ?? DEFAULTS.textSize];
    const align = e.align ?? DEFAULTS.align;
    const dx = align === 'left' ? TEXT_INSET_MM : align === 'right' ? -TEXT_INSET_MM : 0;
    const rotate = e.rotate ?? DEFAULTS.rotate;
    // The text's own frame has its origin at the anchor, x along the text and y down the one-cell band (see render.ts).
    const base = P - BASELINE_MM;
    const at = rotate === 90 ? { x: e.x * P + base, y: e.y * P - dx } : rotate === 270 ? { x: e.x * P - base, y: e.y * P + dx } : { x: e.x * P + dx, y: e.y * P + base };
    const font = (e.style ?? DEFAULTS.style) === 'bold' ? 'bold' : 'regular';
    text(o.expand(e.text), size, font, textColor(e.tone ?? DEFAULTS.textTone), at, align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end', rotate);
  };

  const sequence = (e: Sequence) => {
    const c = textColor(e.tone ?? DEFAULTS.sequenceTone);
    const rotate = e.rotate ?? DEFAULTS.rotate;
    sequenceItems(e).forEach((item, i) => {
      const center = itemCenter(e, i);
      if (isIcons(e)) {
        const shape = ICONS[item];
        if (!shape) return;
        const { x, y, scale, stroke } = iconPlacement(e, i);
        // The icon's grid units to grid mm, then turned about the cell's center (see render.ts).
        let m: Matrix = [scale, 0, 0, scale, x, y];
        if (rotate) {
          const a = rotate === 90 ? -Math.PI / 2 : Math.PI / 2, cos = Math.cos(a), sin = Math.sin(a);
          m = compose([cos, sin, -sin, cos, center.x - (cos * center.x - sin * center.y), center.y - (sin * center.x + cos * center.y)], m);
        }
        const place = (d: string) => transformSegs(transformSegs(iconPath(d), m), [1, 0, 0, 1, ox, oy]);
        if (shape.fill) out.push({ k: 'path', segs: place(shape.fill), fill: c });
        out.push({ k: 'path', segs: place(shape.stroke), stroke: { w: stroke, c, cap: 'round' } });
        return;
      }
      // The baseline's midpoint, turned about the cell's center for a rotated run (see render.ts).
      const down = P - BASELINE_MM - P / 2;
      const at = rotate === 90 ? { x: center.x + down, y: center.y } : rotate === 270 ? { x: center.x - down, y: center.y } : { x: center.x, y: center.y + down };
      text(item, TEXT_SIZE_MM.label, 'regular', c, at, 'middle', rotate);
    });
  };

  // The paths are in mm from the grid's corner, the same ones the screen draws; line widths are in mm and stay as they are.
  const art = (e: Art) => {
    for (const p of artPaths(e)) {
      const parsed = parseStored(p.d);
      if (!parsed.ok) continue;
      out.push({
        k: 'path', segs: transformSegs(parsed.segs, [1, 0, 0, 1, ox, oy]),
        ...(p.fill === 'none' ? {} : { fill: artColor(p.fill, tones) }),
        ...(p.stroke === 'none' ? {} : { stroke: { w: p.stroke_mm, c: artColor(p.stroke, tones), cap: p.linecap } }),
      });
    }
  };

  // An element limited to weekends or weekdays shows for the day a day page reads; where no single day is read it always shows.
  const day = o.expand.read?.kind === 'day' ? o.expand.read.first : null;
  const element = (e: PageElement): void => {
    if (!shownOn(e.days, day)) return;
    switch (e.type) {
      case 'sequence': return sequence(e);
      case 'pattern': return pattern(e);
      case 'shade': return shade(e);
      case 'box': return box(e);
      case 'rule': return rule(e);
      case 'checkboxes': return checkboxes(e);
      case 'text': return label(e);
      case 'art': return art(e);
      case 'generated': return resolveWeek(e, o.expand.read).forEach(element);
    }
  };

  out.push({ k: 'clip', pts: rectPts(o.x, o.y, PAGE_W_MM, PAGE_H_MM) });
  for (const e of page.elements) element(e);
  for (const item of headerItems(page, o.pageNumber, o.expand)) {
    text(item.text, TEXT_SIZE_MM.label, item.bold ? 'bold' : 'regular', HEADER_COLOR, { x: item.x, y: HEADER_BASELINE_MM }, item.anchor === 'end' ? 'end' : 'start', 0);
  }
  out.push({ k: 'unclip' });
}
