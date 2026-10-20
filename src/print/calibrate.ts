// The calibration set: sheets that show, without printing a whole book, how a printer places and tones the pages.
// Built with the same imposition, page size and drawing code as the book's own print files.
//
//   calibration-first.pdf / calibration-second.pdf  one sheet, printed with the book's manual-duplex method: box, crosshairs,
//       gray ramp, the tones as they print, dots, lines and a hairline strip on the front; box, crosshairs and a millimetre
//       scale on the back (which takes the back offset, like print-second.pdf)
//   creep-test.pdf          one single-sided sheet per sheet of the book's biggest signature, each shifted by its creep
//   calibration-cover.pdf   one single-sided sheet like cover.pdf
//   calibration.txt         the settings that made them
import { GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, COLS, ROWS, PITCH_MM as P, emptyPage, type Page, type PageElement, type Text } from '../format/types';
import type { Book } from '../book/book';
import { FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, checkPrintSettings, creepFor, pageOrigin } from '../book/impose';
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
const BLACK = '#000000';
/** Hairline strip: line widths in mm. 0.12 is the writing lines' weight. */
export const HAIRLINE_WIDTHS = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3] as const;
/** The gray ramp's steps, in percent black. */
export const RAMP_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);
/** The back's scale runs -5 to +5 mm in 0.5 mm ticks. */
export const SCALE_MM = 5;

export { creepSheets, thicknessFromCreepTest };

/** The text of calibration.txt, and of every footer: the settings that made the files. */
export function calibrationText(book: Book, now: Date): string {
  return [
    'Dotwork calibration set',
    '',
    ...settingsLines(book, now),
    '',
    'calibration-first.pdf, calibration-second.pdf: print like print-first and print-second; the second takes the back offset',
    `creep-test.pdf: ${creepSheets(book)} single-sided sheets, one per sheet of the biggest signature`,
    'calibration-cover.pdf: one single-sided sheet, like cover.pdf',
    '',
  ].join('\n');
}

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
    text: (str: string, x: number, y: number, size: number, c = BLACK, align: 'start' | 'middle' = 'start') => {
      const width = fonts.regular.widthOfTextAtSize(str, mmToPt(size));
      pdf.drawText(str, { x: X(x) - (align === 'middle' ? width / 2 : 0), y: Y(y), size: mmToPt(size), font: fonts.regular, color: color(c) });
    },
  };
}
type Canvas = ReturnType<typeof sheetCanvas>;

const page = (side: 'left' | 'right', elements: PageElement[]): Page => ({ ...emptyPage(), name: 'Calibration', identity: '', page_number: false, side, elements });
const text = (x: number, y: number, str: string, more: Partial<Text> = {}): PageElement => ({ type: 'text', x, y, text: str, tone: 'black', ...more });

/** Where a page's content area starts on the sheet. */
const gridAt = (isRight: boolean, creep: number) => {
  const o = pageOrigin(isRight, creep);
  return { page: o, x: o.x + GRID_X_MM, y: o.y + GRID_Y_MM };
};
const GRID_W = COLS * P, GRID_H = ROWS * P;

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

// ---- the front: ramp, tones, dots, lines, hairlines --------------------------------------------------------

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

const frontRight = () => page('right', [
  text(0, 1, 'DOT GRID: small and large dots', { style: 'bold' }),
  { type: 'pattern', pattern: 'dots', x: 0, y: 2, w: 13, h: 6 }, { type: 'pattern', pattern: 'dots', dots: 'large', x: 14, y: 2, w: 13, h: 6 },
  text(0, 9, 'small'), text(14, 9, 'large'),
  text(0, 11, 'RULED LINES: hair, thin, thick', { style: 'bold' }),
  text(0, 12, 'hair (writing lines)'), { type: 'pattern', pattern: 'lines', x: 0, y: 13, w: 27, h: 3 },
  text(0, 17, 'thin'), { type: 'pattern', pattern: 'lines', weight: 'thin', x: 0, y: 18, w: 27, h: 3 },
  text(0, 22, 'thick'), { type: 'pattern', pattern: 'lines', weight: 'thick', x: 0, y: 23, w: 27, h: 3 },
  text(0, 28, 'HAIRLINE WEIGHTS: mm (writing: 0.12)', { style: 'bold' }),
]);

