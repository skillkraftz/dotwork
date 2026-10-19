import {
  COLS, DEFAULTS, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM as P, ROWS,
  type Page, type PageElement, type PageSide, type Pattern, type Shade, type Box, type Rule, type Checkboxes, type Text, type Sequence,
} from './format/types';
import { isIcons, itemOrigin, itemSize, sequenceItems } from './format/sequence';
import { ICON_GRID, ICONS } from './icons/icons';
import { elementArea, TEXT_INSET_MM, TEXT_SIZE_MM } from './format/bounds';
import { expandTokens } from './format/tokens';
import { shadeRects } from './format/shade';
import { boundsOf, handlesFor, type Pt } from './geometry';

/** Editor view box: the page plus a quiet margin around it. */
export const EDIT_BOX = { x: -8, y: -6, w: PAGE_W_MM + 16, h: PAGE_H_MM + 12 };
/** What a fitted view shows on a narrow screen: the page with a sliver of margin. */
export const FIT_BOX = { x: -2, y: -3, w: PAGE_W_MM + 4, h: PAGE_H_MM + 6 };
export const EDIT_VIEWBOX = `${EDIT_BOX.x} ${EDIT_BOX.y} ${EDIT_BOX.w} ${EDIT_BOX.h}`;
export const SAMPLE_PAGE_NUMBER = '47';

export const FONT_FAMILY = `font-family="'Courier Prime', 'Courier New', monospace"`;
export const PT = 25.4 / 72;
export const LINE = { hair: { w: 0.12, c: '#c4c4c4' }, thin: { w: 0.5 * PT, c: '#000' }, thick: { w: 1.5 * PT, c: '#000' } } as const;
export const GRAY_DOT = '#b0b0b0';
/** The grays of a shade's tones (L, M, D); blank draws nothing. */
export const SHADE_TONES = { L: '#efefef', M: '#dcdcdc', D: '#bdbdbd' } as const;
/** Dots are 0.5 mm across, or this much when large. */
export const DOT_MM = { small: 0.5, large: 0.9 } as const;
export const TEXT_COLORS = { gray: '#808080', black: '#000' } as const;
export const BASELINE_MM = 0.6; // text sits this far above the bottom of its cell band

export interface RenderOptions {
  /** edit: grid dots, header shading and selection; preview: as printed, on screen; export: as printed, page only. */
  mode: 'edit' | 'preview' | 'export';
  selected?: number | null;
  /** Every selected element (edit mode); `selected` is the main one, the only one that shows resize handles. */
  selection?: readonly number[];
  /** Indexes of elements the editor is hiding (edit mode only). */
  hidden?: ReadonlySet<number>;
  /** Indexes of the pieces of the group being edited from inside (edit mode): the rest of the page is dimmed, and the group framed. */
  inside?: readonly number[];
  /** The box being dragged to select things (cells, edit mode). */
  marquee?: { x: number; y: number; w: number; h: number };
  /** What is about to be placed, drawn faintly (edit mode). */
  draft?: PageElement | readonly PageElement[] | null;
  /** Side of the selection's resize handles in mm (edit mode); the editor sizes them to stay finger-sized on screen. */
  handleMm?: number;
  /** The number in the header's outer corner. Defaults to a sample; null leaves it out. */
  pageNumber?: string | null;
  /** How text turns its {tokens} into what is drawn. Defaults to sample values. */
  expand?: (text: string) => string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => +v.toFixed(3);
const sample = (text: string) => expandTokens(text);

/** Positions of the boundaries inside [from, from+len]: every `step`, plus the far edge. */
export function ticks(from: number, len: number, step: number, includeStart: boolean): number[] {
  const out: number[] = [];
  for (let t = includeStart ? 0 : step; t < len; t += step) out.push(from + t);
  out.push(from + len);
  return out;
}

const stroke = (d: string, w: number, c: string, cap = 'butt') =>
  d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(w)}" stroke-linecap="${cap}"/>` : '';

/** The gray tints of a shade, one rectangle per run of the same tone. */
function shadeMarkup(e: Shade): string {
  return shadeRects(e).map((r) =>
    `<rect x="${n(r.x * P)}" y="${n(r.y * P)}" width="${n(r.w * P)}" height="${n(r.h * P)}" fill="${SHADE_TONES[r.tone]}"/>`).join('');
}

