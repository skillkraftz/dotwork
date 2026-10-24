// The calibration sheets: paper that shows, without printing a whole book, how a printer places and tones the pages.
// Built with the same imposition, page size and drawing code as the book's own print files. Printer settings come from the printer profile.
//
//   calibration-sheet.pdf  one double-sided sheet per layout on the WHOLE paper (the half sheet, or the whole letter sheet for two-up: no halves,
//       labels or cut marks): page 1 = the front, page 2 = the back; print them the way print-first and print-second are printed. Five
//       marks, 8 mm in from the edges and at the centre. Side 1: a fine + at each, and the gray ramp, sample text, dots, lines,
//       hairlines and the line weight by direction (pairs of identical lines along each paper edge, and a ladder) at least 10 mm from every mark. Side 2 (all measuring): at the four edge marks a see-through scale, at the centre a +,
//       two 100 mm lines, and four fold scales (two across each centre line) to read where a crease crosses. See src/book/alignment.ts
//       for what the readings mean.
//   creep-test.pdf             three sheets stand for a book of any size: the cover sheet (calibration-cover.pdf) and, here, the outermost
//       and the innermost sheet of a book of `pages` pages (a signature of pages / 4 sheets), both sides, in manual-duplex order: the fronts
//       (innermost first), then the backs (outermost first). The rest of the book is blank paper of the same kind folded around the
//       innermost sheet, so the test binds and trims like the book. Margin rulers on every page.
//   calibration-cover.pdf      the cover sheet as cover-outside.pdf and cover-inside.pdf print it (two passes), with margin rulers
//   calibration.txt            the settings that made them
//
// On the letter two-up layout every page of the creep test and the cover has the same thing in both halves, labelled Book 1 and Book 2 like the print files, with the
// cut marks; the scale, offsets and rotation of the selected layout apply to the whole page. Covers stay out of the creep test.
import { GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, COLS, ROWS, PITCH_MM as P, emptyPage, type Page, type PageElement, type Text } from '../format/types';
import type { Book } from '../book/book';
import { EDGE_NAMES, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, pageOrigin, type PrintSettings, type Sheet, type SheetLayout } from '../book/impose';
import { FOLD_HOW, LINE_MM, SCALE_RANGE_MM, crosshairs, foldScales, scaleCaptions, sheetHeight, type FoldName } from '../book/alignment';
import { LINE } from '../render';
import { drawItems, mmToPt, type Fonts } from './draw';
import type { Item } from './display';
import { layoutPage } from './layout';
import { printSide } from './correct';
import { newDocument, type ExportedFile, type FontBytes } from './export';
import { cutMarks, halfLabel, halfLabelItem, halfTops, isTwoUp, sheetSize } from './sheets';
import { creepPages, creepSheets, validPages } from '../book/creep';
import { settingsLines } from './settingstext';
import { grayHex, tonesOf } from './tones';

const BOX_MM = LINE.thin.w; // the content-area box: structure, thin black
const HAIR_MM = 0.1; // crosshairs and scale ticks
const FOOTER_MM = 1.8; // footer type: small, so the settings fit a page's width
const FOOTER_LEAD_MM = 2.4;
const LABEL_MM = 1.5; // the numbers on the scales
const BLACK = '#000000';
/** Hairline strip: line widths in mm. 0.12 is the writing lines' weight. */
export const HAIRLINE_WIDTHS = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3] as const;
/** The widths of the line pairs on side 1, mm: each is drawn once along each paper edge. */
export const PAIR_WIDTHS = [0.12, 0.25, 0.35] as const;
/** The ladder on side 1: lines along the 8.5 in edge at these percents of LADDER_MM, beside a LADDER_MM line along the other edge. */
export const LADDER_PCT = [85, 90, 95, 100] as const;
export const LADDER_MM = 0.35;
/** The gray ramp's steps, in percent black. */
export const RAMP_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);
/** Every mm scale runs -5 to +5 mm in 0.5 mm ticks. */
export const SCALE_MM = SCALE_RANGE_MM;
/** The fore-edge ruler runs from the box line this far outward: past the trim line, which is GRID_X from it. */
export const FORE_EDGE_RULER_MM = 7;

export { creepPages, creepSheets };

/** Which sheets (0 = outermost) of an `n`-sheet signature the creep test prints: the outermost and the innermost. */
export const testedSheets = (n: number): number[] => (n > 1 ? [0, n - 1] : [0]);

/** Where a page's box starts on the sheet, and its size. */
const GRID_W = COLS * P, GRID_H = ROWS * P;

// ---- the files' names and text ------------------------------------------------------------------------------

