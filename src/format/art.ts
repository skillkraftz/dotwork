import { PITCH_MM as P, type Art } from './types';
import { parseStored, pathString, pointsOf, transformSegs, type Matrix } from './path';

/** The tones art is drawn in: the shade tones, the gray of gray text, black and white, or nothing. */
export const ART_TONES = ['black', 'dark', 'medium', 'light', 'gray', 'white', 'none'] as const;
export type ArtTone = (typeof ART_TONES)[number];

export const ART_SCALINGS = ['fit', 'stretch'] as const;
export type ArtScaling = (typeof ART_SCALINGS)[number];

/** The fills the owner can give a named path on a page. */
export const ART_FILLS = ['none', 'light', 'medium', 'dark'] as const;
export type ArtFill = (typeof ART_FILLS)[number];
/** The lines the owner can give a named path on a page. */
export const ART_STROKES = ['none', 'gray', 'black'] as const;
export type ArtStroke = (typeof ART_STROKES)[number];

/** How a line ends: flat at the point, rounded past it, or squared past it. */
export const ART_LINECAPS = ['butt', 'round', 'square'] as const;
export type ArtLinecap = (typeof ART_LINECAPS)[number];

/** Path ids are short plain names, as in the SVG file. */
export const ART_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;

/** One shape of the art, in the art's own units (the view box). */
export interface ArtPath {
  /** The id the path had in the SVG file, if it had a usable one. Unique within the art. */
  id?: string;
  /** Absolute M, L, C and Z commands only. */
  d: string;
  fill: ArtTone;
  stroke: ArtTone;
  /** Line width in mm; it does not change when the art is resized. 0 when there is no stroke. */
  stroke_mm: number;
  /** How the line ends; `butt` when absent. */
  linecap?: ArtLinecap;
}

/** Whether a placement can choose this path's fill: it is closed (ends with Z) or it has a fill. */
export const canFill = (p: Pick<ArtPath, 'd' | 'fill'>) => p.fill !== 'none' || /Z\s*$/.test(p.d);
/** Whether a placement can choose this path's line: it has one. */
export const canStroke = (p: Pick<ArtPath, 'stroke' | 'stroke_mm'>) => p.stroke !== 'none' && p.stroke_mm > 0;

/** What the art is made of, apart from where it sits. */
export interface ArtData {
  /** [x, y, width, height] of the art's own drawing area. */
  view_box: [number, number, number, number];
  paths: ArtPath[];
}

/** Limits that keep a page file small and a drawing sane. */
export const ART_LIMITS = { paths: 200, chars: 40_000, stroke_mm: 3, coordinate: 1_000_000 } as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** How far outside the view box a point may lie, as a fraction of the box (rounding and curve controls). */
const SLACK = 0.01;

