import { describe, expect, it } from 'vitest';
import { bookLayout, bookPage, emptyBook, getSlot, readBook, resizeBook, setCover, slotSide, type Book } from '../src/book/book';
import { pageBlock, spreadBlock } from '../src/book/outline';
import { emptyPage, type Page } from '../src/format/types';
import { formatIssue, validatePage } from '../src/format/validate';
import { BUILTIN_PAGES, BUILTIN_SPREADS } from '../src/builtin/library';
import { TEMPLATES } from '../src/builtin/templates';
import { errorLog, withBookJson } from '../src/print/bundle';

const problems = (b: Book) => { const r = readBook(b); return r.ok ? [] : r.issues.map(formatIssue); };

/** A page with an open header row (no identity) and an element on row 0, in the outer corner of the side it is NOT on. */
const cornerPage = (side: 'left' | 'right', pageNumber = true): Page => ({
  ...emptyPage(), name: `Corner ${side}`, side, identity: '', ...(pageNumber ? {} : { page_number: false }),
  elements: [{ type: 'text', x: side === 'left' ? 25 : 0, y: 0, text: 'HI' }],
});

describe('a page that is valid on one side', () => {
  it('really is valid on its own side and breaks on the other (the premise)', () => {
    expect(validatePage(cornerPage('left'))).toEqual([]);
    expect(validatePage({ ...cornerPage('left'), side: 'right' }).map((i) => i.rule)).toEqual(['header-corner']);
  });

  it('can be placed on either side of the interior without breaking the book, and prints fine on both', () => {
    for (const from of ['left', 'right'] as const) {
      const b = emptyBook();
      b.outline = [pageBlock(cornerPage(from), 52)];
      expect(problems(b), `${from} page`).toEqual([]);
      for (let slot = 1; slot <= 52; slot++) expect(validatePage(bookPage(b, slot)), `${from} page in slot ${slot}`).toEqual([]);
    }
  });

  it('keeps its page number when it fits, and loses it (on the placed copy only) when it would cover the corner', () => {
    const b = emptyBook(), src = cornerPage('left');
    b.outline = [pageBlock(src, 2)];
    expect(bookPage(b, 2).page_number).toBeUndefined(); // slot 2 is a left page: fits
    expect(bookPage(b, 1).page_number).toBe(false); // slot 1 is a right page: the corner moved
    expect(src.page_number).toBeUndefined(); // the design itself is untouched
  });

  it('can be placed on both covers (they carry no page number)', () => {
    for (const from of ['left', 'right'] as const) {
      const b = emptyBook();
      setCover(b, 0, cornerPage(from));
      setCover(b, b.page_count + 1, cornerPage(from));
      expect(problems(b), `${from} page on the covers`).toEqual([]);
    }
  });

  it('survives a spread block, a repeated page, and resizing', () => {
    const b = emptyBook();
    b.outline = [spreadBlock('Corners', cornerPage('left'), cornerPage('right'), 26)];
    expect(problems(b)).toEqual([]);
    const c = emptyBook();
    c.outline = [pageBlock(cornerPage('left'), 52)];
    expect(problems(c)).toEqual([]);
    resizeBook(c, 8);
    expect(problems(c)).toEqual([]);
  });
});

describe('the owner’s case', () => {
  const cover = (): Page => ({ ...emptyPage(), name: 'Cover', side: 'left', identity: '', elements: [{ type: 'text', x: 0, y: 0, text: 'MINE' }] });

  it('a cover with an element at row 0, x 0-2 and the page number on reads fine', () => {
    const b = emptyBook();
    b.cover.front = cover();
    expect(problems(b)).toEqual([]);
  });

  it('is still refused in the outline, with the reason', () => {
    const b = emptyBook();
    b.outline = [pageBlock({ ...cover(), side: 'right', elements: [{ type: 'text', x: 25, y: 0, text: 'MINE' }] })];
    expect(problems(b).join('\n')).toContain('header-corner');
  });

  it('a book with this problem still gets a book.json, and an error.txt that says why', () => {
    const b = emptyBook();
    b.outline = [pageBlock({ ...cover(), side: 'right', elements: [{ type: 'text', x: 25, y: 0, text: 'MINE' }] })]; // a hand-edited book that does break the rule
    const files = withBookJson(b, []);
    expect(files.map((f) => f.name)).toEqual(['book.json', 'error.txt']);
    const log = new TextDecoder().decode(files[1].bytes);
    expect(log).toContain('outline[0].page.elements[0]');
    expect(log).toContain('header-corner');
    expect(errorLog(emptyBook())).toBeNull();
  });
});

describe('every design on every slot', () => {
  const saved: Page[] = [cornerPage('left'), cornerPage('right'), cornerPage('left', false)];
  const designs: [string, Page | (typeof BUILTIN_SPREADS)[number]][] = [
    ...BUILTIN_PAGES.map((p) => [p.name, p] as [string, Page]),
    ...BUILTIN_SPREADS.map((s) => [s.name, s] as [string, typeof s]),
    ...saved.map((p) => [`saved ${p.name}${p.page_number === false ? ' (no number)' : ''}`, p] as [string, Page]),
  ];

  it.each(designs)('“%s” is accepted in every slot, covers included, and resized', (_name, design) => {
    const b = emptyBook();
    b.outline = design.format === 'dotwork-spread' ? [spreadBlock(design.name, design.left, design.right, 26)] : [pageBlock(design, 52)];
    for (const slot of [-1, 0, 53, 54]) setCover(b, slot, design.format === 'dotwork-spread' ? design[slotSide(slot)] : design);
    expect(problems(b)).toEqual([]);
    for (let slot = 1; slot <= b.page_count; slot++) expect(validatePage(bookPage(b, slot)), `slot ${slot}`).toEqual([]);
    resizeBook(b, 28);
    expect(problems(b)).toEqual([]);
    resizeBook(b, 60);
    expect(problems(b)).toEqual([]);
  });

  it('is accepted by every book template as built', () => {
    for (const t of TEMPLATES) expect(problems(t.build()), t.id).toEqual([]);
  });
});

describe('spread blocks', () => {
  const names = ['Lined spread', 'Dot grid spread', 'Notes spread', 'Weekly spread', 'Weekly spread (undated)'];

  it.each(names)('“%s” puts left pages on left slots and right pages on right slots', (name) => {
    const sp = BUILTIN_SPREADS.find((s) => s.name === name)!;
    const b = emptyBook();
    b.outline = [pageBlock(null), spreadBlock(sp.name, sp.left, sp.right, 25)]; // one blank page, so the spreads start on page 2
    for (let n = 2; n <= 51; n++) {
      const want = n % 2 ? sp.right : sp.left;
      expect(bookPage(b, n).side, `page ${n}`).toBe(n % 2 ? 'right' : 'left');
      expect(getSlot(b, n)!.name, `page ${n}`).toBe(want.name);
    }
    expect(bookLayout(b).cells[51]).toBeNull();
    expect(problems(b)).toEqual([]);
  });
});