export const SHEET_FILE = 'calibration-sheet.pdf';
export const CREEP_FILE = 'creep-test.pdf';
export const COVER_FILE = 'calibration-cover.pdf';

/** The text of calibration.txt, and of every footer: the settings that made the files. */
export function calibrationText(book: Book, print: PrintSettings, now: Date, pages = creepPages(book, print)): string {
  const n = pages / 4, tested = testedSheets(n).length;
  return [
    'Dotwork calibration',
    '',
    ...settingsLines(print, now),
    '',
    `${SHEET_FILE}: page 1 is the front, page 2 the back; print like print-first and print-second`,
    `${CREEP_FILE}: the outermost and innermost sheet of a ${pages}-page book (${n} sheets), ${2 * tested} pages in manual-duplex order; print pages 1 to ${tested}, put the stack back the same way, print pages ${tested + 1} to ${2 * tested}`,
    `${COVER_FILE}: page 1 is the outside (print it first), page 2 the inside; print like cover-outside and cover-inside`,
    '',
  ].join('\n');
}

// ---- drawing on a sheet --------------------------------------------------------------------------------------

type Align = 'start' | 'middle' | 'end';

/** A sheet to draw on in sheet millimetres (x right, y down from the top left), everything moved down by dy: it adds display-list items (see display.ts). */
function sheetCanvas(items: Item[], fonts: Fonts, dy = 0) {
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c = BLACK, fixed = false, cap: 'butt' | 'square' = 'butt') =>
    items.push({ k: 'line', x1, y1: y1 + dy, x2, y2: y2 + dy, w, c, cap, ...(fixed ? { fixed } : {}) });
  return {
    line,
    rect: (x: number, y: number, w: number, h: number, c: string) => items.push({ k: 'rect', x, y: y + dy, w, h, c }),
    /** A box drawn as four strokes with squared ends, so its corners are filled. */
    outline: (x: number, y: number, w: number, h: number, lw: number, c = BLACK) => {
      line(x, y, x + w, y, lw, c, false, 'square'); line(x, y + h, x + w, y + h, lw, c, false, 'square');
      line(x, y, x, y + h, lw, c, false, 'square'); line(x + w, y, x + w, y + h, lw, c, false, 'square');
    },
    width: (str: string, size: number) => fonts.regular.widthOfTextAtSize(str, mmToPt(size)) / mmToPt(1),
    /** Text with its baseline at y. Turned a quarter (`rotate`), it runs up the sheet from its start. */
    text: (str: string, x: number, y: number, size: number, c = BLACK, align: Align = 'start', knockout = false, rotate = false) => {
      const width = fonts.regular.widthOfTextAtSize(str, mmToPt(size)) / mmToPt(1);
      if (rotate) { items.push({ k: 'text', str, x, y: y + dy, size, font: 'regular', c, align, rot: 90 }); return; }
      // A knocked-out label is on white, so a line running through it doesn't strike it out.
      if (knockout) {
        const left = x - (align === 'middle' ? width / 2 : align === 'end' ? width : 0);
        items.push({ k: 'rect', x: left - 0.1, y: y + dy - size * 0.75, w: width + 0.2, h: size * 0.95, c: '#ffffff' });
      }
      items.push({ k: 'text', str, x, y: y + dy, size, font: 'regular', c, align, rot: 0 });
    },
  };
}
type Canvas = ReturnType<typeof sheetCanvas>;
interface Pt { x: number; y: number }

const page = (side: 'left' | 'right', elements: PageElement[]): Page => ({ ...emptyPage(), name: 'Calibration', identity: '', page_number: false, side, elements });
const text = (x: number, y: number, str: string, more: Partial<Text> = {}): PageElement => ({ type: 'text', x, y, text: str, tone: 'black', ...more });

/** Where a page's content area starts on the sheet. */
const gridAt = (isRight: boolean, creep: number, shift = 0) => {
  const o = pageOrigin(isRight, creep, shift);
  return { page: o, x: o.x + GRID_X_MM, y: o.y + GRID_Y_MM };
};

/** The page edge, the content-area box and, if asked, a crosshair at each corner of the box and at its center. */
function frame(c: Canvas, isRight: boolean, creep: number, shift: number, corners: boolean) {
  const { page: o, x, y } = gridAt(isRight, creep, shift);
  c.outline(o.x, o.y, PAGE_W_MM, PAGE_H_MM, HAIR_MM, '#808080');
  c.outline(x, y, GRID_W, GRID_H, BOX_MM);
  if (!corners) return;
  const cross = (cx: number, cy: number, arm: number) => {
    c.line(cx - arm, cy, cx + arm, cy, HAIR_MM);
    c.line(cx, cy - arm, cx, cy + arm, HAIR_MM);
  };
  for (const cx of [x, x + GRID_W]) for (const cy of [y, y + GRID_H]) cross(cx, cy, 3);
  cross(x + GRID_W / 2, y + GRID_H / 2, 2);
}

