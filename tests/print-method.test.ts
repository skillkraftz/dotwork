// The print method (auto duplex or by hand) and the paper set (inside or cover): which file is made for which, and which offsets it uses.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook, setCover, type Book } from '../src/book/book';
import { emptyPage, type Page } from '../src/format/types';
import { withPages } from './books';
import { DEFAULT_PRINT, clonePrint, everywhere, printOrder, profileOf, type PrintSettings } from '../src/book/impose';
import { COVER_FILE, CREEP_FILE, SHEET_FILE, calibrationText, creepFiles, creepTestOrder, sheetFile } from '../src/print/calibrate';
import { exportBookFiles, type ExportedFile } from '../src/print/export';
import { madeFor } from '../src/print/settingstext';
import { transformOf } from '../src/print/sheets';
import { readPrinter } from '../src/printer';
import { FLAT, flatTwoUp } from './flat';
import { readPdf, textPositions } from './pdf-text';

const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const NOW = new Date(2026, 9, 20, 12, 0, 0);
const file = (files: ExportedFile[], name: string) => files.find((f) => f.name === name)!;
const decode = (f: ExportedFile) => new TextDecoder().decode(f.bytes);
const withMethod = (p: PrintSettings, method: 'auto' | 'hand'): PrintSettings => ({ ...clonePrint(p), print_method: { half_letter: method, letter_two_up: method } });

describe('the creep test’s page order for a 52-page book (13 sheets)', () => {
  it('by hand: the innermost front, the outermost front, the outermost back, the innermost back', () => {
    expect(creepTestOrder(13, 'hand')).toEqual([{ sheet: 12, side: 'front' }, { sheet: 0, side: 'front' }, { sheet: 0, side: 'back' }, { sheet: 12, side: 'back' }]);
  });

  it('auto duplex: each tested sheet’s front then its back, the outermost first', () => {
    expect(creepTestOrder(13, 'auto')).toEqual([{ sheet: 0, side: 'front' }, { sheet: 0, side: 'back' }, { sheet: 12, side: 'front' }, { sheet: 12, side: 'back' }]);
  });

  it('is the order of every sheet in a book too: print-first fronts reversed, print-second backs forward; print-duplex front, back from the outermost', () => {
    expect(printOrder(3, 'hand').map((o) => `${o.sheet}${o.side[0]}`)).toEqual(['2f', '1f', '0f', '0b', '1b', '2b']);
    expect(printOrder(3, 'auto').map((o) => `${o.sheet}${o.side[0]}`)).toEqual(['0f', '0b', '1f', '1b', '2f', '2b']);
  });

  it('is what the PDF’s pages say, for both methods', async () => {
    for (const method of ['hand', 'auto'] as const) {
      const made = await creepFiles(emptyBook(52), withMethod(FLAT, method), fontBytes, NOW);
      const pages = await readPdf(file(made, CREEP_FILE).bytes);
      const seen = pages.map((p) => `${p.strings.find((s) => /^SHEET \d+ OF 13/.test(s))!.match(/\d+/)![0]} ${p.strings.find((s) => /^(FRONT|BACK), left/.test(s))!.split(',')[0]}`);
      expect(seen, method).toEqual(creepTestOrder(13, method).map((o) => `${o.sheet + 1} ${o.side.toUpperCase()}`));
      // The instruction on the page follows the method.
      expect(pages[0].strings.some((s) => (method === 'auto' ? /double-sided/ : /pass 1/).test(s)), method).toBe(true);
    }
  });
});

describe('every test file says what it was made for', () => {
  it('prints the layout, the print method and the paper set in the footer of every page', async () => {
    for (const base of [FLAT, flatTwoUp()]) for (const method of ['hand', 'auto'] as const) {
      const print = withMethod(base, method), made = await creepFiles(emptyBook(52), print, fontBytes, NOW);
      const sheet = await sheetFile(emptyBook(52), print, fontBytes, NOW);
      const forInside = `made for ${madeFor(print, 'inside')}`, forCover = `made for ${madeFor(print, 'cover')}`;
      expect(forInside).toMatch(new RegExp(`${method === 'auto' ? 'auto duplex' : 'by hand'} \\| inside paper$`));
      const halves = base === FLAT ? 1 : 2; // a two-up sheet repeats the spread in both halves
      for (const p of await readPdf(file(made, CREEP_FILE).bytes)) expect(p.strings.filter((s) => s === forInside)).toHaveLength(2 * halves); // both pages of the spread
      for (const p of await readPdf(file(made, COVER_FILE).bytes)) expect(p.strings.filter((s) => s === forCover)).toHaveLength(2 * halves);
      const [front] = await readPdf(sheet.bytes);
      expect(front.strings).toContain(forInside);
    }
  });

  it('puts the paper set in the calibration sheet’s footer, and calibration.txt gives the steps of the chosen method only', async () => {
    const print = withMethod(FLAT, 'auto');
    const sheet = await sheetFile(emptyBook(52), print, fontBytes, NOW, 'cover');
    expect((await readPdf(sheet.bytes))[0].strings).toContain(`made for ${madeFor(print, 'cover')}`);
    const auto = calibrationText(emptyBook(52), print, NOW), hand = calibrationText(emptyBook(52), withMethod(FLAT, 'hand'), NOW);
    expect(auto).toContain('auto duplex');
    expect(auto).not.toMatch(/put the (stack|sheet) back/);
    expect(hand).toMatch(/put the stack back/);
    expect(hand).not.toContain('auto duplex');
    expect(SHEET_FILE).toBe('calibration-sheet.pdf');
  });
});

