import { describe, expect, it } from 'vitest';
import { FOLD_FROM_CENTRE_MM, FOLD_HOW, LINE_MM, MARK_FROM_EDGE_MM, NO_READINGS, backAgainstPaper, crosshairs, foldScales, fromCentre, scaleCaptions, scaleFromReading, seeThrough, sheetHeight, sheetResult } from '../src/book/alignment';
import { DEFAULT_PRINT, SHEET_H_MM, SHEET_W_MM, type LayoutProfile } from '../src/book/impose';

const ZERO: LayoutProfile = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0 };
const DEG = Math.PI / 180;

// printer-error.test.ts proves the signs against whole simulated printers; these pin each conversion down on its own.
describe('where the sheet puts things', () => {
  it('has five marks 8 mm in from the edges of the whole paper, and one at its centre, for both layouts', () => {
    expect(sheetHeight('half_letter')).toBe(SHEET_H_MM);
    expect(sheetHeight('letter_two_up')).toBeCloseTo(2 * SHEET_H_MM, 9);
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const W = SHEET_W_MM, H = sheetHeight(layout), c = crosshairs(layout);
      expect(MARK_FROM_EDGE_MM).toBe(8);
      expect(c).toEqual({ top: { x: W / 2, y: 8 }, bottom: { x: W / 2, y: H - 8 }, left: { x: 8, y: H / 2 }, right: { x: W - 8, y: H / 2 }, centre: { x: W / 2, y: H / 2 } });
    }
    expect(sheetHeight('letter_two_up')).toBeCloseTo(279.4, 9);
  });
  it('measures from the centre, y up', () => {
    expect(fromCentre('half_letter', { x: SHEET_W_MM / 2, y: 0 })).toEqual({ x: 0, y: SHEET_H_MM / 2 });
    expect(fromCentre('letter_two_up', { x: 0, y: sheetHeight('letter_two_up') })).toEqual({ x: -SHEET_W_MM / 2, y: -SHEET_H_MM });
  });
  it('has two 100 mm lines for every layout', () => {
    expect(LINE_MM).toBe(100);
  });
  it('names its scales and lines by the paper’s edges, in the words of the readings', () => {
    const half = scaleCaptions('half_letter'), two = scaleCaptions('letter_two_up');
    expect([half.top, half.bottom, half.left, half.right]).toEqual(['see-through top x', 'see-through bottom x', 'see-through left y', 'see-through right y']);
    expect([half.hFoldLeft, half.hFoldRight, half.vFoldTop, half.vFoldBottom]).toEqual(['horizontal fold, left scale', 'horizontal fold, right scale', 'vertical fold, top scale', 'vertical fold, bottom scale']);
    expect(half.longX).toBe('parallel to the 8.5 in edge: should measure 100.0 mm');
    expect(half.longY).toBe('parallel to the 5.5 in edge: should measure 100.0 mm');
    expect(two.longY).toBe('parallel to the 11 in edge: should measure 100.0 mm');
  });
});

describe('the see-through readings', () => {
  it('give the turn from two x readings, over the distance between the scales, + counter-clockwise', () => {
    const c = crosshairs('half_letter'), span = fromCentre('half_letter', c.top).y - fromCentre('half_letter', c.bottom).y;
    const r = seeThrough('half_letter', { ...NO_READINGS, topX: 0.3, bottomX: -0.3 });
    expect(span).toBeCloseTo(SHEET_H_MM - 16, 9); // H - 2m
    expect(r.phi!).toBeCloseTo(0.6 / span, 12);
    expect(r.dx!).toBeCloseTo(0, 12); // symmetric about the centre: no shift
    expect(r.dy).toBeNull();
  });
  it('give the turn from two y readings too, the left one positive for a counter-clockwise turn', () => {
    const r = seeThrough('half_letter', { ...NO_READINGS, leftY: 0.5, rightY: -0.5 });
    const c = crosshairs('half_letter');
    expect(r.phi!).toBeCloseTo(1 / (c.right.x - c.left.x), 12);
    expect(r.dy!).toBeCloseTo(0, 12);
  });
  it('average the two turns, and take the turn out of the shifts', () => {
    const c = crosshairs('half_letter'), top = fromCentre('half_letter', c.top), bottom = fromCentre('half_letter', c.bottom), phi = 0.2 * DEG;
    const r = seeThrough('half_letter', { ...NO_READINGS, topX: 0.4 + phi * top.y, bottomX: 0.4 + phi * bottom.y, leftY: -0.2, rightY: -0.2 });
    expect(r.phi!).toBeCloseTo(phi / 2, 9); // the x pair says phi, the y pair says none
    expect(r.dx!).toBeCloseTo(0.4, 9); // the top and bottom are equally far from the centre, so the turn's own shifts cancel
  });
  it('with one reading and no turn known, are just that reading', () => {
    expect(seeThrough('half_letter', { ...NO_READINGS, topX: 0.7 })).toEqual({ phi: null, dx: 0.7, dy: null });
    expect(seeThrough('half_letter', { ...NO_READINGS, rightY: -0.2 })).toEqual({ phi: null, dx: null, dy: -0.2 });
  });
});