/** The settings, bottom-aligned inside the box, with any extra lines above them. */
function footer(c: Canvas, print: PrintSettings, now: Date, isRight: boolean, creep: number, shift: number, extra: string[]) {
  const { x, y } = gridAt(isRight, creep, shift);
  const lines = [...extra, ...settingsLines(print, now)];
  lines.forEach((line, i) => c.text(line, x + 0.8, y + GRID_H - 1 - (lines.length - 1 - i) * FOOTER_LEAD_MM, FOOTER_MM));
}

/** A designed page goes through drawPage, so tones, dots and lines print exactly as in a book. */
function content(g: Half, print: PrintSettings, p: Page, isRight: boolean) {
  const o = pageOrigin(isRight, 0);
  layoutPage(p, { x: o.x, y: o.y + g.dy, pageNumber: null, expand: (t) => t, tones: tonesOf(print) }, g.items);
}

// ---- scales and rulers ---------------------------------------------------------------------------------------

interface ScaleOptions {
  /** The text for a whole millimetre, or null for none. */
  label: (mm: number) => string | null;
  /** A longer tick, with its own text, at the expected value. */
  mark?: { mm: number; text: string };
}

/**
 * A scale along the line from `o` in direction `d` (a unit vector), from `from` to `to` mm, with a tick every 0.5 mm, longer
 * at each whole mm. Labels sit on alternate sides of the line so neighbors don't touch, on white so lines don't strike them out.
 */
function scale(c: Canvas, o: Pt, d: Pt, from: number, to: number, opts: ScaleOptions) {
  const at = (mm: number): Pt => ({ x: o.x + d.x * mm, y: o.y + d.y * mm });
  const p = { x: -d.y, y: d.x }; // the way ticks point: (1, 0) -> down, (0, -1) -> right
  const [a, b] = [at(from), at(to)];
  c.line(a.x, a.y, b.x, b.y, HAIR_MM);
  const label = (str: string, pt: Pt, len: number, side: number) => {
    if (p.y !== 0) c.text(str, pt.x, side > 0 ? pt.y + len / 2 + LABEL_MM * 0.85 : pt.y - len / 2 - 0.4, LABEL_MM, BLACK, 'middle', true);
    else c.text(str, pt.x + side * (len / 2 + 0.4), pt.y + LABEL_MM * 0.33, LABEL_MM, BLACK, side > 0 ? 'start' : 'end', true);
  };
  const tick = (pt: Pt, len: number) => c.line(pt.x - (p.x * len) / 2, pt.y - (p.y * len) / 2, pt.x + (p.x * len) / 2, pt.y + (p.y * len) / 2, HAIR_MM);
  const mark = opts.mark && opts.mark.mm >= from && opts.mark.mm <= to ? opts.mark : undefined;
  const onGrid = mark !== undefined && Math.abs(mark.mm * 2 - Math.round(mark.mm * 2)) <= 0.2;
  for (let half = Math.round(from * 2); half <= Math.round(to * 2); half++) {
    const mm = half / 2, whole = half % 2 === 0, pt = at(mm);
    // The tick next to the expected value is the long one: the expected margin is within 0.1 mm of it.
    const marked = onGrid && Math.abs(mm - mark!.mm) <= 0.1;
    const len = marked ? 3 : whole ? 1.6 : 0.9;
    tick(pt, len);
    // A number next to the expected value's own label is left out.
    const str = whole && (onGrid || mark === undefined || Math.abs(mm - mark.mm) > 1) ? opts.label(mm) : null;
    if (str !== null) label(str, pt, len, Math.round(Math.abs(mm)) % 2 === 0 ? -1 : 1);
  }
  // An expected value between ticks (the end of the top and bottom rulers) gets a tick of its own, labelled just inside it.
  if (mark && !onGrid) {
    const pt = at(mark.mm);
    tick(pt, 3);
    if (p.y !== 0) c.text(mark.text, pt.x, pt.y - d.y * 0.75 + 0.5, LABEL_MM, BLACK, 'middle', true);
    else label(mark.text, pt, 3, 1);
  }
}

const fmt = (mm: number) => String(Math.round(mm * 100) / 100);

/**
 * A ruler in a page's margin that counts mm outward from the box line, so the number where the paper ends is the margin there.
 * The expected margin is marked (at the fore-edge, the target margin). `edge` is the side of the page it measures.
 */