describe('which offsets a file uses', () => {
  /** Different offsets for every (method, paper) of half letter: auto inside 1, auto cover 2, hand inside 3, hand cover 4 (the back is 0.5 more). */
  const distinct = (): PrintSettings => {
    const p = clonePrint(FLAT);
    let n = 1;
    for (const method of ['auto', 'hand'] as const) for (const paper of ['inside', 'cover'] as const) {
      Object.assign(p.layouts.half_letter[method][paper], { front_offset_x_mm: n, front_offset_y_mm: 0, back_offset_x_mm: n + 0.5, back_offset_y_mm: 0 });
      n += 1;
    }
    return p;
  };
  const labelled = (label: string): Page => ({ ...emptyPage(), identity: '', page_number: false, elements: [{ type: 'text', x: 3, y: 10, text: label, size: 'heading' }] });
  const booked = (): Book => {
    const b = emptyBook(8);
    b.page_numbers = false;
    withPages(b, Array.from({ length: 8 }, (_, i) => labelled(`P${i + 1}`)));
    setCover(b, 0, labelled('FRONT')); setCover(b, 9, labelled('BACK')); setCover(b, -1, labelled('OUTFRONT')); setCover(b, 10, labelled('OUTBACK'));
    return b;
  };
  const x = async (files: ExportedFile[], name: string, label: string, page = 0) => textPositions((await readPdf(file(files, name).bytes))[page]).find((t) => t.text === label)!.x;

  it('the transform reads the layout’s method and paper', () => {
    const p = distinct();
    expect(p.print_method.half_letter).toBe('hand');
    expect(transformOf(p, 'front', 'inside').dx).toBe(3);
    expect(transformOf(p, 'front', 'cover').dx).toBe(4);
    expect(transformOf(p, 'back', 'inside').dx).toBe(3.5);
    expect(transformOf(p, 'back', 'cover').dx).toBe(4.5);
    p.print_method.half_letter = 'auto';
    expect(transformOf(p, 'front', 'inside').dx).toBe(1);
    expect(transformOf(p, 'front', 'cover').dx).toBe(2);
    expect(transformOf(p, 'back', 'cover').dx).toBe(2.5);
    expect(transformOf(p, 'front').dx).toBe(1); // the inside paper unless it says otherwise
  });

  it('the pages use the inside paper’s set and the covers the cover paper’s, for the chosen method', async () => {
    for (const method of ['hand', 'auto'] as const) {
      const inside = method === 'hand' ? 3 : 1, cover = inside + 1;
      const was = await exportBookFiles(booked(), withMethod(FLAT, method), fontBytes), now = await exportBookFiles(booked(), withMethod(distinct(), method), fontBytes);
      const [first, second] = method === 'hand' ? ['print-first.pdf', 'print-second.pdf'] : ['print-duplex.pdf', 'print-duplex.pdf'];
      expect(was.some((f) => f.name === (method === 'hand' ? 'print-duplex.pdf' : 'print-first.pdf')), `${method}: only its own files`).toBe(false);
      // Sheet 1's front (P1, page 0 of print-duplex; page 1 of print-first, after sheet 2's front) and back (P2) take the inside set's offsets...
      const fp = method === 'hand' ? 1 : 0, sp = method === 'hand' ? 0 : 1;
      expect((await x(now, first, 'P1', fp)) - (await x(was, first, 'P1', fp)), `${method} front`).toBeCloseTo(inside, 2);
      expect((await x(now, second, 'P2', sp)) - (await x(was, second, 'P2', sp)), `${method} back`).toBeCloseTo(inside + 0.5, 2);
      // ...and the covers the cover set's.
      expect((await x(now, 'cover-outside.pdf', 'OUTFRONT')) - (await x(was, 'cover-outside.pdf', 'OUTFRONT')), `${method} outside cover`).toBeCloseTo(cover, 2);
      expect((await x(now, 'cover-inside.pdf', 'FRONT')) - (await x(was, 'cover-inside.pdf', 'FRONT')), `${method} inside cover`).toBeCloseTo(cover + 0.5, 2);
    }
  });

  it('the cover test uses the cover paper’s set, the creep test the inside paper’s', async () => {
    const p = clonePrint(FLAT);
    Object.assign(p.layouts.half_letter.hand.cover, { front_offset_x_mm: 2, back_offset_x_mm: 2 });
    const was = await creepFiles(emptyBook(8), FLAT, fontBytes, NOW), now = await creepFiles(emptyBook(8), p, fontBytes, NOW);
    expect((await x(now, COVER_FILE, 'COVER, outside back cover')) - (await x(was, COVER_FILE, 'COVER, outside back cover'))).toBeCloseTo(2, 2);
    const creepFirst = (await readPdf(file(was, CREEP_FILE).bytes))[0].strings.find((s) => /^SHEET/.test(s))!;
    expect((await x(now, CREEP_FILE, creepFirst)) - (await x(was, CREEP_FILE, creepFirst))).toBeCloseTo(0, 2);
  });
});

