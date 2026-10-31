import { INSET_EDGES, insetScaleZone } from '../src/book/alignment';
import type { PrintSettings } from '../src/book/impose';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { emptyBook, getSlot, lastSlot, readBook, setCover, slotSide, type Book } from '../src/book/book';
import { opening, slotLabel } from '../src/book/labels';
import { withPages } from './books';
import {
  DEFAULT_INSETS, DEFAULT_PRINT, FOLD_X_MM, LAYOUT_NAMES, SHEET_H_MM, SHEET_W_MM, TRIM_ZONE_MM, clonePrint, creepFor, duplexOrder, offsetOf, pageOrigin, profileOf,
} from '../src/book/impose';
import { emptyPage, GRID_X_MM, GRID_Y_MM, PAGE_H_MM, PAGE_W_MM, type Page } from '../src/format/types';
import { exportBookFiles, type ExportedFile } from '../src/print/export';
import { SHEET_FILE, sheetFile, creepFiles, COVER_FILE, CREEP_FILE } from '../src/print/calibrate';
import {
  EDGE_MM, LETTER_H_MM, LETTER_W_MM, backPoint, backRegion, halfTops, mapPoint, sheetSize, transformOf, trimZoneBoxes,
} from '../src/print/sheets';
import { FLAT, flatTwoUp, setPrint } from './flat';
import { readPdf, segments, textPositions, type PageInfo } from './pdf-text';

const fonts = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const PT = 72 / 25.4;
const file = (files: ExportedFile[], name: string) => files.find((f) => f.name === name)!.bytes;
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const labelled = (label: string): Page => ({ ...emptyPage(), identity: '', name: label, elements: [{ type: 'text', x: 3, y: 10, text: label, size: 'heading' }] });

/** The flat printer profile for each layout, so the numbers stay simple. */
const HALF = FLAT, TWO = flatTwoUp();
/** Two-up printed by the printer's auto duplex: print-duplex.pdf. TWO prints by hand: print-first.pdf and print-second.pdf. */
const TWO_AUTO: PrintSettings = { ...clonePrint(TWO), print_method: { ...TWO.print_method, letter_two_up: 'auto' } };
const printFor = (layout: 'half_letter' | 'letter_two_up') => clonePrint(layout === 'letter_two_up' ? TWO : HALF);

/** A book whose pages say `${prefix}${n}`. */
function book(pages: number, prefix: string, _layout: 'half_letter' | 'letter_two_up', name = `Book ${prefix}`): Book {
  const b = emptyBook(pages);
  b.name = name;
  b.page_numbers = false;
  withPages(b, Array.from({ length: pages }, (_, i) => labelled(`${prefix}${i + 1}`)));
  return b;
}
const at = (page: PageInfo, text: string) => textPositions(page).find((t) => t.text === text)!;

const onEdgeScale = (x: number, y: number) => INSET_EDGES.some((e) => { const z = insetScaleZone('letter_two_up', e); return x >= z.x0 - 1 && x <= z.x1 + 1 && y >= z.y0 - 1 && y <= z.y1 + 1; });

describe('the sheet layouts', () => {
  it('half letter is today’s sheet, and two-up a portrait letter sheet with a half-letter sheet at its top and its bottom', () => {
    expect(sheetSize('half_letter')).toEqual({ w: SHEET_W_MM, h: SHEET_H_MM });
    expect(sheetSize('letter_two_up')).toEqual({ w: 215.9, h: 279.4 });
    expect(LETTER_W_MM).toBe(215.9);
    expect(LETTER_H_MM).toBeCloseTo(279.4, 9);
    expect(halfTops('half_letter')).toEqual([0]);
    expect(halfTops('letter_two_up')).toEqual([0, SHEET_H_MM]);
  });

  it('keeps a separate offset and scale for each layout, and the half-letter values are the owner’s', () => {
    expect(DEFAULT_PRINT.sheet_layout).toBe('half_letter');
    expect(DEFAULT_PRINT.layouts.half_letter.hand.inside).toEqual({ front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0, line_weight_x_pct: 100, ...DEFAULT_INSETS });
    expect(DEFAULT_PRINT.layouts.letter_two_up.hand.inside).toEqual({ front_offset_x_mm: -0.25, front_offset_y_mm: -1.55, back_offset_x_mm: -0.4, back_offset_y_mm: 1, scale_x_pct: 100, scale_y_pct: 101.01, back_rotation_deg: -0.183, line_weight_x_pct: 100, ...DEFAULT_INSETS });
    const p = clonePrint(DEFAULT_PRINT);
    p.layouts.letter_two_up.hand.inside.front_offset_x_mm = 0.8;
    p.layouts.letter_two_up.hand.inside.front_offset_y_mm = 0;
    p.layouts.letter_two_up.hand.inside.back_offset_y_mm = 0;
    expect(offsetOf(p, 'front')).toEqual({ x: 1.7, y: -0.05 }); // half letter is selected
    p.sheet_layout = 'letter_two_up';
    p.print_method.letter_two_up = 'hand'; // the owner's default for two-up is auto duplex; these are the by-hand numbers
    expect(offsetOf(p, 'front')).toEqual({ x: 0.8, y: 0 });
    expect(offsetOf(p, 'back')).toEqual({ x: -0.4, y: 0 });
    expect(DEFAULT_PRINT.layouts.letter_two_up.hand.inside.front_offset_x_mm).toBe(-0.25); // the defaults are not shared with the copy
  });

  it('shares creep, shifts, target margin and tones between the layouts, and keeps both layouts’ settings in the one printer profile', () => {
    const p = clonePrint(DEFAULT_PRINT);
    p.layouts.letter_two_up.hand.inside.scale_x_pct = 101;
    p.sheet_layout = 'letter_two_up';
    expect(p.layouts.letter_two_up.hand.inside.scale_x_pct).toBe(101);
    expect(p.layouts.half_letter.hand.inside).toEqual(DEFAULT_PRINT.layouts.half_letter.hand.inside);
    expect(Object.keys(p)).not.toContain('front_offset_x_mm');
    expect(Object.keys(p)).not.toContain('signatures');
  });
});

