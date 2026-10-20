// A printer lands the image off by a little on every pass. With manual duplex the sheet is turned over between passes, so a
// per-pass error e shows on the see-through test as 2e. These tests simulate printers on the real PDFs: where do the pages
// end up on the paper, and does the calibration find the offsets that put them in the middle?
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook, setSlot, type Book } from '../src/book/book';
import { offsetsFromReadings, type SideReadings } from '../src/book/alignment';
import { FOLD_X_MM, SHEET_H_MM, SHEET_W_MM } from '../src/book/impose';
import { GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, PITCH_MM, ROWS, emptyPage } from '../src/format/types';
import { exportBookFiles } from '../src/print/export';
import { FOLD_SCALE_Y, SCALE_MM, alignmentFile } from '../src/print/calibrate';
import { readPdf, textPositions, type PageInfo } from './pdf-text';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const GRID_H = ROWS * PITCH_MM;

const texts = textPositions;

/** A book of two sheets whose pages carry a label; sheet 0 (creep 0) carries P8 | P1 on the front and P2 | P7 on the back. */
function book(tweak: (b: Book) => void = () => {}): Book {
  const b = emptyBook(8);
  b.page_numbers = false;
  for (let n = 1; n <= 8; n++) setSlot(b, n, { ...emptyPage(), identity: '', elements: [{ type: 'text', x: 3, y: 10, text: `P${n}` }] });
  tweak(b);
  return b;
}

/** Where a label sits inside its page (x, and y of its baseline), found on the unshifted page file. */
async function labelInset() {
  const files = await exportBookFiles(book(), fontBytes, { signatures: false, cover: false });
  return texts((await readPdf(files.find((f) => f.name === 'pages.pdf')!.bytes))[0])[0];
}

/** A printer: how far it lands the image off on each side, in mm as seen on that side (x right, y up), and how tall the paper is. */
interface Printer { front: { x: number; y: number }; back: { x: number; y: number }; height: number }

/**
 * What the paper shows for sheet 0 of the real print files. Each side is seen as the printer saw it. The back is seen mirrored
 * left to right through the paper (the sheet is turned over), so a back x on the paper is SHEET_W - x. Returns, per side:
 * where the spread's fold lands (x from the left edge of that side) and the margins from the page's box to the paper's top and bottom edge.
 */
async function landed(b: Book, pr: Printer) {
  const files = await exportBookFiles(b, fontBytes);
  const inset = await labelInset();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;
  const side = async (name: string, index: number, e: { x: number; y: number }) => {
    const [l, r] = texts((await readPdf(get(name)))[index]).sort((p, q) => p.x - q.x);
    const fold = (l.x + r.x) / 2 - inset.x + PAGE_W_MM / 2 + e.x;
    const pageTop = l.y - inset.y - e.y; // + y is up and sheet y runs down
    return { fold, top: pageTop + GRID_Y_MM, bottom: pr.height - (pageTop + PAGE_H_MM - GRID_Y_MM) };
  };
  return { front: await side('print-first.pdf', 1, pr.front), back: await side('print-second.pdf', 0, pr.back) };
}

/**
 * What a person reads on the alignment sheet printed by `pr`: the crease on each side's fold scale, and the margin at the
 * top and at the bottom edge (past the ruler's end, 3.85, the extra is measured with a ruler and added).
 */
async function readSheet(b: Book, pr: Printer): Promise<[SideReadings, SideReadings]> {
  const file = await alignmentFile(b, fontBytes);
  const pages = await readPdf(file.bytes);
  const one = (page: PageInfo, e: { x: number; y: number }): SideReadings => {
    const plus = texts(page).find((t) => t.text === 'fold +')!; // drawn at the scale's right end
    const zeroX = plus.x - (SCALE_MM + 1.4); // where the scale's 0 is printed
    const boxTop = plus.y - 0.5 - (FOLD_SCALE_Y - GRID_Y_MM); // the box line the rulers count from
    const top = boxTop - e.y, bottom = pr.height - (boxTop + GRID_H - e.y);
    return {
      fold: Math.round((FOLD_X_MM - (zeroX + e.x)) * 10) / 10, // the crease is at the paper's centre; read to 0.1 mm
      // Past the ruler's end (3.85) the person measures the extra with a ruler and adds it; a margin below 0 means the page is cut off.
      top: top >= 0 ? Math.round(top * 10) / 10 : null,
      bottom: bottom >= 0 ? Math.round(bottom * 10) / 10 : null,
    };
  };
  return [one(pages[0], pr.front), one(pages[1], pr.back)];
}

describe('a printer that is off by e on every pass, with only the back taking an offset', () => {
  for (const e of [0.5, -1.5, 1.5]) {
    it(`e = ${e}: the see-through shows 2e, and correcting all of it on the back aligns the sides but leaves the spread e off the sheet's centre`, async () => {
      const printer: Printer = { front: { x: e, y: 0 }, back: { x: e, y: 0 }, height: SHEET_H_MM };
      const uncorrected = await landed(book(), printer);
      // The back is seen mirrored through the paper, so the sides disagree by 2e, and the front is e off the centre.
      expect(uncorrected.front.fold - (SHEET_W_MM - uncorrected.back.fold)).toBeCloseTo(2 * e, 6);
      expect(uncorrected.front.fold - FOLD_X_MM).toBeCloseTo(e, 6);
      const corrected = await landed(book((b) => { b.print.back_offset_x_mm = -2 * e; }), printer);
      expect(corrected.front.fold).toBeCloseTo(SHEET_W_MM - corrected.back.fold, 6); // front and back line up with each other...
      expect(corrected.front.fold - FOLD_X_MM).toBeCloseTo(e, 6); // ...and both are e off the paper's centre
    });
  }
});

