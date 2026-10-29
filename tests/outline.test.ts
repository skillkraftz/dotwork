import { describe, expect, it } from 'vitest';
import { bookLayout, bookPage, emptyBook } from '../src/book/book';
import {
  addBlock, canAddFree, canFill, duplicateBlock, fillRepeat, freeBlock, groupBlock, layoutOutline, moveBlock, moveIntoGroup, moveOutOfGroup, pageBlock, pagesToHold,
  removeBlock, setDesign, setPin, setRepeat, spreadBlock, totalLine, type Block,
} from '../src/book/outline';
import { emptyPage, type Page } from '../src/format/types';
import { fingerprint } from '../src/format/fingerprint';

const page = (name: string): Page => ({ ...emptyPage(), name, elements: [{ type: 'text', x: 0, y: 1, text: name }] });
const A = page('A'), B = page('B'), C = page('C');
const spread = (name = 'S', times = 1) => spreadBlock(name, { ...page(`${name}L`), side: 'left' }, { ...page(`${name}R`), side: 'right' }, times);
const fill = (b: Block): Block => ({ ...b, repeat: fillRepeat() }) as Block;
const pin = (b: Block, to: number | 'last'): Block => ({ ...b, pin: to }) as Block;

/** What is on each page, by name: '-' for a blank page, '~' for a gap page, '.' for free pages. */
const names = (outline: Block[], count = 52) => layoutOutline(outline, count).cells.map((c) => (c === null ? '-' : c.kind === 'gap' ? '~' : c.kind === 'free' ? '.' : c.page?.name ?? '-'));
const run = (list: string[]) => list.join(' ');

describe('how many pages an outline takes', () => {
  it('counts a page, a spread and a repeat', () => {
    const l = layoutOutline([pageBlock(A, 3), spread('S', 2)], 52);
    expect(l.used).toBe(7);
    expect(l.over).toBe(0);
    expect(l.rows.map((r) => r.pages)).toEqual([3, 4]);
    expect(layoutOutline([], 52).used).toBe(0);
  });

  it('puts ×N copies one after another, from page 1', () => {
    expect(run(names([pageBlock(A, 2), pageBlock(B, 3)], 8))).toBe('A A B B B - - -');
  });

  it('is over when the blocks need more pages than the book has, and says by how many', () => {
    const l = layoutOutline([pageBlock(A, 30), pageBlock(B, 26)], 52);
    expect(l.used).toBe(56);
    expect(l.end).toBe(56);
    expect(l.over).toBe(4);
    expect(l.cells).toHaveLength(52); // the pages that fit are still laid out
    expect(pagesToHold(l.end)).toBe(56); // "Make the book 56 pages"
    expect(pagesToHold(53)).toBe(56);
    expect(layoutOutline([pageBlock(A, 52)], 52).over).toBe(0);
  });

  it('says so in words: the total, how far over, and the length that would hold it', () => {
    const line = (outline: Block[], count = 52) => totalLine(layoutOutline(outline, count), count);
    expect(line([pageBlock(A, 48)])).toEqual({ used: '48 of 52 pages', over: null, makeLonger: null });
    expect(line([pageBlock(A, 52)])).toEqual({ used: '52 of 52 pages', over: null, makeLonger: null });
    expect(line([pageBlock(A, 56)])).toEqual({ used: '56 of 52 pages', over: 'over by 4 pages', makeLonger: 56 });
    expect(line([pageBlock(A, 53)])).toEqual({ used: '53 of 52 pages', over: 'over by 1 page', makeLonger: 56 });
    expect(line([pageBlock(A, 3), pin(pageBlock(B), 'last')], 4)).toEqual({ used: '4 of 4 pages', over: null, makeLonger: null });
    expect(line([pageBlock(A, 410)], 400)).toMatchObject({ over: 'over by 10 pages', makeLonger: null }); // no book is longer than 400 pages
  });
});

describe('fill what is left', () => {
  it('takes as many copies as use up the pages the other blocks leave', () => {
    const l = layoutOutline([pageBlock(A, 10), fill(pageBlock(B))], 52);
    expect(l.rows.map((r) => r.pages)).toEqual([10, 42]);
    expect(l.used).toBe(52);
    expect(l.rows[1].repeats).toBe(42);
  });

  it('keeps the book’s length when the book changes size', () => {
    const outline = [pageBlock(A, 4), fill(pageBlock(B))];
    expect([8, 28, 100].map((n) => layoutOutline(outline, n).rows[1].pages)).toEqual([4, 24, 96]);
  });

  it('fills with whole repeats of a spread, leaving the page that does not fit blank', () => {
    const l = layoutOutline([pageBlock(A), fill(spread())], 8); // page 1, then spreads on 2-3, 4-5, 6-7; page 8 is left over
    expect(names([pageBlock(A), fill(spread())], 8).join(' ')).toBe('A SL SR SL SR SL SR -');
    expect(l.used).toBe(7);
  });

  it('fills what is left after blocks that come after it', () => {
    expect(run(names([pageBlock(A), fill(pageBlock(B)), pageBlock(C, 2)], 8))).toBe('A B B B B B C C');
  });

  it('is nothing at all when the other blocks use the book up', () => {
    const l = layoutOutline([pageBlock(A, 8), fill(pageBlock(B))], 8);
    expect(l.rows[1].pages).toBe(0);
    expect(l.over).toBe(0);
  });
});