function patternMarkup(e: Pattern): string {
  const step = e.every ?? DEFAULTS.every;
  const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
  const first = e.first === true;
  const rows = (start: boolean) => ticks(e.y, e.h, step, start).map((y) => y * P);
  const cols = (start: boolean) => ticks(e.x, e.w, step, start).map((x) => x * P);
  const h = (start: boolean) => rows(start).map((y) => `M${n(x0)} ${n(y)}H${n(x1)}`).join('');
  const v = (start: boolean) => cols(start).map((x) => `M${n(x)} ${n(y0)}V${n(y1)}`).join('');
  const line = LINE[e.weight ?? DEFAULTS.patternWeight];
  switch (e.pattern) {
    case 'lines': return stroke(h(first), line.w, line.c);
    case 'vlines': return stroke(v(first), line.w, line.c);
    case 'grid': return stroke(h(true) + v(true), line.w, line.c);
    case 'dots': {
      let d = '';
      for (const x of cols(true)) for (const y of rows(true)) d += `M${n(x)} ${n(y)}h0`;
      return stroke(d, DOT_MM[e.dots ?? DEFAULTS.dots], GRAY_DOT, 'round');
    }
  }
}

function boxMarkup(e: Box): string {
  const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
  const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
  const seg = {
    top: `M${n(x0)} ${n(y0)}H${n(x1)}`, bottom: `M${n(x0)} ${n(y1)}H${n(x1)}`,
    left: `M${n(x0)} ${n(y0)}V${n(y1)}`, right: `M${n(x1)} ${n(y0)}V${n(y1)}`,
  };
  return stroke((e.sides ?? ['top', 'bottom', 'left', 'right']).map((s) => seg[s]).join(''), w, '#000', 'square');
}

function ruleMarkup(e: Rule): string {
  const l = LINE[e.weight ?? DEFAULTS.ruleWeight];
  return stroke(`M${n(e.x1 * P)} ${n(e.y1 * P)}L${n(e.x2 * P)} ${n(e.y2 * P)}`, l.w, l.c, e.weight === 'hair' ? 'butt' : 'square');
}

function checkboxesMarkup(e: Checkboxes): string {
  const size = (e.size ?? DEFAULTS.checkSize) * P;
  const every = e.every ?? DEFAULTS.every;
  const across = (e.direction ?? DEFAULTS.direction) === 'across';
  const w = LINE[e.weight ?? DEFAULTS.boxWeight].w;
  let boxes = '';
  for (let i = 0; i < e.count; i++) {
    const cx = (e.x + (across ? i * every : 0)) * P, cy = (e.y + (across ? 0 : i * every)) * P;
    boxes += `<rect x="${n(cx + (P - size) / 2)}" y="${n(cy + (P - size) / 2)}" width="${n(size)}" height="${n(size)}"/>`;
  }
  return `<g fill="none" stroke="#000" stroke-width="${n(w)}">${boxes}</g>`;
}

function textMarkup(e: Text, expand: (t: string) => string): string {
  const size = TEXT_SIZE_MM[e.size ?? DEFAULTS.textSize];
  const align = e.align ?? DEFAULTS.align;
  const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
  const dx = align === 'left' ? TEXT_INSET_MM : align === 'right' ? -TEXT_INSET_MM : 0;
  const rotate = e.rotate ?? DEFAULTS.rotate;
  // Drawn in the text's own frame: origin at the anchor, x along the text, y down the one-cell band.
  const frame = `translate(${n(e.x * P)} ${n(e.y * P)})${rotate === 90 ? ' rotate(-90)' : rotate === 270 ? ' rotate(90)' : ''}`;
  const weight = (e.style ?? DEFAULTS.style) === 'bold' ? ' font-weight="700"' : '';
  return `<text transform="${frame}" x="${n(dx)}" y="${n(P - BASELINE_MM)}" font-size="${size}"${weight} text-anchor="${anchor}" fill="${TEXT_COLORS[e.tone ?? DEFAULTS.textTone]}" xml:space="preserve">${esc(expand(e.text))}</text>`;
}

/** How thick an icon's lines are, in mm, by icon size: a 2-cell icon is drawn with a little more line, not twice as much. */
export const ICON_STROKE_MM = { 1: 0.26, 2: 0.36 } as const;
/** Where an icon is drawn: its top-left corner (cells), and mm per icon grid unit. */
export function iconPlacement(e: Sequence, i: number) {
  const o = itemOrigin(e, i), size = itemSize(e);
  return { x: o.x * P, y: o.y * P, scale: (size * P) / ICON_GRID, stroke: ICON_STROKE_MM[size as 1 | 2] };
}

