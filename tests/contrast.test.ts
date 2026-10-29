import { describe, expect, it } from 'vitest';
import { CONTRAST_TABLE, darkenPixels } from '../src/contrast';

describe('the darker-grays curve', () => {
  it('keeps white and black, never lightens, and never reorders grays', () => {
    expect(CONTRAST_TABLE[0]).toBe(0);
    expect(CONTRAST_TABLE[255]).toBe(255);
    for (let v = 1; v < 256; v++) {
      expect(CONTRAST_TABLE[v]).toBeGreaterThanOrEqual(CONTRAST_TABLE[v - 1]);
      expect(CONTRAST_TABLE[v]).toBeLessThanOrEqual(v);
    }
  });

  it('darkens the shade tones and lines to their targets and keeps gray text lighter than black', () => {
    expect(CONTRAST_TABLE[0xef]).toBe(0xd6);
    expect(CONTRAST_TABLE[0xdc]).toBeCloseTo(0xc4, -1);
    expect(CONTRAST_TABLE[0xc4]).toBeLessThan(0xb4);
    expect(CONTRAST_TABLE[0x80]).toBeGreaterThan(60);
  });

  it('changes colors but not alpha', () => {
    const px = new Uint8ClampedArray([239, 239, 239, 255, 0, 0, 0, 128]);
    darkenPixels(px);
    expect([...px]).toEqual([0xd6, 0xd6, 0xd6, 255, 0, 0, 0, 128]);
  });
});