describe('groups', () => {
  it('repeat their whole contents', () => {
    const g = groupBlock('Pair', [pageBlock(A), pageBlock(B, 2)], 3);
    expect(run(names([g], 12))).toBe('A B B A B B A B B - - -');
    expect(layoutOutline([g], 12).rows[0]).toMatchObject({ pages: 9, first: 1, last: 9, repeats: 3 });
  });

  it('can fill what is left', () => {
    expect(run(names([pageBlock(C), fill(groupBlock('Pair', [pageBlock(A), pageBlock(B)]))], 8))).toBe('C A B A B A B -');
  });

  it('start a spread on a left page in every repeat, adding gap pages inside the group', () => {
    const g = groupBlock('Idea', [spread(), pageBlock(A)], 3);
    // the group starts on page 1 (a right page): each repeat is a gap, the spread, then a page
    expect(run(names([g], 14))).toBe('~ SL SR A ~ SL SR A ~ SL SR A - -');
    expect(layoutOutline([g], 14).rows[0]).toMatchObject({ pages: 11, innerGaps: 2, gaps: [1] }); // the first gap sits before the block
  });

  it('count a gap inside a repeat when the group starts on a left page', () => {
    const g = groupBlock('Idea', [pageBlock(A), spread()], 2);
    expect(run(names([g], 10))).toBe('A SL SR A ~ SL SR - - -');
    expect(layoutOutline([g], 10).rows[0]).toMatchObject({ pages: 7, innerGaps: 1 });
  });

  it('give free pages in a group one blank page for each repeat', () => {
    const g = groupBlock('Weeks', [pageBlock(A), freeBlock([null])], 3);
    expect(run(names([g], 8))).toBe('A . A . A . - -');
  });
});

describe('free pages', () => {
  it('take every page the other blocks leave', () => {
    const l = layoutOutline([pageBlock(A, 10), freeBlock()], 52);
    expect(l.rows.map((r) => r.pages)).toEqual([10, 42]);
    expect(l.cells.slice(10).every((c) => c?.kind === 'free')).toBe(true);
  });

  it('keep the designs on them, and pad the rest with blank pages', () => {
    const l = layoutOutline([freeBlock([B, null, C])], 8);
    expect(l.cells.map((c) => c?.page?.name ?? 'blank').join(' ')).toBe('B blank C blank blank blank blank blank');
    expect(l.used).toBe(8);
  });

  it('are never trimmed: a stored page that does not fit stays, and the book is over', () => {
    const l = layoutOutline([pageBlock(A, 6), freeBlock([B, null, C])], 8);
    expect(l.rows[1].pages).toBe(3);
    expect(l.over).toBe(1);
  });

  it('may be added only when nothing else takes the rest', () => {
    expect(canAddFree([pageBlock(A)])).toBe(true);
    expect(canAddFree([freeBlock()])).toBe(false);
    expect(canAddFree([fill(pageBlock(A))])).toBe(false);
    expect(canFill([pageBlock(A), pageBlock(B)], [1])).toBe(true);
    expect(canFill([pageBlock(A), freeBlock()], [0])).toBe(false);
    expect(canFill([groupBlock('G', [pageBlock(A)])], [0, 0])).toBe(false); // only at the top level
  });
});