function sequenceMarkup(e: Sequence): string {
  const color = TEXT_COLORS[e.tone ?? DEFAULTS.sequenceTone];
  const items = sequenceItems(e);
  if (isIcons(e)) {
    return items.map((name, i) => {
      const shape = ICONS[name];
      if (!shape) return '';
      const { x, y, scale, stroke: sw } = iconPlacement(e, i);
      const fill = shape.fill ? `<path d="${shape.fill}" fill="${color}" stroke="none"/>` : '';
      return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})" fill="none" stroke="${color}" stroke-width="${n(sw / scale)}" stroke-linecap="round" stroke-linejoin="round">${fill}<path d="${shape.stroke}"/></g>`;
    }).join('');
  }
  // Each item is centered in its cell by its own width (the font is monospaced), with no inset.
  const size = TEXT_SIZE_MM.label;
  const texts = items.map((text, i) => {
    const o = itemOrigin(e, i);
    return `<text x="${n(o.x * P + P / 2)}" y="${n(o.y * P + P - BASELINE_MM)}">${esc(text)}</text>`;
  }).join('');
  return `<g font-size="${size}" text-anchor="middle" fill="${color}" xml:space="preserve">${texts}</g>`;
}

export function elementMarkup(e: PageElement, expand: (t: string) => string = sample): string {
  switch (e.type) {
    case 'pattern': return patternMarkup(e);
    case 'shade': return shadeMarkup(e);
    case 'box': return boxMarkup(e);
    case 'rule': return ruleMarkup(e);
    case 'checkboxes': return checkboxesMarkup(e);
    case 'text': return textMarkup(e, expand);
    case 'sequence': return sequenceMarkup(e);
  }
}

export interface HeaderItem { text: string; x: number; bold: boolean; anchor: 'start' | 'end' }

/** Header row, in cells' mm from the grid's corner: page number at the outer top corner, identity by the spine. The spine is right of a left page. */
export function headerItems(page: Page, pageNumber: string | null, expand: (t: string) => string = sample): HeaderItem[] {
  const spineRight = page.side === 'left';
  const edge = (atEnd: boolean) => (atEnd ? COLS * P : 0);
  const items: HeaderItem[] = [];
  const id = expand(page.identity ?? '').toUpperCase();
  if (id.trim()) items.push({ text: id, x: edge(spineRight), bold: true, anchor: spineRight ? 'end' : 'start' });
  if (pageNumber) items.push({ text: pageNumber, x: edge(!spineRight), bold: false, anchor: spineRight ? 'start' : 'end' });
  return items;
}
export const HEADER_BASELINE_MM = 2.1;
export const HEADER_COLOR = '#404040';

function headerMarkup(page: Page, pageNumber: string | null, expand: (t: string) => string): string {
  return headerItems(page, pageNumber, expand).map((i) =>
    `<text x="${i.x}" y="${HEADER_BASELINE_MM}" font-size="${TEXT_SIZE_MM.label}" fill="${HEADER_COLOR}"` +
    `${i.bold ? ' font-weight="700"' : ''}${i.anchor === 'end' ? ' text-anchor="end"' : ''}${i.bold ? ' xml:space="preserve"' : ''}>${esc(i.text)}</text>`).join('');
}

function gridDots(): string {
  let d = '';
  for (let i = 0; i <= COLS; i++) for (let j = 0; j <= ROWS; j++) d += `M${i * P} ${j * P}h0`;
  return stroke(d, 0.4, '#cfcfcf', 'round');
}

const HANDLE_MM = 1.6;

