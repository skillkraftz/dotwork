import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, readBook, setSlot, PRINT_LIMITS, type Book } from '../src/book/book';
import { DEFAULT_PRINT, FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, creepFor, duplexOrder, impose, pageOrigin } from '../src/book/impose';
import { GRID_X_MM, PAGE_H_MM, PAGE_W_MM, emptyPage, type Page } from '../src/format/types';
import { blankTokens } from '../src/format/tokens';
import { validatePage } from '../src/format/validate';
import { SHADE_TONES, TEXT_COLORS } from '../src/render';
import { drawPage, mmToPt } from '../src/print/draw';
import { PRINT_TIPS, exportBookFiles, newDocument, summary, type ExportedFile } from '../src/print/export';
import {
  ALIGNMENT_FILE, COVER_FILE, CREEP_FILE, FORE_EDGE_RULER_MM, FOLD_SCALE_Y, HAIRLINE_WIDTHS, RAMP_STEPS, SCALE_MM, alignmentFile, calibrationPages,
  calibrationText, creepFiles, creepSheets,
} from '../src/print/calibrate';
import { PRINT_LABELS, settingsLines } from '../src/print/settingstext';
import { grayHex, tonesOf } from '../src/print/tones';
import { APP_VERSION } from '../src/version';
import { FLAT } from './flat';
import { readPdf, textPositions } from './pdf-text';

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
  const b = emptyBook(8, FLAT);
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
        const b = emptyBook(52, FLAT) as unknown as { print: Record<string, unknown> };
        b.print[key] = bad;
        const r = readBook(JSON.parse(JSON.stringify(b, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v))));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual([`print.${key}`]);
      }
    }
  });

  it('round-trip through the book file', () => {
    const book = emptyBook(52, FLAT);
    Object.assign(book.print, { shade_light_pct: 12, shade_medium_pct: 22.5, shade_dark_pct: 35, gray_text_pct: 60, back_offset_x_mm: -0.4, creep_per_sheet_mm: 0.1 });
    const r = readBook(JSON.parse(JSON.stringify(book)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.print).toEqual(book.print);
  });
});

describe('the settings text', () => {
  it('names every print setting with its value', () => {
    const book = emptyBook(52, FLAT);
    Object.assign(book.print, { creep_per_sheet_mm: 0.11, signatures: 2, front_offset_x_mm: -0.6, front_offset_y_mm: 0.1, back_offset_x_mm: 0.3, back_offset_y_mm: -0.2, shade_light_pct: 7, shade_medium_pct: 15, shade_dark_pct: 27, gray_text_pct: 55 });
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
    const book = tonedBook((b) => { Object.assign(b.print, { creep_per_sheet_mm: 0.12, signatures: 1, front_offset_x_mm: -0.4, front_offset_y_mm: 0.2, back_offset_x_mm: 0.5, back_offset_y_mm: -0.3, shade_light_pct: 8, shade_medium_pct: 16, shade_dark_pct: 30, gray_text_pct: 55 }); });
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
    expect(tips).toMatch(/best quality/);
    expect(tips).toMatch(/Firefox/);
    expect(tips).toMatch(/CUPS \(localhost:631\)/);
  });

  it('is built from the same lines as calibration.txt', () => {
    const book = emptyBook(52, FLAT);
    const lines = settingsLines(book, NOW);
    const sig = impose(book.page_count, book.print, 1);
    for (const line of lines) {
      expect(summary(book, sig, [], NOW)).toContain(line);
      expect(calibrationText(book, NOW)).toContain(line);
    }
  });
});


const margins = (strings: string[]) => ({ top: strings.filter((t) => t === '3.85').length, fore: strings.filter((t) => t === String(FORE_EDGE_RULER_MM)).length });

