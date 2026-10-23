import { describe, expect, it } from 'vitest';
import { emptyBook, fillSlots, setSlot } from '../src/book/book';
import { contentsRows, designKey, listPages, opening, scopeSlots, slotLabel, whatChanges } from '../src/book/plan';
import { emptyPage, type Page } from '../src/format/types';

const page = (name: string): Page => ({ ...emptyPage(), name, elements: [{ type: 'text', x: 0, y: 1, text: name }] });

describe('which pages a scope reaches', () => {
  const b = emptyBook(16);
  it('takes a plain range, in either order, within the interior pages', () => {
    expect(scopeSlots(b, { mode: 'range', from: 3, to: 6 }, 1)).toEqual([3, 4, 5, 6]);
    expect(scopeSlots(b, { mode: 'range', from: 6, to: 3 }, 1)).toEqual([3, 4, 5, 6]);
    expect(scopeSlots(b, { mode: 'range', from: -4, to: 99 }, 1)).toHaveLength(16);
  });
  it('starts "from here" at the current page', () => {
    expect(scopeSlots(b, { mode: 'from', to: 8 }, 5)).toEqual([5, 6, 7, 8]);
  });
  it('picks every left (even) or right (odd) page in a range', () => {
    expect(scopeSlots(b, { mode: 'left', from: 3, to: 10 }, 1)).toEqual([4, 6, 8, 10]);
    expect(scopeSlots(b, { mode: 'right', from: 3, to: 10 }, 1)).toEqual([3, 5, 7, 9]);
  });
});

describe('what an apply would change', () => {
  it('skips pages that already have the design, and counts the ones it would replace', () => {
    const b = emptyBook(8);
    fillSlots(b, 2, 3, page('A'));
    setSlot(b, 4, page('B'));
    const r = whatChanges(b, [2, 3, 4, 5], b.pages[1]);
    expect(r.changed).toEqual([4, 5]);
    expect(r.replaced).toBe(1);
    expect(whatChanges(b, [1, 2], null)).toEqual({ changed: [2], replaced: 1 }); // clearing: page 1 is already blank
  });
  it('treats a design as the same whichever way it faces', () => {
    expect(designKey({ ...page('A'), side: 'left' })).toBe(designKey({ ...page('A'), side: 'right' }));
    expect(designKey(page('A'))).not.toBe(designKey(page('B')));
  });
  it('says which pages in words', () => {
    expect([[], [4], [5, 7], [5, 6, 7, 8], [4, 6, 8, 10, 12, 14, 16, 18]].map(listPages)).toEqual([
      'no pages', 'page 4', 'pages 5 and 7', 'pages 5–8 (4 pages)', 'pages 4, 6, 8 … 18 (8 pages)',
    ]);
  });
});

describe('the contents', () => {
  it('lists the four covers alone and folds runs of the same design into one row', () => {
    const b = emptyBook(8);
    fillSlots(b, 2, 5, page('Daily'));
    setSlot(b, 7, page('Notes'));
    setSlot(b, 0, page('Front'));
    const rows = contentsRows(b).map((r) => `${r.from}-${r.to} ${r.name}`);
    expect(rows).toEqual(['-1--1 Blank', '0-0 Front', '1-1 Blank', '2-5 Daily', '6-6 Blank', '7-7 Notes', '8-8 Blank', '9-9 Blank', '10-10 Blank']);
  });
  it('folds a wholly blank book into one row between the covers', () => {
    expect(contentsRows(emptyBook(8)).map((r) => `${r.from}-${r.to}`)).toEqual(['-1--1', '0-0', '1-8', '9-9', '10-10']);
  });
});

describe('openings and labels', () => {
  it('pairs a left (even) page with the right page after it, covers included', () => {
    expect([0, 1, 4, 5, 8, 9].map(opening)).toEqual([[0, 1], [0, 1], [4, 5], [4, 5], [8, 9], [8, 9]]);
    const b = emptyBook(8);
    expect([0, 3, 9].map((n) => slotLabel(b, n))).toEqual(['Inside front cover', 'Page 3', 'Inside back cover']);
  });
});
