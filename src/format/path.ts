// Path data for the `art` element. Art is stored with absolute M, L, C and Z commands only, so a reader needs no
// arc or shorthand maths; the importer (src/art/import.ts) turns anything else into that form.

export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

/** An affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (the SVG matrix). */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` applied after `b`: the point goes through `b` first. */
export const compose = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** How much the transform scales lengths, on average: the square root of its area factor. */
export const meanScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export function transformSegs(segs: readonly Seg[], m: Matrix): Seg[] {
  return segs.map((s): Seg => {
    if (s[0] === 'Z') return s;
    const out: number[] = [];
    for (let i = 1; i < s.length; i += 2) out.push(...apply(m, s[i] as number, s[i + 1] as number));
    return [s[0], ...out] as Seg;
  });
}

const r3 = (v: number) => +v.toFixed(3);

/** The path as text in the stored form, numbers to 0.001. */
export function pathString(segs: readonly Seg[]): string {
  return segs.map((s) => (s[0] === 'Z' ? 'Z' : s[0] + s.slice(1).map((v) => r3(v as number)).join(' '))).join('');
}

/** Every point of the path, control points included. */
export function pointsOf(segs: readonly Seg[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segs) for (let i = 1; i < s.length; i += 2) out.push([s[i] as number, s[i + 1] as number]);
  return out;
}

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

/** The stored form: absolute M, L, C and Z, each with exactly its numbers. A path starts with M and every subpath after a Z starts with M. */
export function parseStored(d: unknown): { ok: true; segs: Seg[] } | { ok: false; problem: string } {
  if (typeof d !== 'string' || d.trim() === '') return { ok: false, problem: 'is empty' };
  const arity: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
  const token = new RegExp(`\\s*(?:([MLCZ])|(${NUMBER}))[\\s,]*`, 'gy');
  const segs: Seg[] = [];
  let cmd = '', args: number[] = [], pos = 0, open = false; // `open`: a current point exists, so L and C may follow
  const flush = (at: number): string | null => {
    if (!cmd) return null;
    if (args.length !== arity[cmd]) return `has "${cmd}" with ${args.length} numbers near character ${at}, expected ${arity[cmd]}`;
    if (cmd === 'M') open = true;
    else if (cmd === 'Z') open = false;
    else if (!open) return `draws with "${cmd}" before an "M" near character ${at}`;
    segs.push((cmd === 'Z' ? ['Z'] : [cmd, ...args]) as Seg);
    return null;
  };
  while (pos < d.length) {
    token.lastIndex = pos;
    const m = token.exec(d);
    if (!m) return { ok: false, problem: `has something that is not M, L, C, Z or a number at character ${pos} ("${d.slice(pos, pos + 8)}")` };
    pos = token.lastIndex;
    if (m[1]) {
      const bad = flush(pos);
      if (bad) return { ok: false, problem: bad };
      cmd = m[1];
      args = [];
    } else {
      if (!cmd) return { ok: false, problem: 'starts with a number instead of "M"' };
      const v = Number(m[2]);
      if (!Number.isFinite(v)) return { ok: false, problem: `has a number that is too large near character ${pos}` };
      args.push(v);
    }
  }
  const bad = flush(pos);
  if (bad) return { ok: false, problem: bad };
  if (!segs.length) return { ok: false, problem: 'is empty' };
  if (segs[0][0] !== 'M') return { ok: false, problem: 'must start with "M"' };
  return { ok: true, segs };
}

// ---- reading any SVG path -----------------------------------------------------------

const KAPPA = 0.5522847498;

/** A circular or elliptical arc as cubic curves, one per quarter turn at most (the SVG implementation notes, F.6). */
export function arcToCubics(x0: number, y0: number, rxIn: number, ryIn: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number): Seg[] {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [['L', x, y]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2, cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, h = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): [number, number] => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number): [number, number] => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step;
    const [px, py] = point(a), [qx, qy] = i === n - 1 ? [x, y] : point(b);
    const [da, db] = [deriv(a), deriv(b)];
    out.push(['C', px + h * da[0], py + h * da[1], qx - h * db[0], qy - h * db[1], qx, qy]);
  }
  return out;
}

/** An ellipse as four cubic curves, drawn clockwise from its right-hand end. */
export function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
}

/** Any SVG path data (relative and shorthand commands, arcs) as the stored form, or null when it can't be read. */
export function parseSvgPath(d: string): Seg[] | null {
  const token = new RegExp(`\\s*(?:([MmLlHhVvCcSsQqTtAaZz])|(${NUMBER}))[\\s,]*`, 'gy');
  const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const segs: Seg[] = [];
  let pos = 0, cmd = '';
  let args: number[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0; // current point and the start of the subpath
  let lastC: [number, number] | null = null, lastQ: [number, number] | null = null; // the last control point, for S and T
  let started = false;

  const run = (): boolean => {
    const rel = cmd === cmd.toLowerCase(), lower = cmd.toLowerCase();
    const [ox, oy] = rel ? [cx, cy] : [0, 0];
    let nextC: [number, number] | null = null, nextQ: [number, number] | null = null;
    if (lower === 'm') {
      cx = ox + args[0]; cy = oy + args[1]; sx = cx; sy = cy;
      segs.push(['M', cx, cy]);
      cmd = rel ? 'l' : 'L'; // more pairs after the first are line-tos
    } else if (lower === 'l') {
      cx = ox + args[0]; cy = oy + args[1];
      segs.push(['L', cx, cy]);
    } else if (lower === 'h') {
      cx = (rel ? cx : 0) + args[0];
      segs.push(['L', cx, cy]);
    } else if (lower === 'v') {
      cy = (rel ? cy : 0) + args[0];
      segs.push(['L', cx, cy]);
    } else if (lower === 'c') {
      const p = [ox + args[0], oy + args[1], ox + args[2], oy + args[3], ox + args[4], oy + args[5]];
      segs.push(['C', ...p] as Seg);
      nextC = [p[2], p[3]]; cx = p[4]; cy = p[5];
    } else if (lower === 's') {
      const [c1x, c1y] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
      const p = [ox + args[0], oy + args[1], ox + args[2], oy + args[3]];
      segs.push(['C', c1x, c1y, ...p] as Seg);
      nextC = [p[0], p[1]]; cx = p[2]; cy = p[3];
    } else if (lower === 'q' || lower === 't') {
      let qx: number, qy: number, x: number, y: number;
      if (lower === 'q') { qx = ox + args[0]; qy = oy + args[1]; x = ox + args[2]; y = oy + args[3]; } else {
        [qx, qy] = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
        x = ox + args[0]; y = oy + args[1];
      }
      segs.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]);
      nextQ = [qx, qy]; cx = x; cy = y;
    } else if (lower === 'a') {
      const x = ox + args[5], y = oy + args[6];
      segs.push(...arcToCubics(cx, cy, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, x, y));
      cx = x; cy = y;
    }
    lastC = nextC; lastQ = nextQ;
    args = [];
    return true;
  };

  while (pos < d.length) {
    // Arc flags may be written without separators ("a1 1 0 00.5.5"): read them as single characters.
    if (cmd.toLowerCase() === 'a' && (args.length === 3 || args.length === 4)) {
      const flag = /\s*([01])[\s,]*/y;
      flag.lastIndex = pos;
      const f = flag.exec(d);
      if (!f) return null;
      args.push(Number(f[1]));
      pos = flag.lastIndex;
      continue;
    }
    token.lastIndex = pos;
    const m = token.exec(d);
    if (!m) return null;
    pos = token.lastIndex;
    if (m[1]) {
      if (args.length) return null; // a command with too few numbers
      cmd = m[1];
      if (!started && cmd !== 'M' && cmd !== 'm') return null;
      started = true;
      if (cmd === 'z' || cmd === 'Z') {
        segs.push(['Z']);
        cx = sx; cy = sy; lastC = lastQ = null;
        cmd = '';
      }
    } else {
      if (!cmd) return null;
      args.push(Number(m[2]));
      if (args.length === ARITY[cmd.toLowerCase()]) run();
    }
  }
  if (args.length) return null;
  // After a Z, drawing continues from the subpath's start: make that explicit so every subpath begins with M.
  const out: Seg[] = [];
  let needMove = false;
  for (const s of segs) {
    if (s[0] === 'Z') { out.push(s); needMove = true; continue; }
    if (needMove && s[0] !== 'M') out.push(['M', sx0(out), sy0(out)]);
    needMove = false;
    out.push(s);
  }
  return out.length && out[0][0] === 'M' && out.every((s) => s[0] === 'Z' || s.slice(1).every(Number.isFinite)) ? out : null;
}

/** Where the subpath that the last Z closed began. */
function startOf(segs: readonly Seg[]): [number, number] {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i][0] === 'M') return [segs[i][1] as number, segs[i][2] as number];
  return [0, 0];
}
const sx0 = (s: readonly Seg[]) => startOf(s)[0];
const sy0 = (s: readonly Seg[]) => startOf(s)[1];
