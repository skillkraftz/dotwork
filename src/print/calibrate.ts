// The calibration sheets: paper that shows, without printing a whole book, how a printer places and tones the pages.
// Built with the same imposition, page size and drawing code as the book's own print files.
//
//   calibration-alignment.pdf  page 1 = the front, page 2 = the back; print them the way print-first and print-second are
//       printed. Each side takes its own offset, as the book's files do. Both have a scale across the fold (read where the
//       sheet's crease crosses it) and a ruler at the top and bottom edge (read the margin where the paper ends); the front
//       also has the gray ramp, the tones as they print, dots, lines and a hairline strip. Both draw the page box with
//       crosshairs at its corners and centre, which should coincide when held to a light.
//   creep-test.pdf             every sheet of the book's biggest signature, both sides, in manual-duplex order: pages 1 to N are
//       the fronts (last sheet first), pages N+1 to 2N the backs (first sheet first). Margin rulers on every page.
//   calibration-cover.pdf      one single-sided sheet like cover.pdf, with margin rulers
//   calibration.txt            the settings that made them
import { GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, COLS, ROWS, PITCH_MM as P, emptyPage, type Page, type PageElement, type Text } from '../format/types';
import type { Book } from '../book/book';
import { FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, checkPrintSettings, duplexOrder, impose, offsetOf, pageOrigin, type Sheet } from '../book/impose';
import { LINE } from '../render';
import { color, drawPage, mmToPt, type Fonts } from './draw';
import { newDocument, type ExportedFile, type FontBytes, type PdfPage } from './export';
import { creepSheets, thicknessFromCreepTest } from '../book/creep';
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
/** The fold scale runs -5 to +5 mm in 0.5 mm ticks. */
export const SCALE_MM = 5;
/** The fore-edge ruler runs from the box line this far outward: past the trim line, which is GRID_X from it. */
export const FORE_EDGE_RULER_MM = 7;

export { creepSheets, thicknessFromCreepTest };

/** Where a page's box starts on the sheet, and its size. */
const GRID_W = COLS * P, GRID_H = ROWS * P;

// ---- the files' names and text ------------------------------------------------------------------------------

export const ALIGNMENT_FILE = 'calibration-alignment.pdf';
export const CREEP_FILE = 'creep-test.pdf';
export const COVER_FILE = 'calibration-cover.pdf';

/** The text of calibration.txt, and of every footer: the settings that made the files. */
export function calibrationText(book: Book, now: Date): string {
  const n = creepSheets(book);
  return [
    'Dotwork calibration',
    '',
    ...settingsLines(book, now),
    '',
    `${ALIGNMENT_FILE}: page 1 is the front, page 2 the back; print like print-first and print-second`,
    `${CREEP_FILE}: ${2 * n} pages in manual-duplex order; print pages 1 to ${n}, put the stack back the same way, print pages ${n + 1} to ${2 * n}`,
    `${COVER_FILE}: one single-sided sheet, like cover.pdf`,
    '',
  ].join('\n');
}

// ---- drawing on a sheet --------------------------------------------------------------------------------------

type Align = 'start' | 'middle' | 'end';