function marginRuler(c: Canvas, o: Pt, edge: 'top' | 'bottom' | 'left' | 'right', foreEdgeTarget: number) {
  const x0 = o.x + GRID_X_MM, y0 = o.y + GRID_Y_MM; // the box's top left
  const out = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[edge];
  const from = { top: { x: o.x + PAGE_W_MM / 2, y: y0 }, bottom: { x: o.x + PAGE_W_MM / 2, y: y0 + GRID_H }, left: { x: x0, y: o.y + PAGE_H_MM / 2 }, right: { x: x0 + GRID_W, y: o.y + PAGE_H_MM / 2 } }[edge];
  const horizontal = edge === 'left' || edge === 'right';
  const expected = horizontal ? foreEdgeTarget : GRID_Y_MM;
  scale(c, from, out, 0, horizontal ? FORE_EDGE_RULER_MM : GRID_Y_MM, { label: (mm) => fmt(mm), mark: { mm: expected, text: fmt(expected) } });
}

/** The rulers at a page's top and bottom, and at its fore-edge if asked (the outer edge, which is trimmed; marked at the target margin). */
function pageRulers(c: Canvas, target: number, isRight: boolean, creep: number, shift: number, foreEdge: boolean) {
  const o = pageOrigin(isRight, creep, shift);
  marginRuler(c, o, 'top', target);
  marginRuler(c, o, 'bottom', target);
  if (foreEdge) marginRuler(c, o, isRight ? 'right' : 'left', target);
}

// ---- the calibration sheet's samples ----------------------------------------------------------------

function frontLeft(p: PrintSettings): Page {
  return page('left', [
    text(0, 1, 'GRAY RAMP: percent black', { style: 'bold' }),
    text(0, 24, 'TONES AS THEY PRINT NOW', { style: 'bold' }),
    { type: 'shade', tones: 'L', x: 0, y: 25, w: 6, h: 3 }, { type: 'shade', tones: 'M', x: 7, y: 25, w: 6, h: 3 }, { type: 'shade', tones: 'D', x: 14, y: 25, w: 6, h: 3 },
    text(0, 28, `light ${p.shade_light_pct}%`), text(7, 28, `medium ${p.shade_medium_pct}%`), text(14, 28, `dark ${p.shade_dark_pct}%`),
    text(0, 30, 'GRAY TEXT AS IT PRINTS NOW', { style: 'bold' }),
    text(0, 31, `Gray text ${p.gray_text_pct}%: the quick brown fox`, { tone: 'gray' }),
    text(0, 32, 'Black text: the quick brown fox'),
  ]);
}

/** The ramp itself: a swatch, its percent, and a line of text in that gray to judge it as text. Drawn straight on the sheet, since any percent is allowed. */
function ramp(c: Canvas) {
  const { x, y } = gridAt(false, 0);
  RAMP_STEPS.forEach((pct, i) => {
    const top = y + (2 + i) * P;
    c.rect(x, top + 0.4, 18, 2.2, grayHex(pct));
    c.text(`${String(pct).padStart(3)}%`, x + 19, top + 2.1, 2.3);
    c.text('Gray text', x + 25.5, top + 2.1, 2.3, grayHex(pct));
  });
}

/** Five columns in from the spine and 22 wide, so nothing comes within 10 mm of the marks at the top, bottom and centre of the fold. */
const RIGHT_X = 5, RIGHT_W = 22;
const frontRight = () => page('right', [
  text(RIGHT_X, 3, 'DOT GRID: small and large dots', { style: 'bold' }),
  { type: 'pattern', pattern: 'dots', x: RIGHT_X, y: 4, w: 10, h: 6 }, { type: 'pattern', pattern: 'dots', dots: 'large', x: RIGHT_X + 11, y: 4, w: 11, h: 6 },
  text(RIGHT_X, 11, 'small'), text(RIGHT_X + 11, 11, 'large'),
  text(RIGHT_X, 13, 'RULED LINES: hair, thin, thick', { style: 'bold' }),
  text(RIGHT_X, 14, 'hair (writing lines)'), { type: 'pattern', pattern: 'lines', x: RIGHT_X, y: 15, w: RIGHT_W, h: 3 },
  text(RIGHT_X, 19, 'thin'), { type: 'pattern', pattern: 'lines', weight: 'thin', x: RIGHT_X, y: 20, w: RIGHT_W, h: 3 },
  text(RIGHT_X, 24, 'thick'), { type: 'pattern', pattern: 'lines', weight: 'thick', x: RIGHT_X, y: 25, w: RIGHT_W, h: 3 },
  text(RIGHT_X, 30, 'HAIRLINE WEIGHTS: mm (writing: 0.12)', { style: 'bold' }),
]);

