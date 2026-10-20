import { describe, expect, it } from 'vitest';
import { applyDesign, emptyBook, fillSlots, getSlot, readBook, resizeBook, setDates, setSlot, slotCount, slotSide, type Book } from '../src/book/book';
import { buildSpread } from '../src/format/spread';
import { emptyPage, type Page } from '../src/format/types';
import { validatePage } from '../src/format/validate';
import { BUILTIN_PAGES, BUILTIN_SPREADS } from '../src/builtin/library';
import { designKey, scopeSlots, whatChanges } from '../src/book/plan';
import { TEMPLATES } from '../src/builtin/templates';
import { errorLog, withBookJson } from '../src/print/bundle';
import { formatIssue } from '../src/format/validate';

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

  it('can be placed on either side of the interior without breaking the book', () => {
    for (const from of ['left', 'right'] as const) {
      for (const slot of [1, 2, 3, 52]) {
        const b = emptyBook();
        setSlot(b, slot, cornerPage(from));
        expect(problems(b), `${from} page in slot ${slot}`).toEqual([]);
      }
    }
  });

  it('keeps its page number when it fits, and loses it (on the placed copy only) when it would cover the corner', () => {
    const b = emptyBook(), src = cornerPage('left');
    expect(setSlot(b, 2, src)).toBe(false); // slot 2 is a left page: fits
    expect(getSlot(b, 2)!.page_number).toBeUndefined();
    expect(setSlot(b, 1, src)).toBe(true); // slot 1 is a right page: the corner moved
    expect(getSlot(b, 1)!.page_number).toBe(false);
    expect(src.page_number).toBeUndefined(); // the design itself is untouched
  });

  it('can be placed on both covers (they carry no page number)', () => {
    for (const from of ['left', 'right'] as const) {
      const b = emptyBook();
      setSlot(b, 0, cornerPage(from));
      setSlot(b, b.page_count + 1, cornerPage(from));
      expect(problems(b), `${from} page on the covers`).toEqual([]);
    }
  });

  it('survives a spread filled across slots, apply to more pages, resize and dates', () => {
    const b = emptyBook();
    fillSlots(b, 0, 53, buildSpread('Corners', cornerPage('left'), cornerPage('right')));
    expect(problems(b)).toEqual([]);
    const c = emptyBook();
    applyDesign(c, Array.from({ length: 53 }, (_, i) => i), cornerPage('left'));
    expect(problems(c)).toEqual([]);
    resizeBook(c, 8);
    setDates(c, 1, ['2026-01-04', '2026-01-11']);
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

  it('is still refused on an interior page, with the reason', () => {
    const b = emptyBook();
    b.pages[1] = cover(); // left page, outer corner x 0-2: a real clash
    expect(problems(b).join('\n')).toContain('header-corner');
  });

  it('a book with this problem still gets a book.json, and an error.txt that says why', () => {
    const b = emptyBook();
    b.pages[1] = cover(); // a hand-edited book that does break the rule
    const files = withBookJson(b, []);
    expect(files.map((f) => f.name)).toEqual(['book.json', 'error.txt']);
    const log = new TextDecoder().decode(files[1].bytes);
    expect(log).toContain('pages[1].elements[0]');
    expect(log).toContain('header-corner');
    expect(errorLog(emptyBook())).toBeNull();
  });
});

describe('every design on every slot', () => {
  const dates = (b: Book) => { b.dates = Array.from({ length: b.page_count }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`); };
  const saved: Page[] = [cornerPage('left'), cornerPage('right'), cornerPage('left', false)];
  const designs: [string, Page | ReturnType<typeof buildSpread>][] = [
    ...BUILTIN_PAGES.map((p) => [p.name, p] as [string, Page]),
    ...BUILTIN_SPREADS.map((s) => [s.name, s] as [string, typeof s]),
    ...saved.map((p) => [`saved ${p.name}${p.page_number === false ? ' (no number)' : ''}`, p] as [string, Page]),
  ];

  it.each(designs)('“%s” is accepted in every slot, covers included, dated and resized', (_name, design) => {
    const b = emptyBook();
    dates(b);
    for (let slot = 0; slot < slotCount(b); slot++) {
      setSlot(b, slot, design.format === 'dotwork-spread' ? design[slotSide(slot)] : design);
    }
    expect(problems(b)).toEqual([]);
    resizeBook(b, 28);
    expect(problems(b)).toEqual([]);
    resizeBook(b, 60);
    expect(problems(b)).toEqual([]);
  });

  it('is accepted by every book template as built', () => {
    for (const t of TEMPLATES) expect(problems(t.build()), t.id).toEqual([]);
  });
});


describe('spreads applied to a range', () => {
  const names = ['Lined spread', 'Dot grid spread', 'Notes spread', 'Weekly spread', 'Weekly spread (undated)'];
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it.each(names.flatMap((n) => [[n, 2, 50], [n, 1, 52]] as const))('“%s” on pages %i-%i puts left pages on left slots and right pages on right slots', (name, from, to) => {
    const sp = BUILTIN_SPREADS.find((s) => s.name === name)!;
    const b = emptyBook();
    const slots = scopeSlots(b, { mode: 'range', from, to }, from);
    expect(applyDesign(b, slots, sp)).toEqual([]);
    for (const n of range(from, to)) {
      const want = n % 2 ? sp.right : sp.left;
      expect(getSlot(b, n)!.side, `page ${n}`).toBe(n % 2 ? 'right' : 'left');
      expect(designKey(getSlot(b, n))).toBe(designKey(want));
    }
    expect(getSlot(b, from === 2 ? 1 : 53)).toBeNull();
    expect(problems(b)).toEqual([]);
  });

  it('reports what would change per page for a pair', () => {
    const b = emptyBook(), sp = BUILTIN_SPREADS.find((s) => s.name === 'Weekly spread')!;
    applyDesign(b, [2, 3], sp);
    expect(whatChanges(b, [2, 3, 4, 5], sp)).toEqual({ changed: [4, 5], replaced: 0 });
  });

  it('every built-in spread passes the book format on every pair of slots', () => {
    for (const sp of BUILTIN_SPREADS) {
      const b = emptyBook();
      for (let from = 0; from < slotCount(b) - 1; from += 2) fillSlots(b, from, from + 1, sp);
      expect(problems(b), sp.name).toEqual([]);
    }
  });
});