describe('duplex: the back of each half lands behind its front', () => {
  it('flips on the long edge: the top stays the top and left and right swap', () => {
    expect(backPoint({ x: 10, y: 20 })).toEqual({ x: LETTER_W_MM - 10, y: 20 });
    expect(backRegion(0)).toEqual({ y: 0, h: SHEET_H_MM });
    expect(backRegion(1)).toEqual({ y: SHEET_H_MM, h: SHEET_H_MM });
  });

  it('puts the page behind a right page on the left, at the same height, whatever the creep and shift', () => {
    for (const [creep, shift] of [[0, 0], [1.2, 0], [0, 2], [3.3, 2]]) {
      const front = pageOrigin(true, creep, shift), back = pageOrigin(false, creep, shift);
      // The front's right page, turned over, covers the same paper as the back's left page.
      expect(backPoint({ x: front.x + PAGE_W_MM, y: front.y }).x, 'left edge').toBeCloseTo(back.x, 9);
      expect(backPoint({ x: front.x, y: front.y }).x, 'right edge').toBeCloseTo(back.x + PAGE_W_MM, 9);
      expect(front.y).toBe(back.y);
    }
  });

  it('draws, in the PDF, page 2k+2 behind page 2k+1 in each half: same height, mirrored across the sheet', async () => {
    const files = await exportBookFiles(book(8, 'A', 'letter_two_up'), TWO_AUTO, fonts, {}, book(8, 'B', 'letter_two_up'));
    const duplex = await readPdf(file(files, 'print-duplex.pdf')); // F0 B0 F1 B1
    expect(duplex).toHaveLength(4);
    for (const prefix of ['A', 'B']) {
      for (const [sheet, front, back, right, left] of [[0, 0, 1, 1, 2], [1, 2, 3, 3, 4]]) {
        const f = at(duplex[front], `${prefix}${right}`), b = at(duplex[back], `${prefix}${left}`), c = creepFor(sheet, FLAT);
        expect(b.y, `${prefix}${left} behind ${prefix}${right}`).toBeCloseTo(f.y, 4);
        // Both labels sit at the same inset in their pages. The front's right page starts at fold - c and the back's left page, its
        // mirror image across the sheet, at fold - W + c, so the labels are 2c - W apart.
        expect(b.x - f.x, `${prefix}${left} mirrors ${prefix}${right}`).toBeCloseTo(2 * c - PAGE_W_MM, 3);
      }
    }
    // The top half is Book 1 and the bottom half Book 2, on the back too.
    expect(at(duplex[1], 'A2').y).toBeLessThan(SHEET_H_MM);
    expect(at(duplex[1], 'B2').y).toBeGreaterThan(SHEET_H_MM);
  });
});