/** Lines of each width, in black and in the light gray of writing lines. */
function hairlines(c: Canvas) {
  const { x, y } = gridAt(true, 0);
  HAIRLINE_WIDTHS.forEach((w, i) => {
    const at = y + (29 + i) * P + 1.5;
    c.line(x, at, x + 30, at, w);
    c.line(x + 33, at, x + 63, at, w, LINE.hair.c);
    c.text(w.toFixed(2), x + 66, at + 0.8, 2.3);
  });
}

/** The pages of the set that are designed with page elements (the rest is drawn straight on the sheet). */
export const calibrationPages = (book: Book): Page[] => [frontLeft(book), frontRight(), backLeft()];

// ---- the back: box, crosshairs and the millimetre scales --------------------------------------------------------

/** Where the two marks and scales sit in the gap between the pages' boxes: the x one above the middle of the sheet, the y one below. */
const MARK_X = { x: FOLD_X_MM, y: SHEET_H_MM / 2 - 20 }, MARK_Y = { x: FOLD_X_MM, y: SHEET_H_MM / 2 + 20 };

/** On the front: a crosshair for each scale, in the gap between the pages' boxes (so nothing else is near them). */
function marks(c: Canvas) {
  for (const [m, name] of [[MARK_X, 'x'], [MARK_Y, 'y']] as const) {
    c.line(m.x - 3.9, m.y, m.x + 3.9, m.y, HAIR_MM); // as wide as the gap between the pages' boxes
    c.line(m.x, m.y - 6, m.x, m.y + 6, HAIR_MM);
    c.text(name, m.x + 1, m.y - 1.2, 1.8);
  }
}

/**
 * On the back: a millimetre scale for each mark, -5 to +5 in 0.5 mm ticks, 0 where the mark would be if the back were exactly
 * right. x runs left to right and y bottom to top, as seen on the back with the page the right way up.
 */
function scales(c: Canvas) {
  const along = (m: { x: number; y: number }, horizontal: boolean) => {
    const at = (mm: number) => (horizontal ? { x: m.x + mm, y: m.y } : { x: m.x, y: m.y - mm });
    const [a, b] = [at(-SCALE_MM - 1), at(SCALE_MM + 1)];
    c.line(a.x, a.y, b.x, b.y, HAIR_MM);
    for (let half = -2 * SCALE_MM; half <= 2 * SCALE_MM; half++) {
      const mm = half / 2, whole = half % 2 === 0, len = whole ? 1.6 : 0.9, p = at(mm);
      if (horizontal) c.line(p.x, p.y - len / 2, p.x, p.y + len / 2, HAIR_MM); else c.line(p.x - len / 2, p.y, p.x + len / 2, p.y, HAIR_MM);
      if (!whole) continue;
      // Labels alternate sides of the line so neighbors don't touch.
      const side = mm % 2 === 0 ? -1 : 1;
      if (horizontal) c.text(String(mm), p.x, p.y + (side < 0 ? -1.5 : 2.6), 1.6, BLACK, 'middle');
      else c.text(String(mm), p.x + side * 2.4, p.y + 0.55, 1.6, BLACK, 'middle');
    }
  };
  along(MARK_X, true);
  along(MARK_Y, false);
  c.text('x +', MARK_X.x + SCALE_MM + 1.5, MARK_X.y + 0.6, 1.8);
  c.text('y +', MARK_Y.x - 1.5, MARK_Y.y - SCALE_MM - 1.8, 1.8);
}

const backLeft = () => page('left', [
  text(0, 1, 'BACK OF THE SHEET', { style: 'bold' }),
  text(0, 2, 'Hold to a light, back toward you,'), text(0, 3, 'right way up. At the fold, read the'),
  text(0, 4, 'front crosshair x on the x scale and'), text(0, 5, 'y on the y scale: right and up are +.'),
  text(0, 6, 'new offset = current offset + reading'),
]);