/** A sheet to draw on in sheet millimetres (x right, y down from the top left), everything moved by dx, dy. */
function sheetCanvas(pdf: PdfPage, fonts: Fonts, dx = 0, dy = 0) {
  const X = (x: number) => mmToPt(x + dx), Y = (y: number) => mmToPt(SHEET_H_MM - (y + dy));
  return {
    line: (x1: number, y1: number, x2: number, y2: number, w: number, c = BLACK) =>
      pdf.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: mmToPt(w), color: color(c) }),
    rect: (x: number, y: number, w: number, h: number, c: string) =>
      pdf.drawRectangle({ x: X(x), y: Y(y + h), width: mmToPt(w), height: mmToPt(h), color: color(c) }),
    outline: (x: number, y: number, w: number, h: number, lw: number, c = BLACK) =>
      pdf.drawRectangle({ x: X(x), y: Y(y + h), width: mmToPt(w), height: mmToPt(h), borderWidth: mmToPt(lw), borderColor: color(c) }),
    /** Text with its baseline at y. */
    text: (str: string, x: number, y: number, size: number, c = BLACK, align: Align = 'start', knockout = false) => {
      const width = fonts.regular.widthOfTextAtSize(str, mmToPt(size));
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
const gridAt = (isRight: boolean, creep: number) => {
  const o = pageOrigin(isRight, creep);
  return { page: o, x: o.x + GRID_X_MM, y: o.y + GRID_Y_MM };
};

/** The page edge, the content-area box and, if asked, a crosshair at each corner of the box and at its center. */
function frame(c: Canvas, isRight: boolean, creep: number, crosshairs: boolean) {
  const { page: o, x, y } = gridAt(isRight, creep);
  c.outline(o.x, o.y, PAGE_W_MM, PAGE_H_MM, HAIR_MM, '#808080');
  c.outline(x, y, GRID_W, GRID_H, BOX_MM);
  if (!crosshairs) return;
  const cross = (cx: number, cy: number, arm: number) => {
    c.line(cx - arm, cy, cx + arm, cy, HAIR_MM);
    c.line(cx, cy - arm, cx, cy + arm, HAIR_MM);
  };
  for (const cx of [x, x + GRID_W]) for (const cy of [y, y + GRID_H]) cross(cx, cy, 3);
  cross(x + GRID_W / 2, y + GRID_H / 2, 2);
}

/** The settings, bottom-aligned inside the box, with any extra lines above them. */
function footer(c: Canvas, book: Book, now: Date, isRight: boolean, creep: number, extra: string[]) {
  const { x, y } = gridAt(isRight, creep);
  const lines = [...extra, ...settingsLines(book, now)];
  lines.forEach((line, i) => c.text(line, x + 0.8, y + GRID_H - 1 - (lines.length - 1 - i) * FOOTER_LEAD_MM, FOOTER_MM));
}

/** A designed page goes through drawPage, so tones, dots and lines print exactly as in a book. */
function content(pdf: PdfPage, fonts: Fonts, book: Book, p: Page, isRight: boolean, dx = 0, dy = 0) {
  const o = pageOrigin(isRight, 0);
  drawPage(pdf, p, { x: o.x + dx, y: o.y + dy, sheetHeight: SHEET_H_MM, fonts, pageNumber: null, expand: (t) => t, tones: tonesOf(book.print) });
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

/** Fold scale: -5 to +5 mm across the fold, 0 where the spread's fold lands; + is to the right as seen on that side. */
export const FOLD_SCALE_Y = GRID_Y_MM + 1.5 * P; // in row 1, which these pages leave free
function foldScale(c: Canvas) {
  scale(c, { x: FOLD_X_MM, y: FOLD_SCALE_Y }, { x: 1, y: 0 }, -SCALE_MM - 1, SCALE_MM + 1, { label: (mm) => (Math.abs(mm) <= SCALE_MM ? String(mm) : null) });
  c.text('fold +', FOLD_X_MM + SCALE_MM + 1.4, FOLD_SCALE_Y + 0.5, FOOTER_MM);
}

const fmt = (mm: number) => String(Math.round(mm * 100) / 100);

/**
 * A ruler in a page's margin that counts mm outward from the box line, so the number where the paper ends is the margin there.
 * The expected margin is marked. `edge` is the side of the page it measures.
 */
function marginRuler(c: Canvas, o: Pt, edge: 'top' | 'bottom' | 'left' | 'right') {
  const x0 = o.x + GRID_X_MM, y0 = o.y + GRID_Y_MM; // the box's top left
  const out = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[edge];
  const from = { top: { x: o.x + PAGE_W_MM / 2, y: y0 }, bottom: { x: o.x + PAGE_W_MM / 2, y: y0 + GRID_H }, left: { x: x0, y: o.y + PAGE_H_MM / 2 }, right: { x: x0 + GRID_W, y: o.y + PAGE_H_MM / 2 } }[edge];
  const horizontal = edge === 'left' || edge === 'right';
  const expected = horizontal ? GRID_X_MM : GRID_Y_MM;
  scale(c, from, out, 0, horizontal ? FORE_EDGE_RULER_MM : GRID_Y_MM, { label: (mm) => fmt(mm), mark: { mm: expected, text: fmt(expected) } });
}

/** The rulers at a page's top and bottom, and at its fore-edge if asked (the outer edge, which is trimmed). */
function pageRulers(c: Canvas, isRight: boolean, creep: number, foreEdge: boolean) {
  const o = pageOrigin(isRight, creep);
  marginRuler(c, o, 'top');
  marginRuler(c, o, 'bottom');
  if (foreEdge) marginRuler(c, o, isRight ? 'right' : 'left');
}

// ---- the alignment sheet -------------------------------------------------------------------------------------

function frontLeft(book: Book): Page {
  const p = book.print;
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
    const at = y + (31 + i) * P + 1.5;
    c.line(x, at, x + 30, at, w);
    c.line(x + 33, at, x + 63, at, w, LINE.hair.c);
    c.text(w.toFixed(2), x + 66, at + 0.8, 2.3);
  });
}

/** The pages of the set that are designed with page elements (the rest is drawn straight on the sheet). */
export const calibrationPages = (book: Book): Page[] => [frontLeft(book), frontRight(), backLeft()];

const backLeft = () => page('left', [
  text(0, 1, 'BACK OF THE SHEET', { style: 'bold' }),
  text(0, 2, 'Fold the sheet in half, edge to'), text(0, 3, 'edge, and crease it hard. Read where'),
  text(0, 4, 'the crease crosses the fold scale,'), text(0, 5, 'and the margin where the paper ends.'),
]);