/** Why this is not art data (view box and paths), as [path within the element, message] pairs; empty when it is fine. */
export function artProblems(el: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const vb = el.view_box;
  let box: [number, number, number, number] | null = null;
  if (!Array.isArray(vb) || vb.length !== 4 || !vb.every(isNum)) out.push(['view_box', '"view_box" is required and must be four numbers [x, y, width, height].']);
  else if (vb[2] <= 0 || vb[3] <= 0) out.push(['view_box', `"view_box" width and height must be greater than 0 (got ${vb[2]} x ${vb[3]}).`]);
  else if (vb.some((v) => Math.abs(v) > ART_LIMITS.coordinate)) out.push(['view_box', `"view_box" numbers must be within ${ART_LIMITS.coordinate} of zero.`]);
  else box = vb as [number, number, number, number];

  if (!Array.isArray(el.paths) || el.paths.length === 0) {
    out.push(['paths', '"paths" is required and must list at least one path.']);
    return out;
  }
  if (el.paths.length > ART_LIMITS.paths) out.push(['paths', `Art may have at most ${ART_LIMITS.paths} paths (got ${el.paths.length}).`]);
  let chars = 0;
  const ids = new Set<string>();
  el.paths.forEach((p: unknown, i: number) => {
    const at = `paths[${i}]`;
    if (!isObject(p)) { out.push([at, 'A path must be an object { d, fill, stroke, stroke_mm }.']); return; }
    for (const k of ['fill', 'stroke'] as const) {
      if (!ART_TONES.includes(p[k] as ArtTone)) out.push([`${at}.${k}`, `"${k}" must be one of ${ART_TONES.map((t) => JSON.stringify(t)).join(', ')}, got ${JSON.stringify(p[k])}.`]);
    }
    if (p.id !== undefined) {
      if (typeof p.id !== 'string' || !ART_ID.test(p.id)) out.push([`${at}.id`, `"id" must be a short name of letters, digits and _ . : - starting with a letter, got ${JSON.stringify(p.id)}.`]);
      else if (ids.has(p.id)) out.push([`${at}.id`, `Two paths are called "${p.id}"; ids must be unique.`]);
      else ids.add(p.id);
    }
    if (p.linecap !== undefined && !ART_LINECAPS.includes(p.linecap as ArtLinecap)) out.push([`${at}.linecap`, `"linecap" must be one of ${ART_LINECAPS.map((t) => JSON.stringify(t)).join(', ')}, got ${JSON.stringify(p.linecap)}.`]);
    const w = p.stroke_mm;
    if (!isNum(w) || w < 0 || w > ART_LIMITS.stroke_mm) out.push([`${at}.stroke_mm`, `"stroke_mm" must be a number from 0 to ${ART_LIMITS.stroke_mm} (got ${JSON.stringify(w)}).`]);
    else if (p.stroke !== 'none' && ART_TONES.includes(p.stroke as ArtTone) && w === 0) out.push([`${at}.stroke_mm`, 'A stroked path needs a "stroke_mm" greater than 0.']);
    chars += typeof p.d === 'string' ? p.d.length : 0;
    const parsed = parseStored(p.d);
    if (!parsed.ok) { out.push([`${at}.d`, `Path data ${parsed.problem}. Art paths use absolute M, L, C and Z only.`]); return; }
    if (!box) return;
    const sx = box[2] * SLACK, sy = box[3] * SLACK;
    const stray = pointsOf(parsed.segs).find(([x, y]) => x < box![0] - sx || x > box![0] + box![2] + sx || y < box![1] - sy || y > box![1] + box![3] + sy);
    if (stray) out.push([`${at}.d`, `Path data reaches (${stray[0]}, ${stray[1]}), outside the view box [${box.join(', ')}].`]);
  });
  if (el.fills !== undefined) {
    if (!isObject(el.fills)) out.push(['fills', '"fills" must be an object of path id to fill.']);
    else for (const [id, tone] of Object.entries(el.fills)) {
      if (!ids.has(id)) out.push([`fills.${id}`, `"fills" names "${id}", but no path has that id.`]);
      else if (!ART_FILLS.includes(tone as ArtFill)) out.push([`fills.${id}`, `A fill must be one of ${ART_FILLS.map((t) => JSON.stringify(t)).join(', ')}, got ${JSON.stringify(tone)}.`]);
    }
  }
  if (el.strokes !== undefined) {
    if (!isObject(el.strokes)) out.push(['strokes', '"strokes" must be an object of path id to line.']);
    else for (const [id, tone] of Object.entries(el.strokes)) {
      if (!ids.has(id)) out.push([`strokes.${id}`, `"strokes" names "${id}", but no path has that id.`]);
      else if (!ART_STROKES.includes(tone as ArtStroke)) out.push([`strokes.${id}`, `A line must be one of ${ART_STROKES.map((t) => JSON.stringify(t)).join(', ')}, got ${JSON.stringify(tone)}.`]);
    }
  }
  if (chars > ART_LIMITS.chars) out.push(['paths', `The path data is ${chars} characters; art may have at most ${ART_LIMITS.chars}.`]);
  return out;
}

/** Where the art lands inside its box: scale and offset (mm per art unit, and the box's top-left in mm), all relative to the grid. */
export function artMatrix(el: Pick<Art, 'x' | 'y' | 'w' | 'h' | 'view_box' | 'scaling'>): Matrix {
  const [vx, vy, vw, vh] = el.view_box;
  const W = el.w * P, H = el.h * P;
  const stretch = el.scaling === 'stretch';
  const sx = stretch ? W / vw : Math.min(W / vw, H / vh);
  const sy = stretch ? H / vh : sx;
  const left = el.x * P + (W - vw * sx) / 2, top = el.y * P + (H - vh * sy) / 2;
  return [sx, 0, 0, sy, left - vx * sx, top - vy * sy];
}

/** One path as drawn: the path data in mm from the grid's corner, ready for the screen and the PDF alike. */
export interface DrawnArtPath { d: string; fill: ArtTone; stroke: ArtTone; stroke_mm: number; linecap: ArtLinecap }

/** The paths of an art element placed on the page: fitted or stretched into its box, line widths unchanged. */
export function artPaths(el: Art): DrawnArtPath[] {
  const m = artMatrix(el);
  return el.paths.flatMap((p) => {
    const parsed = parseStored(p.d);
    if (!parsed.ok) return [];
    const fill = (p.id !== undefined && el.fills?.[p.id]) || p.fill;
    // A path with no line of its own can't be given one: there is no width to draw.
    const stroke = p.stroke === 'none' ? 'none' : (p.id !== undefined && el.strokes?.[p.id]) || p.stroke;
    if (fill === 'none' && stroke === 'none') return [];
    return [{ d: pathString(transformSegs(parsed.segs, m)), fill, stroke, stroke_mm: stroke === 'none' ? 0 : p.stroke_mm, linecap: p.linecap ?? 'butt' }];
  });
}

/** The cells the art should cover when first placed: its longer side is `LONG_SIDE_CELLS`, in half cells. */
export const LONG_SIDE_CELLS = 10;
export function defaultSize(view_box: readonly number[]): { w: number; h: number } {
  const [, , vw, vh] = view_box;
  const k = LONG_SIDE_CELLS / Math.max(vw, vh);
  const half = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);
  return { w: half(vw * k), h: half(vh * k) };
}
