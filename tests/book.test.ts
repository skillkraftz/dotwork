import { describe, expect, it } from 'vitest';
import {
  bookPage, emptyBook, fillSlots, getSlot, pagesLostByResize, readBook, resizeBook, roundPageCount, setSlot, slotSide,
  type Book,
} from '../src/book/book';
import { buildSpread } from '../src/format/spread';
import { emptyPage, type Page } from '../src/format/types';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';
import { contactSheet } from '../src/print/contact';
import { crc32, zip } from '../src/print/zip';

const page = (name: string): Page => ({ ...emptyPage(), name, elements: [{ type: 'text', x: 0, y: 1, text: name }] });
const rules = (r: ReturnType<typeof readBook>) => (r.ok ? [] : r.issues.map((i) => i.rule));

describe('a book', () => {
  it('starts as 52 empty pages with page numbers on and the owner’s calibration', () => {
    const b = emptyBook();
    expect(b.page_count).toBe(52);
    expect(b.pages).toHaveLength(52);
    expect(b.page_numbers).toBe(true);
    expect(b.print).toEqual({
      creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5,
      sheet_layout: 'half_letter',
      layouts: {
        half_letter: { front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, scale_x_pct: 100, scale_y_pct: 100 },
        letter_two_up: { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100 },
      },
      signatures: 1,
      shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
    });
  });

  it('rounds the page count up to a multiple of 4, within limits', () => {
    expect([1, 4, 5, 50, 52, 53, 1000, NaN].map(roundPageCount)).toEqual([4, 4, 8, 52, 52, 56, 400, 52]);
  });

  it('puts odd pages on the right, even on the left, and the covers beside pages 1 and N', () => {
    expect([0, 1, 2, 3, 52, 53].map(slotSide)).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
  });

  it('turns a design to face its slot, and keeps a copy', () => {
    const b = emptyBook(8), p = page('A');
    setSlot(b, 1, p);
    setSlot(b, 2, p);
    setSlot(b, 0, p);
    setSlot(b, 9, p);
    expect([1, 2, 0, 9].map((n) => getSlot(b, n)!.side)).toEqual(['right', 'left', 'left', 'right']);
    p.elements.length = 0;
    expect(getSlot(b, 1)!.elements).toHaveLength(1);
    expect(p.side).toBeUndefined();
    setSlot(b, 1, null);
    expect(getSlot(b, 1)).toBeNull();
    expect(bookPage(b, 1).side).toBe('right'); // an empty slot still shows a blank page of the right side
  });

  it('fills a range with one page, or a spread by sides', () => {
    const b = emptyBook(8);
    fillSlots(b, 2, 5, page('Lined'));
    expect(b.pages.map((p) => p?.name ?? null)).toEqual([null, 'Lined', 'Lined', 'Lined', 'Lined', null, null, null]);
    const spread = buildSpread('S', page('L'), page('R'));
    fillSlots(b, 3, 8, spread);
    expect(b.pages.map((p) => p?.name ?? null)).toEqual([null, 'Lined', 'R', 'L', 'R', 'L', 'R', 'L']);
    fillSlots(b, 0, 9, page('All')); // the covers are part of the range
    expect(b.cover.front!.name).toBe('All');
    expect(b.cover.back!.side).toBe('right');
  });

  it('resizes by whole signatures of pages, dropping what is cut off', () => {
    const b = emptyBook(8);
    setSlot(b, 8, page('Last'));
    expect(pagesLostByResize(b, 4)).toBe(1);
    resizeBook(b, 12);
    expect(b.page_count).toBe(12);
    expect(b.pages).toHaveLength(12);
    expect(b.pages[7]!.name).toBe('Last');
    resizeBook(b, 5); // rounds up to 8
    expect(b.page_count).toBe(8);
  });
});

describe('book file', () => {
  const good = () => { const b = emptyBook(8); setSlot(b, 1, page('A')); setSlot(b, 0, page('C')); return JSON.parse(JSON.stringify(b)) as Book; };

  it('reads what it writes', () => {
    const r = readBook(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book.pages[0]!.name).toBe('A');
  });

  it('says which rule failed and where', () => {
    expect(rules(readBook(null))).toEqual(['root-object']);
    expect(rules(readBook({ ...good(), format: 'x' }))).toContain('format');
    expect(rules(readBook({ ...good(), version: 2 }))).toContain('version');
    expect(rules(readBook({ ...good(), name: 3 }))).toContain('name');
    expect(rules(readBook({ ...good(), page_count: 6 }))).toContain('page-count');
    expect(rules(readBook({ ...good(), page_numbers: 'yes' }))).toContain('page-numbers');
    expect(rules(readBook({ ...good(), pages: [] }))).toContain('pages-length');
    expect(rules(readBook({ ...good(), print: { ...good().print, signatures: 0 } }))).toContain('print-setting');
    expect(rules(readBook({ ...good(), print: undefined }))).toContain('print');
    expect(rules(readBook({ ...good(), cover: { front: null } }))).toContain('cover');
  });

  it('checks every page against the page format and the side of its slot', () => {
    const b = good();
    b.pages[1] = { ...page('Bad'), side: 'right' }; // page 2 is a left page
    const r = readBook(b);
    expect(rules(r)).toContain('book-side');
    const c = good();
    c.pages[2] = { ...page('Bad'), side: 'right', elements: [{ type: 'box', x: 0.2, y: 1, w: 2, h: 2 }] };
    expect(rules(readBook(c)).length).toBeGreaterThan(0);
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
    setSlot(b, 1, page('A'));
    const item = await lib.save('book', 'Pocket', b);
    expect(item.kind).toBe('book');
    expect(item.data.name).toBe('Pocket');
    const file = await lib.exportAll();
    expect(readLibraryFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const broken = JSON.parse(JSON.stringify(file));
    broken.items[0].data.page_count = 7;
    const r = readLibraryFile(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toBe('items[0].data.page_count');
  });
});

describe('contact sheet', () => {
  it('shows every spread as it opens, covers beside the first and last pages', () => {
    const b = emptyBook(8);
    setSlot(b, 3, page('Hello'));
    const { svg } = contactSheet(b);
    expect(svg.match(/<g transform="translate\(0 0\)">/g)).toHaveLength(5); // left page of each of the 5 spreads
    expect(svg).toContain('Inside front cover · 1');
    expect(svg).toContain('8 · Inside back cover');
    expect(svg).toContain('>Hello<');
    expect(svg).toContain('>3<'); // page numbers
    expect(contactSheet({ ...b, page_numbers: false }).svg).not.toContain('>3<');
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
