import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, readBook, setSlot, PRINT_LIMITS, type Book } from '../src/book/book';
import { DEFAULT_PRINT, FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, creepFor, impose, pageOrigin } from '../src/book/impose';
import { GRID_X_MM, PAGE_H_MM, PAGE_W_MM, emptyPage, type Page } from '../src/format/types';
import { blankTokens } from '../src/format/tokens';
import { validatePage } from '../src/format/validate';
import { SHADE_TONES, TEXT_COLORS } from '../src/render';
import { drawPage, mmToPt } from '../src/print/draw';
import { PRINT_TIPS, exportBookFiles, newDocument, summary, type ExportedFile } from '../src/print/export';
import {
  HAIRLINE_WIDTHS, RAMP_STEPS, calibrationFiles, calibrationPages, calibrationText, creepSheets, thicknessFromCreepTest,
} from '../src/print/calibrate';
import { PRINT_LABELS, settingsLines } from '../src/print/settingstext';
import { grayHex, tonesOf } from '../src/print/tones';
import { APP_VERSION } from '../src/version';
import { readPdf } from './pdf-text';

const fontBytes = {
  regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'),
  bold: readFileSync('src/fonts/CourierPrime-Bold.ttf'),
};
const NOW = new Date(2026, 9, 20, 12, 0, 0);
const PT = 72 / 25.4;
const file = (files: ExportedFile[], name: string) => files.find((f) => f.name === name)!;
const decode = (f: ExportedFile) => new TextDecoder().decode(f.bytes);

/** A page with one light shade and one gray label, to see the tones in a PDF. */
const toned = (): Page => ({
  ...emptyPage(), identity: '',
  elements: [
    { type: 'shade', tones: 'LMD', x: 0, y: 2, w: 3, h: 1, every: 1, along: 'columns' },
    { type: 'text', x: 0, y: 5, text: 'gray words' },
  ],
});
const tonedBook = (tweak: (b: Book) => void = () => {}) => {
  const b = emptyBook(8);
  b.page_numbers = false;
  setSlot(b, 1, toned());
  tweak(b);
  return b;
};
/** The 81 x 132 mm content-area boxes a sheet draws (drawn as a path inside a translated space), in sheet mm from the top left. */
const contentBoxes = (content: string) => [...content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) cm\n1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n0 0 m\n0 ([\d.]+) l\n([\d.]+) [\d.]+ l/g)]
  .map((m) => ({ x: +m[1] / PT, w: +m[4] / PT, h: +m[3] / PT, y: SHEET_H_MM - (+m[2] + +m[3]) / PT }))
  .filter((b) => Math.abs(b.w - 81) < 0.01 && Math.abs(b.h - 132) < 0.01);
/** The fill colors a page's content stream sets, as written (pdf-lib writes "r g b rg"). */
const fills = (content: string) => new Set([...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) => m[0]));
const rgOf = (hex: string) => {
  const v = parseInt(hex.slice(1, 3), 16) / 255;
  return `${v} ${v} ${v} rg`;
};

describe('tones', () => {
  it('are a percent of black: 0 is white, 100 is black', () => {
    expect(grayHex(0)).toBe('#ffffff');
    expect(grayHex(100)).toBe('#000000');
    expect(grayHex(50)).toBe('#808080');
  });

  it('default to exactly the grays the editor draws', () => {
    const t = tonesOf(DEFAULT_PRINT);
    expect(t.shade).toEqual(SHADE_TONES);
    expect(t.grayText).toBe(TEXT_COLORS.gray);
  });

  it('leave the default output unchanged: a default book prints the same bytes as drawing with the fixed grays', async () => {
    const book = tonedBook();
    const out = (await readPdf(file(await exportBookFiles(book, fontBytes), 'pages.pdf').bytes))[0];
    const { doc, fonts } = await newDocument(fontBytes);
    drawPage(doc.addPage([mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)]), toned(), { x: 0, y: 0, sheetHeight: PAGE_H_MM, fonts, pageNumber: null, expand: blankTokens });
    const before = (await readPdf(await doc.save({ useObjectStreams: false })))[0];
    expect(out.content).toBe(before.content);
  });

  it('change the colors in the printed PDFs', async () => {
    const book = tonedBook((b) => { b.print.shade_light_pct = 40; b.print.shade_medium_pct = 60; b.print.shade_dark_pct = 80; b.print.gray_text_pct = 70; });
    for (const name of ['pages.pdf', 'print-first.pdf']) {
      const files = await exportBookFiles(book, fontBytes);
      const colors = (await readPdf(file(files, name).bytes)).map((p) => [...fills(p.content)]).flat();
      for (const pct of [40, 60, 80, 70]) expect(colors, `${name} ${pct}%`).toContain(rgOf(grayHex(pct)));
      for (const old of [...Object.values(SHADE_TONES), TEXT_COLORS.gray]) expect(colors, `${name} ${old}`).not.toContain(rgOf(old));
    }
  });

  it('are refused outside 0 to 100, with the path', () => {
    for (const key of ['shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct'] as const) {
      expect(PRINT_LIMITS[key]).toEqual({ min: 0, max: 100 });
      for (const bad of [-1, 101, NaN, '50', null]) {
        const b = emptyBook() as unknown as { print: Record<string, unknown> };
        b.print[key] = bad;
        const r = readBook(JSON.parse(JSON.stringify(b, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v))));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual([`print.${key}`]);
      }
    }
  });

  it('round-trip through the book file', () => {
    const book = emptyBook();
    Object.assign(book.print, { shade_light_pct: 12, shade_medium_pct: 22.5, shade_dark_pct: 35, gray_text_pct: 60, back_offset_x_mm: -0.4, paper_thickness_mm: 0.1 });
    const r = readBook(JSON.parse(JSON.stringify(book)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.print).toEqual(book.print);
  });
});

