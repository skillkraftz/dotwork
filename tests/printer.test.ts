import { describe, expect, it } from 'vitest';
import { emptyBook, readBook } from '../src/book/book';
import { DEFAULT_PRINT, clonePrint, type LayoutProfile, type PrintSettings } from '../src/book/impose';
import { PRINTER_KEY, PRINTER_KEYS, loadPrinter, readPrinter, savePrinter, type PrinterStorage } from '../src/printer';

/** A storage that is a plain object, or one that refuses. */
const memory = (initial: Record<string, string> = {}): PrinterStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const refusing = (message: string): PrinterStorage => ({ getItem: () => { throw new Error(message); }, setItem: () => { throw new Error(message); } });

const calibrated = setPrintCopy({ ...clonePrint(DEFAULT_PRINT), creep_per_sheet_mm: 0.11, shade_light_pct: 9 }, { front_offset_x_mm: -1.5, front_offset_y_mm: 0.3, back_offset_x_mm: 1.4, back_offset_y_mm: -0.2, back_rotation_deg: 0.12 });
function setPrintCopy(p: PrintSettings, change: Partial<LayoutProfile>): PrintSettings { Object.assign(p.layouts.half_letter, change); return p; }

describe('the printer profile', () => {
  it('holds the creep, the shifts, the target and the tones, and each layout’s offsets, rotation and scale, but not the signatures', () => {
    expect([...PRINTER_KEYS].sort()).toEqual(['cover_fore_edge_shift_mm', 'creep_per_sheet_mm', 'fore_edge_shift_mm', 'gray_text_pct', 'shade_dark_pct', 'shade_light_pct', 'shade_medium_pct', 'target_fore_edge_margin_mm']);
    expect(DEFAULT_PRINT).not.toHaveProperty('signatures');
    expect(Object.keys(calibrated.layouts)).toEqual(['half_letter', 'letter_two_up']);
    expect(Object.keys(DEFAULT_PRINT.layouts.half_letter)).toContain('back_rotation_deg');
  });

  it('is saved and loaded back', () => {
    const storage = memory();
    expect(savePrinter(storage, calibrated)).toBeNull();
    expect(JSON.parse(storage.data[PRINTER_KEY])).toEqual(calibrated);
    expect(loadPrinter(storage)).toEqual({ status: 'ok', value: calibrated });
  });

  it('is none when nothing is saved', () => {
    expect(loadPrinter(memory())).toEqual({ status: 'none' });
    expect(loadPrinter(null)).toEqual({ status: 'none' });
  });

  it('is the only place the print settings live: a new book has none of them, only its signatures', () => {
    expect(emptyBook(8).print).toEqual({ signatures: 1 });
    expect(readBook(JSON.parse(JSON.stringify(emptyBook(8)))).ok).toBe(true);
  });

  it('is its own copy: editing a loaded profile leaves the saved text alone', () => {
    const storage = memory();
    savePrinter(storage, calibrated);
    const loaded = loadPrinter(storage);
    if (loaded.status === 'ok') loaded.value.layouts.half_letter.front_offset_x_mm = 9;
    expect(JSON.parse(storage.data[PRINTER_KEY]).layouts.half_letter.front_offset_x_mm).toBe(-1.5);
  });

  it('reads a profile saved before the back rotation existed, as no rotation', () => {
    const old = clonePrint(DEFAULT_PRINT) as unknown as { layouts: Record<string, Record<string, unknown>> };
    for (const l of Object.values(old.layouts)) delete l.back_rotation_deg;
    const r = readPrinter(old);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.layouts.half_letter.back_rotation_deg).toBe(0);
  });

  it('reads a profile saved before the line weight existed, as 100 % (nothing changes), and keeps the rest of it', () => {
    const old = clonePrint(calibrated) as unknown as { layouts: Record<string, Record<string, unknown>> };
    for (const l of Object.values(old.layouts)) delete l.line_weight_x_pct;
    const r = readPrinter(old);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.layouts.half_letter.line_weight_x_pct).toBe(100);
      expect(r.value.layouts.letter_two_up.line_weight_x_pct).toBe(100);
      expect(r.value.layouts.half_letter.front_offset_x_mm).toBe(-1.5);
    }
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
    const bad = memory({ [PRINTER_KEY]: JSON.stringify({ ...calibrated, layouts: { ...calibrated.layouts, letter_two_up: { ...calibrated.layouts.letter_two_up, scale_x_pct: 110 } }, gray_text_pct: 'dark' }) });
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

describe('the layouts in the printer profile', () => {
  it('require every offset, the rotation and the scale of each layout, within their limits, with the path', () => {
    const limits = { front_offset_x_mm: [-10.1, 10.1], front_offset_y_mm: [-10.1, 10.1], back_offset_x_mm: [-10.1, 10.1], back_offset_y_mm: [-10.1, 10.1], back_rotation_deg: [-1.6, 1.6], scale_x_pct: [94.9, 105.1], scale_y_pct: [94.9, 105.1], line_weight_x_pct: [79.9, 120.1] } as const;
    for (const layout of ['half_letter', 'letter_two_up'] as const) for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      for (const bad of [...limits[key], 'x', null]) {
        const p = JSON.parse(JSON.stringify(DEFAULT_PRINT));
        p.layouts[layout][key] = bad;
        const r = readPrinter(p);
        expect(r.ok, `${layout} ${key} ${bad}`).toBe(false);
        if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual([`layouts.${layout}.${key}`]);
      }
    }
  });
});