/** Lines of each width, in black and in the light gray of writing lines. */
function hairlines(c: Canvas) {
  const { x, y } = gridAt(true, 0);
  const x0 = x + RIGHT_X * P;
  HAIRLINE_WIDTHS.forEach((w, i) => {
    const at = y + (31 + i * 0.8) * P + 1.5;
    c.line(x0, at, x0 + 22, at, w);
    c.line(x0 + 25, at, x0 + 47, at, w, LINE.hair.c);
    c.text(w.toFixed(2), x0 + 50, at + 0.8, 2.3);
  });
}

/**
 * Line weight by direction, on the left page's free right-hand side: pairs of identical lines, one along each paper edge, so a printer
 * that draws one direction thicker shows; and a ladder of lines along the 8.5 in edge at 85 to 100 % of 0.35 mm beside a 0.35 mm line along
 * the other edge, so the step that matches it can be picked. The ladder is exempt from the line weight setting (`fixed`), so its steps
 * are the same whatever that is set to; the pairs are not, so they show what the setting does.
 */
function lineWeights(c: Canvas, layout: SheetLayout) {
  const { x, y } = gridAt(false, 0);
  const x0 = x + 43, hx0 = x0 + 9, hx1 = hx0 + 11, vx = hx1 + 5, edges = EDGE_NAMES[layout];
  c.text('LINE WEIGHT BY DIRECTION', x0, y + 4.2, 1.8);
  c.text(edges.x, hx0, y + 7.7, 1.4);
  c.text(edges.y, vx - 4, y + 7.7, 1.4);
  PAIR_WIDTHS.forEach((w, i) => {
    const at = y + 13.2 + i * 9;
    c.text(`${w.toFixed(2)} mm`, x0, at + 0.6, 1.8);
    c.line(hx0, at, hx1, at, w);
    c.line(vx, at - 4, vx, at + 4, w);
  });
  const top = y + 39.2;
  c.text(`LADDER: ${LADDER_MM} mm`, x0, top, 1.8);
  LADDER_PCT.forEach((pct, i) => {
    const at = top + 4 + i * 4;
    c.text(`${pct}%`, x0, at + 0.6, 1.8);
    c.line(hx0, at, hx1, at, (LADDER_MM * pct) / 100, BLACK, true);
  });
  c.line(vx, top + 1.5, vx, top + 18.5, LADDER_MM);
  c.text(`${LADDER_MM} mm`, x0 + 18, top + 21.5, 1.4);
}

/** The pages of the set that are designed with page elements (the rest is drawn straight on the sheet). */
export const calibrationPages = (print: PrintSettings): Page[] => [frontLeft(print), frontRight()];

// ---- the pages ---------------------------------------------------------------------------------------------------

/** One half-letter sheet's place on a PDF page (the whole page for half letter): where to draw, and a canvas to draw it with. */
interface Half { items: Item[]; fonts: Fonts; height: number; dy: number; c: Canvas; /** Which half this is, and how many there are. */ index: number; count: number }

/** A page of a calibration PDF: which side it prints, what the trim zone label says after "Book 1 |", how to draw one half, and what to draw once on the whole sheet. */
interface CalPage { side: 'front' | 'back'; label: string[]; draw: (g: Half) => void; whole?: (g: Half) => void }

const bookTitle = (b: Book) => b.name.trim() || 'Untitled book';

/**
 * A calibration PDF: every page is drawn in each half of the sheet (one for half letter, two for letter two-up, with the cut marks and the
 * labels Book 1 / Book 2), under the layout's scale and its side's offset and rotation.
 */
async function calibrationPdf(book: Book, print: PrintSettings, fontBytes: FontBytes, pages: CalPage[]): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const layout = print.sheet_layout, { w, h } = sheetSize(layout), tops = halfTops(layout), twoUp = isTwoUp(layout);
  for (const page of pages) {
    const items: Item[] = [];
    tops.forEach((top, i) => {
      page.draw({ items, fonts, height: h, dy: top, c: sheetCanvas(items, fonts, top), index: i, count: tops.length });
      if (twoUp) items.push(halfLabelItem(halfLabel(fonts.regular, i as 0 | 1, bookTitle(book), ...page.label), top));
    });
    page.whole?.({ items, fonts, height: h, dy: 0, c: sheetCanvas(items, fonts), index: 0, count: tops.length });
    if (twoUp) items.push(...cutMarks());
    drawItems(doc.addPage([mmToPt(w), mmToPt(h)]), printSide(items, print, page.side, w, h), fonts, h);
  }
  return doc.save({ useObjectStreams: false });
}

// ---- the calibration sheet -----------------------------------------------------------------------------------

