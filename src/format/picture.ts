// Where a picture (an `image`, or `art` that has been zoomed, panned or turned) lands inside its box. Pure geometry in mm from the grid's
// corner, shared by the screen, the PNG and the PDF so they agree. See docs/page-format.md, "Zoom, pan and rotate".
import { PITCH_MM as P, type Area, type Art, type Image, type PageElement } from './types';
import { compose, type Matrix } from './path';

export const PICTURE_ROTATIONS = [0, 90, 180, 270] as const;
/** Degrees, clockwise. */
export type PictureRotation = (typeof PICTURE_ROTATIONS)[number];

/** Zoom is a multiple of the fitted size: 1 is 100% (fit), 4 is 400%. */
export const ZOOM = { min: 1, max: 4, step: 0.1 } as const;
/** How far a picture may be moved from the middle of its box, in cells (what the format allows; the editor keeps some of the picture in the box). */
export const PAN_LIMIT = 100;

/** The optional view of a picture inside its box. A missing field is its default: zoom 1, no pan, no rotation. */
export interface PictureView {
  zoom?: number;
  /** Cells the picture is moved right (+) and down (+) from the middle of the box. */
  pan_x?: number;
  pan_y?: number;
  rotate?: PictureRotation;
}

export const VIEW_KEYS = ['zoom', 'pan_x', 'pan_y', 'rotate'] as const;
const isDefault = (key: (typeof VIEW_KEYS)[number], v: number) => (key === 'zoom' ? v === 1 : v === 0);

/** Whether any of the view fields is set to something other than its default. */
export const hasView = (v: PictureView): boolean => VIEW_KEYS.some((k) => v[k] !== undefined && !isDefault(k, v[k]));

/** The view with the given fields changed; a field set to its default is left out, so a plain picture stays plain. */
export function withView<T extends PictureView>(el: T, change: PictureView): T {
  const out: T = { ...el, ...change };
  for (const k of VIEW_KEYS) if (out[k] !== undefined && isDefault(k, out[k] as number)) delete out[k];
  return out;
}

/** The element with no zoom, pan or rotation. */
export function resetView<T extends PictureView>(el: T): T {
  const out = { ...el };
  for (const k of VIEW_KEYS) delete out[k];
  return out;
}

/** The view on a page drawn mirrored: the picture moves to the other side and turns the other way, but its pixels are never flipped (like text). */
export function mirrorView(v: PictureView): PictureView {
  const out: PictureView = {};
  if (v.zoom !== undefined) out.zoom = v.zoom;
  if (v.pan_x) out.pan_x = -v.pan_x;
  if (v.pan_y !== undefined) out.pan_y = v.pan_y;
  if (v.rotate) out.rotate = ((360 - v.rotate) % 360) as PictureRotation;
  return out;
}

/** What a picture is made of, apart from where it sits: its natural size in its own units (pixels, or the art's view box). */
export interface Content { w: number; h: number }

export interface Placement {
  /** The box, in mm from the grid's corner: everything outside it is cut off. */
  clip: Area;
  /** Where the middle of the picture lands, in mm. */
  cx: number;
  cy: number;
  /** The picture's size in the box's frame (after the turn), in mm. */
  w: number;
  h: number;
  /** mm per content unit along the content's own x and y. */
  sx: number;
  sy: number;
  rotate: PictureRotation;
}

/**
 * Where the content lands in the box (`box` in cells): turned by `rotate`, fitted inside the box keeping its proportions (or stretched to fill it, for
 * art that asks for it), made `zoom` times as big, and moved by the pan. At zoom 1 with no pan and no turn it is centred and touches the box.
 */
export function placePicture(box: Area, content: Content, view: PictureView = {}, stretch = false): Placement {
  const rotate = view.rotate ?? 0, zoom = view.zoom ?? 1;
  const W = box.w * P, H = box.h * P;
  const odd = rotate === 90 || rotate === 270;
  // The content scaled along its own axes, so that after the turn it fits the box.
  let sx: number, sy: number;
  if (stretch) {
    sx = (odd ? H : W) / content.w;
    sy = (odd ? W : H) / content.h;
  } else {
    sx = sy = Math.min(W / (odd ? content.h : content.w), H / (odd ? content.w : content.h));
  }
  sx *= zoom; sy *= zoom;
  return {
    clip: { x: box.x * P, y: box.y * P, w: W, h: H },
    cx: box.x * P + W / 2 + (view.pan_x ?? 0) * P,
    cy: box.y * P + H / 2 + (view.pan_y ?? 0) * P,
    w: (odd ? content.h * sy : content.w * sx),
    h: (odd ? content.w * sx : content.h * sy),
    sx, sy, rotate,
  };
}

