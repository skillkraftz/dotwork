import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, setSlot, PRINT_LIMITS, type Book } from '../src/book/book';
import { DEFAULT_PRINT, SHEET_H_MM, SHEET_W_MM, clonePrint, creepFor, impose, pageOrigin, type PrintSettings } from '../src/book/impose';
import { FOLD_FROM_CENTRE_MM, FOLD_HOW, LINE_MM, MARK_CLEAR_MM, markZone, crosshairs, foldScales, scaleCaptions, sheetHeight, type MarkName } from '../src/book/alignment';
import { PRINTER_KEYS, readPrinter } from '../src/printer';
import { sheetSize } from '../src/print/sheets';
import { GRID_X_MM, PAGE_H_MM, PAGE_W_MM, emptyPage, type Page } from '../src/format/types';
import { blankTokens } from '../src/format/tokens';
import { validatePage } from '../src/format/validate';
import { SHADE_TONES, TEXT_COLORS } from '../src/render';
import { drawPage, mmToPt } from '../src/print/draw';
import { PRINT_TIPS, exportBookFiles, newDocument, summary, type ExportedFile } from '../src/print/export';
import {
  COVER_FILE, CREEP_FILE, FORE_EDGE_RULER_MM, HAIRLINE_WIDTHS, LADDER_MM, LADDER_PCT, PAIR_WIDTHS, RAMP_STEPS, SCALE_MM, SHEET_FILE, calibrationPages, calibrationText, creepFiles, creepPages, creepSheets, sheetFile,
} from '../src/print/calibrate';
import { PRINT_LABELS, settingsLines } from '../src/print/settingstext';
import { grayHex, tonesOf } from '../src/print/tones';
import { APP_VERSION } from '../src/version';
import { FLAT, flatTwoUp, setPrint } from './flat';
import { readPdf, segments, strokes, textMatrices, textPositions } from './pdf-text';

const fontBytes = {
  regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'),
  bold: readFileSync('src/fonts/CourierPrime-Bold.ttf'),
};
const NOW = new Date(2026, 9, 20, 12, 0, 0);
/** The flat printer profile with some settings changed (the offsets, rotation and scale go to the selected layout). */
const P = (change: Parameters<typeof setPrint>[1] = {}): PrintSettings => { const p = clonePrint(FLAT); setPrint(p, change); return p; };
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
/** The 81 x 132 mm content-area boxes a sheet draws (four strokes), in sheet mm from the top left: found by their top edge and the left edge under it. */
const contentBoxes = (content: string, height = SHEET_H_MM) => {
  const segs = segments(content, height);
  return segs.filter((h) => Math.abs(h.y1 - h.y2) < 0.001 && Math.abs(Math.abs(h.x2 - h.x1) - 81) < 0.01)
    .map((h) => ({ x: Math.min(h.x1, h.x2), y: h.y1, w: 81, h: 132 }))
    .filter((b) => segs.some((v) => Math.abs(v.x1 - b.x) < 0.001 && Math.abs(v.x2 - b.x) < 0.001 && Math.abs(Math.abs(v.y2 - v.y1) - 132) < 0.01 && Math.abs(Math.min(v.y1, v.y2) - b.y) < 0.001));
};
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
    const out = (await readPdf(file(await exportBookFiles(book, FLAT, fontBytes), 'pages.pdf').bytes))[0];
    const { doc, fonts } = await newDocument(fontBytes);
    drawPage(doc.addPage([mmToPt(PAGE_W_MM), mmToPt(PAGE_H_MM)]), toned(), { x: 0, y: 0, sheetHeight: PAGE_H_MM, fonts, pageNumber: null, expand: blankTokens });
    const before = (await readPdf(await doc.save({ useObjectStreams: false })))[0];
    expect(out.content).toBe(before.content);
  });

  it('change the colors in the printed PDFs', async () => {
    const book = tonedBook(), print = P({ shade_light_pct: 40, shade_medium_pct: 60, shade_dark_pct: 80, gray_text_pct: 70 });
    for (const name of ['pages.pdf', 'print-first.pdf']) {
      const files = await exportBookFiles(book, print, fontBytes);
      const colors = (await readPdf(file(files, name).bytes)).map((p) => [...fills(p.content)]).flat();
      for (const pct of [40, 60, 80, 70]) expect(colors, `${name} ${pct}%`).toContain(rgOf(grayHex(pct)));
      for (const old of [...Object.values(SHADE_TONES), TEXT_COLORS.gray]) expect(colors, `${name} ${old}`).not.toContain(rgOf(old));
    }
  });

  it('are refused outside 0 to 100, with the path', () => {
    for (const key of ['shade_light_pct', 'shade_medium_pct', 'shade_dark_pct', 'gray_text_pct'] as const) {
      expect(PRINT_LIMITS[key]).toEqual({ min: 0, max: 100 });
      for (const bad of [-1, 101, NaN, '50', null]) {
        const r = readPrinter(JSON.parse(JSON.stringify({ ...FLAT, [key]: bad }, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? null : v))));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual([key]);
      }
    }
  });

  it('round-trip through the printer profile', () => {
    const print = P({ creep_per_sheet_mm: 0.1, shade_light_pct: 12, shade_medium_pct: 22.5, shade_dark_pct: 35, gray_text_pct: 60, back_offset_x_mm: -0.4, back_rotation_deg: 0.25 });
    expect([...PRINTER_KEYS]).toContain('shade_light_pct');
    const r = readPrinter(JSON.parse(JSON.stringify(print)));
    expect(r.ok && r.value).toEqual(print);
  });
});