describe('two-up files', () => {
  let files: ExportedFile[];
  beforeAll(async () => {
    // The auto duplex files and, from the by-hand export, print-first and print-second: the layout is the same, so these tests read all three.
    const [A, B] = [book(8, 'A', 'letter_two_up'), book(8, 'B', 'letter_two_up')];
    const auto = await exportBookFiles(A, TWO_AUTO, fonts, {}, B), hand = await exportBookFiles(A, TWO, fonts, {}, B);
    files = [...auto, ...hand.filter((f) => /^print-(first|second)/.test(f.name))];
  });

  it('writes print-duplex.pdf next to print-first.pdf and print-second.pdf, on letter sheets, and the covers', async () => {
    expect(files.map((f) => f.name).sort()).toEqual(['cover-duplex.pdf', 'pages.pdf', 'print-duplex.pdf', 'print-first.pdf', 'print-second.pdf', 'summary.txt']);
    for (const name of ['print-duplex.pdf', 'print-first.pdf', 'print-second.pdf', 'cover-duplex.pdf']) {
      const [page] = await readPdf(file(files, name));
      expect(page.width, name).toBeCloseTo(8.5 * 72, 1);
      expect(page.height, name).toBeCloseTo(11 * 72, 1);
    }
  });

  it('lays each half out exactly as a half-letter sheet: the top half is the same as today, the bottom half the same one sheet lower', async () => {
    const single = await exportBookFiles(book(8, 'A', 'half_letter'), HALF, fonts);
    const bottomOnly = await exportBookFiles(book(8, 'B', 'half_letter'), HALF, fonts);
    for (const name of ['print-first.pdf', 'print-second.pdf']) {
      const one = await readPdf(file(single, name)), two = await readPdf(file(files, name)), bottom = await readPdf(file(bottomOnly, name));
      expect(two).toHaveLength(one.length);
      for (const [i, sheet] of one.entries()) {
        for (const t of textPositions(sheet).filter((t) => /^A\d$/.test(t.text))) {
          const u = at(two[i], t.text);
          expect(u.x, t.text).toBeCloseTo(t.x, 3);
          expect(u.y, t.text).toBeCloseTo(t.y, 3);
        }
        for (const t of textPositions(bottom[i]).filter((t) => /^B\d$/.test(t.text))) {
          const u = at(two[i], t.text);
          expect(u.x, t.text).toBeCloseTo(t.x, 3);
          expect(u.y, t.text).toBeCloseTo(t.y + SHEET_H_MM, 3);
        }
      }
    }
  });

  it('orders the sheets: print-duplex runs front, back from the outermost sheet in; print-first the fronts last sheet first; print-second the backs first sheet first', async () => {
    const pagesOf = async (name: string) => (await readPdf(file(files, name))).map((p) => p.strings.filter((s) => /^A\d$/.test(s)).sort().join(' '));
    expect(await pagesOf('print-duplex.pdf')).toEqual(['A1 A8', 'A2 A7', 'A3 A6', 'A4 A5']); // F0 B0 F1 B1
    expect(await pagesOf('print-first.pdf')).toEqual(['A3 A6', 'A1 A8']);
    expect(await pagesOf('print-second.pdf')).toEqual(['A2 A7', 'A4 A5']);
    const [fronts, backs] = duplexOrder(2);
    expect([fronts, backs]).toEqual([[1, 0], [0, 1]]);
    const same = (name: string) => files.find((f) => f.name === name)!;
    expect(same('print-duplex.pdf')).toBeDefined();
  });

  it('puts the letter sheet k’s Book 1 and Book 2 sheets together, so that a cut pile of each stays in nesting order', async () => {
    const duplex = await readPdf(file(files, 'print-duplex.pdf'));
    for (const [i, sheet] of [0, 0, 1, 1].entries()) {
      const top = duplex[i].strings.filter((s) => /^A\d$/.test(s)).length, bottom = duplex[i].strings.filter((s) => /^B\d$/.test(s)).length;
      expect([top, bottom], `page ${i + 1} (sheet ${sheet + 1})`).toEqual([2, 2]);
    }
    const text = decode(file(files, 'summary.txt'));
    expect(text).toContain('Sheet order:');
    expect(text).toContain('print-duplex.pdf runs front, back for k = 1, 2, 3');
    expect(text).toContain('Letter, two-up');
    expect(text).toContain('Letter (not borderless)');
    expect(text).toContain('print-duplex.pdf');
  });

  it('puts different books on the top and bottom, and leaves the extra halves of the shorter one blank', async () => {
    const out = await exportBookFiles(book(16, 'A', 'letter_two_up', 'Long'), TWO_AUTO, fonts, {}, book(8, 'B', 'letter_two_up', 'Short'));
    const duplex = await readPdf(file(out, 'print-duplex.pdf'));
    expect(duplex).toHaveLength(8); // 4 sheets, both sides: the longer book decides
    const halfOf = (page: PageInfo, half: 'A' | 'B') => page.strings.filter((s) => s.startsWith(half) && /\d/.test(s) && s.length < 4);
    duplex.forEach((page, i) => {
      const sheet = Math.floor(i / 2);
      expect(halfOf(page, 'A'), `page ${i + 1}`).toHaveLength(2);
      expect(halfOf(page, 'B'), `page ${i + 1}`).toHaveLength(sheet < 2 ? 2 : 0);
    });
    // The labels say which book, its name, the sheet and the side; a blank half has none.
    expect(duplex[0].strings).toContain('Book 1 | Long | sheet 1 of 4 | front');
    expect(duplex[0].strings).toContain('Book 2 | Short | sheet 1 of 2 | front');
    expect(duplex[1].strings).toContain('Book 2 | Short | sheet 1 of 2 | back');
    expect(duplex[4].strings.filter((s) => s.startsWith('Book 2'))).toEqual([]);
    expect(duplex[4].strings).toContain('Book 1 | Long | sheet 3 of 4 | front');
    expect(decode(file(out, 'summary.txt'))).toMatch(/Bottom: Book 2, Short \(2 sheets; a book with fewer sheets leaves its half blank\)/);
  });

  it('uses the same book on both halves unless told otherwise', async () => {
    const out = await exportBookFiles(book(8, 'A', 'letter_two_up', 'Same'), TWO_AUTO, fonts);
    const [front] = await readPdf(file(out, 'print-duplex.pdf'));
    expect(front.strings.filter((s) => /^A\d$/.test(s))).toHaveLength(4);
    expect(front.strings).toContain('Book 1 | Same | sheet 1 of 2 | front');
    expect(front.strings).toContain('Book 2 | Same | sheet 1 of 2 | front');
  });

  it('draws cut marks at the middle line and every label in the side trim zones', async () => {
    const [page] = await readPdf(file(files, 'print-duplex.pdf'));
    // The marks: horizontal lines on the middle line, one in each side zone.
    const lines = [...page.content.matchAll(/([\d.-]+) ([\d.-]+) m\s+([\d.-]+) ([\d.-]+) l\s+S/g)].map((m) => ({ x1: +m[1] / PT, y: LETTER_H_MM - +m[2] / PT, x2: +m[3] / PT, y2: LETTER_H_MM - +m[4] / PT }));
    const marks = lines.filter((l) => Math.abs(l.y - SHEET_H_MM) < 0.01 && Math.abs(l.y2 - l.y) < 0.001 && l.x2 - l.x1 < 20);
    expect(marks).toHaveLength(2);
    for (const m of marks) {
      const left = m.x2 < TRIM_ZONE_MM, right = m.x1 > SHEET_W_MM - TRIM_ZONE_MM;
      expect(left || right, 'a mark in a trim zone').toBe(true);
      expect(Math.min(m.x1, SHEET_W_MM - m.x2)).toBeGreaterThanOrEqual(EDGE_MM);
    }
    // The labels: rotated text whose baseline is in the left trim zone and that fits in its half.
    const labels = [...page.content.matchAll(/\S+ 1 -1 \S+ (\S+) (\S+) Tm/g)].map((m) => ({ x: +m[1] / PT, y: LETTER_H_MM - +m[2] / PT }));
    expect(labels).toHaveLength(2);
    for (const l of labels) {
      expect(l.x).toBeGreaterThan(EDGE_MM);
      expect(l.x).toBeLessThan(TRIM_ZONE_MM - 3); // the whole text height is left of the trim line, well clear of the page
    }
    expect(labels[0].y).toBeLessThan(SHEET_H_MM);
    expect(labels[1].y).toBeGreaterThan(SHEET_H_MM);
    // The boxes the check knows about are inside the zones too, and none crosses into a page's content area.
    const sheet = pageOrigin(false, 0, 0);
    for (const b of trimZoneBoxes()) {
      const inZone = b.x + b.w <= TRIM_ZONE_MM || b.x >= SHEET_W_MM - TRIM_ZONE_MM;
      expect(inZone, b.name).toBe(true);
      expect(b.x + b.w <= sheet.x + GRID_X_MM || b.x >= SHEET_W_MM - sheet.x - GRID_X_MM, b.name).toBe(true);
    }
  });

  it('labels the creep test and the cover sheet by book; the calibration sheet uses the whole paper, without labels', async () => {
    const b = book(8, 'A', 'letter_two_up', 'Cal');
    const sheet = await readPdf((await sheetFile(b, TWO, fonts)).bytes);
    for (const page of sheet) expect(page.strings.filter((s) => s.startsWith('Book '))).toEqual([]);
    const made = await creepFiles(b, TWO, fonts);
    const test = await readPdf(made.find((f) => f.name === CREEP_FILE)!.bytes);
    expect(test.map((p) => p.strings.filter((s) => s.startsWith('Book ')))).toEqual([
      ['Book 1 | Cal | sheet 2 of 2 | front', 'Book 2 | Cal | sheet 2 of 2 | front'],
      ['Book 1 | Cal | sheet 1 of 2 | front', 'Book 2 | Cal | sheet 1 of 2 | front'],
      ['Book 1 | Cal | sheet 1 of 2 | back', 'Book 2 | Cal | sheet 1 of 2 | back'],
      ['Book 1 | Cal | sheet 2 of 2 | back', 'Book 2 | Cal | sheet 2 of 2 | back'],
    ]);
    const cover = await readPdf(made.find((f) => f.name === COVER_FILE)!.bytes);
    expect(cover).toHaveLength(2);
    expect(cover[0].width).toBeCloseTo(8.5 * 72, 1);
    expect(cover[0].height).toBeCloseTo(11 * 72, 1);
  });
});