/** The matrix that carries a point of the content (measured from its own `origin`, e.g. an art view box's middle) to mm from the grid's corner. */
export function contentMatrix(p: Placement, origin: { x: number; y: number }): Matrix {
  const a = (p.rotate * Math.PI) / 180, cos = Math.round(Math.cos(a) * 1e12) / 1e12, sin = Math.round(Math.sin(a) * 1e12) / 1e12;
  const into: Matrix = [1, 0, 0, 1, -origin.x, -origin.y];
  const scale: Matrix = [p.sx, 0, 0, p.sy, 0, 0];
  const turn: Matrix = [cos, sin, -sin, cos, 0, 0];
  const out: Matrix = [1, 0, 0, 1, p.cx, p.cy];
  return compose(out, compose(turn, compose(scale, into)));
}

/** The rectangle a picture's pixels fill, in mm from the grid's corner (the box's frame, after the turn). */
export const pictureRect = (p: Placement): Area => ({ x: p.cx - p.w / 2, y: p.cy - p.h / 2, w: p.w, h: p.h });

/**
 * The matrix that carries the unit square of an image (u across, v down, 0 to 1) to the rectangle `r` it fills, turned `rotate` degrees clockwise
 * inside it. (`r` is the size after the turn.)
 */
export function imageMatrix(r: Area, rotate: PictureRotation): Matrix {
  switch (rotate) {
    case 90: return [0, r.h, -r.w, 0, r.x + r.w, r.y];
    case 180: return [-r.w, 0, 0, -r.h, r.x + r.w, r.y + r.h];
    case 270: return [0, -r.h, r.w, 0, r.x, r.y + r.h];
    default: return [r.w, 0, 0, r.h, r.x, r.y];
  }
}

/**
 * The most a picture may be moved, in cells: far enough to bring any edge of it to the middle of the box, but never so far that less than a
 * cell of it (or of the box, if that is smaller) is left in the box.
 */
export function panLimit(box: Area, content: Content, view: PictureView = {}, stretch = false): { x: number; y: number } {
  const p = placePicture(box, content, { ...view, pan_x: 0, pan_y: 0 }, stretch);
  const reach = (boxMm: number, picMm: number) => Math.max(0, (boxMm + picMm) / 2 - Math.min(P, boxMm, picMm)) / P;
  return { x: reach(p.clip.w, p.w), y: reach(p.clip.h, p.h) };
}

/** The pan kept within `panLimit` and to a tenth of a cell. */
export function clampPan(box: Area, content: Content, view: PictureView, pan: { x: number; y: number }, stretch = false): { x: number; y: number } {
  const lim = panLimit(box, content, view, stretch);
  const one = (v: number, max: number) => Math.round(Math.max(-max, Math.min(max, v)) * 10) / 10 + 0; // + 0 turns -0 into 0
  return { x: one(pan.x, Math.floor(lim.x * 10) / 10), y: one(pan.y, Math.floor(lim.y * 10) / 10) };
}

/** The reasons a picture's view fields are not allowed, as [field, message] pairs. */
export function viewProblems(el: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (el.zoom !== undefined && !(num(el.zoom) && el.zoom >= ZOOM.min && el.zoom <= ZOOM.max)) out.push(['zoom', `"zoom" must be a number from ${ZOOM.min} (100%) to ${ZOOM.max} (400%), got ${JSON.stringify(el.zoom)}.`]);
  for (const k of ['pan_x', 'pan_y'] as const) {
    if (el[k] !== undefined && !(num(el[k]) && Math.abs(el[k]) <= PAN_LIMIT)) out.push([k, `"${k}" must be a number of cells from -${PAN_LIMIT} to ${PAN_LIMIT}, got ${JSON.stringify(el[k])}.`]);
  }
  if (el.rotate !== undefined && !(PICTURE_ROTATIONS as readonly unknown[]).includes(el.rotate)) out.push(['rotate', `"rotate" must be one of ${PICTURE_ROTATIONS.join(', ')} (degrees clockwise), got ${JSON.stringify(el.rotate)}.`]);
  return out;
}

// ---- editing a placed picture ---------------------------------------------------------------------------------

/** Whether an element is a picture: an image, or art (which can be zoomed, panned and turned too). */
export const isPicture = (el: PageElement): el is Art | Image => el.type === 'art' || el.type === 'image';

/** A picture's natural size: the pixels of an image, the view box of art. */
export const contentOf = (el: Art | Image): Content => (el.type === 'image' ? { w: el.width_px, h: el.height_px } : { w: el.view_box[2], h: el.view_box[3] });

/** The picture with its view fields tidied: the pan kept inside what the box and zoom allow, and fields at their defaults left out. */
export function tidyView<T extends Art | Image>(el: T, change: PictureView = {}): T {
  const next = withView(el, change);
  const pan = clampPan(next, contentOf(next), next, { x: next.pan_x ?? 0, y: next.pan_y ?? 0 }, next.type === 'art' && next.scaling === 'stretch');
  return withView(next, { pan_x: pan.x, pan_y: pan.y });
}

/** The picture moved to this pan (cells right and down of the middle of its box), kept inside what is allowed. */
export const panTo = <T extends Art | Image>(el: T, x: number, y: number): T => tidyView(el, { pan_x: x, pan_y: y });