describe('the settings text', () => {
  it('names every print setting with its value', () => {
    const book = emptyBook();
    Object.assign(book.print, { paper_thickness_mm: 0.11, signatures: 2, back_offset_x_mm: 0.3, back_offset_y_mm: -0.2, shade_light_pct: 7, shade_medium_pct: 15, shade_dark_pct: 27, gray_text_pct: 55 });
    const text = settingsLines(book, NOW).join('\n');
    for (const key of Object.keys(PRINT_LIMITS) as (keyof typeof PRINT_LIMITS)[]) {
      expect(text, key).toContain(`${PRINT_LABELS[key]} ${book.print[key]}`);
    }
    expect(text).toContain(`Dotwork ${APP_VERSION}`);
    expect(text).toContain('2026-10-20');
    expect(text).toContain(`page ${PAGE_W_MM} x ${PAGE_H_MM} mm`);
  });
});

describe('summary.txt in a book export', () => {
  it('lists every print setting used, the page size, version and date, then tips at the end', async () => {
    const book = tonedBook((b) => { Object.assign(b.print, { paper_thickness_mm: 0.12, signatures: 1, back_offset_x_mm: 0.5, back_offset_y_mm: -0.3, shade_light_pct: 8, shade_medium_pct: 16, shade_dark_pct: 30, gray_text_pct: 55 }); });
    const text = decode(file(await exportBookFiles(book, fontBytes), 'summary.txt'));
    for (const key of Object.keys(PRINT_LIMITS) as (keyof typeof PRINT_LIMITS)[]) expect(text, key).toContain(`${PRINT_LABELS[key]} ${book.print[key]}`);
    expect(text).toContain(`Dotwork ${APP_VERSION}`);
    expect(text).toMatch(/\| \d{4}-\d{2}-\d{2} \|/);
    expect(text).toContain(`page ${PAGE_W_MM} x ${PAGE_H_MM} mm`);
    const tips = text.slice(text.indexOf('Tips:'));
    expect(text.trimEnd().endsWith(PRINT_TIPS.at(-1)!)).toBe(true);
    expect(tips).toMatch(/Calibrate/);
    expect(tips).toMatch(/calibration set first/);
    expect(tips).toMatch(/one signature before the whole book/);
    expect(tips).toMatch(/actual size/);
    expect(tips).toMatch(/same paper and printer settings for print-first and print-second/);
  });

  it('is built from the same lines as calibration.txt', () => {
    const book = emptyBook();
    const lines = settingsLines(book, NOW);
    const sig = impose(book.page_count, book.print, 1);
    for (const line of lines) {
      expect(summary(book, sig, [], NOW)).toContain(line);
      expect(calibrationText(book, NOW)).toContain(line);
    }
  });
});