// ---- the files --------------------------------------------------------------------------------------------------

/** A one-sheet PDF, drawn by `draw`. */
async function oneSheet(fontBytes: FontBytes, draw: (pdf: PdfPage, fonts: Fonts) => void): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  draw(doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]), fonts);
  return doc.save({ useObjectStreams: false });
}

/**
 * calibration-first.pdf and calibration-second.pdf. The second takes the back offset as print-second.pdf does (+x right,
 * +y up), scale and all, so a reading is always relative to the offset in the footer.
 */
async function alignmentPair(book: Book, fontBytes: FontBytes, now: Date): Promise<[Uint8Array, Uint8Array]> {
  const front = await oneSheet(fontBytes, (pdf, fonts) => {
    const c = sheetCanvas(pdf, fonts);
    content(pdf, fonts, book, frontLeft(book), false);
    content(pdf, fonts, book, frontRight(), true);
    ramp(c);
    hairlines(c);
    marks(c);
    for (const right of [false, true]) { frame(c, right, 0, true); footer(c, book, now, right, 0, [`FRONT, ${right ? 'right' : 'left'} page`]); }
  });
  const back = await oneSheet(fontBytes, (pdf, fonts) => {
    const dx = book.print.back_offset_x_mm, dy = -book.print.back_offset_y_mm; // +y moves up; sheet y runs down
    const c = sheetCanvas(pdf, fonts, dx, dy);
    content(pdf, fonts, book, backLeft(), false, dx, dy);
    for (const right of [false, true]) { frame(c, right, 0, true); footer(c, book, now, right, 0, [`BACK, ${right ? 'right' : 'left'} page`]); }
    scales(c);
  });
  return [front, back];
}

/** creep-test.pdf: one single-sided sheet per sheet of the biggest signature, each with the content-area box shifted by its creep. */
async function creepTest(book: Book, fontBytes: FontBytes, now: Date): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(fontBytes);
  const n = creepSheets(book);
  for (let k = 0; k < n; k++) {
    const c = sheetCanvas(doc.addPage([mmToPt(SHEET_W_MM), mmToPt(SHEET_H_MM)]), fonts);
    const creep = creepFor(k, book.print);
    for (const right of [false, true]) {
      frame(c, right, creep, false);
      const { x, y } = gridAt(right, creep);
      c.text(`SHEET ${k + 1} OF ${n}${k === 0 ? ' (OUTERMOST)' : k === n - 1 ? ' (INNERMOST)' : ''}`, x + 0.8, y + 4, 3.2);
      footer(c, book, now, right, creep, [`creep test, shifted ${creep.toFixed(2)} mm toward the fold`]);
    }
  }
  return doc.save({ useObjectStreams: false });
}

/** calibration-cover.pdf: the inside covers' spread as cover.pdf prints it, with the box and crosshairs. */
const coverSheet = (book: Book, fontBytes: FontBytes, now: Date) => oneSheet(fontBytes, (pdf, fonts) => {
  const c = sheetCanvas(pdf, fonts);
  for (const right of [false, true]) { frame(c, right, 0, true); footer(c, book, now, right, 0, [right ? 'COVER, inside back cover' : 'COVER, inside front cover']); }
});

/** The calibration set for a book, as the files that go in the zip. Throws if the paper thickness can't be printed. */
export async function calibrationFiles(book: Book, fontBytes: FontBytes, now = new Date()): Promise<ExportedFile[]> {
  const problem = checkPrintSettings(book.print, creepSheets(book));
  if (problem) throw new Error(problem);
  const pdf = (name: string, bytes: Uint8Array): ExportedFile => ({ name, bytes, type: 'application/pdf' });
  const [first, second] = await alignmentPair(book, fontBytes, now);
  return [
    pdf('calibration-first.pdf', first),
    pdf('calibration-second.pdf', second),
    pdf('creep-test.pdf', await creepTest(book, fontBytes, now)),
    pdf('calibration-cover.pdf', await coverSheet(book, fontBytes, now)),
    { name: 'calibration.txt', bytes: new TextEncoder().encode(calibrationText(book, now)), type: 'text/plain' },
  ];
}
