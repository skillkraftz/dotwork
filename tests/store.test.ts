import { crc32 as zcrc } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { emptyPage } from '../src/format/types';
import { crc32, setPngDpi } from '../src/pngdpi';
import { Store } from '../src/store';

const withRegion = (s: Store) => {
  const p = structuredClone(s.page);
  p.regions.push({ x: 0, y: 1, w: 2, h: 2, fill: 'lines' });
  return p;
};

describe('Store history', () => {
  it('undoes and redoes commits', () => {
    const s = new Store();
    s.commit(withRegion(s));
    expect(s.page.regions).toHaveLength(1);
    s.undo();
    expect(s.page.regions).toHaveLength(0);
    expect(s.canRedo).toBe(true);
    s.redo();
    expect(s.page.regions).toHaveLength(1);
  });

  it('clears redo on a new commit and drops a selection that no longer exists', () => {
    const s = new Store();
    s.commit(withRegion(s));
    s.select(0);
    s.undo();
    expect(s.selected).toBeNull();
    s.commit(withRegion(s));
    expect(s.canRedo).toBe(false);
  });

  it('merges quick edits with the same key into one undo step', () => {
    const s = new Store();
    for (const [i, name] of ['A', 'AB', 'ABC'].entries()) {
      const p = structuredClone(s.page);
      p.name = name;
      s.commit(p, 'name', 1000 + i);
    }
    const p = structuredClone(s.page);
    p.name = 'later';
    s.commit(p, 'name', 5000); // too late to merge
    s.undo();
    expect(s.page.name).toBe('ABC');
    s.undo();
    expect(s.page.name).toBe(emptyPage().name);
  });

  it('normalises committed pages', () => {
    const s = new Store();
    const p = withRegion(s);
    p.regions[0].border = {};
    s.commit(p);
    expect(s.page.regions[0].border).toBeUndefined();
  });
});

describe('setPngDpi', () => {
  it('matches zlib crc32', () => {
    const data = new TextEncoder().encode('pHYs-check');
    expect(crc32(data)).toBe(zcrc(data));
  });

  it('inserts a valid pHYs chunk after IHDR', () => {
    const png = new Uint8Array(8 + 25 + 12); // signature + IHDR + IEND-sized tail
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = setPngDpi(png, 600);
    expect(out.length).toBe(png.length + 21);
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(33)).toBe(9);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    expect(dv.getUint32(41)).toBe(23622);
    expect(dv.getUint32(45)).toBe(23622);
    expect(out[49]).toBe(1);
    expect(dv.getUint32(50)).toBe(zcrc(out.subarray(37, 50)));
  });
});