describe('the edge check', () => {
  const two = (change: Parameters<typeof setPrint>[1]) => { const p = clonePrint(TWO); setPrint(p, change); return p; };
  /** A book whose pages have a band of shade in the first row (the header row) and in the last, so there is content at both edges. */
  const edgy = (prefix: string, name?: string): Book => {
    const b = book(8, prefix, 'letter_two_up', name);
    withPages(b, Array.from({ length: 8 }, (_, i) => ({ ...emptyPage(), identity: '', name: `${prefix}${i + 1}`, elements: [{ type: 'shade', tones: 'L', x: 0, y: 0, w: 27, h: 1 }, { type: 'shade', tones: 'L', x: 0, y: 43, w: 27, h: 1 }] })));
    return b;
  };

  it('passes the flat defaults without a warning', async () => {
    const files = await exportBookFiles(edgy('A'), two({}), fonts);
    expect(files.warnings).toEqual([]);
    expect(decode(file(files, 'summary.txt'))).not.toContain('Warnings:');
  });

  it('warns, naming the book, page and row, when content would print closer to the edge than the printable inset, and still makes the files', async () => {
    // The grid starts 3.85 mm below the top of the top half: an inset of 4.5 on the front's top edge is passed by 0.65.
    const files = await exportBookFiles(edgy('A'), two({ inset_front_top_mm: 4.5 }), fonts);
    // One for the page, and the advice that no split fits (the margin can't give the top any more room), naming the largest margin that would.
    expect(files.warnings).toHaveLength(2);
    expect(files.warnings[0]).toMatch(/^Book 1, page \d+, row 0 \(the header\): on the front of the letter sheet it prints 3\.85 mm from the top edge\. The print driver may cut it off; check by printing that page\./);
    expect(files.warnings[0]).toMatch(/ about as close\.$/); // the other pages with content that close
    expect(files.warnings[1]).toMatch(/^The books don't fit inside the printable area at a trimmed top\/bottom margin of 3\.85 mm.* The largest trimmed top\/bottom margin that would fit is 3\.6\d? mm\.$/);
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['print-first.pdf', 'print-second.pdf', 'cover-outside.pdf', 'cover-inside.pdf', 'pages.pdf', 'summary.txt']));
    const summaryText = decode(file(files, 'summary.txt'));
    expect(summaryText).toContain('Warnings:');
    expect(summaryText).toContain(files.warnings[0]);
  });

  it('names the book and row of the bottom edge, which the bottom book is nearest to', async () => {
    const files = await exportBookFiles(edgy('A'), two({ inset_back_bottom_mm: 4.5 }), fonts);
    expect(files.warnings.find((w) => /on the back/.test(w))).toMatch(/^Book 2, page \d+, row 43: on the back of the letter sheet it prints 3\.85 mm from the bottom edge\./);
    expect(files.warnings.some((w) => /^Book 1/.test(w) && /on the back/.test(w))).toBe(false);
  });

  it('is about what is drawn: a book with nothing near the edge gets no warning, whatever the inset', async () => {
    expect((await exportBookFiles(book(8, 'A', 'letter_two_up'), two({ inset_front_top_mm: 4.5 }), fonts)).warnings).toEqual([]);
    // Book 2 alone has content at the edge.
    const files = await exportBookFiles(book(8, 'A', 'letter_two_up'), two({ inset_back_bottom_mm: 4.5 }), fonts, {}, edgy('B'));
    expect(files.warnings.filter((w) => /^Book 2/.test(w))).toHaveLength(1);
    expect(files.warnings.filter((w) => /^Book 1/.test(w))).toEqual([]);
  });

  it('warns about the labels and the cut marks too when they come within the inset', async () => {
    const files = await exportBookFiles(book(8, 'A', 'letter_two_up'), two({ inset_front_left_mm: 9 }), fonts);
    expect(files.warnings.some((w) => /a label|a cut mark/.test(w) && /mm from the left edge/.test(w))).toBe(true);
    expect((await exportBookFiles(edgy('A'), two({ inset_front_left_mm: 7 }), fonts)).warnings).toEqual([]);
  });

  it('compares the sheet positions with the insets: the offsets, scale and rotation are there to put content there, so they are not counted twice', async () => {
    // Row 43 ends 3.85 mm from the bottom edge (about 4): with an inset of 3 that is fine, whatever the corrections.
    const owner = two({ front_offset_y_mm: -1.65, scale_y_pct: 100.5, back_rotation_deg: 1.5, front_offset_x_mm: 3, back_offset_y_mm: 2 });
    expect((await exportBookFiles(edgy('A'), owner, fonts)).warnings).toEqual([]);
  });

  it('does not warn the owner’s two-up defaults: their corrections are not counted', async () => {
    const files = await exportBookFiles(edgy('A'), { ...clonePrint(DEFAULT_PRINT), sheet_layout: 'letter_two_up', fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, creep_per_sheet_mm: 0.14 }, fonts);
    expect(files.warnings).toEqual([]);
    expect(files.map((f) => f.name)).toContain('print-duplex.pdf'); // two-up defaults to auto duplex
  });

  it('does not apply to half letter, which prints borderless', async () => {
    const p = clonePrint(HALF);
    setPrint(p, { front_offset_y_mm: 3, scale_y_pct: 105 });
    const files = await exportBookFiles(edgy('A'), p, fonts);
    expect(files.warnings).toEqual([]);
  });

  it('still refuses settings that put content past the fold, for both books on the sheet', async () => {
    const p = clonePrint(TWO);
    p.creep_per_sheet_mm = 0.5;
    await expect(exportBookFiles(book(8, 'A', 'letter_two_up'), p, fonts, {}, book(52, 'B', 'letter_two_up'))).rejects.toThrow(/^Book 2: .*past the fold/);
  });
});