describe('front and back offsets measured against the paper', () => {
  for (const e of [0.5, -1.5, 1.5]) {
    it(`e = ${e} on every pass: a front offset of -e and a back offset of -e put the fold on the paper's centre on both sides`, async () => {
      const printer: Printer = { front: { x: e, y: 0 }, back: { x: e, y: 0 }, height: SHEET_H_MM };
      const fixed = await landed(book((b) => { b.print.front_offset_x_mm = -e; b.print.back_offset_x_mm = -e; }), printer);
      expect(fixed.front.fold).toBeCloseTo(FOLD_X_MM, 6);
      expect(fixed.back.fold).toBeCloseTo(FOLD_X_MM, 6);
      expect(fixed.front.fold).toBeCloseTo(SHEET_W_MM - fixed.back.fold, 6); // so the sides also line up with each other
    });
  }

  it('moves the front and the back separately, +x right and +y up as seen on each side', async () => {
    const none = await landed(book(), { front: { x: 0, y: 0 }, back: { x: 0, y: 0 }, height: SHEET_H_MM });
    const moved = await landed(book((b) => { Object.assign(b.print, { front_offset_x_mm: 0.4, front_offset_y_mm: 0.3, back_offset_x_mm: -0.7, back_offset_y_mm: -0.2 }); }), { front: { x: 0, y: 0 }, back: { x: 0, y: 0 }, height: SHEET_H_MM });
    expect(moved.front.fold - none.front.fold).toBeCloseTo(0.4, 6);
    expect(none.front.top - moved.front.top).toBeCloseTo(0.3, 6); // up: the top margin shrinks
    expect(moved.back.fold - none.back.fold).toBeCloseTo(-0.7, 6);
    expect(moved.back.top - none.back.top).toBeCloseTo(0.2, 6); // down: the top margin grows
  });
});

describe('the calibration finds the offsets: readings from the real alignment sheet, applied to the real print files', () => {
  const cases: [string, Printer][] = [
    ['the same error on both sides', { front: { x: 1.5, y: 0.4 }, back: { x: 1.5, y: 0.4 }, height: SHEET_H_MM }],
    ['different errors, each way', { front: { x: -1.2, y: -0.6 }, back: { x: 2.1, y: 0.9 }, height: SHEET_H_MM }],
    ['a sheet cut 0.8 mm tall', { front: { x: 0.7, y: 0.5 }, back: { x: -0.4, y: -0.3 }, height: SHEET_H_MM + 0.8 }],
    ['a sheet cut 0.6 mm short', { front: { x: 0.3, y: -0.4 }, back: { x: -1.1, y: 0.2 }, height: SHEET_H_MM - 0.6 }],
  ];
  for (const [name, printer] of cases) {
    it(`${name}: after one round the fold is on the paper's centre and the margins are even`, async () => {
      const b = book();
      const [front, back] = await readSheet(b, printer);
      Object.assign(b.print, offsetsFromReadings(b.print, front, back));
      const after = await landed(b, printer);
      for (const side of [after.front, after.back]) {
        expect(Math.abs(side.fold - FOLD_X_MM), 'fold').toBeLessThan(0.06);
        expect(Math.abs(side.top - side.bottom), 'margins differ').toBeLessThan(0.11);
        // Each margin is the expected one, plus half of how far the paper's height is from the page's.
        expect(Math.abs(side.top - (GRID_Y_MM + (printer.height - SHEET_H_MM) / 2)), 'top margin').toBeLessThan(0.06);
      }
    });

    it(`${name}: a second round changes nothing, and the footer says what the sheet was printed with`, async () => {
      const b = book();
      const [f1, b1] = await readSheet(b, printer);
      Object.assign(b.print, offsetsFromReadings(b.print, f1, b1));
      const [f2, b2] = await readSheet(b, printer);
      const again = offsetsFromReadings(b.print, f2, b2);
      for (const k of Object.keys(again) as (keyof typeof again)[]) expect(Math.abs(again[k] - b.print[k]), k).toBeLessThan(0.06);
    });
  }

  it('with only the top margin read, that margin is brought to 3.85 and the sheet’s height is trusted', async () => {
    const printer: Printer = { front: { x: 0, y: 0.5 }, back: { x: 0, y: 0.5 }, height: SHEET_H_MM };
    const b = book();
    const [front, back] = await readSheet(b, printer);
    const next = offsetsFromReadings(b.print, { ...front, bottom: null }, { ...back, bottom: null });
    Object.assign(b.print, next);
    const after = await landed(b, printer);
    expect(after.front.top).toBeCloseTo(GRID_Y_MM, 1);
    expect(after.back.top).toBeCloseTo(GRID_Y_MM, 1);
  });
});
