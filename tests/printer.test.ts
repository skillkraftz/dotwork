import { describe, expect, it } from 'vitest';
import { emptyBook, readBook } from '../src/book/book';
import { DEFAULT_PRINT, clonePrint, type LayoutProfile, type PrintSettings } from '../src/book/impose';
import { PRINTER_KEY, PRINTER_KEYS, differing, loadPrinter, printerOf, savePrinter, startingPrint, type PrinterStorage } from '../src/printer';

/** A storage that is a plain object, or one that refuses. */
const memory = (initial: Record<string, string> = {}): PrinterStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const refusing = (message: string): PrinterStorage => ({ getItem: () => { throw new Error(message); }, setItem: () => { throw new Error(message); } });

const calibrated = setPrintCopy({ ...clonePrint(DEFAULT_PRINT), creep_per_sheet_mm: 0.11, shade_light_pct: 9 }, { front_offset_x_mm: -1.5, front_offset_y_mm: 0.3, back_offset_x_mm: 1.4, back_offset_y_mm: -0.2 });
function setPrintCopy(p: PrintSettings, change: Partial<LayoutProfile>): PrintSettings { Object.assign(p.layouts.half_letter, change); return p; }

describe('the printer profile', () => {
  it('holds the creep, the shifts, the target and the tones, and each layout’s offsets and scale, but not the signatures', () => {
    expect([...PRINTER_KEYS].sort()).toEqual(['cover_fore_edge_shift_mm', 'creep_per_sheet_mm', 'fore_edge_shift_mm', 'gray_text_pct', 'shade_dark_pct', 'shade_light_pct', 'shade_medium_pct', 'target_fore_edge_margin_mm']);
    expect(printerOf({ ...calibrated, signatures: 3 })).not.toHaveProperty('signatures');
    expect(Object.keys(printerOf(calibrated).layouts)).toEqual(['half_letter', 'letter_two_up']);
  });

  it('is saved and loaded back', () => {
    const storage = memory();
    expect(savePrinter(storage, { ...calibrated, signatures: 3 })).toBeNull();
    expect(JSON.parse(storage.data[PRINTER_KEY])).toEqual(printerOf(calibrated));
    const loaded = loadPrinter(storage);
    expect(loaded).toEqual({ status: 'ok', value: printerOf(calibrated) });
  });

  it('is none when nothing is saved', () => {
    expect(loadPrinter(memory())).toEqual({ status: 'none' });
    expect(loadPrinter(null)).toEqual({ status: 'none' });
  });

  it('starts a new book: the saved settings over the defaults, signatures from the defaults', () => {
    expect(startingPrint(null)).toEqual(DEFAULT_PRINT);
    const book = emptyBook(8, startingPrint(printerOf({ ...calibrated, signatures: 4 })));
    expect(book.print).toEqual({ ...calibrated, signatures: DEFAULT_PRINT.signatures });
    expect(emptyBook().print).toEqual(DEFAULT_PRINT);
    expect(readBook(JSON.parse(JSON.stringify(book))).ok).toBe(true); // and it is still a valid book
  });

  it('is not shared with the book: changing the book afterwards leaves the saved settings alone', () => {
    const saved = printerOf(calibrated);
    const book = emptyBook(8, startingPrint(saved));
    book.print.layouts.half_letter.front_offset_x_mm = 9;
    expect(saved.layouts.half_letter.front_offset_x_mm).toBe(-1.5);
  });

  it('says which of the book’s settings differ from the saved ones, and none when they agree', () => {
    const saved = printerOf(calibrated);
    expect(differing(calibrated, saved)).toEqual([]);
    expect(differing({ ...calibrated, signatures: 5 }, saved)).toEqual([]); // not a printer setting
    const other = { ...calibrated, shade_light_pct: 6.3, layouts: { ...calibrated.layouts, half_letter: { ...calibrated.layouts.half_letter, front_offset_x_mm: 0 } } };
    expect(differing(other, saved).map((d) => d.name)).toEqual(['light', 'half letter front offset x']);
    expect(differing(DEFAULT_PRINT, saved).length).toBeGreaterThan(0);
  });

  it('reports a storage that refuses, with the browser’s own reason', () => {
    const problem = savePrinter(refusing('The operation is insecure.'), calibrated);
    expect(problem).not.toBeNull();
    expect(problem!.lines.join(' ')).toContain('The operation is insecure.');
    expect(problem!.details).toContain('The operation is insecure.');
    expect(savePrinter(null, calibrated)!.lines.join(' ')).toMatch(/blocked/);
    const load = loadPrinter(refusing('Access is denied.'));
    expect(load.status).toBe('bad');
    if (load.status === 'bad') expect(load.problem.lines.join(' ')).toContain('Access is denied.');
  });

  it('reports a quota error as storage being full', () => {
    const full: PrinterStorage = { getItem: () => null, setItem: () => { throw Object.assign(new Error('x'), { name: 'QuotaExceededError' }); } };
    expect(savePrinter(full, calibrated)!.lines.join(' ')).toMatch(/storage is full/);
  });

  it('refuses stored settings that break the format’s limits, naming each, and does not use them', () => {
    const bad = memory({ [PRINTER_KEY]: JSON.stringify({ ...printerOf(calibrated), layouts: { ...calibrated.layouts, letter_two_up: { ...calibrated.layouts.letter_two_up, scale_x_pct: 110 } }, gray_text_pct: 'dark' }) });
    const load = loadPrinter(bad);
    expect(load.status).toBe('bad');
    if (load.status === 'bad') {
      const text = load.problem.details;
      expect(text).toContain('layouts.letter_two_up.scale_x_pct');
      expect(text).toContain('gray_text_pct');
    }
    const old = memory({ [PRINTER_KEY]: JSON.stringify({ creep_per_sheet_mm: 0.14 }) }); // saved before layouts existed
    expect(loadPrinter(old).status).toBe('bad');
    expect(loadPrinter(memory({ [PRINTER_KEY]: '{not json' })).status).toBe('bad');
    expect(loadPrinter(memory({ [PRINTER_KEY]: '[]' })).status).toBe('bad');
  });
});

describe('the layouts in the book file', () => {
  it('require every offset and scale of each layout, within their limits, with the path', () => {
    const limits = { front_offset_x_mm: [-10.1, 10.1], front_offset_y_mm: [-10.1, 10.1], back_offset_x_mm: [-10.1, 10.1], back_offset_y_mm: [-10.1, 10.1], scale_x_pct: [94.9, 105.1], scale_y_pct: [94.9, 105.1] } as const;
    for (const layout of ['half_letter', 'letter_two_up'] as const) for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      for (const bad of [...limits[key], 'x', null]) {
        const b = JSON.parse(JSON.stringify(emptyBook(8)));
        b.print.layouts[layout][key] = bad;
        const r = readBook(b);
        expect(r.ok, `${layout} ${key} ${bad}`).toBe(false);
        if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual([`print.layouts.${layout}.${key}`]);
      }
      const missing = JSON.parse(JSON.stringify(emptyBook(8)));
      delete missing.print.layouts[layout][key];
      expect(readBook(missing).ok).toBe(false);
    }
  });

  it('round-trip', () => {
    const b = emptyBook(8);
    Object.assign(b.print.layouts.half_letter, { front_offset_x_mm: -1.5, front_offset_y_mm: 0.25 });
    const r = readBook(JSON.parse(JSON.stringify(b)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.print).toEqual(b.print);
  });
});