describe('loading a profile saved before methods and papers', () => {
  const old = (layout: object) => ({
    creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5, sheet_layout: 'letter_two_up',
    shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8, layouts: layout,
  });
  const own = { front_offset_x_mm: 0.9, front_offset_y_mm: -0.7, back_offset_x_mm: 1.1, back_offset_y_mm: 0.4, scale_x_pct: 100.2, scale_y_pct: 100.8, back_rotation_deg: -0.2, line_weight_x_pct: 95 };

  it('keeps its numbers for the inside paper in every method, copies them to the cover paper, and starts each layout on its default method', () => {
    const r = readPrinter(old({ letter_two_up: own }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const method of ['auto', 'hand'] as const) {
      expect(r.value.layouts.letter_two_up[method].inside, method).toEqual(own);
      expect(r.value.layouts.letter_two_up[method].cover, method).toEqual(own);
    }
    expect(r.value.layouts.half_letter).toEqual(DEFAULT_PRINT.layouts.half_letter); // a layout it never had is the default's
    expect(r.value.print_method).toEqual({ half_letter: 'hand', letter_two_up: 'auto' });
    expect(r.value.layouts.letter_two_up.auto.cover).not.toBe(r.value.layouts.letter_two_up.auto.inside); // copies, not the same object
  });

  it('refuses a method that is not auto or hand, naming it', () => {
    const r = readPrinter({ ...clonePrint(DEFAULT_PRINT), print_method: { half_letter: 'sideways' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(['print_method.half_letter']);
  });

  it('round-trips the new shape, the cover paper apart from the inside paper', () => {
    const p = clonePrint(DEFAULT_PRINT);
    p.layouts.half_letter.hand.cover.front_offset_x_mm = 2.5;
    p.print_method.half_letter = 'auto';
    const r = readPrinter(JSON.parse(JSON.stringify(p)));
    expect(r.ok && r.value).toEqual(p);
    expect(r.ok && r.value.layouts.half_letter.hand.inside.front_offset_x_mm).toBe(1.7);
    expect(everywhere(own).hand.cover).toEqual(own);
  });
});

describe('the book’s readme (summary.txt) and files follow the method', () => {
  it('gives the steps of the chosen method only, and names the method', async () => {
    for (const [base, twoUp] of [[FLAT, false], [flatTwoUp(), true]] as const) {
      const auto = await exportBookFiles(emptyBook(8), withMethod(base, 'auto'), fontBytes), hand = await exportBookFiles(emptyBook(8), withMethod(base, 'hand'), fontBytes);
      expect(auto.map((f) => f.name).filter((n) => /^print-/.test(n)), `auto ${twoUp}`).toEqual(['print-duplex.pdf']);
      expect(hand.map((f) => f.name).filter((n) => /^print-/.test(n)), `hand ${twoUp}`).toEqual(['print-first.pdf', 'print-second.pdf']);
      const [a, h] = [decode(file(auto, 'summary.txt')), decode(file(hand, 'summary.txt'))];
      expect(a).toContain('Print method: Printer flips the paper (auto duplex)');
      expect(a).toContain('print-duplex.pdf');
      expect(a).not.toMatch(/print-first|print-second/);
      expect(h).toContain('Print method: I flip the paper by hand');
      expect(h).toMatch(/print-first\.pdf, put the stack back/);
      expect(h).not.toContain('print-duplex');
    }
  });
});