describe('the settings text', () => {
  it('names every print setting with its value', () => {
    const print = P({ creep_per_sheet_mm: 0.11, front_offset_x_mm: -0.6, front_offset_y_mm: 0.1, back_offset_x_mm: 0.3, back_offset_y_mm: -0.2, back_rotation_deg: 0.15, shade_light_pct: 7, shade_medium_pct: 15, shade_dark_pct: 27, gray_text_pct: 55 });
    const text = settingsLines(print, NOW, 2).join('\n');
    for (const key of Object.keys(PRINT_LIMITS) as (keyof typeof PRINT_LIMITS)[]) {
      expect(text, key).toContain(`${PRINT_LABELS[key]} ${key === 'signatures' ? 2 : print[key]}`);
    }
    expect(text).toContain('back rotation 0.15°');
    expect(text).toContain(`Dotwork ${APP_VERSION}`);
    expect(text).toContain('2026-10-20');
    expect(text).toContain(`page ${PAGE_W_MM} x ${PAGE_H_MM} mm`);
  });
});

describe('summary.txt in a book export', () => {
  it('lists every print setting used, the page size, version and date, then tips at the end', async () => {
    const book = tonedBook(), print = P({ creep_per_sheet_mm: 0.12, front_offset_x_mm: -0.4, front_offset_y_mm: 0.2, back_offset_x_mm: 0.5, back_offset_y_mm: -0.3, shade_light_pct: 8, shade_medium_pct: 16, shade_dark_pct: 30, gray_text_pct: 55 });
    const text = decode(file(await exportBookFiles(book, print, fontBytes), 'summary.txt'));
    for (const key of Object.keys(PRINT_LIMITS) as (keyof typeof PRINT_LIMITS)[]) expect(text, key).toContain(`${PRINT_LABELS[key]} ${key === 'signatures' ? book.print.signatures : print[key]}`);
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
    const book = emptyBook(52);
    const sig = impose(book.page_count, FLAT, 1);
    for (const line of settingsLines(FLAT, NOW, 1)) expect(summary({ top: book, bottom: book }, FLAT, sig, [], NOW)).toContain(line);
    for (const line of settingsLines(FLAT, NOW)) expect(calibrationText(book, FLAT, NOW)).toContain(line);
  });
});


const margins = (strings: string[]) => ({ top: strings.filter((t) => t === '3.85').length, fore: strings.filter((t) => t === String(FORE_EDGE_RULER_MM)).length });

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

