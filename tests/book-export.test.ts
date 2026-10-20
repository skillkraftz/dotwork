import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, setSlot, type Book } from '../src/book/book';
import { FOLD_X_MM, SHEET_W_MM, TRIM_ZONE_MM } from '../src/book/impose';
import { emptyPage, PAGE_H_MM, PAGE_W_MM, type Page } from '../src/format/types';
import { exportBookFiles, type ExportedFile } from '../src/print/export';
import { readPdf } from './pdf-text';

const fonts = {
  regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'),
  bold: readFileSync('src/fonts/CourierPrime-Bold.ttf'),
};
const PT = 72 / 25.4;

/** A page whose only content is its label, set in the middle of the grid. */
const labelled = (label: string): Page => ({
  ...emptyPage(), identity: '', name: label,
  elements: [{ type: 'text', x: 3, y: 10, text: label, size: 'heading' }],
});
const labelledBook = (pages: number, tweak: (b: Book) => void = () => {}): Book => {
  const b = emptyBook(pages);
  b.page_numbers = false;
  for (let n = 1; n <= pages; n++) setSlot(b, n, labelled(`P${n}`));
  tweak(b);
  return b;
};
const file = (files: ExportedFile[], name: string) => files.find((f) => f.name === name)!.bytes;
const names = (files: ExportedFile[]) => files.map((f) => f.name);

describe('print files for 8 pages (journal-system: test_duplex_files)', () => {
  let files: ExportedFile[];
  beforeAll(async () => { files = await exportBookFiles(labelledBook(8), fonts); });

  it('writes fronts in reverse sheet order and backs in forward order', async () => {
    const first = await readPdf(file(files, 'print-first.pdf'));
    const second = await readPdf(file(files, 'print-second.pdf'));
    expect(first.map((p) => p.strings.sort())).toEqual([['P3', 'P6'], ['P1', 'P8']]);
    expect(second.map((p) => p.strings.sort())).toEqual([['P2', 'P7'], ['P4', 'P5']]);
  });

  it('writes every file', () => {
    expect(names(files).sort()).toEqual(['cover.pdf', 'pages.pdf', 'print-first.pdf', 'print-second.pdf', 'summary.txt']);
  });
});

describe('a full 52 page book (journal-system: test_duplex_file_page_counts, test_sheet_size_is_half_letter)', () => {
  let files: ExportedFile[];
  beforeAll(async () => { files = await exportBookFiles(labelledBook(52), fonts); });

  it('has 13 sheets each side, 52 pages and one cover spread', async () => {
    const count = async (name: string) => (await PDFDocument.load(file(files, name))).getPageCount();
    expect(await count('print-first.pdf')).toBe(13);
    expect(await count('print-second.pdf')).toBe(13);
    expect(await count('pages.pdf')).toBe(52);
    expect(await count('cover.pdf')).toBe(1);
  });

  it('prints on half-letter sheets, landscape, and pages at final size', async () => {
    const [sheet] = await readPdf(file(files, 'print-first.pdf'));
    expect(sheet.width).toBeCloseTo(8.5 * 72, 1);
    expect(sheet.height).toBeCloseTo(5.5 * 72, 1);
    const [page] = await readPdf(file(files, 'pages.pdf'));
    expect(page.width).toBeCloseTo(PAGE_W_MM * PT, 1);
    expect(page.height).toBeCloseTo(PAGE_H_MM * PT, 1);
  });

  it('puts pages.pdf in reading order', async () => {
    const pages = await readPdf(file(files, 'pages.pdf'));
    expect(pages.map((p) => p.strings.filter((s) => s.startsWith('P')))).toEqual(
      Array.from({ length: 52 }, (_, i) => [`P${i + 1}`]));
  });

  it('keeps text as text, in an embedded font, and lines as vectors', async () => {
    const doc = await PDFDocument.load(file(files, 'print-first.pdf'));
    const raw = Buffer.from(file(files, 'print-first.pdf')).toString('latin1');
    expect(raw).toContain('/FontFile2');
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{0,6}\+?CourierPrime/);
    expect(raw).not.toContain('/Subtype /Image');
    expect(raw).not.toContain('/Subtype/Image');
    expect(doc.getPageCount()).toBe(13);
  });
});

describe('multiple signatures (journal-system: test_multiple_signatures_pad_with_blanks)', () => {
  it('writes a pair of files per signature and a page on every sheet side it needs', async () => {
    const files = await exportBookFiles(labelledBook(12, (b) => { b.print.signatures = 2; }), fonts);
    expect(names(files)).toEqual(expect.arrayContaining(['sig1-print-first.pdf', 'sig1-print-second.pdf', 'sig2-print-first.pdf', 'sig2-print-second.pdf']));
    const s1 = await readPdf(file(files, 'sig1-print-first.pdf'));
    const s2 = await readPdf(file(files, 'sig2-print-first.pdf'));
    // 12 pages in 2 signatures of 8: pages 1-8, then 9-12 with the filler pages 13-16 left blank
    expect(s1.map((p) => p.strings.sort())).toEqual([['P3', 'P6'], ['P1', 'P8']]);
    expect(s2.map((p) => p.strings.sort())).toEqual([['P11'], ['P9']]);
  });
});

