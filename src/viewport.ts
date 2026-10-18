/**
 * Zoom and pan for a page canvas, as plain arithmetic.
 *
 * The canvas shows a window onto the page, in mm. `zoom` 1 fits the whole page-with-margin in the element;
 * `cx`, `cy` are the mm under the middle of the element. `inset` is the height in px of whatever covers the
 * bottom of the element (the bottom sheet): fitting and revealing only use the part above it.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface View { zoom: number; cx: number; cy: number }

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 8;
/** Space kept between a revealed rectangle and the edge of what is visible, in px. */
const REVEAL_MARGIN_PX = 12;
/** How much of the page must stay on screen when panning, in px. */
const SLIVER_PX = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** mm per px at zoom 1: the whole `box` fits in `size`. */
export const baseScale = (box: Rect, size: Size) => Math.max(box.w / size.w, box.h / size.h);

/** mm per px at this view. */
export const scaleOf = (v: View, box: Rect, size: Size) => baseScale(box, size) / v.zoom;

/** The window onto the page this view shows: the SVG's viewBox. */
export function viewRect(v: View, box: Rect, size: Size): Rect {
  const s = scaleOf(v, box, size);
  return { x: v.cx - (size.w / 2) * s, y: v.cy - (size.h / 2) * s, w: size.w * s, h: size.h * s };
}

/** Keep at least a sliver of the page on screen, so it can't be flung out of reach. */
function keep(v: View, box: Rect, size: Size): View {
  const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
  const s = baseScale(box, size) / zoom;
  const slackX = Math.max(0, size.w / 2 - SLIVER_PX) * s, slackY = Math.max(0, size.h / 2 - SLIVER_PX) * s;
  return {
    zoom,
    cx: clamp(v.cx, box.x - slackX, box.x + box.w + slackX),
    cy: clamp(v.cy, box.y - slackY, box.y + box.h + slackY),
  };
}

/**
 * `target` (default the whole box) centred in the part of the element above the inset, as large as fits. Zoom 1 is
 * defined by `box`, so a tighter target can give a zoom above 1.
 */
export function fitView(box: Rect, size: Size, inset = 0, target: Rect = box): View {
  const avail = Math.max(1, size.h - inset);
  const s = Math.max(target.w / size.w, target.h / avail); // mm per px that fits the target
  const zoom = baseScale(box, size) / s;
  return { zoom, cx: target.x + target.w / 2, cy: target.y + target.h / 2 + (inset / 2) * s };
}

/** Zoom by `factor` keeping the mm under the screen point `at` (px from the element's top-left) where it is. */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }, box: Rect, size: Size): View {
  const before = scaleOf(v, box, size);
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const after = baseScale(box, size) / zoom;
  const r = viewRect(v, box, size);
  const mmX = r.x + at.x * before, mmY = r.y + at.y * before;
  return keep({ zoom, cx: mmX - (at.x - size.w / 2) * after, cy: mmY - (at.y - size.h / 2) * after }, box, size);
}

/** Slide the page by a drag of (dx, dy) px: the content follows the fingers. */
export function panBy(v: View, dx: number, dy: number, box: Rect, size: Size): View {
  const s = scaleOf(v, box, size);
  return keep({ ...v, cx: v.cx - dx * s, cy: v.cy - dy * s }, box, size);
}

/** Where a rectangle in mm lands on screen, in px from the element's top-left. */
export function toScreen(r: Rect, v: View, box: Rect, size: Size): Rect {
  const s = scaleOf(v, box, size);
  const o = viewRect(v, box, size);
  return { x: (r.x - o.x) / s, y: (r.y - o.y) / s, w: r.w / s, h: r.h / s };
}

/**
 * Move (and, if it is too big to fit, shrink) the view so `target` (mm) is inside the part of the element above
 * the inset, with a little room around it. Unchanged when it already is.
 */
export function revealRect(v: View, target: Rect, box: Rect, size: Size, inset = 0): View {
  const availW = size.w, availH = Math.max(1, size.h - inset);
  const m = REVEAL_MARGIN_PX;
  let next = v;
  let r = toScreen(target, next, box, size);
  if (r.w + 2 * m > availW || r.h + 2 * m > availH) {
    // Too big to show at this zoom: zoom out about its centre until it fits.
    const factor = Math.min((availW - 2 * m) / r.w, (availH - 2 * m) / r.h);
    next = zoomAt(next, Math.max(factor, MIN_ZOOM / next.zoom), { x: r.x + r.w / 2, y: r.y + r.h / 2 }, box, size);
    r = toScreen(target, next, box, size);
  }
  const dx = r.x < m ? m - r.x : r.x + r.w > availW - m ? availW - m - (r.x + r.w) : 0;
  const dy = r.y < m ? m - r.y : r.y + r.h > availH - m ? availH - m - (r.y + r.h) : 0;
  return dx || dy ? panBy(next, dx, dy, box, size) : next;
}

/** Distance and midpoint of two touch points, for pinching. */
export function pinchOf(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
