import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyBook } from '../src/book/book';
import { SHEET_H_MM, clonePrint } from '../src/book/impose';
import { INSET_EDGES, INSET_SCALE_MM, insetScalePoint, sheetHeight } from '../src/book/alignment';
import { placeBooks } from '../src/print/placement';
import { mapPoint, transformOf, unmapPoint, LETTER_H_MM, LETTER_W_MM, cutMarks } from '../src/print/sheets';
import { sheetFile } from '../src/print/calibrate';
import { FLAT, flatTwoUp, setPrint } from './flat';
import { readPdf, segments } from './pdf-text';

const fonts = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const two = (change: Parameters<typeof setPrint>[1] = {}) => { const p = clonePrint(flatTwoUp()); setPrint(p, change); return p; };

describe('placing the two books on a letter sheet', () => {
  it('puts the books where they are today at the default margin: touching, filling the sheet, no waste', () => {
    const p = placeBooks(two());
    expect(p.pageTops).toEqual([0, SHEET_H_MM]);
    expect(p.cuts).toEqual([0, SHEET_H_MM, LETTER_H_MM]);
    expect(p.bookHeight).toBeCloseTo(SHEET_H_MM, 9);
    expect(p).toMatchObject({ wasteTop: 0, wasteBottom: 0, fits: true, largestMargin: null });
  });

  it('is one book on its own sheet for half letter', () => {
    expect(placeBooks(FLAT)).toMatchObject({ pageTops: [0], cuts: [0, SHEET_H_MM], fits: true });
  });

  it('cuts each book to 132 + 2 x margin and splits the leftover evenly when the insets allow', () => {
    const p = placeBooks(two({ trim_margin_mm: 3 }));
    expect(p.bookHeight).toBeCloseTo(138, 9);
    expect(p.wasteTop).toBeCloseTo(1.7, 6);
    expect(p.wasteBottom).toBeCloseTo(1.7, 6);
    expect(p.cuts[1] - p.cuts[0]).toBeCloseTo(138, 6);
    expect(p.cuts[2] - p.cuts[1]).toBeCloseTo(138, 6);
    expect(p.fits).toBe(true);
    // The grid (3 mm below the cut) is where the page box puts it: the page box starts 3.85 above the grid.
    expect(p.pageTops[0] + 3.85).toBeCloseTo(p.cuts[0] + 3, 6);
    expect(p.pageTops[1] + 3.85).toBeCloseTo(p.cuts[1] + 3, 6);
  });

  it('moves the books up when the bottom inset is bigger than the margin leaves, and takes the rest from the top', () => {
    const even = placeBooks(two({ trim_margin_mm: 3 }));
    const p = placeBooks(two({ trim_margin_mm: 3, inset_front_bottom_mm: 6 }));
    // Book 2's grid ends at 3 mm above the bottom cut: the bottom waste must be at least 6 - 3.
    expect(p.wasteBottom).toBeCloseTo(3, 6);
    expect(p.wasteTop).toBeCloseTo(0.4, 6);
    expect(p.pageTops[0]).toBeLessThan(even.pageTops[0]);
    expect(p.fits).toBe(true);
    // The grid's bottom edge lands exactly on the inset.
    expect(LETTER_H_MM - (p.cuts[2] - 3)).toBeCloseTo(6, 6);
  });

  it('moves the books down when the top inset is bigger than the margin leaves', () => {
    const p = placeBooks(two({ trim_margin_mm: 3, inset_back_top_mm: 4 }));
    expect(p.wasteTop).toBeCloseTo(1.7, 6); // an even split already leaves 1.7 + 3 = 4.7
    const q = placeBooks(two({ trim_margin_mm: 3, inset_back_top_mm: 6 }));
    expect(q.wasteTop).toBeCloseTo(3, 6);
    expect(q.fits).toBe(true);
  });

  it('is not moved by the offsets, scale or rotation: the insets are distances on the paper, and the corrections put content at its sheet position there', () => {
    const base = placeBooks(two({ trim_margin_mm: 3, inset_front_bottom_mm: 5 }));
    const moved = placeBooks(two({ trim_margin_mm: 3, inset_front_bottom_mm: 5, front_offset_y_mm: -1.65, back_offset_y_mm: 1, scale_y_pct: 100.5, scale_x_pct: 99.5, back_rotation_deg: -0.4, front_offset_x_mm: 2 }));
    expect(moved).toEqual(base);
    // The owner's settings with every inset 3 and a margin of 3 fit.
    const owner = clonePrint(flatTwoUp());
    owner.trim_margin_mm = 3;
    setPrint(owner, { front_offset_y_mm: -1.65, scale_y_pct: 100.5 });
    expect(placeBooks(owner).fits).toBe(true);
  });

  it('shares one placement between the interior and the covers: the stricter inset of the two papers at each edge and side', () => {
    const lower = (paper: 'inside' | 'cover') => {
      const p = clonePrint(flatTwoUp());
      p.trim_margin_mm = 3;
      p.layouts.letter_two_up.hand[paper].inset_front_bottom_mm = 6;
      return placeBooks(p);
    };
    const base = placeBooks(two({ trim_margin_mm: 3 }));
    for (const paper of ['inside', 'cover'] as const) {
      const p = lower(paper);
      // Both papers' books move up by the same amount (there is only one placement).
      expect(p.wasteBottom).toBeCloseTo(3, 6);
      expect(p.pageTops[0] - base.pageTops[0]).toBeCloseTo(-1.3, 6);
      expect(p.cuts).toEqual(lower(paper === 'inside' ? 'cover' : 'inside').cuts);
    }
    // The stricter of the two wins.
    const both = clonePrint(flatTwoUp());
    both.trim_margin_mm = 3;
    both.layouts.letter_two_up.hand.inside.inset_front_bottom_mm = 4;
    both.layouts.letter_two_up.hand.cover.inset_front_bottom_mm = 5;
    expect(placeBooks(both).wasteBottom).toBeCloseTo(2, 6);
  });

  it('exports anyway when no split fits, balanced between top and bottom, and names the largest margin that would fit', () => {
    const p = placeBooks(two({ inset_front_bottom_mm: 6 })); // margin 3.85: nothing to split
    expect(p.fits).toBe(false);
    expect(p.pageTops).toEqual([0, SHEET_H_MM]);
    // At a margin m the books leave 15.4 - 4m of waste and need 6 - m at the bottom: m <= (15.4 - 6 + ... ) solved by the closed form.
    expect(p.largestMargin).not.toBeNull();
    const fit = placeBooks(two({ inset_front_bottom_mm: 6, trim_margin_mm: p.largestMargin! }));
    expect(fit.fits).toBe(true);
    // And a hundredth more does not.
    expect(placeBooks(two({ inset_front_bottom_mm: 6, trim_margin_mm: p.largestMargin! + 0.01 })).fits).toBe(false);
  });

  it('says no margin fits when the insets leave no room at all', () => {
    expect(placeBooks(two({ inset_front_bottom_mm: 8, inset_front_top_mm: 8, trim_margin_mm: 0 })).largestMargin).toBeNull();
  });

  it('marks all three cuts, in both side trim zones', () => {
    const marks = cutMarks(placeBooks(two({ trim_margin_mm: 3 })).cuts);
    expect(marks).toHaveLength(6);
    expect(marks.filter((m) => m.k === 'line' && m.y1 === 1.7)).toHaveLength(2);
  });
});