describe('the alignment sheet', () => {
  let made: ExportedFile;
  let sheets: Awaited<ReturnType<typeof readPdf>>;
  beforeAll(async () => {
    made = await alignmentFile(emptyBook(52, FLAT), fontBytes, NOW);
    sheets = await readPdf(made.bytes);
  });

  it('is one PDF: page 1 the front, page 2 the back, at the real sheet size', async () => {
    expect(made.name).toBe(ALIGNMENT_FILE);
    expect(ALIGNMENT_FILE).toBe('calibration-alignment.pdf');
    const doc = await PDFDocument.load(made.bytes);
    expect(doc.getPageCount()).toBe(2);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(SHEET_W_MM * PT, 1);
      expect(page.getHeight()).toBeCloseTo(SHEET_H_MM * PT, 1);
    }
    expect(sheets[0].strings).toContain('FRONT, left page');
    expect(sheets[1].strings).toContain('BACK, left page');
  });

  it('prints the settings on both sides of both pages, the same as calibration.txt', () => {
    const lines = settingsLines(emptyBook(52, FLAT), NOW);
    for (const sheet of sheets) for (const line of lines) expect(sheet.strings.filter((s) => s === line), line).toHaveLength(2);
  });

  it('puts the footer text of a changed book in the PDF, offsets of both sides included', async () => {
    const book = emptyBook(52, FLAT);
    Object.assign(book.print, { creep_per_sheet_mm: 0.09, signatures: 2, front_offset_x_mm: -1.5, front_offset_y_mm: 0.3, back_offset_x_mm: 0.4, back_offset_y_mm: -0.6, shade_light_pct: 9, gray_text_pct: 62 });
    const [sheet] = await readPdf((await alignmentFile(book, fontBytes, NOW)).bytes);
    for (const line of settingsLines(book, NOW)) expect(sheet.strings).toContain(line);
    const text = sheet.strings.join('\n');
    expect(text).toMatch(/creep per sheet 0\.09 mm \| signatures 2/);
    expect(text).toMatch(/front offset x -1\.5 mm \| front offset y 0\.3 mm/);
    expect(text).toMatch(/back offset x 0\.4 mm \| back offset y -0\.6 mm/);
    expect(text).toMatch(/light 9 \| medium 13\.7 \| dark 25\.9 \| gray text 62/);
  });

  it('draws the ramp in 5% steps, the three tones and the gray text as they print now, on the front only', async () => {
    expect(RAMP_STEPS).toHaveLength(21);
    expect(RAMP_STEPS[0]).toBe(0);
    expect(RAMP_STEPS.at(-1)).toBe(100);
    expect(RAMP_STEPS.every((v, i) => v === i * 5)).toBe(true);
    const book = emptyBook(52, FLAT);
    Object.assign(book.print, { shade_light_pct: 10, shade_medium_pct: 20, shade_dark_pct: 35, gray_text_pct: 65 });
    const [front, back] = await readPdf((await alignmentFile(book, fontBytes, NOW)).bytes);
    const colors = fills(front.content);
    for (const pct of RAMP_STEPS) expect(colors, `${pct}%`).toContain(rgOf(grayHex(pct)));
    for (const pct of [10, 20, 35, 65]) expect(colors).toContain(rgOf(grayHex(pct)));
    for (const pct of RAMP_STEPS) expect(front.strings).toContain(`${String(pct).padStart(3)}%`);
    expect(front.strings).toContain('Gray text 65%: the quick brown fox');
    expect(front.strings.filter((t) => t === 'Gray text')).toHaveLength(21);
    expect(back.strings).not.toContain('Gray text');
    expect(HAIRLINE_WIDTHS).toContain(0.12);
  });

  it('has designed pages that follow the page format', () => {
    for (const p of calibrationPages(emptyBook(52, FLAT))) expect(validatePage(p), p.side).toEqual([]);
  });

  it('has a scale across the fold on each side, -5 to +5 in whole millimetres, and a ruler at the top and bottom of each page', () => {
    for (const sheet of sheets) {
      for (const label of ['-5', '-4', '-3', '-2', '-1']) expect(sheet.strings.filter((s) => s === label), label).toHaveLength(1);
      expect(sheet.strings.filter((s) => s === 'fold +')).toHaveLength(1);
      expect(margins(sheet.strings).top).toBe(4); // the expected margin, marked: top and bottom of both pages
    }
    expect(SCALE_MM).toBe(5);
  });

  it('moves the front by the front offset and the back by the back offset, each +x right and +y up', async () => {
    const at = async (print: Partial<typeof DEFAULT_PRINT>) => {
      const book = emptyBook(52, FLAT);
      Object.assign(book.print, print);
      const [front, back] = (await readPdf((await alignmentFile(book, fontBytes, NOW)).bytes)).map((p) => textPositions(p).find((t) => t.text === 'fold +')!);
      return { front, back };
    };
    const base = await at({});
    // The scale's right end is drawn at the fold + the scale's half-length + a gap: that is where the fold lands, offset included.
    expect(base.front.x).toBeCloseTo(FOLD_X_MM + SCALE_MM + 1.4, 2);
    expect(base.front.y).toBeCloseTo(FOLD_SCALE_Y + 0.5, 2);
    const moved = await at({ front_offset_x_mm: 1, front_offset_y_mm: 0.5 });
    expect(moved.front.x - base.front.x).toBeCloseTo(1, 2);
    expect(base.front.y - moved.front.y).toBeCloseTo(0.5, 2); // up is toward the top of the sheet
    expect(moved.back).toEqual(base.back);
    const movedBack = await at({ back_offset_x_mm: -0.7, back_offset_y_mm: -0.4 });
    expect(movedBack.back.x - base.back.x).toBeCloseTo(-0.7, 2);
    expect(base.back.y - movedBack.back.y).toBeCloseTo(-0.4, 2);
    expect(movedBack.front).toEqual(base.front);
  });

  it('is refused for a thickness that cannot be printed, with the reason', async () => {
    const book = emptyBook(52, FLAT);
    book.print.creep_per_sheet_mm = 0.9;
    await expect(alignmentFile(book, fontBytes, NOW)).rejects.toThrow(/past the fold/);
    await expect(creepFiles(book, fontBytes, NOW)).rejects.toThrow(/past the fold/);
  });
});

