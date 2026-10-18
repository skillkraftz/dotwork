import { COLS, PITCH_MM, ROWS } from './format/types';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Dot { x: number; y: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const P = PITCH_MM;

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Why a region may not be placed here, or null if it is fine. */
export function placementProblem(r: Rect, others: Rect[]): string | null {
  if (r.w < 1 || r.h < 1) return 'A region must be at least one cell wide and one cell tall.';
  if (r.y < 1 && r.y + r.h > 0) return 'Row 0 is reserved for the page header; regions can’t touch it.';
  if (r.x < 0 || r.y < 0 || r.x + r.w > COLS || r.y + r.h > ROWS) return 'A region can’t extend past the edge of the page.';
  if (others.some((o) => rectsOverlap(r, o))) return 'Regions can’t overlap another region.';
  return null;
}

export function rectFromDots(a: Dot, b: Dot): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Nearest grid dot to a point in mm. */
export function dotAt(mmX: number, mmY: number): Dot {
  return {
    x: Math.max(0, Math.min(COLS, Math.round(mmX / P))),
    y: Math.max(0, Math.min(ROWS, Math.round(mmY / P))),
  };
}

export function cellAt(mmX: number, mmY: number): Dot {
  return { x: Math.floor(mmX / P), y: Math.floor(mmY / P) };
}

export function containsCell(r: Rect, c: Dot): boolean {
  return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
}

/** Move by whole cells, clamped to stay on the page below the header row. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return {
    ...r,
    x: Math.max(0, Math.min(COLS - r.w, r.x + dx)),
    y: Math.max(1, Math.min(ROWS - r.h, r.y + dy)),
  };
}

/** Drag the edges named by `handle` to the given dot. May return an invalid (zero/negative) size. */
export function resizeRect(r: Rect, handle: Handle, dot: Dot): Rect {
  let { x, y, w, h } = r;
  const right = r.x + r.w, bottom = r.y + r.h;
  if (handle.includes('n')) { y = dot.y; h = bottom - dot.y; }
  if (handle.includes('s')) { h = dot.y - r.y; }
  if (handle.includes('w')) { x = dot.x; w = right - dot.x; }
  if (handle.includes('e')) { w = dot.x - r.x; }
  return { x, y, w, h };
}

/** Which edge or corner of `r` is under the point (mm), within `tolMm`; null for the interior or outside. */
export function hitHandle(r: Rect, mmX: number, mmY: number, tolMm: number): Handle | null {
  const l = r.x * P, rt = (r.x + r.w) * P, t = r.y * P, b = (r.y + r.h) * P;
  // Keep some interior so small regions can still be grabbed to move.
  const tol = Math.min(tolMm, (rt - l) / 3, (b - t) / 3);
  if (mmX < l - tol || mmX > rt + tol || mmY < t - tol || mmY > b + tol) return null;
  const ns = Math.abs(mmY - t) <= tol ? 'n' : Math.abs(mmY - b) <= tol ? 's' : '';
  const ew = Math.abs(mmX - l) <= tol ? 'w' : Math.abs(mmX - rt) <= tol ? 'e' : '';
  return ((ns + ew) as Handle) || null;
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};