const PLUS_MM = 0.2, PLUS_ARM_MM = 3; // side 1's and the centre's +: 0.2 mm lines, 6 mm across
const CAPTION_MM = 1.8;
const plus = (c: Canvas, p: Pt) => { c.line(p.x - PLUS_ARM_MM, p.y, p.x + PLUS_ARM_MM, p.y, PLUS_MM); c.line(p.x, p.y - PLUS_ARM_MM, p.x, p.y + PLUS_ARM_MM, PLUS_MM); };

/** Side 1: the ramp, sample text, dots, lines and hairlines, in the top half of the paper (the left page's settings footer is small and ends 10 mm short of the marks). */
function sheetFront(g: Half, print: PrintSettings, now: Date) {
  content(g, print, frontLeft(print), false);
  content(g, print, frontRight(), true);
  ramp(g.c);
  hairlines(g.c);
  lineWeights(g.c, print.sheet_layout);
  const { x, y } = gridAt(false, 0);
  const lines = ['SIDE 1 (FRONT)', ...settingsLines(print, now)];
  lines.forEach((line, i) => g.c.text(line, x + 0.8, y + 114 - (lines.length - 1 - i) * 1.7, 1.4));
  for (const p of Object.values(crosshairs(print.sheet_layout))) plus(g.c, p);
}

/** The unit vectors, in sheet millimetres (y down), of an edge mark: toward the paper's edge, and along its see-through scale in the direction a reading counts up (right, or up). */
const EDGE_DIRS = {
  top: { out: { x: 0, y: -1 }, along: { x: 1, y: 0 } }, bottom: { out: { x: 0, y: 1 }, along: { x: 1, y: 0 } },
  left: { out: { x: -1, y: 0 }, along: { x: 0, y: -1 } }, right: { out: { x: 1, y: 0 }, along: { x: 0, y: -1 } },
} as const;

/** A tick centred on `at`, across a line that runs along `dir`. */
const tick = (c: Canvas, at: Pt, dir: Pt, len: number) => c.line(at.x - (dir.y * len) / 2, at.y - (dir.x * len) / 2, at.x + (dir.y * len) / 2, at.y + (dir.x * len) / 2, HAIR_MM);

/**
 * An edge mark on side 2: a see-through scale through the mark (-5 to +5 mm, a tick every 0.5, the numbers in two rows on the side away from the
 * edge so neighbours don't touch). The caption is in the words of the reading.
 */
function edgeMark(g: Half, name: 'top' | 'bottom' | 'left' | 'right', p: Pt, cap: ReturnType<typeof scaleCaptions>) {
  const c = g.c, { out, along } = EDGE_DIRS[name], inner = { x: -out.x, y: -out.y }, horizontal = out.x === 0, size = 1.4;
  const at = (a: number, o: number): Pt => ({ x: p.x + along.x * a + out.x * o, y: p.y + along.y * a + out.y * o });
  const [a0, a1] = [at(-SCALE_RANGE_MM - 0.5, 0), at(SCALE_RANGE_MM + 0.5, 0)];
  c.line(a0.x, a0.y, a1.x, a1.y, HAIR_MM);
  for (let half = -2 * SCALE_RANGE_MM; half <= 2 * SCALE_RANGE_MM; half++) {
    const mm = half / 2, whole = half % 2 === 0, t = at(mm, 0);
    tick(c, t, along, mm === 0 ? 3 : whole ? 1.6 : 0.9);
    if (!whole) continue;
    const row = mm % 2 === 0 ? 2.3 : 4.3; // even numbers in the row next to the line, odd ones in the row beyond
    const label = String(mm);
    if (horizontal) c.text(label, t.x, t.y + inner.y * row + (inner.y > 0 ? size * 0.75 : 0), size, BLACK, 'middle', true);
    else c.text(label, t.x + inner.x * row, t.y + size * 0.35, size, BLACK, inner.x > 0 ? 'start' : 'end', true);
  }
  const caption = { top: cap.top, bottom: cap.bottom, left: cap.left, right: cap.right }[name];
  if (horizontal) c.text(caption, p.x + 8, p.y + 0.6, CAPTION_MM);
  else c.text(caption, p.x + inner.x * 9, p.y + 0.6, CAPTION_MM, BLACK, inner.x > 0 ? 'start' : 'end');
}

/**
 * A fold scale: -5 to +5 mm, a tick every 0.5, 0 longer, counting up the sheet (the two across the horizontal centre line, read after folding the top
 * edge to the bottom edge) or to the right (the two across the vertical one), as seen on side 2. Its caption is beside it, clear of the centre.
 */