/** calibration-alignment.pdf: page 1 the front, page 2 the back, each with its own offset. */
async function alignmentPdf(book: Book, fontBytes: FontBytes, now: Date): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  for (const side of ['front', 'back'] as const) {
    const pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
    const off = offsetOf(book.print, side), dx = off.x, dy = -off.y; // +y moves up; sheet y runs down
    const c = sheetCanvas(pdf, fonts, dx, dy);
    if (side === 'front') {
      content(pdf, fonts, book, frontLeft(book), false, dx, dy);
      content(pdf, fonts, book, frontRight(), true, dx, dy);
      ramp(c);
      hairlines(c);
    } else content(pdf, fonts, book, backLeft(), false, dx, dy);
    for (const right of [false, true]) {
      frame(c, right, 0, true);
      pageRulers(c, right, 0, false);
      footer(c, book, now, right, 0, [`${side.toUpperCase()}, ${right ? 'right' : 'left'} page`]);
    }
    foldScale(c);
  }
  return doc.save({ useObjectStreams: false });
}

// ---- creep test and cover ----------------------------------------------------------------------------------

/**
 * creep-test.pdf: both sides of every sheet of the biggest signature, shifted by their creep and by their side's offset, in
 * manual-duplex order: the fronts (last sheet first), then the backs (first sheet first). Page ranges are on every page.
 */
async function creepTestPdf(book: Book, fontBytes: FontBytes, now: Date): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const n = creepSheets(book);
  const sheets: Sheet[] = impose(4 * n, book.print, 1)[0].sheets;
  const [fronts, backs] = duplexOrder(n);
  const order: { sheet: number; side: 'front' | 'back' }[] = [...fronts.map((sheet) => ({ sheet, side: 'front' as const })), ...backs.map((sheet) => ({ sheet, side: 'back' as const }))];
  order.forEach(({ sheet: k, side }, i) => {
    const s = sheets[k], pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
    const off = offsetOf(book.print, side);
    const c = sheetCanvas(pdf, fonts, off.x, -off.y);
    const pass = i < n ? `pass 1: print pages 1-${n}` : `pass 2: print pages ${n + 1}-${2 * n}`;
    for (const right of [false, true]) {
      frame(c, right, s.creep, false);
      const { x, y } = gridAt(right, s.creep);
      const ref = (right ? s[side].right : s[side].left);
      c.text(`SHEET ${k + 1} OF ${n}${k === 0 ? ' (OUTERMOST)' : k === n - 1 ? ' (INNERMOST)' : ''}`, x + 0.8, y + 4, 3.2);
      c.text(`${side.toUpperCase()}, ${right ? 'right' : 'left'} page${ref === null ? '' : ` ${ref}`}`, x + 0.8, y + 8, 3.2);
      c.text(`PDF page ${i + 1} of ${2 * n} (${pass})`, x + 0.8, y + 11, 2);
      pageRulers(c, right, s.creep, true);
      footer(c, book, now, right, s.creep, [`creep test, shifted ${s.creep.toFixed(2)} mm toward the fold`]);
    }
  });
  return doc.save({ useObjectStreams: false });
}

/** calibration-cover.pdf: the inside covers' spread as cover.pdf prints it (front offset), with the box, crosshairs and rulers. */
async function coverPdf(book: Book, fontBytes: FontBytes, now: Date): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const pdf = doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]);
  const off = offsetOf(book.print, 'front');
  const c = sheetCanvas(pdf, fonts, off.x, -off.y);
  for (const right of [false, true]) {
    frame(c, right, 0, true);
    pageRulers(c, right, 0, true);
    footer(c, book, now, right, 0, [right ? 'COVER, inside back cover' : 'COVER, inside front cover']);
  }
  return doc.save({ useObjectStreams: false });
}

// ---- the sets of files ---------------------------------------------------------------------------------------

const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
const txt = (name: string, body: string): ExportedFile => ({ name, bytes: new TextEncoder().encode(body), type: 'text/plain' });

/** Throws if the print settings can't be printed. */
function check(book: Book) {
  const problem = checkPrintSettings(book.print, creepSheets(book));
  if (problem) throw new Error(problem);
}

/** Step 1: calibration-alignment.pdf. */
export async function alignmentFile(book: Book, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile> {
  check(book);
  return pdf(ALIGNMENT_FILE, await alignmentPdf(book, fontBytes, now));
}

/** Step 2: the cover sheet and the creep test, with calibration.txt. */
export async function creepFiles(book: Book, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile[]> {
  check(book);
  return [
    pdf(COVER_FILE, await coverPdf(book, fontBytes, now)),
    pdf(CREEP_FILE, await creepTestPdf(book, fontBytes, now)),
    txt('calibration.txt', calibrationText(book, now)),
  ];
}
