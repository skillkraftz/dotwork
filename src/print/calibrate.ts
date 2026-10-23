// The calibration sheets: paper that shows, without printing a whole book, how a printer places and tones the pages.
// Built with the same imposition, page size and drawing code as the book's own print files. Printer settings come from the printer profile.
//
//   calibration-sheet.pdf  one double-sided sheet per layout: page 1 = the front, page 2 = the back; print them the way print-first and
//       print-second are printed. Side 1 has the gray ramp, sample text, dots, lines, a hairline strip, four small crosshairs (one
//       near each edge of the content area) and the fold mark. Side 2 is all measuring: a mm scale where each crosshair shows through
//       (read x at the top and bottom, y at the left and right), the fold scale for the crease, a ruler at the paper's top and bottom
//       edge, and two long lines to measure with a ruler. See src/book/alignment.ts for what the readings mean.
//   creep-test.pdf             every sheet of the book's biggest signature, both sides, in manual-duplex order: pages 1 to N are
//       the fronts (last sheet first), pages N+1 to 2N the backs (first sheet first). Margin rulers on every page.
//   calibration-cover.pdf      the cover sheet as cover-outside.pdf and cover-inside.pdf print it (two passes), with margin rulers
//   calibration.txt            the settings that made them
//
// On the letter two-up layout every page has the same thing in both halves, labelled Book 1 and Book 2 like the print files, with the
// cut marks; the scale, offsets and rotation of the selected layout apply to the whole page. Covers stay out of the creep test.
import { GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, COLS, ROWS, PITCH_MM as P, emptyPage, type Page, type PageElement, type Text } from '../format/types';
import type { Book } from '../book/book';
import { FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, pageOrigin, type PrintSettings, type Sheet } from '../book/impose';
import { LONG_LINE_MM, SCALE_RANGE_MM, crosshairs, foldScaleAt, scaleCaptions, sheetHeight } from '../book/alignment';
import { LINE } from '../render';
import { degrees } from 'pdf-lib';
import { color, drawPage, mmToPt, type Fonts } from './draw';
import { newDocument, type ExportedFile, type FontBytes, type PdfPage } from './export';
import { drawCutMarks, drawHalfLabel, halfLabel, halfTops, isTwoUp, onSheet, sheetSize, transformOf } from './sheets';
import { creepSheets } from '../book/creep';
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
/** The gray ramp's steps, in percent black. */
export const RAMP_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);
/** Every mm scale runs -5 to +5 mm in 0.5 mm ticks. */
export const SCALE_MM = SCALE_RANGE_MM;
/** The fore-edge ruler runs from the box line this far outward: past the trim line, which is GRID_X from it. */
export const FORE_EDGE_RULER_MM = 7;

export { creepSheets };

/** Where a page's box starts on the sheet, and its size. */
const GRID_W = COLS * P, GRID_H = ROWS * P;

// ---- the files' names and text ------------------------------------------------------------------------------

export const SHEET_FILE = 'calibration-sheet.pdf';
export const CREEP_FILE = 'creep-test.pdf';
export const COVER_FILE = 'calibration-cover.pdf';

/** The text of calibration.txt, and of every footer: the settings that made the files. */
export function calibrationText(book: Book, print: PrintSettings, now: Date): string {
  const n = creepSheets(book, print);
  return [
    'Dotwork calibration',
    '',
    ...settingsLines(print, now),
    '',
    `${SHEET_FILE}: page 1 is the front, page 2 the back; print like print-first and print-second`,
    `${CREEP_FILE}: ${2 * n} pages in manual-duplex order; print pages 1 to ${n}, put the stack back the same way, print pages ${n + 1} to ${2 * n}`,
    `${COVER_FILE}: page 1 is the outside (print it first), page 2 the inside; print like cover-outside and cover-inside`,
    '',
  ].join('\n');
}

// ---- drawing on a sheet --------------------------------------------------------------------------------------

type Align = 'start' | 'middle' | 'end';