function foldScale(g: Half, name: FoldName, p: Pt, caption: string) {
  const up = name === 'left' || name === 'right';
  scale(g.c, p, up ? { x: 0, y: -1 } : { x: 1, y: 0 }, -SCALE_RANGE_MM, SCALE_RANGE_MM, { label: (mm) => fmt(mm), mark: { mm: 0, text: '0' } });
  if (up) g.c.text(caption, p.x - 10, p.y - SCALE_RANGE_MM - 2.3, CAPTION_MM);
  else g.c.text(caption, p.x - 8, p.y + 0.6, CAPTION_MM, BLACK, 'end');
}

/** The words on side 2, one paragraph each. */
const BACK_HOW = [
  'SIDE 2: MEASURE',
  'See-through: hold the sheet to a light and read where side 1\'s + shows through each see-through scale. + is right and up, as seen on this side.',
  `${FOLD_HOW} + is up and right, as seen on this side.`,
  'Lines: measure each 100 mm line with a ruler, tick to tick.',
  'Print twice: if the readings differ much, the paper feed twists it; no setting can fix that.',
];

/** `str` broken into lines no wider than `max` mm at `size`. */
function wrap(c: Canvas, str: string, max: number, size: number): string[] {
  const lines: string[] = [];
  for (const word of str.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && c.width(`${lines[last]} ${word}`, size) <= max) lines[last] += ` ${word}`; else lines.push(word);
  }
  return lines;
}

/** Side 2: the four see-through scales, the centre +, the four fold scales, the two 100 mm lines, and how to read them. */
function sheetBack(g: Half, print: PrintSettings) {
  const layout = print.sheet_layout, cap = scaleCaptions(layout), at = crosshairs(layout), fold = foldScales(layout), c = g.c, W = SHEET_W_MM, H = sheetHeight(layout);
  for (const name of ['top', 'bottom', 'left', 'right'] as const) edgeMark(g, name, at[name], cap);
  plus(c, at.centre);
  for (const [name, key] of [['left', 'hFoldLeft'], ['right', 'hFoldRight'], ['top', 'vFoldTop'], ['bottom', 'vFoldBottom']] as const) foldScale(g, name, fold[name], cap[key]);
  // Below the centre, right of the bottom fold scale: clear of the marks, the 100 mm lines and the scales.
  let y = H / 2 + 17;
  BACK_HOW.forEach((para, i) => {
    for (const line of wrap(c, para, 80, 1.8)) { c.text(line, W / 2 + 10, y, 1.8); y += 2.3; }
    y += i === 0 ? 0.6 : 1.1;
  });
  // The 100 mm lines, in clear space: one parallel to the 8.5 in edge (the top), one to the other (the left).
  const ly = H / 2 - 25, x0 = (W - LINE_MM) / 2;
  c.line(x0, ly, x0 + LINE_MM, ly, PLUS_MM);
  for (const x of [x0, x0 + LINE_MM]) c.line(x, ly - 2.5, x, ly + 2.5, PLUS_MM);
  c.text(cap.longX, x0 + 2, ly - 3.2, CAPTION_MM);
  const x = W / 2 - 58, y0 = H / 2 - LINE_MM / 2;
  c.line(x, y0, x, y0 + LINE_MM, PLUS_MM);
  for (const yy of [y0, y0 + LINE_MM]) c.line(x - 2.5, yy, x + 2.5, yy, PLUS_MM);
  c.text(cap.longY, x + 5.6, y0 + LINE_MM - 3, CAPTION_MM, BLACK, 'start', false, true);
}

/** calibration-sheet.pdf: page 1 the front, page 2 the back, each on the whole paper with its own offset; the back is turned by the layout's rotation. */
async function sheetPdf(print: PrintSettings, fontBytes: FontBytes, now: Date): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const { w, h } = sheetSize(print.sheet_layout);
  for (const side of ['front', 'back'] as const) {
    const items: Item[] = [];
    const g: Half = { items, fonts, height: h, dy: 0, c: sheetCanvas(items, fonts), index: 0, count: 1 };
    if (side === 'front') sheetFront(g, print, now); else sheetBack(g, print);
    drawItems(doc.addPage([mmToPt(w), mmToPt(h)]), printSide(items, print, side, w, h), fonts, h);
  }
  return doc.save({ useObjectStreams: false });
}

// ---- creep test and cover ----------------------------------------------------------------------------------

/**
 * creep-test.pdf: both sides of the outermost and the innermost sheet of an `pages`-page book, each shifted by its creep in that book, the
 * fore-edge shift and its side's offset, in manual-duplex order: the fronts (innermost first), then the backs (outermost first).
 */
