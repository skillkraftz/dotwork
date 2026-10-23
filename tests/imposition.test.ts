import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT, FOLD_X_MM, SHEET_H_MM, SHEET_W_MM, TRIM_ZONE_MM, checkPrintSettings, creepFor, duplexOrder, impose,
  pageOrigin, signatureSizes, type PageRef, type PrintSettings,
} from '../src/book/impose';
import { PAGE_H_MM, PAGE_W_MM } from '../src/format/types';

// The same cases as journal-system's tests/test_foundation.py (its default paper is 0.1 mm; Dotwork's measured 0.14 mm).
const S: PrintSettings = DEFAULT_PRINT;
const JOURNAL = { creep_per_sheet_mm: 0.1 };
const flat = (sigs: ReturnType<typeof impose>): PageRef[] =>
  sigs.flatMap((g) => g.sheets.flatMap((sh) => [sh.front.left, sh.front.right, sh.back.left, sh.back.right]));

describe('page order', () => {
  it('saddle-stitches 8 pages', () => {
    const [sig] = impose(8, S);
    expect(sig.sheets.map((x) => [x.front.left, x.front.right, x.back.left, x.back.right])).toEqual([[8, 1, 2, 7], [6, 3, 4, 5]]);
  });

  it.each([4, 12, 52])('puts every page of %i once, and every spread sums to pages + 1', (pages) => {
    const [sig] = impose(pages, S);
    const seen: number[] = [];
    for (const sh of sig.sheets) {
      for (const side of [sh.front, sh.back]) {
        expect(side.left! + side.right!).toBe(pages + 1);
        seen.push(side.left!, side.right!);
      }
    }
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: pages }, (_, i) => i + 1));
    expect(sig.sheets).toHaveLength(pages / 4);
  });

  it('keeps odd pages on the right and even pages on the left', () => {
    for (const sh of impose(52, S)[0].sheets) {
      for (const side of [sh.front, sh.back]) {
        expect(side.left! % 2).toBe(0);
        expect(side.right! % 2).toBe(1);
      }
    }
  });

  it('pads multiple signatures with blank filler pages', () => {
    const sigs = impose(10, S, 2);
    expect(sigs.map((g) => g.pages)).toEqual([8, 8]);
    expect(sigs[1].firstPage).toBe(9);
    const pages = flat(sigs);
    expect(pages.filter((p) => p).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pages.filter((p) => p === null)).toHaveLength(6);
  });

  it('splits 52 pages into evenly sized signatures of whole sheets', () => {
    expect(signatureSizes(52, 1)).toEqual([52]);
    expect(signatureSizes(52, 2)).toEqual([28, 28]);
    expect(signatureSizes(8, 4)).toEqual([4, 4]); // fewer signatures come back if the pages run out
    expect(signatureSizes(8, 5)).toEqual([4, 4]);
    expect(() => signatureSizes(0)).toThrow();
    expect(() => signatureSizes(8, 0)).toThrow();
  });

  it('numbers the pages of later signatures from where the last one ended', () => {
    const sigs = impose(16, S, 2);
    expect(sigs[1].sheets[0].front).toEqual({ left: 16, right: 9 });
  });
});

describe('duplex split', () => {
  it('prints fronts in reverse sheet order and backs in forward order', () => {
    const n = 13;
    // sheets alternate front/back in the booklet; fronts = odd pages reversed, backs = even pages in order
    const sequence = Array.from({ length: n }, (_, k) => [[k, 'f'], [k, 'b']] as const).flat();
    const first = sequence.filter((x) => x[1] === 'f').map((x) => x[0]).reverse();
    const second = sequence.filter((x) => x[1] === 'b').map((x) => x[0]);
    expect(duplexOrder(n)).toEqual([first, second]);
    expect(first[0]).toBe(12);
    expect(second[0]).toBe(0);
  });
});

describe('centering', () => {
  it('centers the spread on the fold, the page full height', () => {
    const l = pageOrigin(false, 0), r = pageOrigin(true, 0);
    expect(SHEET_W_MM).toBeCloseTo(215.9);
    expect(SHEET_H_MM).toBeCloseTo(139.7);
    expect(l.x).toBeCloseTo(TRIM_ZONE_MM);
    expect(l.x).toBeCloseTo(19.05);
    expect(r.x).toBeCloseTo(FOLD_X_MM);
    expect(r.x + PAGE_W_MM).toBeCloseTo(SHEET_W_MM - TRIM_ZONE_MM);
    expect(r.y).toBe(0);
    expect(PAGE_H_MM).toBeCloseTo(SHEET_H_MM);
    expect(FOLD_X_MM - l.x).toBeCloseTo(r.x + PAGE_W_MM - FOLD_X_MM); // symmetric about the fold
  });
});

describe('creep', () => {
  it("is the number of sheets outside times the paper thickness, on journal-system's numbers", () => {
    const [sig] = impose(52, JOURNAL);
    expect(sig.sheets.map((sh) => sh.creep)).toEqual(Array.from({ length: 13 }, (_, k) => expect.closeTo(k * 0.1, 9)));
    expect(sig.sheets[0].creep).toBe(0);
    expect(sig.sheets.at(-1)!.creep).toBeCloseTo(1.2);
  });

  it('defaults to the creep worked out from the owner’s readings (provisional)', () => {
    expect(S.creep_per_sheet_mm).toBe(0.3);
    expect(creepFor(12, S)).toBeCloseTo(3.6);
    expect(impose(52, S)[0].sheets.at(-1)!.creep).toBeCloseTo(3.6);
  });

  it('shifts the left page right and the right page left, toward the fold', () => {
    const l = pageOrigin(false, 1.2), r = pageOrigin(true, 1.2);
    expect(l.x).toBeCloseTo(TRIM_ZONE_MM + 1.2);
    expect(r.x).toBeCloseTo(FOLD_X_MM - 1.2);
  });

  it('cannot cross the fold: it must stay inside the page margin', () => {
    expect(checkPrintSettings(S, 13)).toBeNull();
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.5 }, 13)).toMatch(/past the fold/);
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.5 }, 5)).toBeNull(); // fewer sheets per signature, less creep (and the shift gives room)
  });

  it('refuses settings that are not numbers', () => {
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: -1 }, 13)).toMatch(/Creep per sheet/);
    expect(checkPrintSettings({ ...S, layouts: { ...S.layouts, half_letter: { ...S.layouts.half_letter, back_offset_x_mm: NaN } } }, 13)).toMatch(/offset/);
    expect(checkPrintSettings({ ...S, layouts: { ...S.layouts, letter_two_up: { ...S.layouts.letter_two_up, front_offset_y_mm: NaN } } }, 13)).toMatch(/offset/);
    expect(checkPrintSettings({ ...S, layouts: { ...S.layouts, half_letter: { ...S.layouts.half_letter, back_rotation_deg: 2 } } }, 13)).toMatch(/rotation/);
  });
});