describe('the calibration set for the default book', () => {
  let files: ExportedFile[];
  let ms: number;
  beforeAll(async () => {
    const t = performance.now();
    files = await calibrationFiles(emptyBook(), fontBytes, NOW);
    ms = performance.now() - t;
  });

  it('builds all its files, valid PDFs at the real sheet size, and fast', async () => {
    expect(files.map((f) => f.name)).toEqual(['calibration-first.pdf', 'calibration-second.pdf', 'creep-test.pdf', 'calibration-cover.pdf', 'calibration.txt']);
    for (const f of files.filter((x) => x.name.endsWith('.pdf'))) {
      const doc = await PDFDocument.load(f.bytes);
      const [page] = doc.getPages();
      expect(page.getWidth(), f.name).toBeCloseTo(SHEET_W_MM * PT, 1);
      expect(page.getHeight(), f.name).toBeCloseTo(SHEET_H_MM * PT, 1);
      expect(doc.getPageCount(), f.name).toBe(f.name === 'creep-test.pdf' ? 13 : 1);
    }
    expect(ms).toBeLessThan(5000);
  });

  it('prints the footer on every page of every sheet, the same as calibration.txt', async () => {
    const book = emptyBook();
    const lines = settingsLines(book, NOW);
    for (const name of ['calibration-first.pdf', 'calibration-second.pdf', 'creep-test.pdf', 'calibration-cover.pdf']) {
      for (const sheet of await readPdf(file(files, name).bytes)) {
        // Both pages of the sheet carry the footer.
        for (const line of lines) expect(sheet.strings.filter((s) => s === line), `${name}: ${line}`).toHaveLength(2);
      }
    }
    for (const line of lines) expect(decode(file(files, 'calibration.txt'))).toContain(line);
  });

  it('puts the footer text of a changed book in the PDFs', async () => {
    const book = emptyBook();
    Object.assign(book.print, { paper_thickness_mm: 0.09, signatures: 2, back_offset_x_mm: 0.4, back_offset_y_mm: -0.6, shade_light_pct: 9, gray_text_pct: 62 });
    const made = await calibrationFiles(book, fontBytes, NOW);
    const [sheet] = await readPdf(file(made, 'calibration-second.pdf').bytes);
    for (const line of settingsLines(book, NOW)) expect(sheet.strings).toContain(line);
    expect(sheet.strings.join('\n')).toMatch(/paper thickness 0\.09 mm \| signatures 2/);
    expect(sheet.strings.join('\n')).toMatch(/back offset x 0\.4 mm \| back offset y -0\.6 mm/);
    expect(sheet.strings.join('\n')).toMatch(/light 9 \| medium 13\.7 \| dark 25\.9 \| gray text 62/);
  });

  it('draws the ramp in 5% steps, the three tones and the gray text as they print now', async () => {
    expect(RAMP_STEPS).toHaveLength(21);
    expect(RAMP_STEPS[0]).toBe(0);
    expect(RAMP_STEPS.at(-1)).toBe(100);
    expect(RAMP_STEPS.every((v, i) => v === i * 5)).toBe(true);
    const book = emptyBook();
    Object.assign(book.print, { shade_light_pct: 10, shade_medium_pct: 20, shade_dark_pct: 35, gray_text_pct: 65 });
    const [sheet] = await readPdf(file(await calibrationFiles(book, fontBytes, NOW), 'calibration-first.pdf').bytes);
    const colors = fills(sheet.content);
    for (const pct of RAMP_STEPS) expect(colors, `${pct}%`).toContain(rgOf(grayHex(pct)));
    for (const pct of [10, 20, 35, 65]) expect(colors).toContain(rgOf(grayHex(pct)));
    for (const pct of RAMP_STEPS) expect(sheet.strings).toContain(`${String(pct).padStart(3)}%`);
    expect(sheet.strings).toContain('Gray text 65%: the quick brown fox');
    expect(sheet.strings.filter((t) => t === 'Gray text')).toHaveLength(21); // each ramp step has text in its own gray
    expect(HAIRLINE_WIDTHS).toContain(0.12); // the writing lines' weight is in the strip
  });

  it('has designed pages that follow the page format', () => {
    for (const p of calibrationPages(emptyBook())) expect(validatePage(p), p.side).toEqual([]);
  });

  it('puts a millimetre scale from -5 to +5 on the back only', async () => {
    const [first] = await readPdf(file(files, 'calibration-first.pdf').bytes);
    const [second] = await readPdf(file(files, 'calibration-second.pdf').bytes);
    for (const label of ['-5', '-4', '-3', '-2', '-1', '0', '1', '2', '3', '4', '5']) {
      expect(second.strings.filter((s) => s === label).length, label).toBe(2); // the x scale and the y scale
      expect(first.strings, label).not.toContain(label);
    }
  });

  it('moves everything on the back, and only the back, by the offset (+x right, +y up)', async () => {
    const origin = async (x: number, y: number) => {
      const book = emptyBook();
      book.print.back_offset_x_mm = x; book.print.back_offset_y_mm = y;
      const made = await calibrationFiles(book, fontBytes, NOW);
      const firstOf = async (name: string) => {
        const m = (await readPdf(file(made, name).bytes))[0].content.match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/)!;
        return { x: parseFloat(m[1]) / PT, y: parseFloat(m[2]) / PT };
      };
      return { first: await firstOf('calibration-first.pdf'), second: await firstOf('calibration-second.pdf') };
    };
    const a = await origin(0, 0), b = await origin(1, 0.5);
    expect(b.first).toEqual(a.first);
    expect(b.second.x - a.second.x).toBeCloseTo(1, 2);
    expect(b.second.y - a.second.y).toBeCloseTo(0.5, 2); // PDF y runs up, so up is larger
  });
});