describe('the fold scales', () => {
  it('sit across the two centre lines, each pair on opposite sides of the centre and at least 25 mm from its +', () => {
    expect(FOLD_FROM_CENTRE_MM).toBeGreaterThanOrEqual(25);
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      const W = SHEET_W_MM, H = sheetHeight(layout), f = foldScales(layout);
      expect(f.left).toEqual({ x: W / 2 - FOLD_FROM_CENTRE_MM, y: H / 2 });
      expect(f.right).toEqual({ x: W / 2 + FOLD_FROM_CENTRE_MM, y: H / 2 });
      expect(f.top).toEqual({ x: W / 2, y: H / 2 - FOLD_FROM_CENTRE_MM });
      expect(f.bottom).toEqual({ x: W / 2, y: H / 2 + FOLD_FROM_CENTRE_MM });
    }
  });
  it('are told to be read by folding top edge to bottom edge, then left edge to right edge', () => {
    expect(FOLD_HOW).toBe('Fold the sheet top edge to bottom edge, crease hard, open it, and read where the crease crosses each horizontal-fold scale. Then fold left edge to right edge and read the vertical-fold scales.');
  });
  it('a back printed 1.1 mm too low has the crease 1.1 mm above the scales’ zero (+ up), so the back is 1.1 mm low', () => {
    for (const layout of ['half_letter', 'letter_two_up'] as const) {
      expect(backAgainstPaper(layout, { ...NO_READINGS, hFoldLeft: 1.1, hFoldRight: 1.1 }).y).toBeCloseTo(-1.1, 9);
      expect(backAgainstPaper(layout, { ...NO_READINGS, hFoldLeft: -0.4, hFoldRight: -0.4 }).y).toBeCloseTo(0.4, 9);
    }
  });
  it('a back printed to the right has the crease left of the scales’ zero (+ right), so a negative reading is a back too far right', () => {
    expect(backAgainstPaper('half_letter', { ...NO_READINGS, vFoldTop: -0.6, vFoldBottom: -0.6 }).x).toBeCloseTo(0.6, 9);
  });
  it('a turned back cancels in the mean of a pair, and the two readings differ by the turn', () => {
    const phi = 0.2 * DEG, q = FOLD_FROM_CENTRE_MM;
    // Back moved up by 0.5 and turned counter-clockwise: the right scale (q.x > 0) is raised more, the left one less.
    const h = { ...NO_READINGS, hFoldLeft: -(0.5 - phi * q), hFoldRight: -(0.5 + phi * q) };
    expect(backAgainstPaper('half_letter', h).y!).toBeCloseTo(0.5, 9);
    expect((h.hFoldLeft - h.hFoldRight) / (2 * q)).toBeCloseTo(phi, 9);
    // Top scale (q.y > 0): a counter-clockwise turn moves it left.
    const v = { ...NO_READINGS, vFoldTop: -(-0.3 - phi * q), vFoldBottom: -(-0.3 + phi * q) };
    expect(backAgainstPaper('half_letter', v).x!).toBeCloseTo(-0.3, 9);
  });
  it('with one scale of a pair, the turn from the see-through is taken out', () => {
    const phi = 0.2 * DEG, q = FOLD_FROM_CENTRE_MM;
    expect(backAgainstPaper('half_letter', { ...NO_READINGS, hFoldRight: -(0.5 + phi * q) }, phi).y!).toBeCloseTo(0.5, 9);
    expect(backAgainstPaper('half_letter', { ...NO_READINGS, hFoldLeft: -(0.5 - phi * q) }, phi).y!).toBeCloseTo(0.5, 9);
    expect(backAgainstPaper('half_letter', { ...NO_READINGS, vFoldTop: 0.3 + phi * q }, phi).x!).toBeCloseTo(-0.3, 9);
    expect(backAgainstPaper('half_letter', { ...NO_READINGS, hFoldLeft: 0.7 }).y).toBeCloseTo(-0.7, 9); // no turn known: none assumed
  });
  it('nothing read is null', () => {
    expect(backAgainstPaper('half_letter', NO_READINGS)).toEqual({ x: null, y: null });
  });
});

