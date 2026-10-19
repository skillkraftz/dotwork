import { crc32 as zcrc } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { emptyPage, type PageElement } from '../src/format/types';
import { crc32, setPngDpi } from '../src/pngdpi';
import { addElement, deleteElement, duplicateElement, nudgeElement, reorderElement } from '../src/actions';
import { Store } from '../src/store';

const box = (x: number): PageElement => ({ type: 'box', x, y: 1, w: 2, h: 2 });
const withRegion = (s: Store) => {
  const p = structuredClone(s.page);
  p.elements.push(box(0));
  return p;
};
const xs = (s: Store) => s.page.elements.map((e) => (e as { x: number }).x);
const threeBoxes = () => {
  const s = new Store();
  for (const x of [0, 5, 10]) addElement(s, box(x));
  return s;
};

describe('Store history', () => {
  it('undoes and redoes commits', () => {
    const s = new Store();
    s.commit(withRegion(s));
    expect(s.page.elements).toHaveLength(1);
    s.undo();
    expect(s.page.elements).toHaveLength(0);
    expect(s.canRedo).toBe(true);
    s.redo();
    expect(s.page.elements).toHaveLength(1);
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
      s.commit(p, 'name', undefined, 1000 + i);
    }
    const p = structuredClone(s.page);
    p.name = 'later';
    s.commit(p, 'name', undefined, 5000); // too late to merge
    s.undo();
    expect(s.page.name).toBe('ABC');
    s.undo();
    expect(s.page.name).toBe(emptyPage().name);
  });
});

describe('Store tools and view state', () => {
  it('tracks the tool, half-cell toggle and mode, and tells listeners', () => {
    const s = new Store();
    let calls = 0;
    s.subscribe(() => calls++);
    s.setTool('box'); s.setTool('box'); s.setHalfCells(true); s.setMode('preview');
    expect([s.tool, s.halfCells, s.mode, calls]).toEqual(['box', true, 'preview', 3]);
  });

  it('keeps hidden and locked with the element through reordering, deleting and undo', () => {
    const s = threeBoxes();
    s.toggleHidden(0);
    s.toggleLocked(2);
    expect([s.isHidden(0), s.isLocked(2)]).toEqual([true, true]);
    reorderElement(s, 0, 2); // the hidden box goes to the front
    expect(xs(s)).toEqual([5, 10, 0]);
    expect([s.isHidden(2), s.isHidden(0), s.isLocked(1)]).toEqual([true, false, true]);
    expect([...s.hiddenIndexes]).toEqual([2]);
    deleteElement(s, 2);
    s.undo();
    expect(s.isHidden(2)).toBe(true);
    s.toggleHidden(2);
    expect(s.isHidden(2)).toBe(false);
  });

  it('starts fresh for a replaced page: nothing hidden, locked or selected, and undo restores the old page', () => {
    const s = threeBoxes();
    s.toggleHidden(0);
    const old = s.page;
    s.replace(structuredClone(old));
    expect([s.selected, s.isHidden(0), s.isLocked(0)]).toEqual([null, false, false]);
    s.undo();
    expect(s.page).toBe(old);
  });
});

describe('editing actions (each one undoable)', () => {
  it('adds on top, selects, and returns to the select tool', () => {
    const s = new Store();
    s.setTool('box');
    addElement(s, box(3));
    expect([s.selected, s.tool, xs(s)]).toEqual([0, 'select', [3]]);
    s.undo();
    expect(s.page.elements).toHaveLength(0);
    s.redo();
    expect(s.page.elements).toHaveLength(1);
  });

  it('reorders by index, keeping the selection on the moved element, and clamps', () => {
    const s = threeBoxes();
    s.select(0);
    reorderElement(s, 0, 1);
    expect([xs(s), s.selected]).toEqual([[5, 0, 10], 1]);
    reorderElement(s, 1, 99);
    expect(xs(s)).toEqual([5, 10, 0]);
    reorderElement(s, 0, -4);
    expect(xs(s)).toEqual([5, 10, 0]);
    s.undo(); s.undo();
    expect(xs(s)).toEqual([0, 5, 10]);
  });

  it('deletes and undoes', () => {
    const s = threeBoxes();
    s.select(1);
    deleteElement(s, 1);
    expect([xs(s), s.selected]).toEqual([[0, 10], null]);
    s.undo();
    expect(xs(s)).toEqual([0, 5, 10]);
  });

  it('duplicates just above the original, offset, and selects the copy', () => {
    const s = threeBoxes();
    duplicateElement(s, 0);
    expect(s.page.elements).toHaveLength(4);
    expect(s.page.elements[1]).toEqual({ type: 'box', x: 1, y: 2, w: 2, h: 2 });
    expect(s.selected).toBe(1);
    expect(new Set(s.ids).size).toBe(4);
    s.undo();
    expect(s.page.elements).toHaveLength(3);
  });

  it('duplicates in the other direction when the first is blocked, and in place when boxed in', () => {
    const s = new Store();
    addElement(s, { type: 'box', x: 25, y: 42, w: 2, h: 2 });
    duplicateElement(s, 0);
    expect(s.page.elements[1]).toMatchObject({ x: 24, y: 41 });
    const full = new Store();
    addElement(full, { type: 'pattern', pattern: 'none', background: 'light', x: 0, y: 1, w: 27, h: 43 });
    duplicateElement(full, 0);
    expect(full.page.elements[1]).toMatchObject({ x: 0, y: 1 });
  });

  it('nudges by whole or half cells, stops at the edge, respects locks, and merges quick nudges', () => {
    const s = new Store();
    addElement(s, { type: 'box', x: 0, y: 1, w: 2, h: 2 });
    nudgeElement(s, 0, -1, 0);
    expect(xs(s)).toEqual([0]);
    expect(s.canUndo).toBe(true); // only the add
    nudgeElement(s, 0, 1, 0);
    nudgeElement(s, 0, 0.5, 0);
    expect(xs(s)).toEqual([1.5]);
    s.undo();
    expect(xs(s)).toEqual([0]); // both nudges were one step
    s.toggleLocked(0);
    nudgeElement(s, 0, 1, 0);
    expect(xs(s)).toEqual([0]);
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
