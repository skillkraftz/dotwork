import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateOf, emptyBook, movePage, setDates, setSlot, swapPages } from '../src/book/book';
import { datesLabel, datesStart } from '../src/book/plan';
import { todayIso } from '../src/format/dates';
import { notesPage } from '../src/builtin/pages';
import { findBuiltinPage } from '../src/builtin/library';
import { pageSpan, usesDates } from '../src/format/tokens';

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