function creepTestPdf(book: Book, print: PrintSettings, fontBytes: FontBytes, now: Date, pages: number) {
  const n = pages / 4, tested = testedSheets(n), count = tested.length;
  const sheets: Sheet[] = impose(pages, print, 1)[0].sheets, shift = print.fore_edge_shift_mm;
  const [fronts, backs] = duplexOrder(n);
  const order: { sheet: number; side: 'front' | 'back' }[] = [
    ...fronts.filter((k) => tested.includes(k)).map((sheet) => ({ sheet, side: 'front' as const })),
    ...backs.filter((k) => tested.includes(k)).map((sheet) => ({ sheet, side: 'back' as const })),
  ];
  return calibrationPdf(book, print, fontBytes, order.map(({ sheet: k, side }, i): CalPage => ({
    side,
    label: [`sheet ${k + 1} of ${n}`, side],
    draw: (g) => {
      const s = sheets[k];
      const pass = i < count ? `pass 1: print pages 1-${count}` : `pass 2: print pages ${count + 1}-${2 * count}`;
      for (const right of [false, true]) {
        frame(g.c, right, s.creep, shift, false);
        const { x, y } = gridAt(right, s.creep, shift);
        const ref = (right ? s[side].right : s[side].left);
        g.c.text(`SHEET ${k + 1} OF ${n}${k === 0 ? ' (OUTERMOST)' : k === n - 1 ? ' (INNERMOST)' : ''}`, x + 0.8, y + 4, 3.2);
        g.c.text(`${side.toUpperCase()}, ${right ? 'right' : 'left'} page${ref === null ? '' : ` ${ref}`}`, x + 0.8, y + 8, 3.2);
        g.c.text(`PDF page ${i + 1} of ${2 * count} (${pass})`, x + 0.8, y + 11, 2);
        pageRulers(g.c, print.target_fore_edge_margin_mm, right, s.creep, shift, true);
        footer(g.c, print, now, right, s.creep, shift, [`creep test, ${pages} pages, ${s.creep.toFixed(2)} mm toward the fold, ${shift} away`]);
      }
    },
  })));
}

/**
 * calibration-cover.pdf: the cover sheet as cover-outside.pdf and cover-inside.pdf print it: page 1 the outside (outside back | outside
 * front, the front offset), page 2 the inside (inside front | inside back, the back offset), each with the cover shift, the box,
 * crosshairs and rulers.
 */
function coverTestPdf(book: Book, print: PrintSettings, fontBytes: FontBytes, now: Date) {
  const shift = print.cover_fore_edge_shift_mm;
  const pass = (side: 'front' | 'back', names: [string, string]): CalPage => ({
    side,
    label: ['cover', side === 'front' ? 'outside' : 'inside'],
    draw: (g) => {
      for (const right of [false, true]) {
        frame(g.c, right, 0, shift, true);
        pageRulers(g.c, print.target_fore_edge_margin_mm, right, 0, shift, true);
        footer(g.c, print, now, right, 0, shift, [`COVER, ${names[right ? 1 : 0]}`]);
      }
    },
  });
  return calibrationPdf(book, print, fontBytes, [pass('front', ['outside back cover', 'outside front cover']), pass('back', ['inside front cover', 'inside back cover'])]);
}

// ---- the sets of files ---------------------------------------------------------------------------------------

const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
const txt = (name: string, body: string): ExportedFile => ({ name, bytes: new TextEncoder().encode(body), type: 'text/plain' });

/** Throws if the print settings can't be printed, or the creep test's page count is not a multiple of 4. */
function check(print: PrintSettings, pages: number) {
  if (!validPages(pages)) throw new Error(`The creep test's page count must be a multiple of 4, at least 4, not ${pages}.`);
  const problem = checkPrintSettings(print, pages / 4);
  if (problem) throw new Error(problem);
}

/** The calibration step: calibration-sheet.pdf. */
export async function sheetFile(book: Book, print: PrintSettings, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile> {
  check(print, creepPages(book, print));
  return pdf(SHEET_FILE, await sheetPdf(print, fontBytes, now));
}

/** The creep step: the cover sheet and the creep test for a book of `pages` pages (the book's biggest signature by default), with calibration.txt. */
export async function creepFiles(book: Book, print: PrintSettings, fontBytes: FontBytes, now = new Date(), pages = creepPages(book, print)): Promise<ExportedFile[]> {
  check(print, pages);
  return [
    pdf(COVER_FILE, await coverTestPdf(book, print, fontBytes, now)),
    pdf(CREEP_FILE, await creepTestPdf(book, print, fontBytes, now, pages)),
    txt('calibration.txt', calibrationText(book, print, now, pages)),
  ];
}