describe('centering, creep and the back offset in the content', () => {
  const numbers = (content: string) => [...content.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+Td|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)];
  const firstTextX = (content: string) => {
    const m = content.match(/(?:1 0 0 1\s+)?(-?[\d.]+)\s+(-?[\d.]+)\s+(?:Tm|Td)/);
    return m ? parseFloat(m[1]) : NaN;
  };

  it('draws no text in the trim zone, even with exaggerated creep', async () => {
    const files = await exportBookFiles(labelledBook(52, (b) => { b.print.paper_thickness_mm = 0.2; }), fonts);
    for (const name of ['print-first.pdf', 'print-second.pdf', 'cover.pdf']) {
      for (const page of await readPdf(file(files, name))) {
        expect(page.content).toMatch(/ re\nW\nn\n/); // each page is clipped to its own box
        for (const m of numbers(page.content)) {
          const x = parseFloat(m[1] ?? m[3]);
          expect(x / PT).toBeGreaterThan(TRIM_ZONE_MM);
          expect(x / PT).toBeLessThan(SHEET_W_MM - TRIM_ZONE_MM);
        }
      }
    }
  });

  it('moves a page toward the fold by its sheet’s creep', async () => {
    const at = async (thickness: number) => {
      const files = await exportBookFiles(labelledBook(8, (b) => { b.print.paper_thickness_mm = thickness; }), fonts);
      const sheets = await readPdf(file(files, 'print-first.pdf')); // [sheet 1, sheet 0]
      return sheets.map((s) => firstTextX(s.content) / PT);
    };
    const flat = await at(0), thick = await at(1);
    expect(thick[1]).toBeCloseTo(flat[1], 2); // sheet 0 is outermost: no creep
    expect(Math.abs(thick[0] - flat[0])).toBeCloseTo(1, 2); // sheet 1 moves 1 mm
  });

  it('shifts each side by its own offset: the front (print-first, cover) by the front offset, the back (print-second) by the back offset', async () => {
    const make = async (print: Partial<Book['print']>) => exportBookFiles(labelledBook(8, (b) => { setSlot(b, 0, labelled('FRONT')); setSlot(b, 9, labelled('BACK')); Object.assign(b.print, print); }), fonts);
    const base = await make({}), front = await make({ front_offset_x_mm: 1, front_offset_y_mm: 2 }), back = await make({ back_offset_x_mm: -1, back_offset_y_mm: -2 });
    const same = (a: ExportedFile[], b: ExportedFile[], name: string) => Buffer.from(file(a, name)).equals(Buffer.from(file(b, name)));
    const pos = (c: string) => c.match(/1 0 0 1\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/)!;
    const moved = async (from: ExportedFile[], to: ExportedFile[], name: string) => {
      const [pa, pb] = [pos((await readPdf(file(from, name)))[0].content), pos((await readPdf(file(to, name)))[0].content)];
      return { x: (parseFloat(pb[1]) - parseFloat(pa[1])) / PT, y: (parseFloat(pb[2]) - parseFloat(pa[2])) / PT };
    };
    // The front offset moves print-first.pdf and cover.pdf (+x right, +y up) and nothing else.
    expect(same(front, base, 'print-second.pdf')).toBe(true);
    expect(same(front, base, 'pages.pdf')).toBe(true);
    for (const name of ['print-first.pdf', 'cover.pdf']) {
      const m = await moved(base, front, name);
      expect([m.x, m.y], name).toEqual([expect.closeTo(1, 2), expect.closeTo(2, 2)]);
    }
    // The back offset moves print-second.pdf and nothing else.
    expect(same(back, base, 'print-first.pdf')).toBe(true);
    expect(same(back, base, 'cover.pdf')).toBe(true);
    const m = await moved(base, back, 'print-second.pdf');
    expect([m.x, m.y]).toEqual([expect.closeTo(-1, 2), expect.closeTo(-2, 2)]);
  });

  it('refuses a creep that would cross the fold', async () => {
    await expect(exportBookFiles(labelledBook(52, (b) => { b.print.paper_thickness_mm = 0.5; }), fonts)).rejects.toThrow(/past the fold/);
  });
});

describe('the cover', () => {
  it('is one centered spread: the inside front cover on the left, the inside back cover on the right', async () => {
    const book = labelledBook(8, (b) => { setSlot(b, 0, labelled('FRONT')); setSlot(b, 9, labelled('BACK')); });
    const [cover] = await readPdf(file(await exportBookFiles(book, fonts), 'cover.pdf'));
    expect(cover.strings.sort()).toEqual(['BACK', 'FRONT']);
    expect(cover.width).toBeCloseTo(SHEET_W_MM * PT, 1);
    expect(FOLD_X_MM * 2).toBeCloseTo(SHEET_W_MM);
  });
});

describe('page numbers', () => {
  it('print by default in the outer corner and are left off on request', async () => {
    const on = await readPdf(file(await exportBookFiles(labelledBook(8, (b) => { b.page_numbers = true; }), fonts), 'pages.pdf'));
    expect(on[4].strings).toContain('5');
    const off = await readPdf(file(await exportBookFiles(labelledBook(8, (b) => { b.page_numbers = false; }), fonts), 'pages.pdf'));
    expect(off[4].strings).not.toContain('5');
  });

  it('leaves date tokens blank for writing in by hand', async () => {
    const book = emptyBook(4);
    setSlot(book, 1, { ...emptyPage(), identity: '{weekday} {month} {day}' });
    const [p1] = await readPdf(file(await exportBookFiles(book, fonts), 'pages.pdf'));
    expect(p1.strings.join('|')).toBe('1');
  });
});