for (const layout of ['half_letter', 'letter_two_up'] as const) {
  describe(`the calibration sheet, ${layout}`, () => {
    const print = layout === 'letter_two_up' ? flatTwoUp() : clonePrint(FLAT);
    const H = sheetHeight(layout), twoUp = layout === 'letter_two_up';
    let made: ExportedFile;
    let sheets: Awaited<ReturnType<typeof readPdf>>;
    beforeAll(async () => {
      made = await sheetFile(emptyBook(52), print, fontBytes, NOW);
      sheets = await readPdf(made.bytes);
    });

    it('is one PDF, double-sided: page 1 the front, page 2 the back, on the whole paper at the real sheet size, with no halves, labels or cut marks', async () => {
      expect(made.name).toBe(SHEET_FILE);
      expect(SHEET_FILE).toBe('calibration-sheet.pdf');
      const doc = await PDFDocument.load(made.bytes);
      expect(doc.getPageCount()).toBe(2);
      for (const page of doc.getPages()) {
        expect(page.getWidth()).toBeCloseTo(SHEET_W_MM * PT, 1);
        expect(page.getHeight()).toBeCloseTo(H * PT, 1);
      }
      expect(H).toBeCloseTo(twoUp ? 279.4 : 139.7, 9);
      expect(sheets[0].strings).toContain('SIDE 1 (FRONT)');
      expect(sheets[1].strings).toContain('SIDE 2: MEASURE');
      for (const sheet of sheets) expect(sheet.strings.filter((t) => /^Book \d/.test(t))).toEqual([]);
    });

    it('prints the settings once on side 1, the same as calibration.txt', () => {
      for (const line of settingsLines(print, NOW)) expect(sheets[0].strings.filter((s) => s === line), line).toHaveLength(1);
    });

    it('draws the ramp in 5% steps, the three tones and the gray text as they print now, on side 1 only', async () => {
      expect(RAMP_STEPS).toHaveLength(21);
      expect(RAMP_STEPS.every((v, i) => v === i * 5)).toBe(true);
      const own = P({ shade_light_pct: 10, shade_medium_pct: 20, shade_dark_pct: 35, gray_text_pct: 65 });
      own.sheet_layout = layout;
      const [front, back] = await readPdf((await sheetFile(emptyBook(52), own, fontBytes, NOW)).bytes);
      const colors = fills(front.content);
      for (const pct of RAMP_STEPS) expect(colors, `${pct}%`).toContain(rgOf(grayHex(pct)));
      for (const pct of [10, 20, 35, 65]) expect(colors).toContain(rgOf(grayHex(pct)));
      for (const pct of RAMP_STEPS) expect(front.strings).toContain(`${String(pct).padStart(3)}%`);
      expect(front.strings.filter((t) => t === 'Gray text')).toHaveLength(21);
      expect(back.strings).not.toContain('Gray text');
      expect(HAIRLINE_WIDTHS).toContain(0.12);
    });

    it('has, on side 1, pairs of identical lines at 0.12, 0.25 and 0.35 mm, one along each paper edge and labelled, and a ladder beside a 0.35 mm line along the other edge', () => {
      expect(PAIR_WIDTHS).toEqual([0.12, 0.25, 0.35]);
      expect(LADDER_PCT).toEqual([85, 90, 95, 100]);
      expect(LADDER_MM).toBe(0.35);
      const front = sheets[0], all = strokes(front.content, H), horizontal = all.filter((s) => Math.abs(s.y1 - s.y2) < 0.001), vertical = all.filter((s) => Math.abs(s.x1 - s.x2) < 0.001);
      expect(front.strings).toContain('LINE WEIGHT BY DIRECTION');
      expect(front.strings).toContain(twoUp ? '11 in' : '5.5 in'); // the paper's edges, named
      expect(front.strings).toContain('8.5 in');
      for (const w of PAIR_WIDTHS) {
        expect(front.strings, `${w}`).toContain(`${w.toFixed(2)} mm`);
        const along = horizontal.filter((s) => near(s.w, w)), across = vertical.filter((s) => near(s.w, w));
        // A pair: one stroke along the 8.5 in edge and one across, identical but for their direction.
        expect(along.some((a) => across.some((b) => Math.abs(Math.abs(a.x2 - a.x1) - 11) < 0.01 && Math.abs(Math.abs(b.y2 - b.y1) - 8) < 0.01)), `pair ${w}`).toBe(true);
      }
      // The ladder: 85, 90, 95 and 100 % of 0.35 mm along the 8.5 in edge, each labelled, and one 0.35 mm line along the other.
      for (const pct of LADDER_PCT) {
        expect(front.strings).toContain(`${pct}%`);
        expect(horizontal.some((s) => Math.abs(s.w - (LADDER_MM * pct) / 100) < 0.0005 && Math.abs(Math.abs(s.x2 - s.x1) - 11) < 0.01), `ladder ${pct}`).toBe(true);
      }
      expect(vertical.some((s) => near(s.w, LADDER_MM) && Math.abs(Math.abs(s.y2 - s.y1) - 17) < 0.01)).toBe(true);
      expect(front.strings.some((t) => t.startsWith('LADDER'))).toBe(true);
    });

    it('says the drawn width next to each pair, and 80 % and 90 % give different widths in the PDF', async () => {
      const at = async (pct: number) => {
        const own = clonePrint(print);
        own.layouts[layout].line_weight_x_pct = pct;
        const [front] = await readPdf((await sheetFile(emptyBook(52), own, fontBytes, NOW)).bytes);
        const wide = strokes(front.content, H).filter((s) => Math.abs(s.y1 - s.y2) < 0.001 && Math.abs(Math.abs(s.x2 - s.x1) - 11) < 0.01 && s.y1 < 40 && PAIR_WIDTHS.some((w) => Math.abs(s.w - w * pct / 100) < 0.0005)); // the pairs, above the ladder
        return { front, widths: wide.map((s) => +s.w.toFixed(4)) };
      };
      const [a80, a90, a100] = [await at(80), await at(90), await at(100)];
      expect(a80.widths).toEqual([0.096, 0.2, 0.28]);
      expect(a90.widths).toEqual([0.108, 0.225, 0.315]);
      expect(a100.widths).toEqual([0.12, 0.25, 0.35]);
      expect(a80.widths).not.toEqual(a90.widths);
      for (const [pct, r] of [[80, a80], [90, a90], [100, a100]] as const) {
        for (const w of PAIR_WIDTHS) {
          expect(r.front.strings, `${pct} ${w}`).toContain(`drawn ${(w * pct / 100).toFixed(3)} mm`);
          expect(r.front.strings).toContain(`other ${w.toFixed(3)} mm`); // the other edge's line is as drawn
        }
      }
    });

    it('draws the pairs with the line weight setting but never the ladder, so the ladder always shows the same steps', async () => {
      const own = clonePrint(print);
      own.layouts[layout].line_weight_x_pct = 90;
      const [front] = await readPdf((await sheetFile(emptyBook(52), own, fontBytes, NOW)).bytes);
      const all = strokes(front.content, H);
      const along = (w: number) => all.some((s) => Math.abs(s.y1 - s.y2) < 0.001 && Math.abs(Math.abs(s.x2 - s.x1) - 11) < 0.01 && Math.abs(s.w - w) < 0.0005);
      const across = (w: number) => all.some((s) => Math.abs(s.x1 - s.x2) < 0.001 && Math.abs(Math.abs(s.y2 - s.y1) - 8) < 0.01 && Math.abs(s.w - w) < 0.0005);
      for (const w of PAIR_WIDTHS) {
        expect(along(w * 0.9), `along ${w}`).toBe(true); // thinned by the setting
        expect(across(w), `across ${w}`).toBe(true); // as drawn
      }
      for (const pct of LADDER_PCT) expect(along((LADDER_MM * pct) / 100), `ladder ${pct}`).toBe(true);
    });

    it('has designed pages that follow the page format', () => {
      for (const p of calibrationPages(print)) expect(validatePage(p), p.side).toEqual([]);
    });

    it('has a fine + at all five marks on side 1: 0.2 mm lines, 6 mm across, and no scales', () => {
      const at = crosshairs(layout), segs = segments(sheets[0].content, H);
      for (const [name, p] of Object.entries(at)) {
        expect(segs.some((s) => near(s.y1, p.y) && near(s.y2, p.y) && near(s.x1, p.x - 3) && near(s.x2, p.x + 3)), `${name} horizontal`).toBe(true);
        expect(segs.some((s) => near(s.x1, p.x) && near(s.x2, p.x) && near(s.y1, p.y - 3) && near(s.y2, p.y + 3)), `${name} vertical`).toBe(true);
      }
      expect(segs.filter((s) => near(Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 6))).toHaveLength(10);
      expect(sheets[0].content).toMatch(/\n0\.56\d* w\n/);
      for (const label of ['-5', '-4', '-3', '-2', '-1']) expect(sheets[0].strings).not.toContain(label);
      expect(sheets[0].strings.filter((t) => /see-through|edge should/.test(t))).toEqual([]);
    });

    it('has the marks 8 mm from each edge and at the centre of the whole paper', () => {
      const at = crosshairs(layout);
      expect(at.top).toEqual({ x: SHEET_W_MM / 2, y: 8 });
      expect(at.bottom).toEqual({ x: SHEET_W_MM / 2, y: H - 8 });
      expect(at.left).toEqual({ x: 8, y: H / 2 });
      expect(at.right).toEqual({ x: SHEET_W_MM - 8, y: H / 2 });
      expect(at.centre).toEqual({ x: SHEET_W_MM / 2, y: H / 2 });
    });

    it('has a see-through scale at each edge mark on side 2 (-5 to +5, ticks every 0.5 mm, running parallel to the edge) and only a + at the centre', () => {
      const back = sheets[1], segs = segments(back.content, H), at = crosshairs(layout);
      expect(SCALE_MM).toBe(5);
      for (const label of ['-5', '-4', '-3', '-2', '-1', '1', '3', '5']) expect(back.strings.filter((s) => s === label), label).toHaveLength(8); // four see-through and four fold scales
      for (const p of [at.top, at.bottom]) {
        expect(segs.some((s) => near(s.y1, p.y) && near(s.y2, p.y) && near(s.x1, p.x - 5.5) && near(s.x2, p.x + 5.5)), 'x scale').toBe(true);
        // 21 ticks across it, one every 0.5 mm.
        expect(segs.filter((s) => near(s.x1, s.x2) && Math.abs(s.x1 - p.x) <= 5.01 && Math.abs((s.y1 + s.y2) / 2 - p.y) < 0.01 && Math.abs(s.y2 - s.y1) < 3.1)).toHaveLength(21);
      }
      for (const p of [at.left, at.right]) {
        expect(segs.some((s) => near(s.x1, p.x) && near(s.x2, p.x) && near(s.y1, p.y + 5.5) && near(s.y2, p.y - 5.5)), 'y scale').toBe(true);
        expect(segs.filter((s) => near(s.y1, s.y2) && Math.abs(s.y1 - p.y) <= 5.01 && Math.abs((s.x1 + s.x2) / 2 - p.x) < 0.01 && Math.abs(s.x2 - s.x1) < 3.1)).toHaveLength(21);
      }
      // The centre: a + and nothing else within its 10 mm.
      const c = at.centre;
      expect(segs.some((s) => near(s.y1, c.y) && near(s.y2, c.y) && near(s.x1, c.x - 3) && near(s.x2, c.x + 3))).toBe(true);
      expect(segs.filter((s) => Math.hypot((s.x1 + s.x2) / 2 - c.x, (s.y1 + s.y2) / 2 - c.y) < 12)).toHaveLength(2);
    });

    it('has no edge rulers: nothing on side 2 runs to the paper’s edge', () => {
      const back = sheets[1];
      expect(back.strings.filter((t) => /edge should|edge distance/.test(t))).toEqual([]);
      for (const s of segments(back.content, H)) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) expect(Math.min(x, SHEET_W_MM - x, y, H - y)).toBeGreaterThanOrEqual(5);
    });

    it('has two fold scales across each centre line, 38 mm from the centre +: -5 to +5, ticks every 0.5 mm, labelled, 0 longer, and told how to use', () => {
      const back = sheets[1], segs = segments(back.content, H), f = foldScales(layout), cap = scaleCaptions(layout);
      expect(FOLD_FROM_CENTRE_MM).toBeGreaterThanOrEqual(25);
      for (const [name, p] of Object.entries(f)) {
        const up = name === 'left' || name === 'right'; // across the horizontal centre line: they run up the sheet
        expect(Math.hypot(p.x - SHEET_W_MM / 2, p.y - H / 2), name).toBeGreaterThanOrEqual(25);
        expect(up ? near(p.y, H / 2) : near(p.x, SHEET_W_MM / 2), name).toBe(true);
        // The line, -5 to +5.
        expect(segs.some((s) => (up ? near(s.x1, p.x) && near(s.x2, p.x) && near(Math.min(s.y1, s.y2), p.y - 5) && near(Math.max(s.y1, s.y2), p.y + 5)
          : near(s.y1, p.y) && near(s.y2, p.y) && near(Math.min(s.x1, s.x2), p.x - 5) && near(Math.max(s.x1, s.x2), p.x + 5))), `${name} line`).toBe(true);
        // 21 ticks across it, one every 0.5 mm, and the one at 0 is the longest.
        const ticks = segs.filter((s) => (up ? near(s.y1, s.y2) && Math.abs(s.x1 - p.x) < 1.6 && Math.abs(s.y1 - p.y) <= 5.01 : near(s.x1, s.x2) && Math.abs(s.y1 - p.y) < 1.6 && Math.abs(s.x1 - p.x) <= 5.01)
          && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 3.1 && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.8);
        expect(ticks, name).toHaveLength(21);
        expect(Math.max(...ticks.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)))).toBeCloseTo(3, 1);
      }
      for (const text of [cap.hFoldLeft, cap.hFoldRight, cap.vFoldTop, cap.vFoldBottom]) expect(back.strings, text).toContain(text);
      // The instructions say how to fold and which way is +, in one run of words (as the wizard says it).
      const words = back.strings.join(' ').replace(/\s+/g, ' ');
      expect(words).toContain('SIDE 2: MEASURE');
      for (const line of FOLD_HOW.match(/.{1,60}(\s|$)/g)!) expect(words.replace(/ /g, ''), line).toContain(line.trim().replace(/ /g, '').slice(0, 20));
      expect(words).toContain('+ is up and right, as seen on this side');
    });

    it('names the paper’s edges of the layout everywhere, in the words of the readings, never across and down', () => {
      const cap = scaleCaptions(layout), edge = twoUp ? '11 in' : '5.5 in';
      expect([cap.top, cap.bottom, cap.left, cap.right]).toEqual(['see-through top x', 'see-through bottom x', 'see-through left y', 'see-through right y']);
      expect(cap.longX).toBe('parallel to the 8.5 in edge: should measure 100.0 mm');
      expect(cap.longY).toBe(`parallel to the ${edge} edge: should measure 100.0 mm`);
      for (const text of [cap.top, cap.bottom, cap.left, cap.right, cap.longX, cap.longY]) expect(sheets[1].strings, text).toContain(text);
      for (const sheet of sheets) for (const s of sheet.strings) expect(s.toLowerCase(), s).not.toMatch(/across|\bdown\b|190|260/);
    });

    it('has two 100.0 mm lines with end ticks on side 2, one parallel to each paper edge, and no 190, 260 mm lines', () => {
      const segs = segments(sheets[1].content, H);
      expect(LINE_MM).toBe(100);
      const horizontal = segs.filter((s) => near(s.y1, s.y2) && near(Math.abs(s.x2 - s.x1), 100)), vertical = segs.filter((s) => near(s.x1, s.x2) && near(Math.abs(s.y2 - s.y1), 100));
      expect(horizontal).toHaveLength(1);
      expect(vertical).toHaveLength(1);
      // An end tick at each end, across the line.
      for (const h of horizontal) for (const x of [h.x1, h.x2]) expect(segs.some((s) => near(s.x1, x) && near(s.x2, x) && near(Math.abs(s.y2 - s.y1), 5) && near((s.y1 + s.y2) / 2, h.y1))).toBe(true);
      for (const v of vertical) for (const y of [v.y1, v.y2]) expect(segs.some((s) => near(s.y1, y) && near(s.y2, y) && near(Math.abs(s.x2 - s.x1), 5) && near((s.x1 + s.x2) / 2, v.x1))).toBe(true);
      expect(segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 100.5)).toEqual([]);
    });

    it('keeps everything but the marks 10 mm from every mark, on both sides', () => {
      for (const [i, side] of [[0, 1], [1, 2]] as const) {
        const zones = (Object.keys(crosshairs(layout)) as MarkName[]).map((n) => markZone(layout, n, side));
        const gap = (x: number, y: number) => Math.min(...zones.map((z) => Math.hypot(Math.max(z.x0 - x, 0, x - z.x1), Math.max(z.y0 - y, 0, y - z.y1))));
        const items = [
          ...segments(sheets[i].content, H).flatMap((s) => [[s.x1, s.y1], [s.x2, s.y2]]),
          // Text starts here and runs right (an upper bound for its length).
          // (The label of the line parallel to the short edge runs up the sheet from where it starts.)
          ...textPositions(sheets[i]).flatMap((t) => (/^parallel to the (5\.5|11) in/.test(t.text) ? [[t.x, t.y]] : [[t.x, t.y], [t.x + 1.1 * t.text.length, t.y]])),
        ];
        for (const [x, y] of items) {
          const d = gap(x, y);
          expect(d === 0 || d >= MARK_CLEAR_MM - 0.01, `side ${side}: (${x.toFixed(1)}, ${y.toFixed(1)}) is ${d.toFixed(1)} mm from a mark`).toBe(true);
        }
      }
    });

    it('stays 3 mm from every paper edge', () => {
      for (const sheet of sheets) {
        for (const s of segments(sheet.content, H)) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
          expect(Math.min(x, SHEET_W_MM - x, y, H - y), `(${x.toFixed(1)}, ${y.toFixed(1)})`).toBeGreaterThanOrEqual(3 - 0.01);
        }
        for (const t of textPositions(sheet)) {
          expect(Math.min(t.x, SHEET_W_MM - t.x, t.y, H - t.y), t.text).toBeGreaterThanOrEqual(3);
          // (The labels that run up the sheet start where they are drawn.)
          if (!t.text.startsWith('parallel to the 5.5') && !t.text.startsWith('parallel to the 11')) expect(t.x + 1.1 * t.text.length, t.text).toBeLessThanOrEqual(SHEET_W_MM - 3);
        }
      }
    });

    it('moves side 1 by the front offset and side 2 by the back offset, each +x right and +y up', async () => {
      const at = async (change: Parameters<typeof setPrint>[1]) => {
        const own = clonePrint(print);
        setPrint(own, change);
        const [front, back] = await readPdf((await sheetFile(emptyBook(52), own, fontBytes, NOW)).bytes);
        return { front: textPositions(front).find((t) => t.text === 'SIDE 1 (FRONT)')!, back: textPositions(back).find((t) => t.text === 'SIDE 2: MEASURE')! };
      };
      const base = await at({});
      const moved = await at({ front_offset_x_mm: 1, front_offset_y_mm: 0.5 });
      expect(moved.front.x - base.front.x).toBeCloseTo(1, 2);
      expect(base.front.y - moved.front.y).toBeCloseTo(0.5, 2); // up is toward the top of the sheet
      expect(moved.back).toEqual(base.back);
      const movedBack = await at({ back_offset_x_mm: -0.7, back_offset_y_mm: -0.4 });
      expect(movedBack.back.x - base.back.x).toBeCloseTo(-0.7, 2);
      expect(base.back.y - movedBack.back.y).toBeCloseTo(-0.4, 2);
      expect(movedBack.front).toEqual(base.front);
    });

    it('is refused for settings that cannot be printed, with the reason', async () => {
      const own = clonePrint(print);
      own.creep_per_sheet_mm = 0.9;
      await expect(sheetFile(emptyBook(52), own, fontBytes, NOW)).rejects.toThrow(/past the fold/);
      await expect(creepFiles(emptyBook(52), own, fontBytes, NOW)).rejects.toThrow(/past the fold/);
    });
  });
}