describe('size correction', () => {
  it('scales a sheet about its centre and then moves it by the offset', () => {
    const t = { sx: 1.01, sy: 0.99, rot: 0, dx: 0.5, dy: -0.25 };
    const mid = mapPoint(t, 215.9, 279.4, { x: 107.95, y: 139.7 });
    expect(mid.x).toBeCloseTo(107.95 + 0.5, 9);
    expect(mid.y).toBeCloseTo(139.7 - 0.25, 9);
    const a = mapPoint(t, 215.9, 279.4, { x: 40, y: 50 }), b = mapPoint(t, 215.9, 279.4, { x: 140, y: 150 });
    expect(b.x - a.x).toBeCloseTo(101, 9); // 100 mm across prints 101
    expect(b.y - a.y).toBeCloseTo(99, 9);
  });

  it('moves every position of every print PDF, the covers and the calibration sheets as mapPoint says: scaled about the sheet’s centre, then moved by the offset of the side', async () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const b = book(8, 'A', layout), flat = printFor(layout), print = printFor(layout);
      setPrint(print, { scale_x_pct: 101, scale_y_pct: 99.5, front_offset_x_mm: 0.6, front_offset_y_mm: 0.4, back_offset_x_mm: -0.6, back_offset_y_mm: -0.4 });
      const { w, h } = sheetSize(layout);
      const build = async (p: typeof print) => [
        ...(await exportBookFiles(b, p, fonts)).filter((f) => f.name.endsWith('.pdf') && f.name !== 'pages.pdf').map((f) => [f.name, f.bytes] as const),
        [SHEET_FILE, (await sheetFile(b, p, fonts)).bytes] as const,
        ...(await creepFiles(b, p, fonts)).filter((f) => f.name.endsWith('.pdf')).map((f) => [f.name, f.bytes] as const),
      ];
      const [was, now] = [await build(flat), await build(print)];
      expect(now.length).toBeGreaterThan(6);
      for (const [n, [name, bytes]] of now.entries()) {
        expect(was[n][0]).toBe(name);
        const [pagesWas, pagesNow] = [await readPdf(was[n][1]), await readPdf(bytes)];
        for (const [i, page] of pagesNow.entries()) {
          const side = (name === 'print-duplex.pdf' ? i % 2 === 1 : name === SHEET_FILE ? i === 1 : name === CREEP_FILE ? i >= 2 : name === COVER_FILE ? i === 1 : /second|inside/.test(name)) ? 'back' : 'front';
          const t = transformOf(print, side);
          const [a, b2] = [segments(pagesWas[i].content, h), segments(page.content, h)];
          expect(b2.length, `${layout} ${name} page ${i + 1}`).toBe(a.length);
          a.forEach((s, k) => {
            // The edge scales of the calibration sheet are placed with the correction already undone, so they do not move.
            if (name === SHEET_FILE && onEdgeScale((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)) return;
            const p1 = mapPoint(t, w, h, { x: s.x1, y: s.y1 }), p2 = mapPoint(t, w, h, { x: s.x2, y: s.y2 });
            [b2[k].x1, b2[k].y1, b2[k].x2, b2[k].y2].forEach((v, c) => expect(v, `${layout} ${name} page ${i + 1} stroke ${k}`).toBeCloseTo([p1.x, p1.y, p2.x, p2.y][c], 2));
          });
          // The book's own text is left-aligned (it starts at its anchor), so it lands where the anchor does; and is not stretched.
          if (name !== SHEET_FILE && name !== CREEP_FILE && name !== COVER_FILE) {
            const [ta, tb] = [textPositions(pagesWas[i]), textPositions(page)];
            expect(tb.length).toBe(ta.length);
            ta.forEach((s, k) => {
              const p = mapPoint(t, w, h, { x: s.x, y: s.y });
              expect(tb[k].x).toBeCloseTo(p.x, 2);
              expect(tb[k].y).toBeCloseTo(p.y, 2);
            });
          }
        }
      }
    }
  });

  it('adds no transform at 100 %, so half letter’s files are as they were', async () => {
    const files = await exportBookFiles(book(8, 'A', 'half_letter'), HALF, fonts);
    for (const p of await readPdf(file(files, 'print-first.pdf'))) expect(p.content).not.toMatch(/ cm\n/);
  });

  it('scales only the selected layout', async () => {
    const print = clonePrint(HALF);
    print.layouts.letter_two_up.hand.inside.scale_x_pct = 103;
    const [page] = await readPdf(file(await exportBookFiles(book(8, 'A', 'half_letter'), print, fonts), 'print-first.pdf'));
    expect(page.content).not.toMatch(/ cm\n/);
    expect(transformOf(print, 'front').sx).toBe(1);
    print.sheet_layout = 'letter_two_up';
    expect(transformOf(print, 'front').sx).toBe(1.03);
  });

  it('turns only the back about the sheet’s centre, counter-clockwise as seen on the back', () => {
    const print = clonePrint(HALF);
    print.layouts.half_letter.hand.inside.back_rotation_deg = 1;
    expect(transformOf(print, 'front').rot).toBe(0);
    const t = transformOf(print, 'back');
    expect(t.rot).toBeCloseTo(Math.PI / 180, 12);
    // The centre stays put (but for the offset); a point to the right of it rises (y is down on the sheet), and one above it moves left.
    const w = SHEET_W_MM, h = SHEET_H_MM;
    const mid = mapPoint(t, w, h, { x: w / 2, y: h / 2 });
    expect([mid.x, mid.y]).toEqual([w / 2 + t.dx, h / 2 + t.dy]);
    const right = mapPoint(t, w, h, { x: w / 2 + 100, y: h / 2 }), above = mapPoint(t, w, h, { x: w / 2, y: h / 2 - 100 });
    expect(right.y).toBeLessThan(mid.y);
    expect(above.x).toBeLessThan(mid.x);
  });
});

