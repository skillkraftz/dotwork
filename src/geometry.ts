import { COLS, DEFAULTS, ROWS, type Area, type Art, type Image, type IconSize, type PageElement, type Rule, type TextTone } from './format/types';
import { CLOSED_HEADER, elementArea, hitsCorner, insideGrid, limitsArea, type Header } from './format/bounds';

export interface Pt { x: number; y: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'p1' | 'p2';

/** Nearest whole cell (or half cell) to a position given in cells, kept on the grid below the header (or from row 0 when `top` is 0). */
export function snapPoint(p: Pt, half: boolean, top = 1): Pt {
  const u = half ? 0.5 : 1;
  const snap = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v / u) * u));
  return { x: snap(p.x, 0, COLS), y: snap(p.y, top, ROWS) };
}

export const snapStep = (half: boolean) => (half ? 0.5 : 1);

/** The corner of the whole or half cell holding a point in cells, kept on the grid below the header: where an icon or a sequence starts. */
export function cellPoint(p: Pt, half: boolean, top = 1): Pt {
  const u = snapStep(half);
  const snap = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v / u) * u));
  return { x: snap(p.x, 0, COLS - 1), y: snap(p.y, top, ROWS - 1) };
}

export function areaFromPoints(a: Pt, b: Pt): Area {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

const overlap = (a: Area, b: Area) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const within = (a: Area, p: Pt, tol: number) =>
  p.x >= a.x - tol && p.x <= a.x + a.w + tol && p.y >= a.y - tol && p.y <= a.y + a.h + tol;

/** Whether a point (in cells) is on an element, within `tol` cells. Boxes are hit on their drawn sides, not their inside. */
export function hitElement(el: PageElement, p: Pt, tol: number): boolean {
  switch (el.type) {
    case 'pattern':
    case 'shade':
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
    case 'sequence':
    case 'art':
    case 'image':
    case 'generated':
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

/** The element shifted by (dx, dy) cells, wherever that puts it. */
export function translate<T extends PageElement>(el: T, dx: number, dy: number): T {
  const out = { ...el } as PageElement;
  if (out.type === 'rule') { out.x1 += dx; out.x2 += dx; out.y1 += dy; out.y2 += dy; } else { out.x += dx; out.y += dy; }
  // Text centered in an area keeps its place in it when moved along with others.
  if (out.type === 'text' && out.center_in) out.center_in = { ...out.center_in, x: out.center_in.x + dx, y: out.center_in.y + dy };
  return out as T;
}

/** The smallest area holding every element (cells). */
export function groupArea(els: readonly PageElement[]): Area {
  const areas = els.map(limitsArea);
  const x = Math.min(...areas.map((a) => a.x)), y = Math.min(...areas.map((a) => a.y));
  return { x, y, w: Math.max(...areas.map((a) => a.x + a.w)) - x, h: Math.max(...areas.map((a) => a.y + a.h)) - y };
}

/** The smallest area holding everything drawn of the elements (cells), text included at its full length. */
export function boundsOf(els: readonly PageElement[]): Area {
  const areas = els.map((e) => elementArea(e));
  const x = Math.min(...areas.map((a) => a.x)), y = Math.min(...areas.map((a) => a.y));
  return { x, y, w: Math.max(...areas.map((a) => a.x + a.w)) - x, h: Math.max(...areas.map((a) => a.y + a.h)) - y };
}

/** A text no longer centered in an area: it stays where it is drawn, snapped to the grid (`step` is 1, or 0.5 for half cells). */
export function uncenter<T extends PageElement>(el: T, step = 1): T {
  if (el.type !== 'text' || !el.center_in) return el;
  const { center_in: _area, ...rest } = el;
  const snap = (v: number) => Math.round(v / step) * step;
  return { ...rest, x: snap(el.x), y: snap(el.y) } as T;
}

/**
 * Move elements together by (dx, dy) cells, keeping their positions relative to each other: the group stops at the grid edge and the header row as one.
 * A text centered in an area that is moved by itself comes loose and snaps to the grid; moved with others it keeps its place in the area.
 */
export function moveGroup<T extends PageElement>(els: readonly T[], dx: number, dy: number, header: Header = CLOSED_HEADER, step = 1): T[] {
  if (!els.length) return [];
  if (els.length === 1 && (dx !== 0 || dy !== 0)) els = [uncenter(els[0], step)];
  const a = groupArea(els);
  dx = Math.max(-a.x, Math.min(COLS - (a.x + a.w), dx));
  const place = (top: number) => els.map((el) => translate(el, dx, Math.max(top - a.y, Math.min(ROWS - (a.y + a.h), dy))));
  const moved = place(header.top);
  // Row 0 is open, but the page number's corner is not: a move that would land on it stops below the header instead.
  return moved.some((el) => hitsCorner(el, header)) ? place(1) : moved;
}

/** Move an element by (dx, dy) cells, stopping at the edge of the grid and the header row. */
export function moveElement<T extends PageElement>(el: T, dx: number, dy: number, header: Header = CLOSED_HEADER): T {
  return moveGroup([el], dx, dy, header)[0];
}

/** True when `el` can be moved by (dx, dy) without being pushed back by the grid edge. */
export function canMove(els: PageElement | readonly PageElement[], dx: number, dy: number, header: Header = CLOSED_HEADER): boolean {
  const list = [els].flat();
  const a = groupArea(list);
  return insideGrid({ ...a, x: a.x + dx, y: a.y + dy }, header.top) && !list.some((el) => hitsCorner(translate(el, dx, dy), header));
}

/** Handles an element offers for resizing. Checkboxes and text are resized in the properties panel. */
export function handlesFor(el: PageElement): { handle: Handle; at: Pt }[] {
  if (el.type === 'rule') return [{ handle: 'p1', at: { x: el.x1, y: el.y1 } }, { handle: 'p2', at: { x: el.x2, y: el.y2 } }];
  if (el.type !== 'pattern' && el.type !== 'shade' && el.type !== 'box' && el.type !== 'art' && el.type !== 'image' && el.type !== 'generated') return [];
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
  if (el.type !== 'pattern' && el.type !== 'shade' && el.type !== 'box' && el.type !== 'art' && el.type !== 'image' && el.type !== 'generated') return null;
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

/** A tap with a sequence tool places this many items down the page (fewer near the bottom). */
export const TAP_SEQUENCE_COUNT = 7;

/** The icon the Advanced picker last chose, for the icon tool to place. */
export interface IconChoice { name: string; size: IconSize; tone: TextTone }

/**
 * A new element of `type` from a drag between two snapped points, or null if the drag is too small to make one.
 * The sequence and icon tools also make something from a tap: seven numbers down the page, or one icon.
 */
export function elementFromDrag(type: 'pattern' | 'shade' | 'box' | 'rule' | 'checkboxes' | 'sequence' | 'icon', a: Pt, b: Pt, icon?: IconChoice): PageElement | null {
  const r = areaFromPoints(a, b);
  switch (type) {
    case 'pattern': return r.w > 0 && r.h > 0 ? { type, ...r, pattern: 'lines' } : null;
    case 'shade': return r.w > 0 && r.h > 0 ? { type, ...r, tones: DEFAULTS.shadeTones } : null;
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
    case 'sequence':
    case 'icon': {
      // These two take the cell under each end of the drag (see `cellPoint`), and cover both end cells.
      if (type === 'icon' && !icon) return null;
      const size = type === 'icon' ? icon!.size : 1;
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      const across = dx > dy, tap = dx === 0 && dy === 0;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const el: PageElement = {
        type: 'sequence',
        x: Math.min(across ? x : a.x, COLS - size), y: Math.min(across ? a.y : y, ROWS - size),
        count: Math.max(1, Math.floor((across ? dx : dy) / size) + 1),
      };
      if (type === 'icon') {
        el.values = 'icons';
        el.icons = [icon!.name];
        if (size !== DEFAULTS.iconSize) { el.size = icon!.size; el.every = size; }
        if (icon!.tone !== DEFAULTS.sequenceTone) el.tone = icon!.tone;
      } else if (tap) {
        el.count = Math.min(TAP_SEQUENCE_COUNT, Math.floor(ROWS - el.y));
      }
      if (across) el.direction = 'across';
      return el;
    }
  }
}

// ---- finding what a finger meant ------------------------------------------------

/** How far a finger can miss and still select something, in mm: about the width of a fingertip's slop. */
export const TAP_REACH_MM = 6;

const rectDistance = (a: Area, p: Pt) => Math.hypot(Math.max(a.x - p.x, 0, p.x - (a.x + a.w)), Math.max(a.y - p.y, 0, p.y - (a.y + a.h)));
function segmentDistance(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The sides a box draws, as segments. */
function boxSides(el: Extract<PageElement, { type: 'box' }>): [Pt, Pt][] {
  const { x, y, w, h } = el;
  const seg = {
    top: [{ x, y }, { x: x + w, y }], bottom: [{ x, y: y + h }, { x: x + w, y: y + h }],
    left: [{ x, y }, { x, y: y + h }], right: [{ x: x + w, y }, { x: x + w, y: y + h }],
  } as const;
  return (el.sides ?? ['top', 'bottom', 'left', 'right']).map((s) => [seg[s][0], seg[s][1]]);
}

/** The cells a strip of checkboxes occupies. */
function checkboxCells(el: Extract<PageElement, { type: 'checkboxes' }>): Area[] {
  const every = el.every ?? DEFAULTS.every;
  const across = (el.direction ?? DEFAULTS.direction) === 'across';
  return Array.from({ length: el.count }, (_, i) => (across ? { x: el.x + i * every, y: el.y, w: 1, h: 1 } : { x: el.x, y: el.y + i * every, w: 1, h: 1 }));
}

/** Shading and patterns cover an area; everything else is a mark drawn on top of such areas. */
export const isFill = (el: PageElement) => el.type === 'pattern' || el.type === 'shade';

/** How far a point (cells) is from the drawn part of an element: 0 on it. A box is only its drawn sides. */
export function distanceTo(el: PageElement, p: Pt): number {
  switch (el.type) {
    case 'box': {
      const sides = boxSides(el);
      return sides.length ? Math.min(...sides.map(([a, b]) => segmentDistance(a, b, p))) : rectDistance(elementArea(el), p);
    }
    case 'rule': return segmentDistance({ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }, p);
    case 'checkboxes': return Math.min(...checkboxCells(el).map((c) => rectDistance(c, p)));
    default: return rectDistance(elementArea(el), p);
  }
}

/**
 * The elements a tap at `p` could mean, best first, for a finger that can miss by `reach` cells. Marks (text, rules,
 * boxes, checkboxes, sequences) within reach come first, nearest first, so a thin rule over a shaded area is still
 * the one picked; then areas under the finger, then areas just beside it. Ties go to the one drawn on top.
 * `usable` leaves out hidden and locked elements.
 */
export function tapCandidates(els: readonly PageElement[], p: Pt, reach: number, usable: (index: number) => boolean = () => true): number[] {
  const scored = els.flatMap((el, index) => {
    if (!usable(index)) return [];
    const d = distanceTo(el, p);
    if (d > reach) return [];
    const tier = isFill(el) ? (d === 0 ? 1 : 2) : 0;
    return [{ index, d, tier }];
  });
  scored.sort((a, b) => a.tier - b.tier || (a.tier === 1 ? 0 : a.d - b.d) || b.index - a.index);
  return scored.map((s) => s.index);
}

/** Whether a box dragged on the page (cells) touches the element: any part of what is drawn lies inside or crosses it. */
export function touchedBy(el: PageElement, area: Area): boolean {
  switch (el.type) {
    case 'box': return boxSides(el).some(([a, b]) => overlap({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, area));
    case 'checkboxes': return checkboxCells(el).some((c) => overlap(c, area));
    default: return overlap(elementArea(el), area);
  }
}

/**
 * Art or an image drawn like a box: the rectangle dragged from `a` to `b` is where the art goes (fitted or stretched, as its
 * scaling says). A tap, with no drag, puts it down at its first size with its top-left corner there, kept on the page.
 */
export function artFromDrag<T extends Art | Image>(art: T, a: Pt, b: Pt, top = 1): T | null {
  const r = areaFromPoints(a, b);
  const { group: _group, ...rest } = structuredClone(art) as T & { group?: string };
  if (r.w > 0 && r.h > 0) return { ...rest, ...r } as unknown as T;
  if (r.w > 0 || r.h > 0) return null; // a line has no inside to fit the art into
  return { ...rest, x: Math.max(0, Math.min(COLS - art.w, a.x)), y: Math.max(top, Math.min(ROWS - art.h, a.y)) } as unknown as T;
}