/** A sheet `height` mm tall to draw on in sheet millimetres (x right, y down from the top left), everything moved by dx, dy. */
function sheetCanvas(pdf: PdfPage, fonts: Fonts, height: number, dx = 0, dy = 0) {
  const X = (x: number) => mmToPt(x + dx), Y = (y: number) => mmToPt(height - (y + dy));
  return {
    line: (x1: number, y1: number, x2: number, y2: number, w: number, c = BLACK) =>
      pdf.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: mmToPt(w), color: color(c) }),
    dot: (x: number, y: number, r: number, c = BLACK) => pdf.drawCircle({ x: X(x), y: Y(y), size: mmToPt(r), color: color(c) }),
    ring: (x: number, y: number, r: number, w: number, c = BLACK) => pdf.drawCircle({ x: X(x), y: Y(y), size: mmToPt(r), borderWidth: mmToPt(w), borderColor: color(c) }),
    rect: (x: number, y: number, w: number, h: number, c: string) =>
      pdf.drawRectangle({ x: X(x), y: Y(y + h), width: mmToPt(w), height: mmToPt(h), color: color(c) }),
    outline: (x: number, y: number, w: number, h: number, lw: number, c = BLACK) =>
      pdf.drawRectangle({ x: X(x), y: Y(y + h), width: mmToPt(w), height: mmToPt(h), borderWidth: mmToPt(lw), borderColor: color(c) }),
    /** Text with its baseline at y. */
    text: (str: string, x: number, y: number, size: number, c = BLACK, align: Align = 'start', knockout = false, rotate = false) => {
      const width = fonts.regular.widthOfTextAtSize(str, mmToPt(size));
      // Turned a quarter, the text runs up the sheet from its start, so an aligned text starts that much below y.
      if (rotate) {
        pdf.drawText(str, { x: X(x), y: Y(y) - (align === 'middle' ? width / 2 : align === 'end' ? width : 0), size: mmToPt(size), font: fonts.regular, color: color(c), rotate: degrees(90) });
        return;
      }
      const left = X(x) - (align === 'middle' ? width / 2 : align === 'end' ? width : 0);
      // A knocked-out label is on white, so a line running through it doesn't strike it out.
      if (knockout) pdf.drawRectangle({ x: left - mmToPt(0.1), y: Y(y) - mmToPt(size * 0.2), width: width + mmToPt(0.2), height: mmToPt(size * 0.95), color: color('#ffffff') });
      pdf.drawText(str, { x: left, y: Y(y), size: mmToPt(size), font: fonts.regular, color: color(c) });
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
  drawPage(g.pdf, p, { x: o.x + g.dx, y: o.y + g.dy, sheetHeight: g.height, fonts: g.fonts, pageNumber: null, expand: (t) => t, tones: tonesOf(print) });
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

// ---- the alignment sheet -------------------------------------------------------------------------------------

function frontLeft(p: PrintSettings): Page {
  return page('left', [
    text(0, 1, 'GRAY RAMP: percent black', { style: 'bold' }),
    text(0, 24, 'TONES AS THEY PRINT NOW', { style: 'bold' }),
    { type: 'shade', tones: 'L', x: 0, y: 25, w: 8, h: 3 }, { type: 'shade', tones: 'M', x: 9, y: 25, w: 8, h: 3 }, { type: 'shade', tones: 'D', x: 18, y: 25, w: 8, h: 3 },
    text(0, 28, `light ${p.shade_light_pct}%`), text(9, 28, `medium ${p.shade_medium_pct}%`), text(18, 28, `dark ${p.shade_dark_pct}%`),
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

/** Two rows lower than it needs to be, so rows 0 and 1 stay free for the fold scale. */
const frontRight = () => page('right', [
  text(0, 3, 'DOT GRID: small and large dots', { style: 'bold' }),
  { type: 'pattern', pattern: 'dots', x: 0, y: 4, w: 13, h: 6 }, { type: 'pattern', pattern: 'dots', dots: 'large', x: 14, y: 4, w: 13, h: 6 },
  text(0, 11, 'small'), text(14, 11, 'large'),
  text(0, 13, 'RULED LINES: hair, thin, thick', { style: 'bold' }),
  text(0, 14, 'hair (writing lines)'), { type: 'pattern', pattern: 'lines', x: 0, y: 15, w: 27, h: 3 },
  text(0, 19, 'thin'), { type: 'pattern', pattern: 'lines', weight: 'thin', x: 0, y: 20, w: 27, h: 3 },
  text(0, 24, 'thick'), { type: 'pattern', pattern: 'lines', weight: 'thick', x: 0, y: 25, w: 27, h: 3 },
  text(0, 30, 'HAIRLINE WEIGHTS: mm (writing: 0.12)', { style: 'bold' }),
]);

/** Lines of each width, in black and in the light gray of writing lines. */
function hairlines(c: Canvas) {
  const { x, y } = gridAt(true, 0);
  HAIRLINE_WIDTHS.forEach((w, i) => {
    const at = y + (31 + i * 0.8) * P + 1.5;
    c.line(x, at, x + 30, at, w);
    c.line(x + 33, at, x + 63, at, w, LINE.hair.c);
    c.text(w.toFixed(2), x + 66, at + 0.8, 2.3);
  });
}

/** The pages of the set that are designed with page elements (the rest is drawn straight on the sheet). */
export const calibrationPages = (print: PrintSettings): Page[] => [frontLeft(print), frontRight()];

// ---- the pages ---------------------------------------------------------------------------------------------------

/** One half-letter sheet's place on a PDF page (the whole page for half letter): where to draw, and a canvas to draw it with. */
interface Half { pdf: PdfPage; fonts: Fonts; height: number; dx: number; dy: number; c: Canvas; /** Which half this is, and how many there are. */ index: number; count: number }

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
    const pdf = doc.addPage([mmToPt(w), mmToPt(h)]);
    onSheet(pdf, w, h, transformOf(print, page.side), (dx, dy) => {
      tops.forEach((top, i) => {
        page.draw({ pdf, fonts, height: h, dx, dy: dy + top, c: sheetCanvas(pdf, fonts, h, dx, dy + top), index: i, count: tops.length });
        if (twoUp) drawHalfLabel(pdf, fonts, halfLabel(fonts.regular, i as 0 | 1, bookTitle(book), ...page.label), top, dx, dy);
      });
      page.whole?.({ pdf, fonts, height: h, dx, dy, c: sheetCanvas(pdf, fonts, h, dx, dy), index: 0, count: tops.length });
      if (twoUp) drawCutMarks(pdf, dx, dy);
    });
  }
  return doc.save({ useObjectStreams: false });
}

// ---- the calibration sheet -----------------------------------------------------------------------------------

const ARM_MM = 2; // a crosshair's arm
const CAPTION_MM = 1.8;
const cross = (c: Canvas, p: Pt) => { c.line(p.x - ARM_MM, p.y, p.x + ARM_MM, p.y, HAIR_MM); c.line(p.x, p.y - ARM_MM, p.x, p.y + ARM_MM, HAIR_MM); };

/** Side 1, in each half: the gray ramp, sample text, dots, lines and hairlines. */
function sheetFront(g: Half, print: PrintSettings, now: Date) {
  content(g, print, frontLeft(print), false);
  content(g, print, frontRight(), true);
  ramp(g.c);
  hairlines(g.c);
  for (const right of [false, true]) {
    frame(g.c, right, 0, 0, false);
    footer(g.c, print, now, right, 0, 0, [`SIDE 1 (FRONT), ${right ? 'right' : 'left'} page`]);
  }
}

/** Side 1, once on the sheet: the four crosshairs, and the fold mark, a short line on the fold at the centre that shows through next to the crease on side 2. */
function frontMarks(g: Half, print: PrintSettings) {
  for (const p of Object.values(crosshairs(print.sheet_layout))) cross(g.c, p);
  const f = foldScaleAt(print.sheet_layout);
  g.c.line(f.x, f.y - 5, f.x, f.y + 5, HAIR_MM);
  g.c.text('fold', f.x - 1.2, f.y - 6, CAPTION_MM, BLACK, 'end');
}

/** Side 2, once on the sheet: a mm scale where each crosshair shows through, the fold scale, the rulers at the paper's top and bottom edge, and how to read them. */
function sheetBack(g: Half, print: PrintSettings) {
  const layout = print.sheet_layout, cap = scaleCaptions(layout), at = crosshairs(layout), c = g.c, H = sheetHeight(layout);
  const label = (mm: number) => (Math.abs(mm) <= SCALE_MM ? String(mm) : null);
  const across = (p: Pt) => scale(c, p, { x: 1, y: 0 }, -SCALE_MM - 0.5, SCALE_MM + 0.5, { label });
  const up = (p: Pt) => scale(c, p, { x: 0, y: -1 }, -SCALE_MM - 0.5, SCALE_MM + 0.5, { label });
  across(at.top); across(at.bottom); up(at.left); up(at.right);
  c.text(cap.top, at.top.x + 8, at.top.y + 0.6, CAPTION_MM);
  c.text(cap.bottom, at.bottom.x + 8, at.bottom.y + 0.6, CAPTION_MM);
  c.text(cap.left, at.left.x + 6, at.left.y + 0.6, CAPTION_MM);
  c.text(cap.right, at.right.x - 6, at.right.y + 0.6, CAPTION_MM, BLACK, 'end');
  const f = foldScaleAt(layout);
  across(f);
  c.text(cap.crease, f.x, f.y + 6.5, CAPTION_MM, BLACK, 'middle');
  // The rulers at the paper's top and bottom edge, on the fold: they count outward from the box line.
  marginRuler(c, { x: FOLD_X_MM - PAGE_W_MM / 2, y: 0 }, 'top', 0);
  marginRuler(c, { x: FOLD_X_MM - PAGE_W_MM / 2, y: H - SHEET_H_MM }, 'bottom', 0);
  c.text(cap.topMargin, FOLD_X_MM - 3, 6.5, CAPTION_MM, BLACK, 'end');
  c.text(cap.bottomMargin, FOLD_X_MM - 3, H - 8.2, CAPTION_MM, BLACK, 'end');
  const how = [
    'SIDE 2: MEASURE', '', 'Hold the sheet to a light: side 1\'s crosshairs', 'show through next to the scales. Read each', 'scale where its crosshair is: + is right and',
    '+ is up, as seen on this side.', '', 'Fold the sheet in half edge to edge, crease it', 'hard, open it, and read where the crease', 'crosses its scale.',
    '', 'Print the sheet twice. If the readings differ', 'much between the two prints, the paper feed', 'twists it: no setting can fix that.',
  ];
  how.forEach((line, i) => c.text(line, FOLD_X_MM - PAGE_W_MM + GRID_X_MM + 1, 20 + i * 2.7, 2.1));
  sheetLines(g, print);
}

/** The two long lines to measure, along the 8.5 in edge (at the bottom) and the other (at the left), each with its tick marks. */
function sheetLines(g: Half, print: PrintSettings) {
  const layout = print.sheet_layout, cap = scaleCaptions(layout), len = LONG_LINE_MM[layout], H = sheetHeight(layout), c = g.c;
  const x0 = (SHEET_W_MM - len.x) / 2, y = H - 5.5;
  c.line(x0, y, x0 + len.x, y, 0.2);
  for (const x of [x0, x0 + len.x]) c.line(x, y - TICK_MM / 2, x, y + TICK_MM / 2, 0.2);
  c.text(cap.longX, x0 + 2, y - 1.6, CAPTION_MM);
  // On two-up the line is kept out of the printer's 3 mm margin and the half labels' column (x 9 to 11) in the left trim zone.
  const y0 = (H - len.y) / 2, x = 4.6;
  c.line(x, y0, x, y0 + len.y, 0.2);
  for (const yy of [y0, y0 + len.y]) c.line(x - 1.5, yy, x + 1.5, yy, 0.2);
  c.text(cap.longY, x + 3.6, y0 + len.y - 8, 1.6, BLACK, 'start', false, true);
}

const TICK_MM = 5;

/** calibration-sheet.pdf: page 1 the front, page 2 the back, each with its own offset; the back is turned by the layout's rotation. */
const sheetPdf = (book: Book, print: PrintSettings, fontBytes: FontBytes, now: Date) => calibrationPdf(book, print, fontBytes, [
  { side: 'front', label: ['calibration', 'front'], draw: (g) => sheetFront(g, print, now), whole: (g) => frontMarks(g, print) },
  { side: 'back', label: ['calibration', 'back'], draw: () => {}, whole: (g) => sheetBack(g, print) },
]);

// ---- creep test and cover ----------------------------------------------------------------------------------

/**
 * creep-test.pdf: both sides of every sheet of the biggest signature, shifted by their creep, the fore-edge shift and their side's offset, in
 * manual-duplex order: the fronts (last sheet first), then the backs (first sheet first). Page ranges are on every page.
 */
function creepTestPdf(book: Book, print: PrintSettings, fontBytes: FontBytes, now: Date) {
  const n = creepSheets(book, print);
  const sheets: Sheet[] = impose(4 * n, print, 1)[0].sheets, shift = print.fore_edge_shift_mm;
  const [fronts, backs] = duplexOrder(n);
  const order: { sheet: number; side: 'front' | 'back' }[] = [...fronts.map((sheet) => ({ sheet, side: 'front' as const })), ...backs.map((sheet) => ({ sheet, side: 'back' as const }))];
  return calibrationPdf(book, print, fontBytes, order.map(({ sheet: k, side }, i): CalPage => ({
    side,
    label: [`sheet ${k + 1} of ${n}`, side],
    draw: (g) => {
      const s = sheets[k];
      const pass = i < n ? `pass 1: print pages 1-${n}` : `pass 2: print pages ${n + 1}-${2 * n}`;
      for (const right of [false, true]) {
        frame(g.c, right, s.creep, shift, false);
        const { x, y } = gridAt(right, s.creep, shift);
        const ref = (right ? s[side].right : s[side].left);
        g.c.text(`SHEET ${k + 1} OF ${n}${k === 0 ? ' (OUTERMOST)' : k === n - 1 ? ' (INNERMOST)' : ''}`, x + 0.8, y + 4, 3.2);
        g.c.text(`${side.toUpperCase()}, ${right ? 'right' : 'left'} page${ref === null ? '' : ` ${ref}`}`, x + 0.8, y + 8, 3.2);
        g.c.text(`PDF page ${i + 1} of ${2 * n} (${pass})`, x + 0.8, y + 11, 2);
        pageRulers(g.c, print.target_fore_edge_margin_mm, right, s.creep, shift, true);
        footer(g.c, print, now, right, s.creep, shift, [`creep test, ${s.creep.toFixed(2)} mm toward the fold, ${shift} away`]);
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

/** Throws if the print settings can't be printed. */
function check(book: Book, print: PrintSettings) {
  const problem = checkPrintSettings(print, creepSheets(book, print));
  if (problem) throw new Error(problem);
}

/** The calibration step: calibration-sheet.pdf. */
export async function sheetFile(book: Book, print: PrintSettings, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile> {
  check(book, print);
  return pdf(SHEET_FILE, await sheetPdf(book, print, fontBytes, now));
}

/** The creep step: the cover sheet and the creep test, with calibration.txt. */
export async function creepFiles(book: Book, print: PrintSettings, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile[]> {
  check(book, print);
  return [
    pdf(COVER_FILE, await coverTestPdf(book, print, fontBytes, now)),
    pdf(CREEP_FILE, await creepTestPdf(book, print, fontBytes, now)),
    txt('calibration.txt', calibrationText(book, print, now)),
  ];
}
