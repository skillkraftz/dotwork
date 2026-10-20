import { describe, expect, it } from 'vitest';
import { NO_READINGS, offsetsFromReadings, xFromReading, yFromReadings, type Offsets } from '../src/book/alignment';
import { GRID_Y_MM } from '../src/format/types';

const ZERO: Offsets = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0 };

// The signs are proved against the real PDFs in printer-error.test.ts; these pin each conversion down on its own.
describe('the fold scale: x', () => {
  it('new offset = the offset the sheet was printed with + the crease’s reading (+ is right, as seen on that side)', () => {
    expect(xFromReading(0, 0.5)).toBe(0.5); // crease right of 0: the page landed too far left, so move it right
    expect(xFromReading(0, -1.2)).toBe(-1.2);
    expect(xFromReading(-1.5, 0.3)).toBe(-1.2);
    expect(xFromReading(0.4, 0)).toBe(0.4);
  });
  it('an empty reading leaves the offset alone', () => {
    expect(xFromReading(0.7, null)).toBe(0.7);
  });
  it('stays inside the book format’s limits, and rounds to 0.01 mm', () => {
    expect(xFromReading(9, 4)).toBe(10);
    expect(xFromReading(-9, -4)).toBe(-10);
    expect(xFromReading(0.1, 0.2)).toBe(0.3);
  });
});

describe('the top and bottom rulers: y', () => {
  it('top margin too big (the page sits too low): move up', () => {
    expect(yFromReadings(0, GRID_Y_MM + 0.5, null)).toBeCloseTo(0.5, 9);
    expect(yFromReadings(0, GRID_Y_MM - 0.5, null)).toBeCloseTo(-0.5, 9); // too high: move down
  });
  it('bottom margin too big (the page sits too high): move down', () => {
    expect(yFromReadings(0, null, GRID_Y_MM + 0.5)).toBeCloseTo(-0.5, 9);
    expect(yFromReadings(0, null, GRID_Y_MM - 0.5)).toBeCloseTo(0.5, 9);
  });
  it('both margins: move up by half of (top − bottom), so the page is centered whatever the sheet’s height', () => {
    expect(yFromReadings(0, 4.35, 3.35)).toBeCloseTo(0.5, 9);
    expect(yFromReadings(0, 3.35, 4.35)).toBeCloseTo(-0.5, 9);
    expect(yFromReadings(0.2, 3.85, 3.85)).toBe(0.2); // already even
    expect(yFromReadings(0, 3.5, 3.5)).toBe(0); // a short sheet: even margins, not 3.85 each
  });
  it('no reading leaves the offset alone', () => {
    expect(yFromReadings(0.3, null, null)).toBe(0.3);
  });
  it('stays inside the limits and rounds to 0.01 mm', () => {
    expect(yFromReadings(9.5, 20, null)).toBe(10);
    expect(yFromReadings(0, 3.851, 3.85)).toBe(0);
  });
});

describe('all four offsets', () => {
  it('each side is read on its own, and the new value starts from the offset it was printed with', () => {
    const printed: Offsets = { front_offset_x_mm: 1, front_offset_y_mm: 0.2, back_offset_x_mm: -2, back_offset_y_mm: 0.1 };
    const next = offsetsFromReadings(printed, { fold: -0.4, top: 4.05, bottom: 3.65 }, { fold: 0.6, top: null, bottom: 4.35 });
    expect(next.front_offset_x_mm).toBeCloseTo(0.6, 9);
    expect(next.front_offset_y_mm).toBeCloseTo(0.4, 9); // 0.2 + (4.05 - 3.65) / 2
    expect(next.back_offset_x_mm).toBeCloseTo(-1.4, 9);
    expect(next.back_offset_y_mm).toBeCloseTo(-0.4, 9); // 0.1 + (3.85 - 4.35)
  });
  it('nothing read changes nothing', () => {
    expect(offsetsFromReadings(ZERO, NO_READINGS, NO_READINGS)).toEqual(ZERO);
  });
  it('one side read leaves the other as it was', () => {
    const next = offsetsFromReadings({ ...ZERO, back_offset_x_mm: 0.9 }, { fold: 1, top: null, bottom: null }, NO_READINGS);
    expect(next).toEqual({ ...ZERO, front_offset_x_mm: 1, back_offset_x_mm: 0.9 });
  });
});
