import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, setSlot, PRINT_LIMITS, type Book } from '../src/book/book';
import { DEFAULT_PRINT, SHEET_H_MM, SHEET_W_MM, clonePrint, creepFor, duplexOrder, impose, pageOrigin, type PrintSettings } from '../src/book/impose';
import { LINE_MM, MARK_CLEAR_MM, markZone, crosshairs, scaleCaptions, sheetHeight, type MarkName } from '../src/book/alignment';
import { PRINTER_KEYS, readPrinter } from '../src/printer';
import { sheetSize } from '../src/print/sheets';
import { GRID_X_MM, PAGE_H_MM, PAGE_W_MM, emptyPage, type Page } from '../src/format/types';
import { blankTokens } from '../src/format/tokens';
import { validatePage } from '../src/format/validate';
import { SHADE_TONES, TEXT_COLORS } from '../src/render';
import { drawPage, mmToPt } from '../src/print/draw';
import { PRINT_TIPS, exportBookFiles, newDocument, summary, type ExportedFile } from '../src/print/export';
import {
  COVER_FILE, CREEP_FILE, FORE_EDGE_RULER_MM, HAIRLINE_WIDTHS, RAMP_STEPS, SCALE_MM, SHEET_FILE, calibrationPages, calibrationText, creepFiles, creepSheets, sheetFile,
} from '../src/print/calibrate';
import { PRINT_LABELS, settingsLines } from '../src/print/settingstext';
import { grayHex, tonesOf } from '../src/print/tones';
import { APP_VERSION } from '../src/version';
import { FLAT, flatTwoUp, setPrint } from './flat';
import { readPdf, textPositions } from './pdf-text';

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

