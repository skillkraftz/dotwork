// A printer that lands the image off by the same amount on every pass, in its own terms. With manual duplex the sheet is
// turned over between passes, so a per-pass error e shows on the see-through test as 2e. This simulates it on the real
// print files: where do the pages end up on the paper?
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook, setSlot, type Book } from '../src/book/book';
import { FOLD_X_MM, SHEET_H_MM, SHEET_W_MM } from '../src/book/impose';
import { PAGE_W_MM, emptyPage } from '../src/format/types';
import { exportBookFiles } from '../src/print/export';
import { readPdf } from './pdf-text';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const PT = 72 / 25.4;

/** Where the two labelled pages of a sheet's side sit, in mm on that PDF page: x of each label and the y of its baseline from the top. */
async function labels(pdf: Uint8Array, index: number) {
  const page = (await readPdf(pdf))[index];
  const runs = [...page.content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => ({ x: +m[1] / PT, y: SHEET_H_MM - +m[2] / PT }));
  runs.sort((a, b) => a.x - b.x);
  return { left: runs[0], right: runs[1] };
}

/** A book of two sheets whose pages carry a label; sheet 0 (creep 0) carries P8 | P1 on the front and P2 | P7 on the back. */
function book(tweak: (b: Book) => void = () => {}): Book {
  const b = emptyBook(8);
  b.page_numbers = false;
  for (let n = 1; n <= 8; n++) setSlot(b, n, { ...emptyPage(), identity: '', elements: [{ type: 'text', x: 3, y: 10, text: `P${n}` }] });
  tweak(b);
  return b;
}

/** How far a label sits inside its own page, found on the unshifted page file. */
async function labelInset() {
  const pages = await exportBookFiles(book(), fontBytes, { signatures: false, cover: false });
  const [p] = await readPdf(pages.find((f) => f.name === 'pages.pdf')!.bytes);
  return +p.content.match(/1 0 0 1 ([\d.-]+) [\d.-]+ Tm/)![1] / PT;
}

/**
 * What the paper shows. The printer lands everything `e` (mm; x right, y up, as the printer sees the sheet) off, on every
 * pass. The front is seen as the printer saw it. The back is seen mirrored left to right through the paper (the sheet is
 * turned over), so a back x on the paper is SHEET_W - x. Returns, in the FRONT's frame (x from the left, y down from the top edge):
 * the fold of the spread on each side and the top of its pages.
 */
async function onPaper(b: Book, e: { x: number; y: number }) {
  const files = await exportBookFiles(b, fontBytes);
  const inset = await labelInset();
  const get = (name: string) => files.find((f) => f.name === name)!.bytes;
  const front = await labels(get('print-first.pdf'), 1); // sheet 0 is last in print-first
  const back = await labels(get('print-second.pdf'), 0);
  const frontFold = (front.left.x + front.right.x) / 2 - inset + PAGE_W_MM / 2 + e.x; // between the pages' origins, then to the fold
  const backFoldOwn = (back.left.x + back.right.x) / 2 - inset + PAGE_W_MM / 2 + e.x; // in the back's own frame
  return {
    frontFold,
    backFold: SHEET_W_MM - backFoldOwn, // seen from the front
    frontTop: front.left.y - e.y,
    backTop: back.left.y - e.y,
  };
}

describe('a printer that is off by e on every pass (the current code: only the back takes an offset)', () => {
  for (const e of [0.5, -1.5, 1.5]) {
    it(`e = ${e}: the see-through shows 2e, and correcting all of it on the back aligns the sides but leaves the spread e off the sheet's centre`, async () => {
      const uncorrected = await onPaper(book(), { x: e, y: 0 });
      // The two sides disagree by 2e (the reading on the see-through test), and the front is e off the centre.
      expect(uncorrected.frontFold - uncorrected.backFold).toBeCloseTo(2 * e, 6);
      expect(uncorrected.frontFold - FOLD_X_MM).toBeCloseTo(e, 6);

      // The owner reads 2e on the see-through scale and enters it as the back offset (+x moves the back right, as seen on the back).
      const corrected = await onPaper(book((b) => { b.print.back_offset_x_mm = -2 * e; }), { x: e, y: 0 });
      expect(corrected.frontFold).toBeCloseTo(corrected.backFold, 6); // front and back line up with each other...
      expect(corrected.frontFold - FOLD_X_MM).toBeCloseTo(e, 6); // ...and both are e off the paper's centre
    });
  }
});
