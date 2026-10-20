import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { BUILTIN_PAGES, BUILTIN_SPREADS, BUILTIN_WIDGETS, asCopy, isBuiltinName } from '../src/builtin/library';
import { TEMPLATES } from '../src/builtin/templates';
import { monthStarts, monthOfWeek } from '../src/builtin/calendar';
import { monthlyLayout } from '../src/builtin/layout';
import { readBook, bookPage, getSlot } from '../src/book/book';
import { readPage } from '../src/format/read';
import { readSpread } from '../src/format/spread';
import { formatIssue, validatePage, validateElement } from '../src/format/validate';
import { placeWidget } from '../src/widgets';
import { exportBookFiles } from '../src/print/export';
import { Library, MemoryBackend } from '../src/library/library';

const fonts = { regular: readFileSync('src/fonts/CourierPrime-Regular.ttf'), bold: readFileSync('src/fonts/CourierPrime-Bold.ttf') };
const problems = (issues: Parameters<typeof formatIssue>[0][]) => issues.map(formatIssue);

describe('the built-in pages, spreads and widgets', () => {
  it('has every page of the owner’s books', () => {
    const names = BUILTIN_PAGES.map((p) => p.name);
    for (const want of ['Monthly tracker', 'Daily Good Time Journal', 'Weekly reflection', 'Patterns & takeaways', 'Questions', 'Idea page', 'Lined page', 'Dot grid page',
      'Blank', 'Notes', 'Year journal weekly page', 'Year journal weekly page (dated)', 'Year goals cover', 'Year index', 'Monthly page index',
      'Plain-book purpose cover', 'Plain-book index', 'Book notes setup', 'Book notes']) expect(names).toContain(want);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(BUILTIN_PAGES.map((p) => [p.name, p] as const))('page “%s” validates', (_name, page) => {
    expect(problems(validatePage(page))).toEqual([]);
    expect(readPage(page).ok).toBe(true);
  });

  it.each(BUILTIN_SPREADS.map((s) => [s.name, s] as const))('spread “%s” validates', (_name, spread) => {
    const r = readSpread(spread);
    expect(r.ok ? [] : problems(r.issues)).toEqual([]);
  });

  it('pairs the spreads the way the books use them', () => {
    const names = (s: string) => { const sp = BUILTIN_SPREADS.find((x) => x.name === s)!; return [sp.left.name, sp.right.name]; };
    expect(names('Ideas spread')).toEqual(['Idea page', 'Dot grid page']);
    expect(names('Book notes spread')).toEqual(['Book notes setup', 'Book notes']);
    expect(names('Lined spread')).toEqual(['Lined page', 'Lined page']);
    expect(names('Dot grid spread')).toEqual(['Dot grid page', 'Dot grid page']);
    expect(names('Notes spread')).toEqual(['Notes', 'Notes']);
    expect(names('Weekly spread')).toEqual(['Year journal weekly page (dated)', 'Year journal weekly page (dated)']);
    expect(names('Weekly spread (undated)')).toEqual(['Year journal weekly page', 'Year journal weekly page']);
    expect(names('Book notes spread')).toEqual(['Book notes setup', 'Book notes']); // left as it was
    for (const covers of ['Year planner covers', 'Monthly journal covers', 'Plain-book covers']) expect(names(covers)).toHaveLength(2);
  });

  it('mirrors the weekly spread: the day column is on the outer edge of each page and the lines run to the spine', () => {
    for (const name of ['Weekly spread', 'Weekly spread (undated)']) {
      const sp = BUILTIN_SPREADS.find((x) => x.name === name)!;
      expect([sp.left.side, sp.right.side]).toEqual(['left', 'right']);
      const strip = (p: typeof sp.left) => p.elements.filter((e) => e.type === 'shade').map((e) => (e as { x: number }).x);
      expect(strip(sp.left)).toEqual([0, 0]); // outer edge of the left page
      expect(strip(sp.right)).toEqual([25, 25]); // outer edge of the right page
      const rule = (p: typeof sp.left) => p.elements.find((e) => e.type === 'rule' && e.x1 === e.x2 && e.y2 - e.y1 > 40) as { x1: number };
      expect([rule(sp.left).x1, rule(sp.right).x1]).toEqual([2, 25]); // the strip's inner edge
      const lines = (p: typeof sp.left) => p.elements.find((e) => e.type === 'pattern' && e.pattern === 'lines') as { x: number; w: number };
      expect([lines(sp.left).x, lines(sp.left).x + lines(sp.left).w]).toEqual([2, 27]); // to the spine
      expect([lines(sp.right).x, lines(sp.right).x + lines(sp.right).w]).toEqual([0, 25]); // to the spine
    }
  });

  it.each(BUILTIN_WIDGETS.map((w) => [w.name, w] as const))('widget “%s” validates wherever it is placed', (_name, widget) => {
    for (const at of [{ x: 0, y: 1 }, { x: 26, y: 43 }]) {
      for (const el of placeWidget(widget, at)) expect(problems(validateElement(el)), JSON.stringify(el)).toEqual([]);
    }
  });

  it('lists the starter widgets', () => {
    expect(BUILTIN_WIDGETS.map((w) => w.name)).toEqual(['S M T W T F S header', 'Habit row', 'Mood scale', 'Weather row', 'Rapid-log key', 'Day block', 'Dial placeholder']);
  });
});

describe('built-ins can’t be overwritten', () => {
  it('opening one makes a copy under another name', () => {
    const original = BUILTIN_PAGES[0];
    const copy = asCopy(original);
    expect(copy.name).toBe(`${original.name} copy`);
    expect(copy.elements).toEqual(original.elements);
    copy.elements.pop();
    expect(copy.elements).not.toEqual(original.elements);
    expect(original.name).toBe('Monthly tracker');
    expect(isBuiltinName('page', copy.name)).toBe(false);
  });

  it('keeps their names out of the saved library', async () => {
    const lib = new Library(new MemoryBackend(), undefined, undefined, isBuiltinName);
    await expect(lib.save('page', 'Lined page', BUILTIN_PAGES[0])).rejects.toThrow(/built-in/);
    await expect(lib.save('spread', 'Ideas spread', BUILTIN_SPREADS[0])).rejects.toThrow(/built-in/);
    const saved = await lib.save('page', 'My lined page', BUILTIN_PAGES[0]);
    await expect(lib.rename(saved.id, 'Notes')).rejects.toThrow(/built-in/);
    expect((await lib.get(saved.id))!.name).toBe('My lined page');
    expect((await lib.list()).map((i) => i.name)).toEqual(['My lined page']);
  });
});

describe('the sideways lists', () => {
  it('group the weeks of 2026 into the months journal-system lists', () => {
    expect(monthStarts(2026)).toEqual([1, 6, 10, 14, 19, 23, 27, 32, 36, 40, 45, 49]);
  });
  it('keep week 1 in January and the months in order for any year', () => {
    for (let year = 2000; year <= 2100; year++) {
      const months = Array.from({ length: 52 }, (_, w) => monthOfWeek(year, w + 1));
      expect(months[0]).toBe(1);
      expect(months).toEqual([...months].sort((a, b) => a - b));
      expect(new Set(months).size).toBe(12);
    }
  });
});

describe('the book templates', () => {
  const inputs: Record<string, Record<string, number>[]> = {
    'year-planner': [{ year: 2026, first: 43, last: 52 }, { year: 2027 }, { year: 2026, first: 1, last: 1 }, { year: 2028, first: 10, last: 40 }],
    'monthly-journal': Array.from({ length: 12 }, (_, m) => ({ year: 2027, month: m + 1 })),
    'blank-journal': [{}], 'lined-journal': [{}], 'dot-grid-journal': [{}], 'idea-book': [{}],
  };
  it('are all tested', () => expect(TEMPLATES.map((t) => t.id).sort()).toEqual(Object.keys(inputs).sort()));

  for (const t of TEMPLATES) {
    for (const a of inputs[t.id]) {
      it(`${t.name} ${JSON.stringify(a)} builds a valid 52-page book`, async () => {
        const book = t.build(a);
        expect(book.page_count).toBe(52);
        expect(book.pages).toHaveLength(52);
        const r = readBook(JSON.parse(JSON.stringify(book)));
        expect(r.ok ? [] : problems(r.issues)).toEqual([]);
        expect(getSlot(book, 0)).not.toBeNull();
        expect(getSlot(book, 53)).not.toBeNull();
        const files = await exportBookFiles(book, fonts);
        expect(files.map((f) => f.name).sort()).toEqual(['cover.pdf', 'pages.pdf', 'print-first.pdf', 'print-second.pdf', 'summary.txt']);
        const count = async (name: string) => (await PDFDocument.load(files.find((f) => f.name === name)!.bytes)).getPageCount();
        expect(await count('pages.pdf')).toBe(52);
        expect(await count('print-first.pdf')).toBe(13);
        expect(await count('print-second.pdf')).toBe(13);
        expect(await count('cover.pdf')).toBe(1);
      });
    }
  }

  it('draws the dot grid book fast and small (each dot pattern is written once per PDF)', async () => {
    const book = TEMPLATES.find((t) => t.id === 'dot-grid-journal')!.build({});
    const start = performance.now();
    const files = await exportBookFiles(book, fonts);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(files.filter((f) => f.name.endsWith('.pdf')).reduce((n, f) => n + f.bytes.length, 0)).toBeLessThan(500_000);
  });

  it('fills the year planner with dated weeks and the rest with ideas', () => {
    const book = TEMPLATES.find((t) => t.id === 'year-planner')!.build({ year: 2026, first: 43, last: 52 });
    expect(book.dates!.slice(0, 10)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20']);
    expect(book.dates!.slice(10).every((d) => d === null)).toBe(true);
    expect(bookPage(book, 1).name).toBe('Year journal weekly page (dated)');
    expect(getSlot(book, 53)!.name).toBe('Year index');
    expect(getSlot(book, 0)!.name).toBe('Year goals cover');
    // the day column is on the outer edge: right on right pages, left on left pages
    const col = (slot: number) => bookPage(book, slot).elements.find((e) => e.type === 'rule' && e.y1 === 1 && e.y2 === 44);
    expect(col(1)).toMatchObject({ x1: 25 });
    expect(col(2)).toMatchObject({ x1: 2 });
  });

  it('lays the monthly journal out like the October 2026 reference', () => {
    const layout = monthlyLayout(2026, 10);
    const kinds = layout.map((s) => s.kind);
    expect(kinds.slice(0, 5)).toEqual(['daily', 'daily', 'daily', 'reflection', 'daily']);
    expect(kinds.indexOf('patterns')).toBe(36); // page 37
    expect(kinds[37]).toBe('questions');
    expect(kinds[38]).toBe('notes');
    expect(kinds.slice(39, 49)).toEqual(['idea', 'dots', 'idea', 'dots', 'idea', 'dots', 'idea', 'dots', 'idea', 'dots']);
    expect(kinds.slice(49)).toEqual(['notes', 'notes', 'notes']);
    expect(layout[3].identity).toBe('WEEK 40  OCT 1-3');
    expect(layout[35].identity).toBe('WEEK 44  OCT 25-31');
  });

  it('puts the month’s own tracker and day list on the covers', () => {
    const book = TEMPLATES.find((t) => t.id === 'monthly-journal')!.build({ year: 2027, month: 2 });
    const tracker = getSlot(book, 0)!;
    const days = tracker.elements.find((e) => e.type === 'sequence' && e.values === 'numbers');
    expect(days).toMatchObject({ count: 28 });
    expect(tracker.identity).toBe('FEBRUARY 2027');
    expect(book.dates!.filter(Boolean)).toHaveLength(28);
  });
});
