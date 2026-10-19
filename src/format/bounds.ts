import { COLS, DEFAULTS, PITCH_MM, ROWS, type Area, type PageElement, type Text } from './types';
import { sequenceArea } from './sequence';

/** Gap between a label and the edge it is anchored to, in mm (matches journal-system's label inset). */
export const TEXT_INSET_MM = 0.8;
/** Courier Prime is monospaced: every glyph advances 0.6 em. */
export const GLYPH_EM = 0.6;
export const TEXT_SIZE_MM = { label: 2.3, heading: 3.2 } as const;

/** Cells a strip of checkboxes spans along its direction. */
export const checkboxSpan = (count: number, every: number) => (count - 1) * every + 1;

/** The area an element occupies, in cells, for hit testing and selection. Text is estimated from its length. */
export function elementArea(el: PageElement, text = el.type === 'text' ? el.text : ''): Area {
  switch (el.type) {
    case 'pattern':
    case 'box':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'rule':
      return {
        x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1),
      };
    case 'checkboxes': {
      const span = checkboxSpan(el.count, el.every ?? DEFAULTS.every);
      return (el.direction ?? DEFAULTS.direction) === 'across'
        ? { x: el.x, y: el.y, w: span, h: 1 }
        : { x: el.x, y: el.y, w: 1, h: span };
    }
    case 'text':
      return textArea(el, text);
    case 'sequence':
      return sequenceArea(el);
  }
}

/** Where a text element's glyphs fall, in cells. */
function textArea(el: Text, text: string): Area {
  const fontMm = TEXT_SIZE_MM[el.size ?? DEFAULTS.textSize];
  const len = (text.length * GLYPH_EM * fontMm) / PITCH_MM;
  const inset = TEXT_INSET_MM / PITCH_MM;
  const align = el.align ?? DEFAULTS.align;
  // Along the text (local x) and across its one-cell band (local y), relative to the anchor.
  const a0 = align === 'left' ? inset : align === 'center' ? -len / 2 : -len - inset;
  const rotate = el.rotate ?? DEFAULTS.rotate;
  if (rotate === 0) return { x: el.x + a0, y: el.y, w: len, h: 1 };
  // 90 reads bottom to top, the band lying right of the anchor; 270 reads top to bottom, the band left of it.
  if (rotate === 90) return { x: el.x, y: el.y - a0 - len, w: 1, h: len };
  return { x: el.x - 1, y: el.y + a0, w: 1, h: len };
}

/**
 * The part of an element that must lie inside the grid (and below the header). For text this is the
 * anchor and its one-cell band; how far the characters run is up to the writer.
 */
export function limitsArea(el: PageElement): Area {
  if (el.type !== 'text') return elementArea(el);
  switch (el.rotate ?? DEFAULTS.rotate) {
    case 90: return { x: el.x, y: el.y, w: 1, h: 0 };
    case 270: return { x: el.x - 1, y: el.y, w: 1, h: 0 };
    default: return { x: el.x, y: el.y, w: 0, h: 1 };
  }
}

export const insideGrid = (a: Area) => a.x >= 0 && a.y >= 1 && a.x + a.w <= COLS && a.y + a.h <= ROWS;
