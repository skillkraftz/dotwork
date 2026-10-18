import { COLS, DEFAULTS, ROWS, type Area, type PageElement, type Rule } from './format/types';
import { elementArea, insideGrid, limitsArea } from './format/bounds';

export interface Pt { x: number; y: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'p1' | 'p2';

/** Nearest whole cell (or half cell) to a position given in cells, kept on the grid below the header. */
export function snapPoint(p: Pt, half: boolean): Pt {
  const u = half ? 0.5 : 1;
  const snap = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v / u) * u));
  return { x: snap(p.x, 0, COLS), y: snap(p.y, 1, ROWS) };
}

export const snapStep = (half: boolean) => (half ? 0.5 : 1);

export function areaFromPoints(a: Pt, b: Pt): Area {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

const within = (a: Area, p: Pt, tol: number) =>
  p.x >= a.x - tol && p.x <= a.x + a.w + tol && p.y >= a.y - tol && p.y <= a.y + a.h + tol;

/** Whether a point (in cells) is on an element, within `tol` cells. Boxes are hit on their drawn sides, not their inside. */
export function hitElement(el: PageElement, p: Pt, tol: number): boolean {
  switch (el.type) {
    case 'shade':
    case 'pattern':
      return within(elementArea(el), p, 0);
    case 'box': {
      const a = elementArea(el);
      if (!within(a, p, tol)) return false;
      return (el.sides ?? ['top', 'bottom', 'left', 'right']).some((s) =>
        s === 'top' ? Math.abs(p.y - a.y) <= tol
          : s === 'bottom' ? Math.abs(p.y - (a.y + a.h)) <= tol
            : s === 'left' ? Math.abs(p.x - a.x) <= tol
              : Math.abs(p.x - (a.x + a.w)) <= tol);
    }
    case 'rule':
    case 'text':
      return within(elementArea(el), p, tol);
    case 'checkboxes': {
      const every = el.every ?? DEFAULTS.every;
      const across = (el.direction ?? DEFAULTS.direction) === 'across';
      for (let i = 0; i < el.count; i++) {
        const cell = across ? { x: el.x + i * every, y: el.y, w: 1, h: 1 } : { x: el.x, y: el.y + i * every, w: 1, h: 1 };
        if (within(cell, p, 0)) return true;
      }
      return false;
    }
  }
}

/** Move an element by (dx, dy) cells, stopping at the edge of the grid and the header row. */
export function moveElement<T extends PageElement>(el: T, dx: number, dy: number): T {
  const a = limitsArea(el);
  dx = Math.max(-a.x, Math.min(COLS - (a.x + a.w), dx));
  dy = Math.max(1 - a.y, Math.min(ROWS - (a.y + a.h), dy));
  const out = { ...el } as PageElement;
  if (out.type === 'rule') { out.x1 += dx; out.x2 += dx; out.y1 += dy; out.y2 += dy; } else { out.x += dx; out.y += dy; }
  return out as T;
}

/** True when `el` can be moved by (dx, dy) without being pushed back by the grid edge. */
export function canMove(el: PageElement, dx: number, dy: number): boolean {
  const a = limitsArea(el);
  return insideGrid({ ...a, x: a.x + dx, y: a.y + dy });
}

/** Handles an element offers for resizing. Checkboxes and text are resized in the properties panel. */
export function handlesFor(el: PageElement): { handle: Handle; at: Pt }[] {
  if (el.type === 'rule') return [{ handle: 'p1', at: { x: el.x1, y: el.y1 } }, { handle: 'p2', at: { x: el.x2, y: el.y2 } }];
  if (el.type !== 'shade' && el.type !== 'pattern' && el.type !== 'box') return [];
  const { x, y, w, h } = el;
  const xm = x + w / 2, ym = y + h / 2, r = x + w, b = y + h;
  return [
    { handle: 'nw', at: { x, y } }, { handle: 'n', at: { x: xm, y } }, { handle: 'ne', at: { x: r, y } },
    { handle: 'w', at: { x, y: ym } }, { handle: 'e', at: { x: r, y: ym } },
    { handle: 'sw', at: { x, y: b } }, { handle: 's', at: { x: xm, y: b } }, { handle: 'se', at: { x: r, y: b } },
  ];
}

/** The handle of `el` under a point (in cells), or null. Edge handles of small elements shrink so they can still be grabbed. */
export function hitHandle(el: PageElement, p: Pt, tol: number): Handle | null {
  const hs = handlesFor(el);
  if (el.type === 'rule') {
    return hs.find((h) => Math.hypot(h.at.x - p.x, h.at.y - p.y) <= tol)?.handle ?? null;
  }
  if (!hs.length) return null;
  const a = elementArea(el);
  const t = Math.min(tol, a.w / 3, a.h / 3) || tol;
  const l = a.x, r = a.x + a.w, top = a.y, bot = a.y + a.h;
  if (p.x < l - t || p.x > r + t || p.y < top - t || p.y > bot + t) return null;
  const ns = Math.abs(p.y - top) <= t ? 'n' : Math.abs(p.y - bot) <= t ? 's' : '';
  const ew = Math.abs(p.x - l) <= t ? 'w' : Math.abs(p.x - r) <= t ? 'e' : '';
  return ((ns + ew) as Handle) || null;
}

/** The handle of `el` nearest a point (in cells) within `tol` cells, or null. Unlike `hitHandle` only the drawn handles count, so a finger can still grab the rest of an edge to move the element. */
export function hitHandlePoint(el: PageElement, p: Pt, tol: number): Handle | null {
  let best: Handle | null = null, bestD = tol;
  for (const { handle, at } of handlesFor(el)) {
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d <= bestD) { best = handle; bestD = d; }
  }
  return best;
}

