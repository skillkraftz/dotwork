import { COLS, DEFAULTS, type Art, type Image, type Box, type BoxSide, type Page, type PageElement, type Shade, type Text } from './types';
import { elementArea } from './bounds';
import { mirrorView } from './picture';
import { parseStored, pathString, transformSegs } from './path';
import { sequenceArea } from './sequence';
import { resolveWeek, type WeekPreview } from './week';
import type { Reading } from './tokens';

// "Mirror on left pages" (docs/page-format.md, `mirror_left`): a page made for the right-hand side of the spine, with a strip along its outer
// edge, is drawn flipped left to right when it sits on a left page, so the strip is on the outer edge there too. It is done where the page is
// drawn (the screen's preview, the PNG and the PDF), never in the file: the design stays as it was made.

/** Whether the page is drawn mirrored: it asks for it and sits on a left page (a page that is on neither side is drawn as made). */
export const mirrorsOn = (page: Pick<Page, 'side' | 'mirror_left'>): boolean => page.mirror_left === true && page.side === 'left';

const flipX = (x: number, w = 0) => COLS - x - w;
const SWAP_SIDE: Record<BoxSide, BoxSide> = { top: 'top', bottom: 'bottom', left: 'right', right: 'left' };

/** Text stays readable: its anchor and alignment swap, and a turned text turns the other way so it reads with its tops toward the same side of the page. */
function mirrorText(e: Text): Text {
  const align = e.align === 'left' || e.align === undefined ? 'right' : e.align === 'right' ? 'left' : 'center';
  const rotate = e.rotate === 90 ? 270 : e.rotate === 270 ? 90 : e.rotate;
  const { align: _a, rotate: _r, center_in: area, ...rest } = e;
  return { ...rest, x: flipX(e.x), ...(area ? { center_in: { ...area, x: flipX(area.x, area.w) } } : {}), ...(align !== DEFAULTS.align ? { align } : {}), ...(rotate ? { rotate } : {}) };
}

/** The element with its zoom, pan and rotation as they read on the mirrored page. */
function mirroredView<T extends Art | Image>(e: T): T {
  const { zoom: _z, pan_x: _x, pan_y: _y, rotate: _r, ...rest } = e;
  return { ...rest, ...mirrorView(e) } as T;
}

/** An image moves to the other side of the page (and is panned and turned the other way) but its pixels are never flipped, like text. */
const mirrorImage = (e: Image): Image => ({ ...mirroredView(e), x: flipX(e.x, e.w) });

/** Art is flipped as a whole: its box moves to the other side and its drawing turns about the middle of its view box. */
function mirrorArt(e: Art): Art {
  const [vx, , vw] = e.view_box;
  const flip = [-1, 0, 0, 1, 2 * vx + vw, 0] as const;
  const paths = e.paths.map((p) => {
    const parsed = parseStored(p.d);
    return parsed.ok ? { ...p, d: pathString(transformSegs(parsed.segs, flip)) } : p;
  });
  return { ...mirroredView(e), x: flipX(e.x, e.w), paths };
}

/** A shade's tones run the other way: columns start from the right, and a checker keeps its squares' places. */
function mirrorShade(e: Shade): Shade {
  const x = flipX(e.x, e.w), along = e.along ?? DEFAULTS.along;
  if (along === 'rows') return { ...e, x };
  const steps = Math.ceil(e.w / (e.every ?? DEFAULTS.every));
  const at = (c: number) => e.tones[c % e.tones.length];
  if (along === 'columns') return { ...e, x, tones: Array.from({ length: steps }, (_, c) => at(steps - 1 - c)).join('') };
  // A checker of one or two tones flips by starting on the right tone; with more tones the diagonals would run the other way, so it is left as it is.
  return { ...e, x, tones: e.tones.length === 2 && steps % 2 === 0 ? e.tones[1] + e.tones[0] : e.tones };
}

/** One element flipped left to right. A generated element isn't flipped here: `placedElements` resolves it first. */
export function mirrorElement(e: PageElement): PageElement {
  switch (e.type) {
    case 'pattern': return { ...e, x: flipX(e.x, e.w) };
    case 'box': {
      const out: Box = { ...e, x: flipX(e.x, e.w) };
      if (e.sides) out.sides = e.sides.map((s) => SWAP_SIDE[s]);
      return out;
    }
    case 'shade': return mirrorShade(e);
    case 'art': return mirrorArt(e);
    case 'image': return mirrorImage(e);
    case 'rule': return { ...e, x1: flipX(e.x1), x2: flipX(e.x2) };
    case 'text': return mirrorText(e);
    // A run keeps its items in reading order and moves, as a block, to the mirrored place.
    case 'checkboxes': return { ...e, x: flipX(elementArea(e).x, elementArea(e).w) };
    case 'sequence': {
      const a = sequenceArea(e);
      return { ...e, x: flipX(a.x, a.w), ...(e.rotate ? { rotate: e.rotate === 90 ? 270 : 90 } as const : {}) };
    }
    case 'generated': return e;
  }
}

/**
 * What a page draws, in cells: its elements, or for a page that is mirrored the same elements flipped, with a week block turned into the
 * ordinary elements it draws for `read` (see resolveWeek) and each of those flipped, so its goals, days and outcomes mirror like any others.
 */
export function placedElements(page: Page, read: Reading | null | undefined, preview?: WeekPreview): PageElement[] {
  if (!mirrorsOn(page)) return page.elements;
  return page.elements.flatMap((e) => (e.type === 'generated' ? resolveWeek(e, read, preview) : [e])).map(mirrorElement);
}