function selectionMarkup(e: PageElement, withHandles = true, handleMm = HANDLE_MM): string {
  const a = elementArea(e);
  const pad = e.type === 'rule' || e.type === 'text' ? 0.6 : 0;
  const x = a.x * P - pad, y = a.y * P - pad, w = a.w * P + 2 * pad, h = a.h * P + 2 * pad;
  const outline = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="#000" stroke-width="0.35" stroke-dasharray="1 0.8"/>`;
  const handles = (withHandles ? handlesFor(e) : [])
    .map(({ at }: { at: Pt }) => `<rect x="${n(at.x * P - handleMm / 2)}" y="${n(at.y * P - handleMm / 2)}" width="${n(handleMm)}" height="${n(handleMm)}"/>`)
    .join('');
  return outline + `<g fill="#fff" stroke="#000" stroke-width="0.25">${handles}</g>`;
}

/** A frame round several elements: solid for the group being edited from inside, dashed for a selection of several. */
function frameMarkup(a: { x: number; y: number; w: number; h: number }, solid: boolean): string {
  const pad = 0.8;
  return `<rect x="${n(a.x * P - pad)}" y="${n(a.y * P - pad)}" width="${n(a.w * P + 2 * pad)}" height="${n(a.h * P + 2 * pad)}" fill="none" stroke="#000" stroke-width="${solid ? 0.5 : 0.3}"${solid ? '' : ' stroke-dasharray="2 1"'}/>`;
}

function spineLabel(side: PageSide | undefined): string {
  const x = side === 'left' ? PAGE_W_MM + 2.6 : -2.6;
  return `<text transform="translate(${x} ${PAGE_H_MM / 2}) rotate(-90)" text-anchor="middle" font-size="1.8" fill="#999" ${FONT_FAMILY}>SPINE</text>`;
}

/** The page drawn in mm units, origin at the page's top-left corner (not the grid's). */
export function pageContent(page: Page, opts: RenderOptions): string {
  const edit = opts.mode === 'edit';
  const exporting = opts.mode === 'export';
  let out = `<rect x="0" y="0" width="${PAGE_W_MM}" height="${PAGE_H_MM}" fill="#fff"${exporting ? '' : ' stroke="#a8a8a8" stroke-width="0.2"'}/>`;
  out += `<g transform="translate(${GRID_X_MM} ${GRID_Y_MM})" ${FONT_FAMILY}>`;
  if (edit) {
    out += `<rect x="0" y="0" width="${COLS * P}" height="${ROWS * P}" fill="#f7f7f7"/>`;
    out += `<rect x="0" y="0" width="${COLS * P}" height="${P}" fill="#e4e4e4"/>`;
    out += gridDots();
  }
  const expand = opts.expand ?? sample;
  const inside = edit && opts.inside?.length ? new Set(opts.inside) : null;
  page.elements.forEach((e, i) => {
    if (edit && opts.hidden?.has(i)) return;
    const markup = elementMarkup(e, expand);
    out += inside && !inside.has(i) ? `<g opacity="0.3">${markup}</g>` : markup;
  });
  out += headerMarkup(page, opts.pageNumber === undefined ? SAMPLE_PAGE_NUMBER : opts.pageNumber, expand);
  if (edit) {
    const chosen = opts.selection ?? (opts.selected != null ? [opts.selected] : []);
    if (inside) out += frameMarkup(boundsOf([...inside].map((i) => page.elements[i])), true);
    if (chosen.length > 1) out += frameMarkup(boundsOf(chosen.map((i) => page.elements[i])), false);
    for (const i of chosen) {
      const sel = page.elements[i];
      // Only a lone selection can be resized, so only it shows handles.
      if (sel && !opts.hidden?.has(i)) out += selectionMarkup(sel, chosen.length === 1, opts.handleMm);
    }
    const m = opts.marquee;
    if (m) out += `<rect x="${n(m.x * P)}" y="${n(m.y * P)}" width="${n(m.w * P)}" height="${n(m.h * P)}" fill="rgba(0,0,0,0.04)" stroke="#000" stroke-width="0.3" stroke-dasharray="1 0.8"/>`;
    const draft = opts.draft ? [opts.draft].flat() : [];
    if (draft.length) {
      out += `<g opacity="0.55">${draft.map((d) => elementMarkup(d, expand)).join('')}</g>`;
      out += draft.map((d) => selectionMarkup(d, false)).join('');
    }
  }
  out += '</g>';
  if (!exporting) out += spineLabel(page.side);
  return out;
}

/** Standalone SVG of the page as printed, for rasterising. */
export function exportSvg(page: Page, widthPx: number, heightPx: number, fontCss: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${PAGE_W_MM} ${PAGE_H_MM}">` +
    `<style>${fontCss}</style>${pageContent(page, { mode: 'export' })}</svg>`
  );
}

/** Thumbnail of a page, or a spread's two pages side by side (left page on the left), as printed. */
export function thumbnailSvg(pages: Page[]): string {
  const body = pages.map((p, i) => `<g transform="translate(${i * PAGE_W_MM} 0)">${pageContent(p, { mode: 'export' })}</g>`).join('');
  const outline = `<rect x="0.1" y="0.1" width="${pages.length * PAGE_W_MM - 0.2}" height="${PAGE_H_MM - 0.2}" fill="none" stroke="#a8a8a8" stroke-width="0.4"/>`;
  const fold = pages.length > 1 ? `<path d="M${PAGE_W_MM} 0V${PAGE_H_MM}" stroke="#a8a8a8" stroke-width="0.4"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pages.length * PAGE_W_MM} ${PAGE_H_MM}" role="img">${body}${outline}${fold}</svg>`;
}
