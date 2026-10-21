import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateOf, emptyBook, movePage, readBook, setDates, setSlot, swapPages, type Book } from '../src/book/book';
import { datesLabel, datesStart } from '../src/book/plan';
import { applyWeeks, planWeeks, recipeFrom, sectionMonth, weeksSummary, type WeeksInput } from '../src/book/weeks';
import { todayIso } from '../src/format/dates';
import { notesPage } from '../src/builtin/pages';
import { findBuiltinPage } from '../src/builtin/library';
import { pageSpan, usesDates } from '../src/format/tokens';

const load = (): Book => {
  const r = readBook(JSON.parse(readFileSync('tests/fixtures/november-2026-journal.json', 'utf8')));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.book;
};
/** The fixture's own parts: pages 1-10 repeat, 46-47 follow the weeks, 48-49 fill, 52 ends. */
const RANGES: Omit<WeeksInput, 'year' | 'month'> = { section: [1, 10], after: [46, 47], fill: [48, 49], end: [52, 52] };

function build(book: Book, year: number, month: number, more: Partial<WeeksInput> = {}) {
  const recipe = recipeFrom(book, { ...RANGES, year, month, ...more });
  if ('problem' in recipe) throw new Error(recipe.problem);
  return planWeeks(recipe, book.page_count);
}
const names = (plan: ReturnType<typeof build>) => plan.entries.map((e) => e.page?.name ?? '-');

afterEach(() => { vi.useRealTimers(); delete process.env.TZ; });

describe('today is the local date', () => {
  it('does not turn a UTC evening into tomorrow', () => {
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T01:30:00Z')); // 9:30 pm on Oct 21 in New York
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(todayIso()).toBe('2026-10-21');
    expect(datesStart(emptyBook(8), 1).start).toBe('2026-10-21');
  });

  it('is the next morning east of UTC too', () => {
    process.env.TZ = 'Pacific/Auckland';
    expect(todayIso(new Date('2026-10-21T20:00:00Z'))).toBe('2026-10-22'); // 9 am on Oct 22 in Auckland
  });
});

describe('where the Dates window starts', () => {
  const book = () => {
    const b = emptyBook(8);
    for (let n = 1; n <= 8; n++) setSlot(b, n, findBuiltinPage('Daily Good Time Journal')!);
    return b;
  };

  it('is today only when the book has no dates', () => {
    expect(datesStart(book(), 3, '2026-10-21')).toEqual({ start: '2026-10-21', weekly: false });
  });

  it('continues the day-by-day rhythm of the pages before', () => {
    const b = book();
    setDates(b, 1, ['2026-10-18', '2026-10-19']);
    expect(datesStart(b, 3)).toEqual({ start: '2026-10-20', weekly: false });
    expect(datesStart(b, 6)).toEqual({ start: '2026-10-20', weekly: false }); // the nearest dated page before, not the end
  });

  it('continues a week-by-week rhythm', () => {
    const b = book();
    setDates(b, 1, ['2026-10-18', '2026-10-25']);
    expect(datesStart(b, 3)).toEqual({ start: '2026-11-01', weekly: true });
  });

  it('takes a single dated week page as weekly, and a single daily page as daily', () => {
    const weekly = emptyBook(8);
    setSlot(weekly, 1, findBuiltinPage('Weekly reflection')!);
    setDates(weekly, 1, ['2026-10-18']);
    expect(datesStart(weekly, 2)).toEqual({ start: '2026-10-25', weekly: true });
    const daily = book();
    setDates(daily, 1, ['2026-10-18']);
    expect(datesStart(daily, 2)).toEqual({ start: '2026-10-19', weekly: false });
  });

  it('keeps a page’s own date, and steps back from dates after it when none are before', () => {
    const b = book();
    setDates(b, 4, ['2026-10-24', '2026-10-25']);
    expect(datesStart(b, 4).start).toBe('2026-10-24');
    expect(datesStart(b, 2).start).toBe('2026-10-23');
  });
});