/** Straight segments a page draws, in sheet mm from the top left (the page must have no transform). */
const segments = (content: string, height: number) => [...content.matchAll(/([\d.-]+) ([\d.-]+) m\n([\d.-]+) ([\d.-]+) l\nS/g)]
  .map((m) => ({ x1: +m[1] / PT, y1: height - +m[2] / PT, x2: +m[3] / PT, y2: height - +m[4] / PT }));
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
      for (const label of ['-5', '-4', '-3', '-2', '-1', '1', '3', '5']) expect(back.strings.filter((s) => s === label), label).toHaveLength(4);
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

    it('has an edge ruler from each edge mark to the paper’s edge: 0 to 8 mm in 0.5 mm ticks, labelled "edge should be at 8.0"', () => {
      const segs = segments(sheets[1].content, H), at = crosshairs(layout), cap = scaleCaptions(layout);
      const ends = { top: { x: at.top.x, y: 0 }, bottom: { x: at.bottom.x, y: H }, left: { x: 0, y: at.left.y }, right: { x: SHEET_W_MM, y: at.right.y } };
      for (const name of ['top', 'bottom', 'left', 'right'] as const) {
        const p = at[name], e = ends[name], vertical = name === 'top' || name === 'bottom';
        expect(segs.some((s) => (near(s.x1, p.x) && near(s.y1, p.y) && near(s.x2, e.x) && near(s.y2, e.y)) || (near(s.x2, p.x) && near(s.y2, p.y) && near(s.x1, e.x) && near(s.y1, e.y)))).toBe(true);
        // 17 ticks along it (0, 0.5 ... 8), across it.
        const ticks = segs.filter((s) => (vertical ? near(s.y1, s.y2) && Math.abs(s.x1 - p.x) < 1.6 : near(s.x1, s.x2) && Math.abs(s.y1 - p.y) < 1.6)
          && Math.abs(vertical ? s.y1 - p.y : s.x1 - p.x) <= 8.01 && Math.abs(vertical ? s.y1 - p.y : s.x1 - p.x) >= 0.49 + (vertical ? 0 : 0) - 0.5 && Math.abs(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)) < 3.1);
        expect(ticks.length, name).toBeGreaterThanOrEqual(16);
      }
      expect(sheets[1].strings.filter((t) => t === cap.edge)).toHaveLength(4);
      expect(cap.edge).toBe('edge should be at 8.0');
    });

    it('names the paper’s edges of the layout everywhere, in the words of the readings, never across and down', () => {
      const cap = scaleCaptions(layout), edge = twoUp ? '11 in' : '5.5 in';
      expect([cap.top, cap.bottom, cap.left, cap.right]).toEqual(['see-through top x', 'see-through bottom x', 'see-through left y', 'see-through right y']);
      expect(cap.longX).toBe('parallel to the 8.5 in edge: should measure 100.0 mm');
      expect(cap.longY).toBe(`parallel to the ${edge} edge: should measure 100.0 mm`);
      for (const text of [cap.top, cap.bottom, cap.left, cap.right, cap.longX, cap.longY]) expect(sheets[1].strings, text).toContain(text);
      for (const sheet of sheets) for (const s of sheet.strings) expect(s.toLowerCase(), s).not.toMatch(/across|\bdown\b|crease|fold scale|190|260/);
    });

    it('has two 100.0 mm lines with end ticks on side 2, one parallel to each paper edge, and no 190, 260 mm lines or fold scale', () => {
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
          ...textPositions(sheets[i]).flatMap((t) => [[t.x, t.y], [t.x + 1.1 * t.text.length, t.y]]),
        ];
        for (const [x, y] of items) {
          const d = gap(x, y);
          expect(d === 0 || d >= MARK_CLEAR_MM - 0.01, `side ${side}: (${x.toFixed(1)}, ${y.toFixed(1)}) is ${d.toFixed(1)} mm from a mark`).toBe(true);
        }
      }
    });

    it('stays 3 mm from every paper edge, except the edge rulers, which run to it', () => {
      for (const sheet of sheets) {
        const zones = (['top', 'bottom', 'left', 'right'] as const).map((n) => markZone(layout, n, 2));
        const inRuler = (x: number, y: number) => zones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) && (x < 3 || y < 3 || x > SHEET_W_MM - 3 || y > H - 3);
        for (const s of segments(sheet.content, H)) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
          if (inRuler(x, y)) continue;
          expect(Math.min(x, SHEET_W_MM - x, y, H - y), `(${x.toFixed(1)}, ${y.toFixed(1)})`).toBeGreaterThanOrEqual(3 - 0.01);
        }
        for (const t of textPositions(sheet)) {
          if (/^[\d-]+$/.test(t.text)) continue; // the numbers on the edge rulers
          expect(Math.min(t.x, SHEET_W_MM - t.x, t.y, H - t.y), t.text).toBeGreaterThanOrEqual(3);
          // (The two labels that run up the sheet start where they are drawn.)
          if (!t.text.startsWith('edge should') && !t.text.startsWith('parallel to the 5.5') && !t.text.startsWith('parallel to the 11')) expect(t.x + 1.1 * t.text.length, t.text).toBeLessThanOrEqual(SHEET_W_MM - 3);
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
  /** The matrix a page's content is drawn under, the first one in it: [a b c d e f]. A page with no turn has b = c = 0 (its content's own translations). */
  const matrixOf = (content: string) => { const m = content.match(/q\n(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm\n/); return m ? m.slice(1).map(Number) : null; };
  const isTurned = (content: string) => { const m = matrixOf(content); return m !== null && Math.abs(m[1]) > 1e-9; };
  const turned = (deg: number, layout: 'half_letter' | 'letter_two_up' = 'half_letter') => {
    const p = clonePrint(layout === 'letter_two_up' ? flatTwoUp() : FLAT);
    p.layouts[layout].back_rotation_deg = deg;
    return p;
  };
  const book = () => { const b = emptyBook(8); setSlot(b, 1, toned()); return b; };

  it('turns the back pass of the print files, the covers and the calibration PDFs, and never the front', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      // A two-up sheet turns about the letter sheet's centre, so a degree swings its corners past the 3 mm the printer needs.
      const deg = layout === 'half_letter' ? 1 : 0.3, sin = Math.sin((deg * Math.PI) / 180), cos = Math.cos((deg * Math.PI) / 180);
      const print = turned(deg, layout);
      const files = await exportBookFiles(book(), print, fontBytes);
      for (const f of files.filter((f) => f.name.endsWith('.pdf') && f.name !== 'pages.pdf')) {
        const pages = await readPdf(f.bytes);
        pages.forEach((page, i) => {
          const m = matrixOf(page.content);
          const back = f.name === 'print-duplex.pdf' ? i % 2 === 1 : /second|inside/.test(f.name);
          if (back) {
            expect(isTurned(page.content), `${layout} ${f.name} ${i}`).toBe(true);
            expect(m![0]).toBeCloseTo(cos, 9);
            expect(m![1]).toBeCloseTo(sin, 9); // + is counter-clockwise: the PDF's axes point up, where that is +sin in b
            expect(m![2]).toBeCloseTo(-sin, 9);
            expect(m![3]).toBeCloseTo(cos, 9);
          } else expect(isTurned(page.content), `${layout} ${f.name} ${i} is a front`).toBe(false);
        });
      }
      const sheet = await readPdf((await sheetFile(book(), print, fontBytes, NOW)).bytes);
      expect(isTurned(sheet[0].content)).toBe(false);
      expect(matrixOf(sheet[1].content)![1]).toBeCloseTo(sin, 9);
      const made = await creepFiles(book(), print, fontBytes, NOW);
      const creep = await readPdf(file(made, CREEP_FILE).bytes), cover = await readPdf(file(made, COVER_FILE).bytes);
      const n = creep.length / 2;
      creep.forEach((page, i) => expect(isTurned(page.content), `creep page ${i}`).toBe(i >= n));
      expect(isTurned(cover[0].content)).toBe(false);
      expect(matrixOf(cover[1].content)![1]).toBeCloseTo(sin, 9);
    }
  });

  it('turns about the sheet’s centre: the centre stays where the back offset puts it (the letter sheet’s centre for two-up)', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const print = turned(0.2, layout);
      setPrint(print, { back_offset_x_mm: 0.5, back_offset_y_mm: -0.25 });
      const { w, h } = sheetSize(layout);
      const [m] = [matrixOf((await readPdf(file(await exportBookFiles(book(), print, fontBytes), 'print-second.pdf').bytes))[0].content)!];
      const [a, b, c, d, e, f] = m;
      expect((a * (w / 2) * PT + c * (h / 2) * PT + e) / PT).toBeCloseTo(w / 2 + 0.5, 6);
      expect((b * (w / 2) * PT + d * (h / 2) * PT + f) / PT).toBeCloseTo(h / 2 - 0.25, 6);
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
    expect(text).toContain('print pages 1 to 13');
    expect(text).toContain('print pages 14 to 26');
    for (const line of settingsLines(FLAT, NOW)) expect(text).toContain(line);
  });

  it('has both sides of every sheet of the biggest signature, in manual-duplex order: fronts in reverse, then backs forward', async () => {
    const book = emptyBook(52);
    expect(creepSheets(book, FLAT)).toBe(13);
    const pages = await readPdf(file(made, CREEP_FILE).bytes);
    expect(pages).toHaveLength(26);
    const [fronts, backs] = duplexOrder(13);
    const sheetAndSide = pages.map((p) => {
      const [, k, side] = p.strings.join('|').match(/SHEET (\d+) OF 13.*?\|(FRONT|BACK), left/)!;
      return [Number(k) - 1, side];
    });
    expect(sheetAndSide).toEqual([...fronts.map((k) => [k, 'FRONT']), ...backs.map((k) => [k, 'BACK'])]);
    // The ranges are on every page, as are the sheet's own pages (the imposition's, for 52 pages).
    const sig = impose(52, FLAT, 1)[0];
    pages.forEach((p, i) => {
      expect(p.strings).toContain(`PDF page ${i + 1} of 26 (${i < 13 ? 'pass 1: print pages 1-13' : 'pass 2: print pages 14-26'})`);
      const [k, side] = sheetAndSide[i] as [number, 'FRONT' | 'BACK'];
      const s = sig.sheets[k][side === 'FRONT' ? 'front' : 'back'];
      expect(p.strings).toContain(`${side}, left page ${s.left}`);
      expect(p.strings).toContain(`${side}, right page ${s.right}`);
    });
  });

  it('uses the book’s sheet count: the biggest signature', async () => {
    const book = emptyBook(20);
    book.print.signatures = 2; // two signatures of 12 pages
    expect(creepSheets(book, FLAT)).toBe(3);
    const pages = await readPdf(file(await creepFiles(book, FLAT, fontBytes, NOW), CREEP_FILE).bytes);
    expect(pages).toHaveLength(6);
    expect(pages[0].strings).toContain('SHEET 3 OF 3 (INNERMOST)');
    expect(pages[2].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[3].strings).toContain('SHEET 1 OF 3 (OUTERMOST)');
    expect(pages[0].strings).toContain('PDF page 1 of 6 (pass 1: print pages 1-3)');
    expect(pages[5].strings).toContain('PDF page 6 of 6 (pass 2: print pages 4-6)');
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
