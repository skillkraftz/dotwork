import {
  COLS, DEFAULTS, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM as P, ROWS,
  type Page, type PageElement, type PageSide, type Shade, type Pattern, type Box, type Rule, type Checkboxes, type Text,
} from './format/types';
import { elementArea, TEXT_INSET_MM, TEXT_SIZE_MM } from './format/bounds';
import { expandTokens } from './format/tokens';
import { handlesFor, type Pt } from './geometry';

/** Editor view box: the page plus a quiet margin around it. */
export const EDIT_VIEWBOX = `-8 -6 ${PAGE_W_MM + 16} ${PAGE_H_MM + 12}`;
export const SAMPLE_PAGE_NUMBER = '47';

const FONT = `font-family="'Courier Prime', 'Courier New', monospace"`;
const PT = 25.4 / 72;
const LINE = { hair: { w: 0.12, c: '#c4c4c4' }, thin: { w: 0.5 * PT, c: '#000' }, thick: { w: 1.5 * PT, c: '#000' } } as const;
const GRAY_DOT = '#b0b0b0';
const TONES = { light: '#efefef', medium: '#dcdcdc', dark: '#bdbdbd' } as const;
const TEXT_TONES = { gray: '#808080', black: '#000' } as const;
const BASELINE_MM = 0.6; // text sits this far above the bottom of its cell band

export interface RenderOptions {
  /** edit: grid dots, header shading and selection; preview: as printed, on screen; export: as printed, page only. */
  mode: 'edit' | 'preview' | 'export';
  selected?: number | null;
  /** Indexes of elements the editor is hiding (edit mode only). */
  hidden?: ReadonlySet<number>;
  draft?: PageElement | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => +v.toFixed(3);

/** Positions of the boundaries inside [from, from+len]: every `step`, plus the far edge. */
function ticks(from: number, len: number, step: number, includeStart: boolean): number[] {
  const out: number[] = [];
  for (let t = includeStart ? 0 : step; t < len; t += step) out.push(from + t);
  out.push(from + len);
  return out;
}

const stroke = (d: string, w: number, c: string, cap = 'butt') =>
  d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(w)}" stroke-linecap="${cap}"/>` : '';

function shadeMarkup(e: Shade): string {
  const fill = TONES[e.tone ?? DEFAULTS.tone];
  const stripes = e.stripes ?? DEFAULTS.stripes;
  const rect = (x: number, y: number, w: number, h: number) =>
    `<rect x="${n(x * P)}" y="${n(y * P)}" width="${n(w * P)}" height="${n(h * P)}" fill="${fill}"/>`;
  if (stripes === 'none') return rect(e.x, e.y, e.w, e.h);
  let out = '';
  if (stripes === 'rows') for (let t = 0; t < e.h; t += 2) out += rect(e.x, e.y + t, e.w, Math.min(1, e.h - t));
  else for (let t = 0; t < e.w; t += 2) out += rect(e.x + t, e.y, Math.min(1, e.w - t), e.h);
  return out;
}