describe('the edge scales land where they say once the side’s correction is applied', () => {
  it('inverts the correction exactly', () => {
    const p = clonePrint(flatTwoUp());
    setPrint(p, { front_offset_x_mm: 0.7, front_offset_y_mm: -1.3, scale_x_pct: 100.4, scale_y_pct: 101, back_rotation_deg: -0.3 });
    for (const side of ['front', 'back'] as const) {
      const t = transformOf(p, side), q = unmapPoint(t, LETTER_W_MM, LETTER_H_MM, { x: 40, y: 7.5 });
      const back = mapPoint(t, LETTER_W_MM, LETTER_H_MM, q);
      expect(back.x).toBeCloseTo(40, 9);
      expect(back.y).toBeCloseTo(7.5, 9);
    }
  });

  it('draws a line every 0.5 mm from 0 to 8 mm in from each paper edge on both sides, numbered every mm, measured on the paper after the offset', async () => {
    const p = clonePrint(flatTwoUp());
    setPrint(p, { front_offset_y_mm: -1, back_offset_x_mm: 0.5 });
    const pages = await readPdf((await sheetFile(emptyBook(52), p, fonts)).bytes);
    const H = sheetHeight('letter_two_up');
    for (const page of pages) {
      const segs = segments(page.content, H);
      for (const edge of INSET_EDGES) {
        const across = edge === 'top' || edge === 'bottom';
        let found = 0;
        for (let half = 0; half <= 2 * INSET_SCALE_MM; half++) {
          const at = insetScalePoint('letter_two_up', edge, half / 2);
          // The PDF page is what the printer gets: the line is already corrected, so it sits exactly at its distance from the edge (along the edge it
          // may be moved by the offset, which is why the position along it is only roughly checked).
          const [run, ax] = across ? [(s: { x1: number; x2: number; y1: number; y2: number }) => [s.x1, s.x2, s.y1, s.y2], at.x] : [(s: { x1: number; x2: number; y1: number; y2: number }) => [s.y1, s.y2, s.x1, s.x2], at.y];
          const want = across ? at.y : at.x;
          if (segs.some((s) => { const [a, b, c, d] = run(s); return Math.abs(c - d) < 1e-3 && Math.abs(b - a) < 3.1 && Math.abs((a + b) / 2 - ax) < 1.5 && Math.abs(c - want) < 0.01; })) found++;
        }
        expect(found, edge).toBe(17);
      }
      for (const n of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) expect(page.strings.filter((s) => s === n).length, n).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('one placement for the interior and the covers', () => {
  it('lists one set of cuts in summary.txt', async () => {
    const { exportBookFiles } = await import('../src/print/export');
    const p = clonePrint(flatTwoUp());
    p.trim_margin_mm = 3;
    p.layouts.letter_two_up.hand.cover.inset_front_bottom_mm = 6;
    const text = new TextDecoder().decode((await exportBookFiles(emptyBook(8), p, fonts)).find((f) => f.name === 'summary.txt')!.bytes);
    expect(text.match(/top trim/g)).toHaveLength(1);
    expect(text).toContain('top trim 0.4 | between the books 138.4 | bottom trim 276.4');
  });
});