describe('dates travel with their page', () => {
  const dated = () => {
    const b = emptyBook(8);
    const daily = findBuiltinPage('Daily Good Time Journal')!;
    [1, 2, 3, 4].forEach((n) => setSlot(b, n, { ...daily, name: `Day ${n}` }));
    setDates(b, 1, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    return b;
  };

  it('moves with a swapped page', () => {
    const b = dated();
    swapPages(b, 1, 4);
    expect([1, 2, 3, 4].map((n) => [b.pages[n - 1]!.name, dateOf(b, n)])).toEqual([
      ['Day 4', '2026-11-04'], ['Day 2', '2026-11-02'], ['Day 3', '2026-11-03'], ['Day 1', '2026-11-01'],
    ]);
  });

  it('moves with a moved page, the pages between shifting', () => {
    const b = dated();
    movePage(b, 1, 3);
    expect([1, 2, 3, 4].map((n) => [b.pages[n - 1]!.name, dateOf(b, n)])).toEqual([
      ['Day 2', '2026-11-02'], ['Day 3', '2026-11-03'], ['Day 1', '2026-11-01'], ['Day 4', '2026-11-04'],
    ]);
    movePage(b, 4, 1);
    expect([1, 2, 3, 4].map((n) => b.pages[n - 1]!.name)).toEqual(['Day 4', 'Day 2', 'Day 3', 'Day 1']);
    expect(dateOf(b, 1)).toBe('2026-11-04');
  });

  it('leaves an undated page undated when it moves', () => {
    const b = dated();
    setSlot(b, 5, notesPage());
    swapPages(b, 1, 5);
    expect(dateOf(b, 1)).toBeNull();
    expect(dateOf(b, 5)).toBe('2026-11-01');
  });

  it('clears the date when a design with no date tokens goes on the page', () => {
    const b = dated();
    setSlot(b, 2, notesPage());
    expect(dateOf(b, 2)).toBeNull();
    setSlot(b, 3, null);
    expect(dateOf(b, 3)).toBeNull();
    setSlot(b, 4, findBuiltinPage('Weekly reflection')!);
    expect(dateOf(b, 4)).toBe('2026-11-04'); // it prints dates, so it keeps one
    expect(dateOf(b, 1)).toBe('2026-11-01');
    setSlot(b, 1, notesPage());
    setSlot(b, 4, notesPage());
    expect(b.dates).toBeUndefined(); // no dates left
  });

  it('shows each page’s date in the contents', () => {
    const b = dated();
    expect(datesLabel(b, 2, 2)).toBe('Nov 2');
    expect(datesLabel(b, 1, 4)).toBe('Nov 1 – Nov 4');
    expect(datesLabel(b, 6, 6)).toBe('');
  });
});

describe('what a page stands for', () => {
  it('tells day pages from week pages', () => {
    expect(pageSpan(findBuiltinPage('Daily Good Time Journal')!)).toBe('day');
    expect(pageSpan(findBuiltinPage('Weekly reflection')!)).toBe('week');
    expect(pageSpan(findBuiltinPage('Year journal weekly page (dated)')!)).toBe('week');
    expect(pageSpan(notesPage())).toBeNull();
    expect(usesDates(notesPage())).toBe(false);
  });
});

describe('Build by week', () => {
  it('rebuilds November to the same pages and dates as the fixture', () => {
    const book = load();
    expect(sectionMonth(book, 1, 10)).toEqual({ year: 2026, month: 11 });
    const plan = build(book, 2026, 11);
    expect(plan.weeks).toBe(5);
    expect(plan.leftOut).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(plan.gaps).toEqual([]);
    expect(plan.over).toBe(0);
    expect(plan.under).toBe(0);
    const again = load();
    applyWeeks(again, plan);
    expect(again.pages).toEqual(book.pages);
    expect(again.dates).toEqual(book.dates);
    expect(again.recipe?.month).toBe('2026-11');
    expect(weeksSummary(plan, 52).at(-1)).toBe('Fills the book’s 52 pages exactly.');
  });

  it('builds December (Dec 1 is a Tuesday) without Nov 29-30 and Jan 1-2, keeping the week pages', () => {
    const book = load();
    const plan = build(book, 2026, 12);
    expect(plan.weeks).toBe(5);
    expect(plan.leftOut).toEqual(['2026-11-29', '2026-11-30', '2027-01-01', '2027-01-02']);
    const weekly = plan.entries.filter((e) => e.page?.name.startsWith('Year journal weekly'));
    expect(weekly.map((e) => e.date)).toEqual(['2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']);
    const dailies = plan.entries.filter((e) => e.page?.name === 'Daily Good Time Journal').map((e) => e.date!);
    expect(dailies).toHaveLength(31);
    expect(dailies[0]).toBe('2026-12-01');
    expect(dailies.at(-1)).toBe('2026-12-31');
    // 8 + 10 + 10 + 10 + 8 pages for the weeks, a gap so the review pages begin on the left, 2 after, 2 of filler, the end.
    expect(plan.counts).toMatchObject({ weeks: 46, after: 2, fill: 2, fillRepeats: 1, end: 1 });
    expect(plan.gaps).toEqual([47]);
    expect(names(plan).slice(46, 52)).toEqual(['Notes', 'Weekly reflection', 'Patterns & takeaways', 'Idea page', 'Dot grid page', 'Book notes']);
    expect(plan.entries).toHaveLength(52);
    expect(plan.under).toBe(0);
    expect(plan.entries[47].date).toBe('2026-12-01'); // after the weeks: the month, so {monthname} reads DECEMBER
    expect(weeksSummary(plan, 52).join(' ')).toMatch(/Left out.*4 daily pages \(Nov 29–30, Jan 1–2\).*Inserted a Notes page on page 47/);
  });

  it('builds February 2027, which starts on a Monday, and keeps the weeks on the right sides', () => {
    const book = load();
    const plan = build(book, 2027, 2);
    expect(plan.weeks).toBe(5); // Jan 31, Feb 7, 14, 21, 28
    expect(plan.leftOut).toEqual(['2027-01-31', '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06']);
    // The first week has 9 pages, so a Notes page keeps the second week's weekly page on a right (odd) page.
    expect(plan.gaps).toEqual([10, 45]);
    plan.entries.forEach((e, i) => { if (e.page?.name.startsWith('Year journal weekly')) expect((i + 1) % 2, `page ${i + 1}`).toBe(1); });
    expect(plan.entries[9].page?.name).toBe('Notes');
    expect(plan.entries).toHaveLength(52);
    expect(plan.under).toBe(0);
    expect(plan.over).toBe(0);
  });

  it('puts the end on the last pages, and a gap last when it would begin on the wrong side', () => {
    const book = load();
    const plan = build(book, 2026, 11, { end: [50, 51] }); // began on a left page; at the end of 52 pages it would begin on a right one
    expect(plan.entries.at(-1)!.page?.name).toBe('Notes');
    expect(plan.gaps).toContain(52);
  });

  it('cuts the last filler repeat short only when asked', () => {
    const book = load();
    const whole = build(book, 2026, 11, { fill: [48, 51], end: [52, 52] });
    const cut = build(book, 2026, 11, { fill: [48, 50], fillCut: true, end: [52, 52] });
    const keep = build(book, 2026, 11, { fill: [48, 50], end: [52, 52] });
    expect(whole.counts.fill).toBe(4);
    expect(cut.counts).toMatchObject({ fill: 4, fillRepeats: 2 });
    expect(keep.counts).toMatchObject({ fill: 3, fillRepeats: 1 });
    expect(keep.under).toBe(1);
    expect(weeksSummary(keep, 52).at(-1)).toBe('1 page under the book’s 52: left blank.');
    expect(keep.entries[50].page).toBeNull();
  });

  it('says how far over the book it runs, and can’t be applied', () => {
    const book = load();
    const recipe = recipeFrom(book, { ...RANGES, year: 2026, month: 12 });
    if ('problem' in recipe) throw new Error(recipe.problem);
    const plan = planWeeks(recipe, 40);
    expect(plan.over).toBeGreaterThan(0);
    expect(weeksSummary(plan, 40).at(-1)).toMatch(/over the book’s 40/);
  });

  it('refuses ranges outside the book and sections with no dates', () => {
    const book = load();
    expect(recipeFrom(book, { ...RANGES, year: 2026, month: 11, end: [52, 60] })).toHaveProperty('problem');
    expect(recipeFrom(book, { ...RANGES, year: 2026, month: 11, section: [10, 10] })).toHaveProperty('problem'); // the notes page: no date
  });

  it('keeps a recipe in the book that rebuilds for another month, and reads it back', () => {
    const book = load();
    const nov = build(book, 2026, 11);
    applyWeeks(book, nov);
    const again = readBook(JSON.parse(JSON.stringify(book)));
    expect(again.ok).toBe(true);
    const recipe = again.ok ? again.book.recipe! : null!;
    // Only the month changes: the same as building December from the page ranges.
    const rebuilt = planWeeks({ ...recipe, month: '2026-12' }, 52);
    const fromRanges = build(load(), 2026, 12);
    expect(rebuilt.entries).toEqual(fromRanges.entries);
    expect(rebuilt.gaps).toEqual(fromRanges.gaps);
    expect(readBook({ ...JSON.parse(JSON.stringify(book)), recipe: { ...recipe, weekday: 9 } }).ok).toBe(false);
  });

  it('applies as one change: pages, dates and recipe together', () => {
    const book = load();
    const before = JSON.stringify(book);
    applyWeeks(book, build(book, 2026, 12));
    expect(JSON.stringify(book)).not.toBe(before);
    expect(book.dates).toHaveLength(52);
    expect(book.dates!.filter(Boolean)).toHaveLength(44); // 5 weekly pages, 31 days, 5 reflections, the 2 pages after the weeks and the dot grid page, which prints the month
    expect(readBook(JSON.parse(JSON.stringify(book))).ok).toBe(true);
  });
});