function patternMarkup(e: Pattern): string {
  const step = e.every ?? DEFAULTS.every;
  const x0 = e.x * P, x1 = (e.x + e.w) * P, y0 = e.y * P, y1 = (e.y + e.h) * P;
  const rows = (start: boolean) => ticks(e.y, e.h, step, start).map((y) => y * P);
  const cols = (start: boolean) => ticks(e.x, e.w, step, start).map((x) => x * P);
  const h = (start: boolean) => rows(start).map((y) => `M${n(x0)} ${n(y)}H${n(x1)}`).join('');
  const v = (start: boolean) => cols(start).map((x) => `M${n(x)} ${n(y0)}V${n(y1)}`).join('');
  switch (e.pattern) {
    case 'lines': return stroke(h(false), LINE.hair.w, LINE.hair.c);
    case 'vlines': return stroke(v(false), LINE.hair.w, LINE.hair.c);
    case 'grid': return stroke(h(true) + v(true), LINE.hair.w, LINE.hair.c);
    case 'dots': {
      let d = '';
      for (const x of cols(true)) for (const y of rows(true)) d += `M${n(x)} ${n(y)}h0`;
      return stroke(d, 0.5, GRAY_DOT, 'round');
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

function textMarkup(e: Text): string {
  const size = TEXT_SIZE_MM[e.size ?? DEFAULTS.textSize];
  const align = e.align ?? DEFAULTS.align;
  const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
  const dx = align === 'left' ? TEXT_INSET_MM : align === 'right' ? -TEXT_INSET_MM : 0;
  const rotate = e.rotate ?? DEFAULTS.rotate;
  // Drawn in the text's own frame: origin at the anchor, x along the text, y down the one-cell band.
  const frame = `translate(${n(e.x * P)} ${n(e.y * P)})${rotate === 90 ? ' rotate(-90)' : rotate === 270 ? ' rotate(90)' : ''}`;
  const weight = (e.style ?? DEFAULTS.style) === 'bold' ? ' font-weight="700"' : '';
  return `<text transform="${frame}" x="${n(dx)}" y="${n(P - BASELINE_MM)}" font-size="${size}"${weight} text-anchor="${anchor}" fill="${TEXT_TONES[e.tone ?? DEFAULTS.textTone]}" xml:space="preserve">${esc(expandTokens(e.text))}</text>`;
}

export function elementMarkup(e: PageElement): string {
  switch (e.type) {
    case 'shade': return shadeMarkup(e);
    case 'pattern': return patternMarkup(e);
    case 'box': return boxMarkup(e);
    case 'rule': return ruleMarkup(e);
    case 'checkboxes': return checkboxesMarkup(e);
    case 'text': return textMarkup(e);
  }
}

/** Header row: page number at the outer top corner, identity by the spine. The spine is right of a left page. */
function headerMarkup(page: Page): string {
  const id = expandTokens(page.identity ?? '').toUpperCase();
  const spineRight = page.side === 'left';
  const common = `y="2.1" font-size="${TEXT_SIZE_MM.label}" fill="#404040"`;
  const idX = spineRight ? COLS * P : 0, numX = spineRight ? 0 : COLS * P;
  const anchor = (atEnd: boolean) => (atEnd ? ' text-anchor="end"' : '');
  return (
    `<text x="${idX}" ${common} font-weight="700"${anchor(spineRight)} xml:space="preserve">${esc(id)}</text>` +
    `<text x="${numX}" ${common}${anchor(!spineRight)}>${SAMPLE_PAGE_NUMBER}</text>`
  );
}

function gridDots(): string {
  let d = '';
  for (let i = 0; i <= COLS; i++) for (let j = 0; j <= ROWS; j++) d += `M${i * P} ${j * P}h0`;
  return stroke(d, 0.4, '#cfcfcf', 'round');
}

const HANDLE_MM = 1.6;

function selectionMarkup(e: PageElement, withHandles = true): string {
  const a = elementArea(e);
  const pad = e.type === 'rule' || e.type === 'text' ? 0.6 : 0;
  const x = a.x * P - pad, y = a.y * P - pad, w = a.w * P + 2 * pad, h = a.h * P + 2 * pad;
  const outline = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="#000" stroke-width="0.35" stroke-dasharray="1 0.8"/>`;
  const handles = (withHandles ? handlesFor(e) : [])
    .map(({ at }: { at: Pt }) => `<rect x="${n(at.x * P - HANDLE_MM / 2)}" y="${n(at.y * P - HANDLE_MM / 2)}" width="${HANDLE_MM}" height="${HANDLE_MM}"/>`)
    .join('');
  return outline + `<g fill="#fff" stroke="#000" stroke-width="0.25">${handles}</g>`;
}

function spineLabel(side: PageSide | undefined): string {
  const x = side === 'left' ? PAGE_W_MM + 2.6 : -2.6;
  return `<text transform="translate(${x} ${PAGE_H_MM / 2}) rotate(-90)" text-anchor="middle" font-size="1.8" fill="#999" ${FONT}>SPINE</text>`;
}

/** The page drawn in mm units, origin at the page's top-left corner (not the grid's). */
export function pageContent(page: Page, opts: RenderOptions): string {
  const edit = opts.mode === 'edit';
  const exporting = opts.mode === 'export';
  let out = `<rect x="0" y="0" width="${PAGE_W_MM}" height="${PAGE_H_MM}" fill="#fff"${exporting ? '' : ' stroke="#a8a8a8" stroke-width="0.2"'}/>`;
  out += `<g transform="translate(${GRID_X_MM} ${GRID_Y_MM})" ${FONT}>`;
  if (edit) {
    out += `<rect x="0" y="0" width="${COLS * P}" height="${ROWS * P}" fill="#f7f7f7"/>`;
    out += `<rect x="0" y="0" width="${COLS * P}" height="${P}" fill="#e4e4e4"/>`;
    out += gridDots();
  }
  page.elements.forEach((e, i) => {
    if (!(edit && opts.hidden?.has(i))) out += elementMarkup(e);
  });
  out += headerMarkup(page);
  if (edit) {
    const sel = opts.selected != null ? page.elements[opts.selected] : undefined;
    if (sel && !opts.hidden?.has(opts.selected!)) out += selectionMarkup(sel);
    if (opts.draft) out += `<g opacity="0.55">${elementMarkup(opts.draft)}</g>${selectionMarkup(opts.draft, false)}`;
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