describe('the outside covers', () => {
  const covered = (layout: 'half_letter' | 'letter_two_up') => {
    const b = book(8, 'A', layout);
    setCover(b, 0, labelled('INFRONT')); setCover(b, 9, labelled('INBACK')); setCover(b, -1, labelled('OUTFRONT')); setCover(b, lastSlot(b), labelled('OUTBACK'));
    return b;
  };

  it('are two more pages: the outside front is a right page and the outside back a left page, and neither has a page number', () => {
    const b = emptyBook(8);
    expect(slotSide(-1)).toBe('right');
    expect(slotSide(lastSlot(b))).toBe('left');
    expect(lastSlot(b)).toBe(10);
    setCover(b, -1, labelled('F'));
    setCover(b, 10, { ...labelled('B'), side: 'right' });
    expect(getSlot(b, -1)!.side).toBe('right');
    expect(getSlot(b, 10)!.side).toBe('left'); // turned to face the way its slot faces
    expect(b.cover.outside_front!.name).toBe('F');
    expect(b.cover.outside_back!.name).toBe('B');
    expect(getSlot(b, 0)).toBeNull();
    setCover(b, -1, null);
    expect(getSlot(b, -1)).toBeNull();
  });

  it('are named, and have no partner in an opening', () => {
    const b = emptyBook(8);
    expect(slotLabel(b, -1)).toBe('Outside front cover');
    expect(slotLabel(b, 10)).toBe('Outside back cover');
    expect(opening(-1)).toEqual([-2, -1]);
    expect(opening(0)).toEqual([0, 1]);
    expect(opening(10)).toEqual([10, 11]);
  });

  it('are read from a book file with their sides checked, and are optional', () => {
    const b = covered('half_letter');
    const r = readBook(JSON.parse(JSON.stringify(b)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.cover.outside_back!.name).toBe('OUTBACK');
    const wrong = JSON.parse(JSON.stringify(b));
    wrong.cover.outside_front.side = 'left';
    const bad = readBook(wrong);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((i) => i.path)).toEqual(['cover.outside_front.side']);
    const none = JSON.parse(JSON.stringify(emptyBook(8)));
    delete none.cover.outside_front;
    expect(readBook(none).ok).toBe(true);
  });

  it('print on cover-outside.pdf as outside back | outside front, and cover-inside.pdf as inside front | inside back', async () => {
    const files = await exportBookFiles(covered('half_letter'), HALF, fonts);
    const [outside] = await readPdf(file(files, 'cover-outside.pdf')), [inside] = await readPdf(file(files, 'cover-inside.pdf'));
    expect([...outside.strings].sort()).toEqual(['OUTBACK', 'OUTFRONT']);
    expect([...inside.strings].sort()).toEqual(['INBACK', 'INFRONT']);
    expect(at(outside, 'OUTBACK').x).toBeLessThan(FOLD_X_MM);
    expect(at(outside, 'OUTFRONT').x).toBeGreaterThan(FOLD_X_MM);
    expect(at(inside, 'INFRONT').x).toBeLessThan(FOLD_X_MM);
    expect(at(inside, 'INBACK').x).toBeGreaterThan(FOLD_X_MM);
  });

  it('mirror the cover shift on the two sides: the inside front lands behind the outside front, each moved away from the fold', async () => {
    for (const shift of [0, 2.2, -1]) {
      const print = clonePrint(HALF);
      print.cover_fore_edge_shift_mm = shift;
      const files = await exportBookFiles(covered('half_letter'), print, fonts);
      const [outside] = await readPdf(file(files, 'cover-outside.pdf')), [inside] = await readPdf(file(files, 'cover-inside.pdf'));
      const outFront = at(outside, 'OUTFRONT'), inFront = at(inside, 'INFRONT'), outBack = at(outside, 'OUTBACK'), inBack = at(inside, 'INBACK');
      // Same inset in each page: the outside front starts at fold + shift, the inside front (a left page on the other side of the sheet) at fold - W - shift.
      expect(outFront.x - inFront.x, `shift ${shift}`).toBeCloseTo(PAGE_W_MM + 2 * shift, 3);
      expect(inBack.x - outBack.x, `shift ${shift}`).toBeCloseTo(PAGE_W_MM + 2 * shift, 3);
      // Turned over (left and right swap), the inside front covers exactly the paper the outside front is printed on.
      const rectOut = [FOLD_X_MM + shift, FOLD_X_MM + shift + PAGE_W_MM];
      const rectIn = [FOLD_X_MM - PAGE_W_MM - shift, FOLD_X_MM - shift].map((x) => SHEET_W_MM - x).sort((a, b) => a - b);
      expect(rectIn[0]).toBeCloseTo(rectOut[0], 9);
      expect(rectIn[1]).toBeCloseTo(rectOut[1], 9);
      expect(outFront.y).toBeCloseTo(inFront.y, 4);
    }
  });

  it('take the first pass’s offsets for the outside and the second pass’s for the inside, from the selected layout', async () => {
    const make = async (layout: 'half_letter' | 'letter_two_up', change: Parameters<typeof setPrint>[1]) => {
      const print = printFor(layout);
      setPrint(print, change);
      return exportBookFiles(covered(layout), print, fonts);
    };
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const base = await make(layout, {}), moved = await make(layout, { front_offset_x_mm: 0.7, back_offset_x_mm: -0.4 });
      const x = async (files: ExportedFile[], name: string, text: string) => at((await readPdf(file(files, name)))[0], text).x;
      expect((await x(moved, 'cover-outside.pdf', 'OUTFRONT')) - (await x(base, 'cover-outside.pdf', 'OUTFRONT'))).toBeCloseTo(0.7, 3);
      expect((await x(moved, 'cover-inside.pdf', 'INFRONT')) - (await x(base, 'cover-inside.pdf', 'INFRONT'))).toBeCloseTo(-0.4, 3);
    }
  });

  it('print two to a sheet on letter two-up: the top book’s covers above the bottom book’s', async () => {
    const bottom = covered('letter_two_up');
    for (const slot of [-1, 0, 9, 10]) setCover(bottom, slot, labelled(`B${slot}`));
    const files = await exportBookFiles(covered('letter_two_up'), TWO, fonts, {}, bottom);
    const [outside] = await readPdf(file(files, 'cover-outside.pdf'));
    expect(at(outside, 'OUTFRONT').y).toBeLessThan(SHEET_H_MM);
    expect(at(outside, 'B-1').y).toBeGreaterThan(SHEET_H_MM);
    expect(at(outside, 'B-1').x).toBeCloseTo(at(outside, 'OUTFRONT').x, 3);
    expect(outside.strings).toContain('Book 1 | Book A | outside cover');
    expect(outside.strings).toContain('Book 2 | Book A | outside cover');
    expect(outside.strings.filter((s) => s.startsWith('B'))).toEqual(expect.arrayContaining(['B-1', 'B10']));
  });

  it('stay out of the creep test, which has only sheets', async () => {
    const test = await readPdf((await creepFiles(covered('half_letter'), HALF, fonts)).find((f) => f.name === CREEP_FILE)!.bytes);
    expect(test.flatMap((p) => p.strings).join('\n')).not.toMatch(/OUTFRONT|OUTBACK|INFRONT|INBACK/);
  });

  it('keep the pages.pdf to the interior pages', async () => {
    const files = await exportBookFiles(covered('half_letter'), HALF, fonts);
    expect((await PDFDocument.load(file(files, 'pages.pdf'))).getPageCount()).toBe(8);
  });
});

describe('page geometry stays the sister project’s', () => {
  it('keeps the grid where it was', () => {
    expect([GRID_X_MM, GRID_Y_MM, PAGE_H_MM]).toEqual([3.95, 3.85, 139.7]);
    expect(profileOf(DEFAULT_PRINT)).toBe(DEFAULT_PRINT.layouts.half_letter.hand.inside);
    expect(LAYOUT_NAMES.letter_two_up).toBe('Letter, two-up');
  });
});