describe('the back rotation', () => {
  /** How far a stroke is turned from the nearest axis, in degrees, 0 to 90. */
  const turnOf = (s: { x1: number; y1: number; x2: number; y2: number }) => {
    const deg = (Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180) / Math.PI;
    return ((deg % 90) + 90) % 90;
  };
  const turned = (deg: number, layout: 'half_letter' | 'letter_two_up' = 'half_letter') => {
    const p = clonePrint(layout === 'letter_two_up' ? flatTwoUp() : FLAT);
    p.layouts[layout].back_rotation_deg = deg;
    return p;
  };
  const book = () => { const b = emptyBook(8); setSlot(b, 1, toned()); return b; };

  it('places the back pass of the print files, the covers and the calibration PDFs by the rotation, and never turns a stroke or a glyph; the front is never rotated', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const deg = layout === 'half_letter' ? 1 : 0.3, H = sheetHeight(layout);
      const print = turned(deg, layout);
      const files = await exportBookFiles(book(), print, fontBytes);
      const made = await creepFiles(book(), print, fontBytes, NOW);
      const all = [...files, ...made].filter((f) => f.name.endsWith('.pdf') && f.name !== 'pages.pdf').concat([await sheetFile(book(), print, fontBytes, NOW)]);
      for (const f of all) {
        for (const [i, page] of (await readPdf(f.bytes)).entries()) {
          for (const s of segments(page.content, H)) {
            const turn = turnOf(s);
            expect(Math.min(turn, 90 - turn), `${layout} ${f.name} ${i}`).toBeLessThan(1e-4); // exactly horizontal or vertical
          }
          for (const m of textMatrices(page.content)) expect(Math.abs(m[1]) === 0 || Math.abs(m[1]) === 1, `${layout} ${f.name} ${i} glyphs`).toBe(true);
        }
      }
      // The back differs from the unrotated one: the strokes sit where the rotation puts them.
      const flat = await readPdf((await sheetFile(book(), turned(0, layout), fontBytes, NOW)).bytes);
      const rot = await readPdf((await sheetFile(book(), print, fontBytes, NOW)).bytes);
      expect(segments(rot[1].content, H)[0].y1).not.toBeCloseTo(segments(flat[1].content, H)[0].y1, 4);
      expect(segments(rot[0].content, H)[0]).toEqual(segments(flat[0].content, H)[0]); // the front is not rotated
    }
  });

  it('turns about the sheet’s centre: the centre stays where the back offset puts it (the letter sheet’s centre for two-up)', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const print = turned(0.2, layout);
      setPrint(print, { back_offset_x_mm: 0.5, back_offset_y_mm: -0.25 });
      const { w, h } = sheetSize(layout);
      // The + at the centre of side 2: both its strokes are centred on it.
      const [, back] = await readPdf((await sheetFile(book(), print, fontBytes, NOW)).bytes);
      const plus = segments(back.content, h).filter((s) => Math.abs(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) - 6) < 0.01 && Math.hypot((s.x1 + s.x2) / 2 - w / 2 - 0.5, (s.y1 + s.y2) / 2 - h / 2 - 0.25) < 0.001);
      expect(plus, layout).toHaveLength(2);
    }
  });

  it('leaves the files alone at 0 degrees', async () => {
    const a = await exportBookFiles(book(), turned(0), fontBytes), b = await exportBookFiles(book(), FLAT, fontBytes);
    expect(Buffer.from(file(a, 'print-second.pdf').bytes).equals(Buffer.from(file(b, 'print-second.pdf').bytes))).toBe(true);
  });
});