describe('pinning a block to a page', () => {
  it('puts a block on the last page, and the fill before it takes the slack', () => {
    const l = layoutOutline([pageBlock(A, 10), fill(pageBlock(B)), pin(pageBlock(C), 'last')], 52);
    expect(l.cells[51]?.page?.name).toBe('C');
    expect(l.rows.map((r) => r.pages)).toEqual([10, 41, 1]);
    expect(l.used).toBe(52);
    expect(l.over).toBe(0);
  });

  it('follows the book when it is resized', () => {
    const outline = [pageBlock(A), pin(pageBlock(C, 2), 'last')];
    expect(layoutOutline(outline, 8).rows[1]).toMatchObject({ first: 7, last: 8 });
    expect(layoutOutline(outline, 12).rows[1]).toMatchObject({ first: 11, last: 12 });
  });

  it('puts a block on a page number, and the others flow around it', () => {
    const l = layoutOutline([pageBlock(A, 6), pin(pageBlock(C), 3), pageBlock(B, 2)], 12);
    expect(run(l.cells.map((c) => c?.page?.name ?? '-'))).toBe('A A C A A A A B B - - -');
  });

  it('turns the count red (over) when the others are pushed past the end by a pin', () => {
    const l = layoutOutline([pageBlock(A, 8), pin(pageBlock(C), 'last')], 8);
    expect(l.cells[7]?.page?.name).toBe('C');
    expect(l.over).toBe(1); // the eighth A has to go past the pinned page
  });

  it('says when two pins are in each other’s way', () => {
    const l = layoutOutline([pin(pageBlock(A), 5), pin(pageBlock(B), 5)], 8);
    expect(l.issues).toHaveLength(1);
    expect(l.issues[0]).toContain('pinned to page 5');
  });

  it('starts a pinned spread on a left page with a gap page', () => {
    expect(run(names([pin(spread(), 3)], 8))).toBe('- - ~ SL SR - - -');
  });

  it('keeps a pinned block out of the fill', () => {
    const l = layoutOutline([fill(pageBlock(A)), pin(pageBlock(C), 4)], 8);
    expect(run(l.cells.map((c) => c?.page?.name ?? '-'))).toBe('A A A C A A A A');
  });
});

describe('gap pages', () => {
  it('go in before a spread that would land on a right page, and show as gap pages', () => {
    const l = layoutOutline([pageBlock(A, 2), spread(), pageBlock(C)], 12);
    expect(run(l.cells.map((c) => (c?.kind === 'gap' ? '~' : c?.page?.name ?? '-')))).toBe('A A ~ SL SR C - - - - - -');
    expect(l.cells[2]).toMatchObject({ kind: 'gap', block: 1 });
    expect(l.cells[2]!.page!.name).toBe('Notes');
    expect(l.rows[1]).toMatchObject({ gaps: [3], first: 4, pages: 2 });
    expect(l.used).toBe(6); // the gap page counts in the total
  });

  it('need none when the spread already starts on a left page', () => {
    const l = layoutOutline([pageBlock(A), spread()], 8);
    expect(l.cells.some((c) => c?.kind === 'gap')).toBe(false);
  });
});

describe('the book’s pages come from its outline', () => {
  it('builds the 52-page book of the plan: blank ×10, a group of an idea spread and a lined page ×6, free pages, a closing page on page 52', () => {
    const b = emptyBook();
    b.outline = [pageBlock(null, 10), groupBlock('Ideas', [spread('Idea'), pageBlock(page('Lined'))], 6), freeBlock(), pin(pageBlock(page('Closing')), 'last')];
    const l = bookLayout(b);
    expect(l.over).toBe(0);
    expect(l.used).toBe(52);
    expect(l.rows.map((r) => r.pages)).toEqual([10, 23, 17, 1]); // each repeat: a gap page, the spread and the lined page
    expect(l.rows[1].innerGaps).toBe(5); // the first repeat's gap sits before the group
    expect(l.rows[1].gaps).toEqual([11]);
    expect(bookPage(b, 1).name).toBe('Blank');
    expect(bookPage(b, 11).name).toBe('Notes');
    expect([12, 13, 14].map((n) => bookPage(b, n).name)).toEqual(['IdeaL', 'IdeaR', 'Lined']);
    expect([bookPage(b, 12).side, bookPage(b, 13).side]).toEqual(['left', 'right']);
    expect(bookPage(b, 34).name).toBe('Lined');
    expect(l.cells[34]?.kind).toBe('free'); // page 35
    expect(l.cells[50]?.kind).toBe('free'); // page 51
    expect(bookPage(b, 52).name).toBe('Closing');
  });

  it('is kept for an outline that has not changed, and worked out again for a new one', () => {
    const b = emptyBook(8);
    b.outline = [pageBlock(A, 2)];
    const first = bookLayout(b);
    expect(bookLayout(b)).toBe(first);
    b.outline = addBlock(b.outline, pageBlock(B));
    expect(bookLayout(b)).not.toBe(first);
    expect(bookLayout(b).used).toBe(3);
    b.page_count = 12;
    expect(bookLayout(b).cells).toHaveLength(12);
  });
});

