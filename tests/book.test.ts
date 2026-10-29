import { describe, expect, it } from 'vitest';
import {
  bookLayout, bookPage, emptyBook, getSlot, lastSlot, readBook, resizeBook, roundPageCount, setCover, slotSide,
  type Book,
} from '../src/book/book';
import { openings } from '../src/book/flip';
import { groupBlock, pageBlock, spreadBlock } from '../src/book/outline';
import { emptyPage, type Page } from '../src/format/types';
import { Library, MemoryBackend, isOldFormat, readLibraryFile, type LibraryItem } from '../src/library/library';
import { readSection, sectionGroup, isOldSection } from '../src/book/sections';
import { BUILTIN_SECTIONS } from '../src/builtin/sections';
import { contactSheet } from '../src/print/contact';
import { crc32, zip } from '../src/print/zip';
import { onPages } from './books';

const page = (name: string): Page => ({ ...emptyPage(), name, elements: [{ type: 'text', x: 0, y: 1, text: name }] });
const rules = (r: ReturnType<typeof readBook>) => (r.ok ? [] : r.issues.map((i) => i.rule));

describe('a book', () => {
  it('starts as 52 pages with nothing placed, page numbers on, one signature and no printer settings', () => {
    const b = emptyBook();
    expect(b.page_count).toBe(52);
    expect(b.outline).toEqual([]);
    expect(bookLayout(b).cells).toHaveLength(52);
    expect(b.page_numbers).toBe(true);
    expect(b.print).toEqual({ signatures: 1 }); // the book file holds the design only; the printer's settings are the printer profile's (printer.test.ts)
  });

  it('rounds the page count up to a multiple of 4, within limits', () => {
    expect([1, 4, 5, 50, 52, 53, 1000, NaN].map(roundPageCount)).toEqual([4, 4, 8, 52, 52, 56, 400, 52]);
  });

  it('puts odd pages on the right, even on the left, and the covers beside pages 1 and N', () => {
    expect([0, 1, 2, 3, 52, 53].map(slotSide)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
  });

  it('turns a design to face its slot, and keeps a copy of a cover', () => {
    const b = emptyBook(8), p = page('A');
    b.outline = [pageBlock(p, 2)];
    setCover(b, 0, p);
    setCover(b, 9, p);
    expect([1, 2, 0, 9].map((n) => bookPage(b, n).side)).toEqual(['right', 'left', 'left', 'right']);
    p.elements.length = 0;
    expect(getSlot(b, 0)!.elements).toHaveLength(1);
    expect(p.side).toBeUndefined();
    setCover(b, 0, null);
    expect(getSlot(b, 0)).toBeNull();
    expect(bookPage(b, 3).side).toBe('right'); // a page nothing is placed on still shows a blank page of the right side
    expect(() => setCover(b, 1, p)).toThrow(/not a cover/); // the outline makes the pages
  });

  it('turns the page number off for a page it covers when the design is turned to the other side', () => {
    const b = emptyBook(8);
    const corner = { ...page('Corner'), side: 'left' as const, identity: '', elements: [{ type: 'text' as const, x: 25, y: 0, text: 'HI' }] };
    b.outline = [pageBlock(corner, 2)];
    expect(bookPage(b, 2).page_number).toBeUndefined(); // slot 2 is a left page: it fits
    expect(bookPage(b, 1).page_number).toBe(false); // slot 1 is a right page: the corner moved under the text
    expect(corner.page_number).toBeUndefined(); // the design itself is untouched
  });

  it('is resized without losing the outline: a book that no longer fits is over', () => {
    const b = emptyBook(8);
    b.outline = [pageBlock(page('Page'), 8)];
    resizeBook(b, 12);
    expect(b.page_count).toBe(12);
    expect(bookLayout(b).used).toBe(8);
    resizeBook(b, 5); // rounds up to 8
    expect(b.page_count).toBe(8);
    resizeBook(b, 4);
    expect(b.page_count).toBe(4);
    expect(b.outline).toHaveLength(1);
    expect(bookLayout(b).over).toBe(4);
  });
});

describe('book file', () => {
  const good = () => {
    const b = emptyBook(8);
    b.outline = [pageBlock(page('A'), 2), spreadBlock('S', { ...page('L'), side: 'left' }, { ...page('R'), side: 'right' }), groupBlock('G', [pageBlock(page('B'))])];
    setCover(b, 0, page('C'));
    return JSON.parse(JSON.stringify(b)) as Book;
  };

  it('reads what it writes', () => {
    const r = readBook(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.outline.map((x) => x.type)).toEqual(['page', 'spread', 'group']);
  });

  it('says which rule failed and where', () => {
    expect(rules(readBook(null))).toEqual(['root-object']);
    expect(rules(readBook({ ...good(), format: 'x' }))).toContain('format');
    expect(rules(readBook({ ...good(), version: 3 }))).toContain('version');
    expect(rules(readBook({ ...good(), name: 3 }))).toContain('name');
    expect(rules(readBook({ ...good(), page_count: 6 }))).toContain('page-count');
    expect(rules(readBook({ ...good(), page_numbers: 'yes' }))).toContain('page-numbers');
    expect(rules(readBook({ ...good(), outline: undefined }))).toContain('outline');
    expect(rules(readBook({ ...good(), cover: { front: null } }))).toContain('cover');
  });

  it('checks the outline: repeats, pins, groups, spread sides, pages and the one block that takes what is left', () => {
    const bad = (outline: unknown) => rules(readBook({ ...good(), outline }));
    expect(bad([{ type: 'page', page: null, repeat: { times: 0 } }])).toContain('repeat');
    expect(bad([{ type: 'page', page: null, repeat: { times: 2 }, pin: 0 }])).toContain('pin');
    expect(bad([{ type: 'page', page: null, repeat: { fill: true }, pin: 'last' }])).toContain('pin');
    expect(bad([{ type: 'group', name: 'G', repeat: { times: 1 }, children: [{ type: 'group', name: 'H', repeat: { times: 1 }, children: [] }] }])).toContain('group');
    expect(bad([{ type: 'group', name: 'G', repeat: { times: 1 }, children: [{ type: 'page', page: null, repeat: { fill: true } }] }])).toContain('repeat');
    expect(bad([{ type: 'spread', name: 'S', left: { ...page('L'), side: 'right' }, right: { ...page('R'), side: 'right' }, repeat: { times: 1 } }])).toContain('spread-side');
    expect(bad([{ type: 'page', page: { ...page('Bad'), elements: [{ type: 'box', x: 0.2, y: 1, w: 2, h: 2 }] }, repeat: { times: 1 } }]).length).toBeGreaterThan(0);
    expect(bad([{ type: 'page', page: null, repeat: { fill: true } }, { type: 'free', pages: [] }])).toContain('rest');
    expect(bad([{ type: 'page', page: null, repeat: { fill: true } }, { type: 'group', name: 'G', repeat: { fill: true }, children: [] }])).toContain('rest');
    expect(bad([{ type: 'wat' }])).toContain('block');
    expect(bad([{ type: 'page', page: null, repeat: { times: 1 }, from: { id: 'x' } }])).toContain('from');
    expect(bad([{ type: 'page', page: null, repeat: { times: 1 }, from: { id: 'x', fingerprint: 'y' }, pin: 'last' }, { type: 'free', pages: [null] }])).toEqual([]);
    const d = good();
    d.cover.back = { ...page('Back'), side: 'left' }; // the inside back cover is a right page
    expect(rules(readBook(d))).toContain('book-side');
  });
});

describe('the library holds books', () => {
  it('saves, lists and backs up a book beside pages and spreads, and checks it on import', async () => {
    let n = 0;
    const lib = new Library(new MemoryBackend(), () => new Date(Date.UTC(2026, 9, 18, 12, 0, n)), () => `id${n++}`);
    const b = emptyBook(8);
    onPages(b, { 1: page('A') });
    const item = await lib.save('book', 'Pocket', b);
    expect(item.kind).toBe('book');
    expect(item.data.name).toBe('Pocket');
    const file = await lib.exportAll();
    expect(readLibraryFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const broken = JSON.parse(JSON.stringify(file));
    broken.items[0].data.page_count = 7;
    const r = readLibraryFile(broken);
    expect(r.ok && r.items).toEqual([]); // the book is refused, with the reason
    if (r.ok) expect(r.refused[0].reason).toContain('items[0].data.page_count');
  });
});

describe('books and sections from before the outline', () => {
  const oldBook = { format: 'dotwork-book', version: 1, name: 'Old', page_count: 8, page_numbers: true, print: { signatures: 1 }, pages: Array(8).fill(null), dates: Array(8).fill(null), cover: { front: null, back: null } };
  const oldSection = { format: 'dotwork-section', version: 1, name: 'Old week', pages: [null, null], days: [0, 1], weekday: 1, move: 'week', left: false };
  const item = (kind: 'book' | 'section', data: unknown) => ({ id: 'x', kind, name: 'Old', updated: '2026-10-27T00:00:00Z', data }) as unknown as LibraryItem;

  it('are told by their shape, and are not read', () => {
    expect(isOldFormat(item('book', oldBook))).toBe(true);
    expect(isOldFormat(item('section', oldSection))).toBe(true);
    expect(isOldFormat(item('book', emptyBook()))).toBe(false);
    expect(isOldFormat(item('section', BUILTIN_SECTIONS[0]))).toBe(false);
    expect(rules(readBook(oldBook))).toContain('outline');
    expect(readSection(oldSection).ok).toBe(false);
    expect(isOldSection(oldSection)).toBe(true);
  });

  it('are refused in a backup, with the reason, and the rest is restored', () => {
    const file = { format: 'dotwork-library', version: 1, exported: '2026-10-27T00:00:00Z', items: [
      { id: 'a', kind: 'book', name: 'Old', updated: '2026-10-27T00:00:00Z', data: oldBook },
      { id: 'b', kind: 'book', name: 'New', updated: '2026-10-27T00:00:00Z', data: emptyBook() },
    ] };
    const r = readLibraryFile(JSON.parse(JSON.stringify(file)));
    expect(r.ok && r.items.map((i) => i.name)).toEqual(['New']);
    if (r.ok) expect(r.refused[0].reason).toContain('outline');
  });
});

describe('sections', () => {
  it('read as the children of a group, and place as a group of their own', () => {
    for (const s of BUILTIN_SECTIONS) {
      const r = readSection(JSON.parse(JSON.stringify(s)));
      expect(r.ok, s.name).toBe(true);
      const g = sectionGroup(s);
      expect(g).toMatchObject({ type: 'group', name: s.name, repeat: { times: 1 } });
      expect(g.children).toEqual(s.children);
      expect(g.children).not.toBe(s.children); // a copy
    }
    expect(BUILTIN_SECTIONS.find((s) => s.name === 'Journal week')!.children.map((c) => c.type === 'page' && c.repeat)).toEqual(
      [{ times: 1 }, { times: 7 }, { times: 1 }, { times: 1 }]);
  });

  it('refuse a group inside a section, a fill, and a pin', () => {
    const bad = (children: unknown) => readSection({ format: 'dotwork-section', version: 1, name: 'S', children }).ok;
    expect(bad([{ type: 'page', page: null, repeat: { times: 2 } }])).toBe(true);
    expect(bad([{ type: 'page', page: null, repeat: { fill: true } }])).toBe(false);
    expect(bad([{ type: 'page', page: null, repeat: { times: 1 }, pin: 'last' }])).toBe(false);
    expect(bad([{ type: 'group', name: 'G', children: [], repeat: { times: 1 } }])).toBe(false);
  });
});

describe('contact sheet', () => {
  it('shows every spread as it opens, covers beside the first and last pages', () => {
    const b = emptyBook(8);
    onPages(b, { 3: page('Hello') });
    const { svg } = contactSheet(b);
    expect(svg.match(/<g transform="translate\(0 0\)">/g)).toHaveLength(5); // left page of each of the 5 spreads
    expect(svg).toContain('Inside front cover · 1');
    expect(svg).toContain('8 · Inside back cover');
    expect(svg).toContain('>Hello<');
    expect(svg).toContain('>3<'); // page numbers
    expect(contactSheet({ ...b, page_numbers: false }).svg).not.toContain('>3<');
  });

  it('adds the outside covers, laid out as cover-outside.pdf prints them (back | front), only when one is designed', () => {
    const b = emptyBook(8);
    expect(contactSheet(b).svg).not.toContain('Outside');
    setCover(b, -1, page('FRONTOUT'));
    setCover(b, lastSlot(b), page('BACKOUT'));
    const { svg } = contactSheet(b);
    expect(svg).toContain('Outside back cover · Outside front cover');
    expect(svg).toContain('>FRONTOUT<');
    expect(svg).toContain('>BACKOUT<');
    expect(svg.match(/<g transform="translate\(0 0\)">/g)).toHaveLength(6); // the 5 spreads and the outside covers
    expect(svg.indexOf('>BACKOUT<')).toBeLessThan(svg.indexOf('>FRONTOUT<')); // the back is the left page
  });
});

describe('flip through', () => {
  it('has an opening for each designed outside cover, the front alone before the book and the back alone after it', () => {
    const b = emptyBook(8);
    expect(openings(b)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]);
    setCover(b, -1, page('F'));
    expect(openings(b)[0]).toEqual([null, -1]);
    expect(openings(b)).toHaveLength(6);
    setCover(b, lastSlot(b), page('B'));
    expect(openings(b).at(-1)).toEqual([10, null]);
    expect(openings(b)).toHaveLength(7);
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('stores entries and a directory that lists them', () => {
    const bytes = zip([{ name: 'a.txt', bytes: new TextEncoder().encode('hi') }, { name: 'b.bin', bytes: new Uint8Array([1, 2, 3]) }], new Date(2026, 9, 18, 12, 0, 0));
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    expect(new TextDecoder().decode(bytes.subarray(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(bytes.subarray(35, 37))).toBe('hi');
    // the directory starts where it says it does
    expect(v.getUint32(v.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});