describe('the creep test', () => {
  it('uses the book’s sheet count: the biggest signature', async () => {
    const book = emptyBook(20);
    book.print.signatures = 2; // two signatures of 12 pages
    expect(creepSheets(book)).toBe(3);
    const made = await calibrationFiles(book, fontBytes, NOW);
    const sheets = await readPdf(file(made, 'creep-test.pdf').bytes);
    expect(sheets).toHaveLength(3);
    expect(sheets[0].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(sheets[2].strings).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(creepSheets(emptyBook())).toBe(13);
  });

  it('shifts each sheet’s box toward the fold by the thickness × the sheets outside it', async () => {
    const book = emptyBook(8);
    book.print.paper_thickness_mm = 0.5;
    const sheets = await readPdf(file(await calibrationFiles(book, fontBytes, NOW), 'creep-test.pdf').bytes);
    const left = sheets.map((s) => contentBoxes(s.content)[0].x); // the left page's box is drawn first
    expect(left[1] - left[0]).toBeCloseTo(0.5, 2);
    expect(left[1]).toBeCloseTo(pageOrigin(false, creepFor(1, book.print)).x + GRID_X_MM, 2);
    const right = sheets.map((s) => contentBoxes(s.content)[1].x);
    expect(right[0] - right[1]).toBeCloseTo(0.5, 2); // the right page moves left
  });

  it('turns a measured difference into a thickness, sign and divisor derived from the imposition', () => {
    const sheets = 13, thickness = 0.14;
    // The sheet that really has `real` mm of paper: its pages sit at the code's creep, but its fold has moved k × real toward
    // the trimmed edge. Margin from the box's outer edge to the cut, at sheet k (the cut is PAGE_W from the outermost fold).
    const margin = (set: number, real: number, k: number) => {
      const boxEdge = pageOrigin(false, creepFor(k, { paper_thickness_mm: set })).x + GRID_X_MM; // outer edge of the left page's box
      const cut = FOLD_X_MM - PAGE_W_MM + k * real; // the cut line on sheet k, whose own fold is k × real closer to it
      return boxEdge - cut;
    };
    expect(margin(thickness, thickness, 0)).toBeCloseTo(GRID_X_MM, 6);
    for (const real of [0.08, 0.1, 0.14, 0.17]) {
      const difference = margin(thickness, real, sheets - 1) - margin(thickness, real, 0); // innermost minus outermost
      // Set too high (real < set): the innermost box is farther from the edge, the difference is positive.
      expect(Math.sign(difference)).toBe(Math.sign(thickness - real));
      expect(thicknessFromCreepTest(thickness, sheets, difference)).toBeCloseTo(real, 9);
    }
    expect(thicknessFromCreepTest(0.14, 13, 0)).toBe(0.14);
    // 0.12 mm of difference over 12 gaps is 0.01 mm of thickness.
    expect(0.14 - thicknessFromCreepTest(0.14, 13, 0.12)).toBeCloseTo(0.01, 9);
  });

  it('draws the same content-area box on every page', async () => {
    const sheets = await readPdf(file(await calibrationFiles(emptyBook(8), fontBytes, NOW), 'creep-test.pdf').bytes);
    for (const s of sheets) {
      const boxes = contentBoxes(s.content);
      expect(boxes).toHaveLength(2);
      for (const b of boxes) expect([b.w, b.h]).toEqual([81, 132].map((v) => expect.closeTo(v, 2)));
    }
  });
});

describe('the cover sheet', () => {
  it('has the box and crosshairs of both covers on one sheet, with the same footer', async () => {
    const made = await calibrationFiles(emptyBook(), fontBytes, NOW);
    const [sheet] = await readPdf(file(made, 'calibration-cover.pdf').bytes);
    expect(sheet.strings).toContain('COVER, inside front cover');
    expect(sheet.strings).toContain('COVER, inside back cover');
  });
});

describe('a thickness that cannot be printed', () => {
  it('is refused with the reason, like the print files', async () => {
    const book = emptyBook();
    book.print.paper_thickness_mm = 0.9;
    await expect(calibrationFiles(book, fontBytes, NOW)).rejects.toThrow(/past the fold/);
  });
});