describe('the creep test and the cover sheet', () => {
  let made: ExportedFile[];
  beforeAll(async () => { made = await creepFiles(emptyBook(52), FLAT, fontBytes, NOW); });

  it('are a cover sheet, the creep test and calibration.txt', () => {
    expect(made.map((f) => f.name)).toEqual([COVER_FILE, CREEP_FILE, 'calibration.txt']);
    expect([COVER_FILE, CREEP_FILE]).toEqual(['calibration-cover.pdf', 'creep-test.pdf']);
    const text = decode(file(made, 'calibration.txt'));
    expect(text).toContain('the outermost and innermost sheet of a 52-page book (13 sheets), 4 pages');
    expect(text).toContain('print pages 1 to 2');
    expect(text).toContain('print pages 3 to 4');
    for (const line of settingsLines(FLAT, NOW)) expect(text).toContain(line);
  });

  it('prints only the outermost and the innermost sheet, both sides, in manual-duplex order: the innermost front first, then the outermost back first', async () => {
    const book = emptyBook(52);
    expect(creepSheets(book, FLAT)).toBe(13);
    expect(creepPages(book, FLAT)).toBe(52);
    const pages = await readPdf(file(made, CREEP_FILE).bytes);
    expect(pages).toHaveLength(4);
    const sheetAndSide = pages.map((p) => {
      const [, k, side] = p.strings.join('|').match(/SHEET (\d+) OF 13.*?\|(FRONT|BACK), left/)!;
      return [Number(k) - 1, side];
    });
    expect(sheetAndSide).toEqual([[12, 'FRONT'], [0, 'FRONT'], [0, 'BACK'], [12, 'BACK']]);
    // The ranges are on every page, as are the sheet's own pages (the imposition's, for 52 pages): page 1 and 52 on the outermost, 26 and 27 in the middle.
    const sig = impose(52, FLAT, 1)[0];
    pages.forEach((p, i) => {
      expect(p.strings).toContain(`PDF page ${i + 1} of 4 (${i < 2 ? 'pass 1: print pages 1-2' : 'pass 2: print pages 3-4'})`);
      const [k, side] = sheetAndSide[i] as [number, 'FRONT' | 'BACK'];
      const s = sig.sheets[k][side === 'FRONT' ? 'front' : 'back'];
      expect(p.strings).toContain(`${side}, left page ${s.left}`);
      expect(p.strings).toContain(`${side}, right page ${s.right}`);
    });
    expect(pages[1].strings).toContain('FRONT, right page 1');
    expect(pages[1].strings).toContain('FRONT, left page 52');
    expect(pages[3].strings).toContain('BACK, left page 26'); // the middle spread is the back of the innermost sheet
    expect(pages[3].strings).toContain('BACK, right page 27');
    expect(pages[0].strings).toContain('SHEET 13 OF 13 (INNERMOST)');
    expect(pages[1].strings).toContain('SHEET 1 OF 13 (OUTERMOST)');
  });

  it('is made for the page count it is given, which sets the creep of the innermost sheet', async () => {
    const own = P({ creep_per_sheet_mm: 0.3 });
    const boxLeft = async (pages: number) => {
      const test = await readPdf(file(await creepFiles(emptyBook(52), own, fontBytes, NOW, pages), CREEP_FILE).bytes);
      return { count: test.length, outer: contentBoxes(test[1].content)[0].x, inner: contentBoxes(test[0].content)[0].x, text: test[0].strings.join('|') };
    };
    const small = await boxLeft(12), big = await boxLeft(52);
    expect(small.count).toBe(4);
    expect(small.text).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(small.text).toContain('creep test, 12 pages, 0.60 mm toward the fold'); // two sheets outside it
    expect(big.text).toContain('creep test, 52 pages, 3.60 mm toward the fold'); // twelve sheets outside it
    expect(small.inner - small.outer).toBeCloseTo(0.6, 2);
    expect(big.inner - big.outer).toBeCloseTo(3.6, 2);
    expect(decode(file(await creepFiles(emptyBook(52), own, fontBytes, NOW, 12), 'calibration.txt'))).toContain('a 12-page book (3 sheets)');
  });

  it('is the book’s biggest signature when no page count is given', async () => {
    const book = emptyBook(20);
    book.print.signatures = 2; // two signatures of 12 pages
    expect(creepSheets(book, FLAT)).toBe(3);
    expect(creepPages(book, FLAT)).toBe(12);
    const pages = await readPdf(file(await creepFiles(book, FLAT, fontBytes, NOW), CREEP_FILE).bytes);
    expect(pages).toHaveLength(4);
    expect(pages[0].strings).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(pages[1].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[2].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[3].strings).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(pages[0].strings).toContain('PDF page 1 of 4 (pass 1: print pages 1-2)');
    expect(pages[3].strings).toContain('PDF page 4 of 4 (pass 2: print pages 3-4)');
  });

  it('prints one sheet, front and back, for a 4-page book, and refuses a page count that is not a multiple of 4', async () => {
    const one = await readPdf(file(await creepFiles(emptyBook(52), FLAT, fontBytes, NOW, 4), CREEP_FILE).bytes);
    expect(one).toHaveLength(2);
    for (const bad of [0, 6, 10, 2.5, -4, NaN]) await expect(creepFiles(emptyBook(52), FLAT, fontBytes, NOW, bad), String(bad)).rejects.toThrow(/multiple of 4/);
  });

  it('shifts each sheet’s box toward the fold by the thickness × the sheets outside it, on both sides', async () => {
    const book = emptyBook(8);
    const print = P({ creep_per_sheet_mm: 0.5 });
    const pages = await readPdf(file(await creepFiles(book, print, fontBytes, NOW), CREEP_FILE).bytes); // [front 1, front 0, back 0, back 1]
    const left = pages.map((s) => contentBoxes(s.content)[0].x), right = pages.map((s) => contentBoxes(s.content)[1].x);
    expect(left[0] - left[1]).toBeCloseTo(0.5, 2);
    expect(left[3] - left[2]).toBeCloseTo(0.5, 2);
    expect(left[0]).toBeCloseTo(pageOrigin(false, creepFor(1, print)).x + GRID_X_MM, 2);
    expect(right[1] - right[0]).toBeCloseTo(0.5, 2); // the right page moves left
  });

  it('moves the creep test’s boxes by the fore-edge shift, and the cover sheet’s by the cover shift, and writes them in the footer and calibration.txt', async () => {
    const book = emptyBook(8);
    const [a, b] = [await creepFiles(book, FLAT, fontBytes, NOW), await creepFiles(book, P({ fore_edge_shift_mm: 1.5, cover_fore_edge_shift_mm: 0.7, target_fore_edge_margin_mm: 3.2 }), fontBytes, NOW)];
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
    const book = emptyBook(8);
    const [a, b] = [await creepFiles(book, FLAT, fontBytes, NOW), await creepFiles(book, P({ front_offset_x_mm: 0.4, front_offset_y_mm: 0.2, back_offset_x_mm: -0.6, back_offset_y_mm: -0.3 }), fontBytes, NOW)];
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
    expect(box(cb[0]).x - box(ca[0]).x).toBeCloseTo(0.4, 2); // the outside (page 1) takes the front offset
    expect(box(ca[0]).y - box(cb[0]).y).toBeCloseTo(0.2, 2);
    expect(box(cb[1]).x - box(ca[1]).x).toBeCloseTo(-0.6, 2); // the inside (page 2) takes the back offset
    expect(box(ca[1]).y - box(cb[1]).y).toBeCloseTo(-0.3, 2);
  });

  it('has margin rulers on every page, the cover included: top, bottom and fore-edge, with the expected margin marked', async () => {
    const creep = await readPdf(file(made, CREEP_FILE).bytes), cover = await readPdf(file(made, COVER_FILE).bytes);
    expect(cover).toHaveLength(2); // the outside, then the inside
    for (const p of [...creep, ...cover]) {
      expect(margins(p.strings).top, 'top and bottom of both pages').toBe(4);
      expect(margins(p.strings).fore, 'fore-edge ruler of both pages').toBe(2); // each runs 0 to 7 mm from the box line
    }
    expect(FORE_EDGE_RULER_MM).toBeGreaterThan(GRID_X_MM);
  });

  it('puts the covers’ footer on the cover sheet', async () => {
    const [outside, inside] = await readPdf(file(made, COVER_FILE).bytes);
    expect(outside.strings).toContain('COVER, outside back cover');
    expect(outside.strings).toContain('COVER, outside front cover');
    expect(inside.strings).toContain('COVER, inside front cover');
    expect(inside.strings).toContain('COVER, inside back cover');
    for (const sheet of [outside, inside]) for (const line of settingsLines(FLAT, NOW)) expect(sheet.strings.filter((s) => s === line)).toHaveLength(2);
  });

  it('draws the same content-area box on every page', async () => {
    const pages = await readPdf(file(await creepFiles(emptyBook(8), FLAT, fontBytes, NOW), CREEP_FILE).bytes);
    for (const s of pages) {
      const boxes = contentBoxes(s.content);
      expect(boxes).toHaveLength(2);
      for (const b of boxes) expect([b.w, b.h]).toEqual([81, 132].map((v) => expect.closeTo(v, 2)));
    }
  });
});
