import { COLS, ROWS, type Edge, type Page, type Region } from './format/types';
import { expandTokens } from './format/tokens';
import { P, type Rect } from './geometry';

export const PAGE_W = COLS * P; // 81 mm
export const PAGE_H = ROWS * P; // 132 mm
/** Editor view box: the page plus a quiet margin. */
export const EDIT_VIEWBOX = `-7 -5 ${PAGE_W + 14} ${PAGE_H + 10}`;

export const SAMPLE_PAGE_NUMBER = '47';

const FONT = `font-family="'Courier Prime', 'Courier New', monospace"`;
const LABEL_SIZE = 2.3; // mm, about 6.5 pt
const GRAY_LINE = '#c4c4c4';
const GRAY_DOT = '#b0b0b0';
const BORDER_WIDTH = { thin: 0.2, thick: 0.6 } as const;

export interface RenderOptions {
  /** edit: dots, header shading and selection; preview: as printed, on screen; export: as printed, page only. */
  mode: 'edit' | 'preview' | 'export';
  selected?: number | null;
  draft?: { rect: Rect; valid: boolean } | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => +v.toFixed(3);

function fillMarkup(r: Region): string {
  const x0 = r.x * P, x1 = (r.x + r.w) * P, y0 = r.y * P, y1 = (r.y + r.h) * P;
  const hlines = (fromX: number) => {
    let d = '';
    for (let i = 1; i <= r.h; i++) d += `M${fromX} ${(r.y + i) * P}H${x1}`;
    return d;
  };
  const vlines = () => {
    let d = '';
    for (let i = 1; i <= r.w; i++) d += `M${(r.x + i) * P} ${y0}V${y1}`;
    return d;
  };
  const line = (d: string) => (d ? `<path d="${d}" fill="none" stroke="${GRAY_LINE}" stroke-width="0.12"/>` : '');

  switch (r.fill) {
    case 'blank':
      return '';
    case 'lines':
      return line(hlines(x0));
    case 'vlines':
      return line(vlines());
    case 'grid':
      return line(hlines(x0) + vlines());
    case 'dots': {
      let d = '';
      for (let i = 0; i <= r.w; i++) for (let j = 0; j <= r.h; j++) d += `M${(r.x + i) * P} ${(r.y + j) * P}h0`;
      return `<path d="${d}" stroke="${GRAY_DOT}" stroke-width="0.5" stroke-linecap="round"/>`;
    }
    case 'checkboxes': {
      let boxes = '';
      for (let i = 0; i < r.h; i += 2) {
        boxes += `<rect x="${n(x0 + 0.6)}" y="${n((r.y + i) * P + 0.7)}" width="1.8" height="1.8"/>`;
      }
      return line(hlines(x0 + P)) + `<g fill="none" stroke="#777" stroke-width="0.15">${boxes}</g>`;
    }
  }
}

function borderMarkup(r: Region): string {
  const x0 = r.x * P, x1 = (r.x + r.w) * P, y0 = r.y * P, y1 = (r.y + r.h) * P;
  const seg: Record<Edge, string> = {
    top: `M${x0} ${y0}H${x1}`,
    bottom: `M${x0} ${y1}H${x1}`,
    left: `M${x0} ${y0}V${y1}`,
    right: `M${x1} ${y0}V${y1}`,
  };
  let out = '';
  for (const [edge, style] of Object.entries(r.border ?? {}) as [Edge, 'thin' | 'thick'][]) {
    out += `<path d="${seg[edge]}" stroke="#000" stroke-width="${BORDER_WIDTH[style]}" stroke-linecap="square" fill="none"/>`;
  }
  return out;
}

function labelsMarkup(r: Region): string {
  let out = '';
  for (const l of r.labels ?? []) {
    const text = esc(expandTokens(l.text));
    const attrs = `font-size="${LABEL_SIZE}" fill="#808080"`;
    if (l.vertical) {
      const tx = n(r.x * P + 2.2), ty = n((r.y + r.h) * P - 0.8);
      out += `<text transform="translate(${tx} ${ty}) rotate(-90)" ${attrs}>${text}</text>`;
    } else {
      const y = n((r.y + (l.row ?? 0) + 1) * P - 0.6);
      if (l.align === 'right') {
        out += `<text x="${n((r.x + r.w) * P - 0.8)}" y="${y}" text-anchor="end" ${attrs}>${text}</text>`;
      } else {
        out += `<text x="${n(r.x * P + 0.8)}" y="${y}" ${attrs}>${text}</text>`;
      }
    }
  }
  return out;
}

function headerMarkup(page: Page): string {
  const id = expandTokens(page.identity ?? '').toUpperCase();
  // Right-hand page: the spine is on the left, the outer corner top right.
  return (
    `<text x="1" y="2.1" font-size="2.3" font-weight="700" fill="#404040">${esc(id)}</text>` +
    `<text x="${PAGE_W - 1}" y="2.1" font-size="2.3" fill="#404040" text-anchor="end">${SAMPLE_PAGE_NUMBER}</text>`
  );
}

function allDots(): string {
  let d = '';
  for (let i = 0; i <= COLS; i++) for (let j = 0; j <= ROWS; j++) d += `M${i * P} ${j * P}h0`;
  return `<path d="${d}" stroke="#cfcfcf" stroke-width="0.4" stroke-linecap="round"/>`;
}

const HANDLE_SIZE = 1.6;

function selectionMarkup(r: Region): string {
  const x0 = r.x * P, x1 = (r.x + r.w) * P, y0 = r.y * P, y1 = (r.y + r.h) * P;
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const hs = [[x0, y0], [xm, y0], [x1, y0], [x0, ym], [x1, ym], [x0, y1], [xm, y1], [x1, y1]];
  const handles = hs
    .map(([x, y]) => `<rect x="${n(x - HANDLE_SIZE / 2)}" y="${n(y - HANDLE_SIZE / 2)}" width="${HANDLE_SIZE}" height="${HANDLE_SIZE}"/>`)
    .join('');
  return (
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#000" stroke-width="0.35" stroke-dasharray="1 0.8"/>` +
    `<g fill="#fff" stroke="#000" stroke-width="0.25">${handles}</g>`
  );
}

function draftMarkup({ rect, valid }: { rect: Rect; valid: boolean }): string {
  const style = valid
    ? 'fill="#000" fill-opacity="0.06" stroke="#000" stroke-dasharray="1 0.8"'
    : 'fill="#000" fill-opacity="0.3" stroke="#000" stroke-dasharray="0.2 0.8" stroke-linecap="round"';
  return `<rect x="${rect.x * P}" y="${rect.y * P}" width="${rect.w * P}" height="${rect.h * P}" ${style} stroke-width="0.35"/>`;
}

/** The page drawn in mm units, origin at the page's top-left corner. */
export function pageContent(page: Page, opts: RenderOptions): string {
  const edit = opts.mode === 'edit';
  let out = `<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#fff"${opts.mode === 'export' ? '' : ' stroke="#a8a8a8" stroke-width="0.2"'}/>`;
  if (edit) {
    out += `<rect x="0" y="0" width="${PAGE_W}" height="${P}" fill="#e4e4e4"/>`;
    for (const r of page.regions) {
      out += `<rect x="${r.x * P}" y="${r.y * P}" width="${r.w * P}" height="${r.h * P}" fill="#f5f5f5"/>`;
    }
    out += allDots();
  }
  out += `<g ${FONT}>`;
  for (const r of page.regions) out += fillMarkup(r);
  for (const r of page.regions) out += borderMarkup(r);
  for (const r of page.regions) out += labelsMarkup(r);
  out += headerMarkup(page);
  out += '</g>';
  if (opts.mode !== 'export') {
    out += `<text transform="translate(-2.4 ${PAGE_H / 2}) rotate(-90)" text-anchor="middle" font-size="1.8" fill="#999" ${FONT}>SPINE</text>`;
  }
  if (edit) {
    const sel = opts.selected != null ? page.regions[opts.selected] : undefined;
    if (sel) out += selectionMarkup(sel);
    if (opts.draft) out += draftMarkup(opts.draft);
  }
  return out;
}

/** Standalone SVG of the page as printed, for rasterising. */
export function exportSvg(page: Page, widthPx: number, heightPx: number, fontCss: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">` +
    `<style>${fontCss}</style>${pageContent(page, { mode: 'export' })}</svg>`
  );
}
