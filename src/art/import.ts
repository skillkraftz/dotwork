// Turns an SVG file into art the page format can store: a view box and a list of paths, each filled and stroked with one
// of the app's tones. Everything else in the file (text, images, gradients, filters, masks, scripts, styles, links to
// other files) is left out, and the result says what was.
import { ART_LIMITS, LONG_SIDE_CELLS, type ArtData, type ArtPath, type ArtTone } from '../format/art';
import { arcToCubics, compose, ellipseSegs, IDENTITY, meanScale, parseSvgPath, pathString, pointsOf, transformSegs, type Matrix, type Seg } from '../format/path';
import { PITCH_MM } from '../format/types';
import { artColor, SCREEN_ART_TONES } from '../render';
import { parseXml, type XmlNode } from './xml';

export type ArtImport =
  | { ok: true; art: ArtData; dropped: string[] }
  | { ok: false; reason: string; dropped: string[] };

/** The biggest file looked at. */
export const MAX_SVG_BYTES = 2_000_000;

// ---- colors ---------------------------------------------------------------------

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
  red: [255, 0, 0], green: [0, 128, 0], lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0],
  purple: [128, 0, 128], pink: [255, 192, 203], brown: [165, 42, 42], navy: [0, 0, 128], teal: [0, 128, 128],
  cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255], maroon: [128, 0, 0],
  olive: [128, 128, 0], gold: [255, 215, 0], indigo: [75, 0, 130], violet: [238, 130, 238], coral: [255, 127, 80],
};

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** How light a '#rgb' or '#rrggbb' color is (0 black to 255 white). */
function hexLuma(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(full.slice(1), 16);
  return luma((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** How light each tone is on screen: colors snap to the nearest. */
const TONE_LUMA = (['black', 'dark', 'medium', 'light', 'gray', 'white'] as const).map((tone) => [tone, hexLuma(artColor(tone, SCREEN_ART_TONES))] as const);

/** The tone nearest to a color's lightness. */
export function nearestTone(r: number, g: number, b: number): Exclude<ArtTone, 'none'> {
  const l = luma(r, g, b);
  return TONE_LUMA.reduce((best, t) => (Math.abs(t[1] - l) < Math.abs(best[1] - l) ? t : best))[0];
}

/** Read a CSS color: a tone, or null when it isn't one we understand. */
function readColor(text: string): ArtTone | 'inherit' | 'url' | null {
  const t = text.trim().toLowerCase();
  if (t === 'none' || t === 'transparent') return 'none';
  if (t === 'inherit') return 'inherit';
  if (t === 'currentcolor') return 'black';
  if (t.startsWith('url(')) return 'url';
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join('') : h;
    if (full.length !== 6 && full.length !== 8) return null;
    if (full.length === 8 && parseInt(full.slice(6), 16) === 0) return 'none';
    const n = parseInt(full.slice(0, 6), 16);
    return nearestTone((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
    if (![r, g, b].every(Number.isFinite)) return null;
    if (parts[3] !== undefined && parseFloat(parts[3]) === 0) return 'none';
    return nearestTone(r, g, b);
  }
  const named = NAMED[t];
  return named ? nearestTone(...named) : null;
}

// ---- numbers and transforms ------------------------------------------------------

const UNITS: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** A length in user units (px); null for a percentage, em or anything unreadable. */
function length(text: string | undefined, fallback = 0): number | null {
  if (text === undefined || text.trim() === '') return fallback;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(text);
  if (!m || !(m[2].toLowerCase() in UNITS)) return null;
  return Number(m[1]) * UNITS[m[2].toLowerCase()];
}

/** An SVG transform list as one matrix, or null when it can't be read. */
function readTransform(text: string | undefined): Matrix | null {
  if (!text || !text.trim()) return IDENTITY;
  let m: Matrix = IDENTITY;
  let rest = text.trim();
  const item = /^([a-zA-Z]+)\s*\(([^)]*)\)[\s,]*/;
  while (rest) {
    const t = item.exec(rest);
    if (!t) return null;
    rest = rest.slice(t[0].length);
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (!a.every(Number.isFinite)) return null;
    let next: Matrix;
    switch (t[1]) {
      case 'matrix': if (a.length !== 6) return null; next = a as unknown as Matrix; break;
      case 'translate': if (a.length < 1 || a.length > 2) return null; next = [1, 0, 0, 1, a[0], a[1] ?? 0]; break;
      case 'scale': if (a.length < 1 || a.length > 2) return null; next = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null;
        const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        next = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case 'skewX': if (a.length !== 1) return null; next = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': if (a.length !== 1) return null; next = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: return null;
    }
    m = compose(m, next);
  }
  return m;
}

// ---- shapes ---------------------------------------------------------------------

/** A rectangle, with rounded corners when rx or ry is given. */
function rectSegs(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null): Seg[] {
  let rx = rxIn ?? ryIn ?? 0, ry = ryIn ?? rxIn ?? 0;
  rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const corner = (fx: number, fy: number, tx: number, ty: number) => arcToCubics(fx, fy, rx, ry, 0, false, true, tx, ty);
  return [
    ['M', x + rx, y], ['L', x + w - rx, y], ...corner(x + w - rx, y, x + w, y + ry),
    ['L', x + w, y + h - ry], ...corner(x + w, y + h - ry, x + w - rx, y + h),
    ['L', x + rx, y + h], ...corner(x + rx, y + h, x, y + h - ry),
    ['L', x, y + ry], ...corner(x, y + ry, x + rx, y), ['Z'],
  ];
}

function pointSegs(points: string | undefined, close: boolean): Seg[] | null {
  const nums = (points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.length % 2 || !nums.every(Number.isFinite)) return null;
  const segs: Seg[] = [['M', nums[0], nums[1]]];
  for (let i = 2; i < nums.length; i += 2) segs.push(['L', nums[i], nums[i + 1]]);
  if (close) segs.push(['Z']);
  return segs;
}

// ---- walking the file --------------------------------------------------------------

interface Paint { fill: ArtTone; stroke: ArtTone; width: number }
const START: Paint = { fill: 'black', stroke: 'none', width: 1 };

/** Elements that draw nothing themselves or that we don't keep: a label for the report, or null to pass over silently. */
const LEFT_OUT: Record<string, string | null> = {
  text: 'text', tspan: 'text', textPath: 'text', image: 'images', foreignObject: 'embedded web content',
  linearGradient: 'gradients', radialGradient: 'gradients', meshgradient: 'gradients', pattern: 'patterns',
  filter: 'filters', mask: 'masks', clipPath: 'clip paths', script: 'scripts', style: 'styles',
  marker: 'markers', symbol: 'symbols', use: 'use elements', animate: 'animations', animateTransform: 'animations', set: 'animations',
  defs: null, title: null, desc: null, metadata: null, namedview: null,
};

const style = (node: XmlNode): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (node.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
};

export function importSvg(text: string): ArtImport {
  const counts = new Map<string, number>();
  const drop = (label: string, n = 1) => counts.set(label, (counts.get(label) ?? 0) + n);
  const report = () => [...counts].map(([label, n]) => (n > 1 ? `${label} (${n})` : label));
  const refuse = (reason: string): ArtImport => ({ ok: false, reason, dropped: report() });

  if (text.length > MAX_SVG_BYTES) return refuse(`The file is ${(text.length / 1e6).toFixed(1)} MB; art files over ${MAX_SVG_BYTES / 1e6} MB are refused.`);
  let root: XmlNode;
  try { root = parseXml(text); } catch (err) { return refuse(`This isn't a readable SVG file. ${(err as Error).message}`); }

  const drawn: { segs: Seg[]; fill: ArtTone; stroke: ArtTone; width: number }[] = [];

  const paintOf = (node: XmlNode, parent: Paint): Paint => {
    const css = style(node);
    const out = { ...parent };
    for (const key of ['fill', 'stroke'] as const) {
      const raw = css[key] ?? node.attrs[key];
      if (raw === undefined) continue;
      const c = readColor(raw);
      if (c === 'inherit') continue;
      if (c === 'url') { drop('gradient and pattern paints (drawn in medium)'); out[key] = 'medium'; } else if (c === null) { drop(`colors that weren't understood (drawn in black)`); out[key] = 'black'; } else out[key] = c;
    }
    const w = css['stroke-width'] ?? node.attrs['stroke-width'];
    if (w !== undefined) { const v = length(w, 1); if (v !== null && v >= 0) out.width = v; }
    for (const k of ['opacity', 'fill-opacity', 'stroke-opacity']) {
      const v = css[k] ?? node.attrs[k];
      if (v !== undefined && parseFloat(v) < 1) drop('transparency (drawn solid)');
    }
    if ((css['stroke-dasharray'] ?? node.attrs['stroke-dasharray'] ?? 'none') !== 'none') drop('dashed lines (drawn solid)');
    return out;
  };

  const notePointers = (node: XmlNode) => {
    for (const k of ['filter', 'mask', 'clip-path']) {
      const v = style(node)[k] ?? node.attrs[k];
      if (v && v !== 'none') drop(k === 'filter' ? 'filters' : k === 'mask' ? 'masks' : 'clip paths');
    }
    for (const k of Object.keys(node.attrs)) if (/^on/i.test(k)) drop('scripts');
    const href = node.attrs.href ?? node.attrs['xlink:href'];
    if (href !== undefined && !href.startsWith('#')) drop('links to other files');
  };

  const walk = (node: XmlNode, parentMatrix: Matrix, parentPaint: Paint) => {
    const css = style(node);
    if (node.attrs.display === 'none' || css.display === 'none') return;
    if (node.name in LEFT_OUT) {
      const label = LEFT_OUT[node.name];
      if (label) drop(label);
      // Definitions draw nothing, but what is defined there (gradients, filters) is still left out.
      else if (node.name === 'defs') for (const child of node.children) if (LEFT_OUT[child.name]) drop(LEFT_OUT[child.name]!);
      return;
    }
    notePointers(node);
    const t = readTransform(node.attrs.transform);
    if (t === null) drop('transforms that weren\'t understood (ignored)');
    const matrix = compose(parentMatrix, t ?? IDENTITY);
    const paint = paintOf(node, parentPaint);
    const a = node.attrs;
    let segs: Seg[] | null = null;
    let fill = paint.fill;
    switch (node.name) {
      case 'svg': case 'g': case 'a': case 'switch':
        for (const child of node.children) walk(child, matrix, paint);
        return;
      case 'path': {
        segs = parseSvgPath(a.d ?? '');
        if (!segs && (a.d ?? '').trim()) drop('paths that couldn\'t be read');
        break;
      }
      case 'rect': {
        const [x, y, w, h] = [length(a.x), length(a.y), length(a.width), length(a.height)];
        if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) break;
        segs = rectSegs(x, y, w, h, a.rx === undefined ? null : length(a.rx), a.ry === undefined ? null : length(a.ry));
        break;
      }
      case 'circle': {
        const [cx, cy, r] = [length(a.cx), length(a.cy), length(a.r)];
        if (cx !== null && cy !== null && r !== null && r > 0) segs = ellipseSegs(cx, cy, r, r);
        break;
      }
      case 'ellipse': {
        const [cx, cy, rx, ry] = [length(a.cx), length(a.cy), length(a.rx), length(a.ry)];
        if (cx !== null && cy !== null && rx !== null && ry !== null && rx > 0 && ry > 0) segs = ellipseSegs(cx, cy, rx, ry);
        break;
      }
      case 'line': {
        const [x1, y1, x2, y2] = [length(a.x1), length(a.y1), length(a.x2), length(a.y2)];
        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) segs = [['M', x1, y1], ['L', x2, y2]];
        fill = 'none'; // a line has no inside
        break;
      }
      case 'polyline': segs = pointSegs(a.points, false); break;
      case 'polygon': segs = pointSegs(a.points, true); break;
      default: drop(`unsupported elements (${node.name})`); return;
    }
    if (!segs || (fill === 'none' && (paint.stroke === 'none' || paint.width <= 0))) return;
    const stroked = paint.stroke !== 'none' && paint.width > 0;
    drawn.push({ segs: transformSegs(segs, matrix), fill, stroke: stroked ? paint.stroke : 'none', width: stroked ? paint.width * meanScale(matrix) : 0 });
  };
  walk(root, IDENTITY, START);

  if (!drawn.length) return refuse('Nothing in this file can be drawn: it has no shapes with a fill or a line.');
  if (drawn.length > ART_LIMITS.paths) return refuse(`The file has ${drawn.length} shapes; art may have at most ${ART_LIMITS.paths}. Simplify it, or merge shapes, and try again.`);

  // The view box: the file's own, widened if the drawing reaches outside it; otherwise its width and height, otherwise the drawing's extent.
  const pts = drawn.flatMap((d) => pointsOf(d.segs));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const nums = (root.attrs.viewBox ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const [w, h] = [length(root.attrs.width, NaN), length(root.attrs.height, NaN)];
  let box: [number, number, number, number] | null = nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0 ? (nums as [number, number, number, number])
    : w !== null && h !== null && w > 0 && h > 0 ? [0, 0, w, h] : null;
  if (box) {
    const sx = box[2] * 0.01, sy = box[3] * 0.01;
    if (extent[0] < box[0] - sx || extent[1] < box[1] - sy || extent[2] > box[0] + box[2] + sx || extent[3] > box[1] + box[3] + sy) {
      const x0 = Math.min(box[0], extent[0]), y0 = Math.min(box[1], extent[1]);
      box = [x0, y0, Math.max(box[0] + box[2], extent[2]) - x0, Math.max(box[1] + box[3], extent[3]) - y0];
    }
  } else box = [extent[0], extent[1], extent[2] - extent[0], extent[3] - extent[1]];
  if (!(box[2] > 0 && box[3] > 0)) return refuse('The drawing has no width or no height, so there is nothing to place.');
  if (box.some((v) => Math.abs(v) > ART_LIMITS.coordinate)) return refuse(`The drawing's numbers are too large (over ${ART_LIMITS.coordinate}).`);
  const view_box = box.map((v) => +v.toFixed(3)) as ArtData['view_box'];

  // Lines keep their width in mm: as wide as they look when the art is first placed.
  const mmPerUnit = (LONG_SIDE_CELLS * PITCH_MM) / Math.max(view_box[2], view_box[3]);
  const paths: ArtPath[] = drawn.map((d) => ({
    d: pathString(d.segs), fill: d.fill, stroke: d.stroke,
    stroke_mm: d.stroke === 'none' ? 0 : Math.min(ART_LIMITS.stroke_mm, Math.max(0.05, +(d.width * mmPerUnit).toFixed(2))),
  }));
  const chars = paths.reduce((n, p) => n + p.d.length, 0);
  if (chars > ART_LIMITS.chars) return refuse(`The shapes need ${chars} characters of path data; art may have at most ${ART_LIMITS.chars}. Simplify the drawing and try again.`);
  return { ok: true, art: { view_box, paths }, dropped: report() };
}