describe('changing an outline', () => {
  const base = (): Block[] => [pageBlock(A), pin(pageBlock(B), 5), groupBlock('G', [pageBlock(C), pageBlock(A)]), freeBlock()];

  it('leaves the outline it was given as it was', () => {
    const o = base();
    const before = JSON.stringify(o);
    moveBlock(o, [0], 1); removeBlock(o, [1]); duplicateBlock(o, [1]); setRepeat(o, [0], { times: 3 }); setPin(o, [0], 'last');
    expect(JSON.stringify(o)).toBe(before);
  });

  it('moves a block up or down in its list, a child within its group', () => {
    const o = moveBlock(base(), [0], 1);
    expect(o.map((b) => (b.type === 'page' ? b.page?.name : b.type))).toEqual(['B', 'A', 'group', 'free']);
    const g = moveBlock(base(), [2, 1], -1);
    expect((g[2] as Extract<Block, { type: 'group' }>).children.map((c) => (c.type === 'page' ? c.page?.name : ''))).toEqual(['A', 'C']);
    expect(moveBlock(base(), [0], -1).map((b) => b.type)).toEqual(base().map((b) => b.type)); // the first can't go up
  });

  it('duplicates a block without its pin, and a fill as ×1', () => {
    const d = duplicateBlock(base(), [1]);
    expect(d).toHaveLength(5);
    expect(d[2]).toMatchObject({ type: 'page', repeat: { times: 1 } });
    expect('pin' in d[2]).toBe(false);
    const f = duplicateBlock([fill(pageBlock(A))], [0]);
    expect(f[1]).toMatchObject({ repeat: { times: 1 } });
  });

  it('changes a repeat within 1 to 400, and drops the pin when a block fills', () => {
    expect(setRepeat([pageBlock(A)], [0], { times: 0 })[0]).toMatchObject({ repeat: { times: 1 } });
    expect(setRepeat([pageBlock(A)], [0], { times: 9999 })[0]).toMatchObject({ repeat: { times: 400 } });
    const f = setRepeat([pin(pageBlock(A), 'last')], [0], fillRepeat())[0];
    expect(f).toMatchObject({ repeat: { fill: true } });
    expect('pin' in f).toBe(false);
  });

  it('pins a block, and un-pins it', () => {
    const p = setPin([pageBlock(A, 3)], [0], 'last');
    expect(p[0]).toMatchObject({ pin: 'last' });
    expect('pin' in setPin(p, [0], null)[0]).toBe(false);
    expect(setPin([fill(pageBlock(A))], [0], 4)[0]).toMatchObject({ pin: 4, repeat: { times: 1 } });
  });

  it('moves a block into a group and out of it', () => {
    const into = moveIntoGroup(base(), [1], 2); // the pinned B goes to the end of G
    expect(into).toHaveLength(3);
    const g = into[1] as Extract<Block, { type: 'group' }>;
    expect(g.children.map((c) => (c.type === 'page' ? c.page?.name : ''))).toEqual(['C', 'A', 'B']);
    expect('pin' in g.children[2]).toBe(false);
    const out = moveOutOfGroup(into, [1, 0]);
    expect(out.map((b) => (b.type === 'page' ? b.page?.name : b.type))).toEqual(['A', 'group', 'C', 'free']);
  });

  it('records the link to the design a block was placed from', () => {
    const b = pageBlock(A, 1, { id: 'abc', fingerprint: fingerprint(A) });
    expect(b.from).toEqual({ id: 'abc', fingerprint: fingerprint(A) });
    expect(fingerprint(A)).toBe(fingerprint({ ...A, name: 'Renamed', side: 'left', page_number: false })); // the name, side and number are left out
    expect(fingerprint(A)).not.toBe(fingerprint(B));
  });
});

describe('putting a design in a block', () => {
  const link = { id: 'lib-1', fingerprint: 'old' };
  const week = (): Block[] => [{ ...pin(pageBlock(A, 3, link), 9), repeat: { each: 'week' } } as Block, groupBlock('G', [spreadBlock('S', A, B, 2, link)])];

  it('keeps the repeat, pin and position, and the link unless told otherwise', () => {
    const o = setDesign(week(), [0], { page: C });
    expect(o[0]).toMatchObject({ type: 'page', page: { name: 'C' }, repeat: { each: 'week' }, pin: 9, from: link });
    expect(o).toHaveLength(2);
  });

  it('replaces or takes off the link', () => {
    const next = { id: 'lib-2', fingerprint: 'new' };
    expect((setDesign(week(), [0], { page: C }, next)[0] as { from?: unknown }).from).toEqual(next);
    expect('from' in setDesign(week(), [0], { page: null }, null)[0]).toBe(false);
  });

  it('works inside a group, on a spread, and ignores a design of the other kind', () => {
    const o = setDesign(week(), [1, 0], { name: 'T', left: C, right: A });
    expect((o[1] as Extract<Block, { type: 'group' }>).children[0]).toMatchObject({ type: 'spread', name: 'T', left: { name: 'C' }, repeat: { times: 2 }, from: link });
    expect(JSON.stringify(setDesign(week(), [0], { name: 'T', left: C, right: A }))).toBe(JSON.stringify(week()));
    const before = JSON.stringify(week());
    const input = week();
    setDesign(input, [0], { page: C });
    expect(JSON.stringify(input)).toBe(before);
  });
});
