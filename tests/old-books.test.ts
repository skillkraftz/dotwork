import { describe, expect, it } from 'vitest';
import { emptyBook, readBook, setSlot } from '../src/book/book';
import { DEFAULT_PRINT, clonePrint } from '../src/book/impose';
import { emptyPage } from '../src/format/types';
import { savePrinter, loadPrinter, type PrinterStorage } from '../src/printer';
import { exportBookFiles } from '../src/print/export';
import { readFileSync } from 'node:fs';
import { FLAT } from './flat';

/** A book file as an older version wrote it: a valid book whose "print" is whatever that version kept there. */
const bookWith = (print: unknown) => ({ ...JSON.parse(JSON.stringify(emptyBook(8))), print });

const TONES = { shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8 };
const layout = { front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, scale_x_pct: 100, scale_y_pct: 100 };

// The shapes of "print" in the books of each version, from git history.
const SHAPES: Record<string, unknown> = {
  'before PR 16 (paper thickness, back offsets)': { paper_thickness_mm: 0.16, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 2 },
  'PR 16 (tones)': { paper_thickness_mm: 0.16, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 2, ...TONES },
  'PR 17 (front offsets)': { paper_thickness_mm: 0.16, front_offset_x_mm: 0.4, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 2, ...TONES },
  'PR 18 (creep and fore-edge shifts)': { creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5, front_offset_x_mm: 1.7, front_offset_y_mm: 0, back_offset_x_mm: 1.5, back_offset_y_mm: 0, signatures: 2, ...TONES },
  'PR 24 (layouts)': { creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5, sheet_layout: 'letter_two_up', layouts: { half_letter: layout, letter_two_up: layout }, signatures: 2, ...TONES },
};

describe('books saved by every earlier version open', () => {
  for (const [name, print] of Object.entries(SHAPES)) {
    it(`${name}, keeping its signatures`, () => {
      const r = readBook(bookWith(print));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.book.print).toEqual({ signatures: 2 });
    });
  }

  it('opens the owner’s November 2026 journal, saved with the full PR 24 settings', () => {
    const r = readBook(JSON.parse(readFileSync('tests/fixtures/november-2026-journal.json', 'utf8')));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.book.print)).toEqual(['signatures']);
  });

  it('ignores a "print" of any shape, and uses one signature when there is no usable number', () => {
    for (const print of [undefined, null, 'x', 7, [], {}, { layouts: 'broken', sheet_layout: 'nope', creep_per_sheet_mm: 99 }, { signatures: 'many' }, { signatures: 0 }, { signatures: 2.5 }, { signatures: 99 }]) {
      const raw = bookWith(print);
      if (print === undefined) delete raw.print;
      const r = readBook(raw);
      expect(r.ok, JSON.stringify(print)).toBe(true);
      if (r.ok) expect(r.book.print).toEqual({ signatures: 1 });
    }
  });

  it('keeps a good number of signatures', () => {
    const r = readBook(bookWith({ signatures: 3 }));
    expect(r.ok && r.book.print.signatures).toBe(3);
  });
});

describe('settings never touch the book', () => {
  it('a book holds only its signatures, and what is read back is what was written', () => {
    const book = emptyBook(8);
    expect(Object.keys(book.print)).toEqual(['signatures']);
    const r = readBook(JSON.parse(JSON.stringify(book)));
    expect(r.ok && r.book).toEqual(book);
  });

  it('changing the printer profile leaves the book, and whether it opens, unchanged', () => {
    const data: Record<string, string> = {};
    const storage: PrinterStorage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
    const book = emptyBook(8);
    const before = JSON.stringify(book);
    const profile = clonePrint(DEFAULT_PRINT);
    // wild values: the printer profile's own limits are for the printer's fields, the book never sees them
    Object.assign(profile, { creep_per_sheet_mm: 0.9, fore_edge_shift_mm: -9, shade_dark_pct: 3 });
    Object.assign(profile.layouts.letter_two_up, { back_rotation_deg: 1.5, back_offset_x_mm: 9, scale_x_pct: 104 });
    profile.sheet_layout = 'letter_two_up';
    expect(savePrinter(storage, profile)).toBeNull();
    expect(loadPrinter(storage).status).toBe('ok');
    expect(JSON.stringify(book)).toBe(before);
    expect(readBook(JSON.parse(before)).ok).toBe(true);
  });

  it('prints with the printer profile it is given, not anything in the book', async () => {
    const fontBytes = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
    const book = emptyBook(8);
    setSlot(book, 1, { ...emptyPage(), identity: '', elements: [{ type: 'text', x: 1, y: 3, text: 'HELLO', tone: 'black' }] });
    const a = await exportBookFiles(book, DEFAULT_PRINT, fontBytes, { pages: false, cover: false });
    const twoUp = clonePrint(DEFAULT_PRINT); twoUp.sheet_layout = 'letter_two_up';
    twoUp.layouts.letter_two_up = { ...FLAT.layouts.letter_two_up }; // the owner’s calibrated two-up offsets put the last row inside the 3 mm edge check

    const b = await exportBookFiles(book, twoUp, fontBytes, { pages: false, cover: false });
    expect(a.map((f) => f.name)).toContain('print-first.pdf');
    expect(b.map((f) => f.name)).toContain('print-duplex.pdf');
  });
});