describe('scale from a long line', () => {
  it('turns a measured line into a scale: a printer that makes 100 mm 98.8 mm needs 101.21 %', () => {
    expect(scaleFromReading(100, 100, 98.8)).toBeCloseTo(101.21, 2);
    expect(scaleFromReading(100, 100, 100)).toBe(100);
  });
  it('is by the line’s length: 190 mm that measures 188.0 needs 101.06 %', () => {
    expect(scaleFromReading(100, 100, 188, 190)).toBeCloseTo(101.06, 2);
    expect(scaleFromReading(100, 100, 190, 190)).toBe(100);
  });
  it('is relative to the scale the sheet was printed at', () => {
    expect(scaleFromReading(101.21, 101.21, 100)).toBeCloseTo(101.21, 2);
    expect(scaleFromReading(101, 101, 99.5)).toBeCloseTo(101.51, 2);
  });
  it('stays within 95 to 105, and keeps the old scale when nothing was measured', () => {
    expect(scaleFromReading(100, 100, 80)).toBe(105);
    expect(scaleFromReading(100, 100, 120)).toBe(95);
    expect(scaleFromReading(101.2, 100, null)).toBe(101.2);
    expect(scaleFromReading(101.2, 100, 0)).toBe(101.2);
  });
  it('sets each axis from its own line: the 8.5 in edge the x scale, the other the y scale', () => {
    const next = sheetResult('letter_two_up', ZERO, { ...NO_READINGS, longX: 98, longY: 101 });
    expect(next.scale_x_pct).toBeCloseTo(102.04, 2);
    expect(next.scale_y_pct).toBeCloseTo(99.01, 2);
  });
});

describe('the result', () => {
  it('turns the back by minus what it is turned, and stays within ±1.5 degrees, rounded to 0.001', () => {
    const c = crosshairs('half_letter'), top = fromCentre('half_letter', c.top), bottom = fromCentre('half_letter', c.bottom);
    const read = (deg: number) => ({ ...NO_READINGS, topX: deg * DEG * top.y, bottomX: deg * DEG * bottom.y });
    expect(sheetResult('half_letter', ZERO, read(0.4)).back_rotation_deg).toBeCloseTo(-0.4, 3);
    expect(sheetResult('half_letter', { ...ZERO, back_rotation_deg: 0.3 }, read(0.1)).back_rotation_deg).toBeCloseTo(0.2, 3);
    expect(sheetResult('half_letter', ZERO, read(5)).back_rotation_deg).toBe(-1.5);
    expect(sheetResult('half_letter', ZERO, read(-5)).back_rotation_deg).toBe(1.5);
  });
  it('keeps the offsets within ±10 mm and rounds to 0.01 mm', () => {
    expect(sheetResult('half_letter', { ...ZERO, back_offset_x_mm: 9 }, { ...NO_READINGS, topX: 4, bottomX: 4 }).back_offset_x_mm).toBe(10);
    expect(sheetResult('half_letter', ZERO, { ...NO_READINGS, topX: 0.123, bottomX: 0.123 }).back_offset_x_mm).toBe(0.12);
  });
  it('moves the back by what it reads against the front when only the see-through is read, and the front not at all', () => {
    const next = sheetResult('half_letter', { ...ZERO, front_offset_x_mm: 1, back_offset_x_mm: 2, back_offset_y_mm: 0.5 }, { ...NO_READINGS, topX: -0.4, bottomX: -0.4, leftY: 0.3, rightY: 0.3 });
    expect(next.back_offset_x_mm).toBeCloseTo(1.6, 9); // the front shows through left of the scale: move the back left
    expect(next.back_offset_y_mm).toBeCloseTo(0.8, 9); // above the scale: move the back up
    expect(next.front_offset_x_mm).toBe(1);
  });
  it('moves the front too once the back is read against the paper: the front is what is left', () => {
    // Back perfect against the paper (every fold reads 0), front shows through 0.4 mm left of the scale and 0.3 mm above it: the
    // front is 0.4 right of where it should be (the sheet is turned over) and 0.3 too high.
    const next = sheetResult('half_letter', DEFAULT_PRINT.layouts.half_letter, { ...NO_READINGS, topX: -0.4, bottomX: -0.4, leftY: 0.3, rightY: 0.3, hFoldLeft: 0, hFoldRight: 0, vFoldTop: 0, vFoldBottom: 0 });
    const was = DEFAULT_PRINT.layouts.half_letter;
    expect(next.front_offset_x_mm).toBeCloseTo(was.front_offset_x_mm - 0.4, 9);
    expect(next.front_offset_y_mm).toBeCloseTo(was.front_offset_y_mm - 0.3, 9);
    expect(next.back_offset_x_mm).toBe(was.back_offset_x_mm);
    expect(next.back_offset_y_mm).toBe(was.back_offset_y_mm);
  });
  it('nothing read changes nothing', () => {
    expect(sheetResult('half_letter', ZERO, NO_READINGS)).toEqual(ZERO);
  });
});