/** Of the elements under a point (topmost first), the one beneath the selected one, wrapping to the top; the topmost if the selection isn't among them. */
export function cycleHit(hits: number[], selected: number | null): number | undefined {
  if (!hits.length) return undefined;
  const at = selected === null ? -1 : hits.indexOf(selected);
  return hits[(at + 1) % hits.length];
}

/** The element with the edge or corner named by `handle` dragged to `dot`, or null if that leaves nothing. */
export function resizeElement<T extends PageElement>(el: T, handle: Handle, dot: Pt): T | null {
  if (el.type === 'rule') {
    const out: Rule = { ...(el as Rule) };
    // An end of a rule slides along the rule; it stays horizontal or vertical.
    if (el.y1 === el.y2) { if (handle === 'p1') out.x1 = dot.x; else out.x2 = dot.x; } else if (handle === 'p1') out.y1 = dot.y; else out.y2 = dot.y;
    return out.x1 === out.x2 && out.y1 === out.y2 ? null : (out as unknown as T);
  }
  if (el.type !== 'shade' && el.type !== 'pattern' && el.type !== 'box') return null;
  let { x, y, w, h } = el;
  const right = x + w, bottom = y + h;
  if (handle.includes('n')) { y = dot.y; h = bottom - dot.y; }
  if (handle.includes('s')) { h = dot.y - el.y; }
  if (handle.includes('w')) { x = dot.x; w = right - dot.x; }
  if (handle.includes('e')) { w = dot.x - el.x; }
  return w > 0 && h > 0 ? { ...el, x, y, w, h } : null;
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
  p1: 'move', p2: 'move',
};

/** A new element of `type` from a drag between two snapped points, or null if the drag is too small to make one. */
export function elementFromDrag(type: 'shade' | 'pattern' | 'box' | 'rule' | 'checkboxes', a: Pt, b: Pt): PageElement | null {
  const r = areaFromPoints(a, b);
  switch (type) {
    case 'shade': return r.w > 0 && r.h > 0 ? { type, ...r, tone: 'light' } : null;
    case 'pattern': return r.w > 0 && r.h > 0 ? { type, ...r, pattern: 'lines' } : null;
    case 'box': return r.w > 0 && r.h > 0 ? { type, ...r } : null;
    case 'rule': {
      if (r.w === 0 && r.h === 0) return null;
      // Whichever way the drag went further decides the line's direction.
      return r.w >= r.h ? { type, x1: a.x, y1: a.y, x2: b.x, y2: a.y } : { type, x1: a.x, y1: a.y, x2: a.x, y2: b.y };
    }
    case 'checkboxes': {
      if (r.w === 0 && r.h === 0) return null;
      const across = r.w > r.h;
      const count = Math.max(1, Math.round(across ? r.w : r.h));
      const el: PageElement = { type, x: r.x, y: r.y, count };
      if (across) el.direction = 'across';
      return el;
    }
  }
}