describe('the creep test and the cover sheet', () => {
  let made: ExportedFile[];
  beforeAll(async () => { made = await creepFiles(emptyBook(52, FLAT), fontBytes, NOW); });

  it('are a cover sheet, the creep test and calibration.txt', () => {
    expect(made.map((f) => f.name)).toEqual([COVER_FILE, CREEP_FILE, 'calibration.txt']);
    expect([COVER_FILE, CREEP_FILE]).toEqual(['calibration-cover.pdf', 'creep-test.pdf']);
    const text = decode(file(made, 'calibration.txt'));
    expect(text).toContain('print pages 1 to 13');
    expect(text).toContain('print pages 14 to 26');
    for (const line of settingsLines(emptyBook(52, FLAT), NOW)) expect(text).toContain(line);
  });

  it('has both sides of every sheet of the biggest signature, in manual-duplex order: fronts in reverse, then backs forward', async () => {
    const book = emptyBook(52, FLAT);
    expect(creepSheets(book)).toBe(13);
    const pages = await readPdf(file(made, CREEP_FILE).bytes);
    expect(pages).toHaveLength(26);
    const [fronts, backs] = duplexOrder(13);
    const sheetAndSide = pages.map((p) => {
      const [, k, side] = p.strings.join('|').match(/SHEET (\d+) OF 13.*?\|(FRONT|BACK), left/)!;
      return [Number(k) - 1, side];
    });
    expect(sheetAndSide).toEqual([...fronts.map((k) => [k, 'FRONT']), ...backs.map((k) => [k, 'BACK'])]);
    // The ranges are on every page, as are the sheet's own pages (the imposition's, for 52 pages).
    const sig = impose(52, book.print, 1)[0];
    pages.forEach((p, i) => {
      expect(p.strings).toContain(`PDF page ${i + 1} of 26 (${i < 13 ? 'pass 1: print pages 1-13' : 'pass 2: print pages 14-26'})`);
      const [k, side] = sheetAndSide[i] as [number, 'FRONT' | 'BACK'];
      const s = sig.sheets[k][side === 'FRONT' ? 'front' : 'back'];
      expect(p.strings).toContain(`${side}, left page ${s.left}`);
      expect(p.strings).toContain(`${side}, right page ${s.right}`);
    });
  });

  it('uses the book’s sheet count: the biggest signature', async () => {
    const book = emptyBook(20, FLAT);
    book.print.signatures = 2; // two signatures of 12 pages
    expect(creepSheets(book)).toBe(3);
    const pages = await readPdf(file(await creepFiles(book, fontBytes, NOW), CREEP_FILE).bytes);
    expect(pages).toHaveLength(6);
    expect(pages[0].strings).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(pages[2].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[3].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[0].strings).toContain('PDF page 1 of 6 (pass 1: print pages 1-3)');
    expect(pages[5].strings).toContain('PDF page 6 of 6 (pass 2: print pages 4-6)');
  });

  it('shifts each sheet’s box toward the fold by the thickness × the sheets outside it, on both sides', async () => {
    const book = emptyBook(8, FLAT);
    book.print.creep_per_sheet_mm = 0.5;
    const pages = await readPdf(file(await creepFiles(book, fontBytes, NOW), CREEP_FILE).bytes); // [front 1, front 0, back 0, back 1]
    const left = pages.map((s) => contentBoxes(s.content)[0].x), right = pages.map((s) => contentBoxes(s.content)[1].x);
    expect(left[0] - left[1]).toBeCloseTo(0.5, 2);
    expect(left[3] - left[2]).toBeCloseTo(0.5, 2);
    expect(left[0]).toBeCloseTo(pageOrigin(false, creepFor(1, book.print)).x + GRID_X_MM, 2);
    expect(right[1] - right[0]).toBeCloseTo(0.5, 2); // the right page moves left
  });

  it('moves the creep test’s boxes by the fore-edge shift, and the cover sheet’s by the cover shift, and writes them in the footer and calibration.txt', async () => {
    const flat = emptyBook(8, FLAT), book = emptyBook(8, FLAT);
    Object.assign(book.print, { fore_edge_shift_mm: 1.5, cover_fore_edge_shift_mm: 0.7, target_fore_edge_margin_mm: 3.2 });
    const [a, b] = [await creepFiles(flat, fontBytes, NOW), await creepFiles(book, fontBytes, NOW)];
    const [pa, pb] = [await readPdf(file(a, CREEP_FILE).bytes), await readPdf(file(b, CREEP_FILE).bytes)];
    for (const i of [0, 1, 2, 3]) {
      expect(contentBoxes(pb[i].content)[0].x - contentBoxes(pa[i].content)[0].x, `left ${i}`).toBeCloseTo(-1.5, 2);
      expect(contentBoxes(pb[i].content)[1].x - contentBoxes(pa[i].content)[1].x, `right ${i}`).toBeCloseTo(1.5, 2);
    }
    const [ca, cb] = [await readPdf(file(a, COVER_FILE).bytes), await readPdf(file(b, COVER_FILE).bytes)];
    expect(contentBoxes(cb[0].content)[0].x - contentBoxes(ca[0].content)[0].x).toBeCloseTo(-0.7, 2);
    expect(contentBoxes(cb[0].content)[1].x - contentBoxes(ca[0].content)[1].x).toBeCloseTo(0.7, 2);
    for (const pdfFile of [CREEP_FILE, COVER_FILE]) {
      const text = (await readPdf(file(b, pdfFile).bytes)).flatMap((p) => p.strings).join('\n');
      expect(text).toMatch(/fore-edge shift 1\.5 \| cover shift 0\.7 \| target margin 3\.2 mm/);
    }
    expect(new TextDecoder().decode(file(b, 'calibration.txt').bytes)).toContain('fore-edge shift 1.5 | cover shift 0.7 | target margin 3.2 mm');
  });

  it('applies the front offset to the front pages and the cover, and the back offset to the back pages', async () => {
    const book = emptyBook(8, FLAT);
    Object.assign(book.print, { front_offset_x_mm: 0.4, front_offset_y_mm: 0.2, back_offset_x_mm: -0.6, back_offset_y_mm: -0.3 });
    const flat = emptyBook(8, FLAT);
    const [a, b] = [await creepFiles(flat, fontBytes, NOW), await creepFiles(book, fontBytes, NOW)];
    const [pa, pb] = [await readPdf(file(a, CREEP_FILE).bytes), await readPdf(file(b, CREEP_FILE).bytes)]; // two front pages, then two back pages
    const box = (p: (typeof pa)[number]) => contentBoxes(p.content)[0];
    for (const i of [0, 1]) {
      expect(box(pb[i]).x - box(pa[i]).x, `front ${i}`).toBeCloseTo(0.4, 2);
      expect(box(pa[i]).y - box(pb[i]).y, `front ${i}`).toBeCloseTo(0.2, 2); // up is toward the top
    }
    for (const i of [2, 3]) {
      expect(box(pb[i]).x - box(pa[i]).x, `back ${i}`).toBeCloseTo(-0.6, 2);
      expect(box(pa[i]).y - box(pb[i]).y, `back ${i}`).toBeCloseTo(-0.3, 2);
    }
    const [ca, cb] = [await readPdf(file(a, COVER_FILE).bytes), await readPdf(file(b, COVER_FILE).bytes)];
    expect(box(cb[0]).x - box(ca[0]).x).toBeCloseTo(0.4, 2); // the cover takes the front offset
    expect(box(ca[0]).y - box(cb[0]).y).toBeCloseTo(0.2, 2);
  });

  it('has margin rulers on every page, the cover included: top, bottom and fore-edge, with the expected margin marked', async () => {
    const creep = await readPdf(file(made, CREEP_FILE).bytes), cover = await readPdf(file(made, COVER_FILE).bytes);
    expect(cover).toHaveLength(1);
    for (const p of [...creep, ...cover]) {
      expect(margins(p.strings).top, 'top and bottom of both pages').toBe(4);
      expect(margins(p.strings).fore, 'fore-edge ruler of both pages').toBe(2); // each runs 0 to 7 mm from the box line
    }
    expect(FORE_EDGE_RULER_MM).toBeGreaterThan(GRID_X_MM);
  });

  it('puts the covers’ footer on the cover sheet', async () => {
    const [sheet] = await readPdf(file(made, COVER_FILE).bytes);
    expect(sheet.strings).toContain('COVER, inside front cover');
    expect(sheet.strings).toContain('COVER, inside back cover');
    for (const line of settingsLines(emptyBook(52, FLAT), NOW)) expect(sheet.strings.filter((s) => s === line)).toHaveLength(2);
  });

  it('draws the same content-area box on every page', async () => {
    const pages = await readPdf(file(await creepFiles(emptyBook(8, FLAT), fontBytes, NOW), CREEP_FILE).bytes);
    for (const s of pages) {
      const boxes = contentBoxes(s.content);
      expect(boxes).toHaveLength(2);
      for (const b of boxes) expect([b.w, b.h]).toEqual([81, 132].map((v) => expect.closeTo(v, 2)));
    }
  });
});
