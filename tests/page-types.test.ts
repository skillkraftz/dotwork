import { describe, expect, it } from 'vitest';
import { calendarFor } from '../src/format/calendar';
import { emptyPage, type Page } from '../src/format/types';
import { bookLayout, emptyBook, readBook } from '../src/book/book';
import { datesCovered, freeBlock, groupBlock, layoutOutline, pageBlock, setDates, spreadBlock, type Block, type Cell, type DateKind, type Repeat } from '../src/book/outline';

const named = (name: string, side: 'left' | 'right' = 'right'): Page => ({ ...emptyPage(), name, side });
const LINED = named('Lined'), WEEK_L = named('Week', 'left'), WEEK_R = named('Week', 'right'), DAILY = named('Daily'), REVIEW = named('Review'), MONTH = named('Month review');

const typed = (b: Block, dates: DateKind, repeat?: Repeat): Block => ({ ...b, dates, ...(repeat ? { repeat } : {}) }) as Block;
const toWeek: Repeat = { to: 'week' };
const weekSpread = () => typed(spreadBlock('Week spread', WEEK_L, WEEK_R), 'week');
const daily = () => typed(pageBlock(DAILY), 'day', toWeek);
const review = () => typed(pageBlock(REVIEW), 'week-review');

/** The outline from the owner's example: two groups of [week, week, daily, review, daily, review], then a week, a daily run and a review, free pages and the month review. */
const outline = (): Block[] => [
  pageBlock(LINED),
  groupBlock('Fortnight', [weekSpread() as never, weekSpread() as never, daily() as never, review() as never, daily() as never, review() as never], 2),
  weekSpread(), daily(), review(), freeBlock(),
  { ...typed(pageBlock(MONTH), 'month-review'), pin: 'last' } as Block,
];

/** A page's reading as "week 2026-11-01..2026-11-07" or "day 2026-11-01". */
const at = (cells: (Cell | null)[], p: number) => {
  const r = cells[p - 1]?.read;
  return r ? (r.first === r.last ? `${r.kind} ${r.first.slice(5)}` : `${r.kind} ${r.first.slice(5)}..${r.last.slice(5)}`) : null;
};
const run = (cal: ReturnType<typeof calendarFor>) => layoutOutline(outline(), 52, cal);
const days = (cells: (Cell | null)[], from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => at(cells, from + i));

describe('dates come from page types and order', () => {
  it('walks November 2026: weeks, day runs to the end of each week, and reviews of the week before them', () => {
    const l = run(calendarFor(2026, 11));
    const c = l.cells;
    expect(l.issues).toEqual([]);
    expect(l.used).toBe(52);
    expect(at(c, 1)).toBeNull();
    for (const [p, w] of [[2, '01..11-07'], [4, '08..11-14'], [22, '15..11-21'], [24, '22..11-28'], [42, '29..11-30']] as const) expect([at(c, p), at(c, p + 1)]).toEqual([`week 11-${w}`, `week 11-${w}`]);
    expect(days(c, 6, 12)).toEqual(['01', '02', '03', '04', '05', '06', '07'].map((d) => `day 11-${d}`));
    expect(at(c, 13)).toBe('week 11-01..11-07');
    expect(days(c, 14, 20)).toEqual(['08', '09', '10', '11', '12', '13', '14'].map((d) => `day 11-${d}`));
    expect(at(c, 21)).toBe('week 11-08..11-14');
    expect([at(c, 26), at(c, 32), at(c, 33)]).toEqual(['day 11-15', 'day 11-21', 'week 11-15..11-21']);
    expect([at(c, 34), at(c, 40), at(c, 41)]).toEqual(['day 11-22', 'day 11-28', 'week 11-22..11-28']);
    expect([at(c, 44), at(c, 45), at(c, 46)]).toEqual(['day 11-29', 'day 11-30', 'week 11-29..11-30']);
    expect(c.slice(46, 51).map((x) => x?.kind)).toEqual(['free', 'free', 'free', 'free', 'free']);
    expect(at(c, 52)).toBe('month 11-01..11-30');
  });

  it('walks December 2026, which starts on a Tuesday', () => {
    const l = run(calendarFor(2026, 12));
    const c = l.cells;
    expect(l.issues).toEqual([]);
    expect([at(c, 2), at(c, 4), at(c, 20), at(c, 22), at(c, 40)]).toEqual(['week 12-01..12-05', 'week 12-06..12-12', 'week 12-13..12-19', 'week 12-20..12-26', 'week 12-27..12-31']);
    expect([at(c, 6), at(c, 10), at(c, 11)]).toEqual(['day 12-01', 'day 12-05', 'week 12-01..12-05']);
    expect([at(c, 12), at(c, 18), at(c, 19)]).toEqual(['day 12-06', 'day 12-12', 'week 12-06..12-12']);
    expect([at(c, 24), at(c, 30), at(c, 31)]).toEqual(['day 12-13', 'day 12-19', 'week 12-13..12-19']);
    expect([at(c, 32), at(c, 38), at(c, 39)]).toEqual(['day 12-20', 'day 12-26', 'week 12-20..12-26']);
    expect([at(c, 42), at(c, 46), at(c, 47)]).toEqual(['day 12-27', 'day 12-31', 'week 12-27..12-31']);
    expect(c.slice(47, 51).map((x) => x?.kind)).toEqual(['free', 'free', 'free', 'free']);
    expect(at(c, 52)).toBe('month 12-01..12-31');
  });

  it('gives a spread one date, or with "Each page its own date" two: the left page k, the right page k+1', () => {
    const cal = calendarFor(2026, 11);
    const one = layoutOutline([pageBlock(null), weekSpread()], 8, cal).cells;
    expect([at(one, 2), at(one, 3)]).toEqual(['week 11-01..11-07', 'week 11-01..11-07']);
    const own = layoutOutline([pageBlock(null), { ...weekSpread(), shared: false } as Block], 8, cal).cells;
    expect([at(own, 2), at(own, 3)]).toEqual(['week 11-01..11-07', 'week 11-08..11-14']);
    const twice = layoutOutline([pageBlock(null), { ...weekSpread(), shared: false, repeat: { times: 2 } } as Block], 8, cal).cells;
    expect([at(twice, 4), at(twice, 5)]).toEqual(['week 11-15..11-21', 'week 11-22..11-28']);
  });

  it('prints a copy past the calendar’s last day blank, and says so once', () => {
    const l = layoutOutline([typed(pageBlock(DAILY, 3), 'day'), pageBlock(LINED)], 8, { start: '2026-11-29', end: '2026-11-30', week_starts: 0 });
    expect([at(l.cells, 1), at(l.cells, 2), at(l.cells, 3)]).toEqual(['day 11-29', 'day 11-30', null]);
    expect(l.issues).toEqual(["Page 3 is past the calendar's last day (Nov 30)."]);
  });

  it('runs a Day page to the end of the month, and a Week page to the end of the month of its first day', () => {
    const cal = calendarFor(2026, 11, 2);
    const l = layoutOutline([typed(pageBlock(DAILY), 'day', { to: 'month' }), typed(pageBlock(DAILY), 'day', { to: 'month' }), typed(pageBlock(REVIEW), 'week-review')], 80, cal);
    expect(l.rows.map((r) => r.repeats)).toEqual([30, 31, 1]); // November, then December
    expect(at(l.cells, 31)).toBe('day 12-01');
    expect(at(l.cells, 62)).toBe('week 12-27..12-31');
    const weeks = layoutOutline([typed(pageBlock(REVIEW), 'week', { to: 'month' }), typed(pageBlock(REVIEW), 'week', { to: 'month' })], 20, cal);
    expect(weeks.rows.map((r) => r.repeats)).toEqual([5, 4]); // weeks starting in November (the last runs into December), then in December
    expect(at(weeks.cells, 6)).toBe('week 12-06..12-12');
  });

  it('reads the week of the last day page, else the last week page, else the first week', () => {
    const cal = calendarFor(2026, 11);
    const first = (o: Block[]) => { const cells = layoutOutline(o, 40, cal).cells; return at(cells, cells.findIndex((c) => c?.page === REVIEW) + 1); };
    expect(first([typed(pageBlock(REVIEW), 'week-review')])).toBe('week 11-01..11-07');
    expect(first([typed(pageBlock(LINED, 2), 'week'), typed(pageBlock(REVIEW), 'week-review')])).toBe('week 11-08..11-14');
    expect(first([typed(pageBlock(LINED, 2), 'week'), typed(pageBlock(DAILY, 9), 'day'), typed(pageBlock(REVIEW), 'week-review')])).toBe('week 11-08..11-14');
    expect(at(layoutOutline([typed(pageBlock(DAILY, 3), 'day'), typed(pageBlock(REVIEW), 'month-review')], 8, cal).cells, 4)).toBe('month 11-01..11-30');
  });

  it('counts the dates after a fill by what the fill actually gets', () => {
    const cal = calendarFor(2026, 11);
    const fill = { ...typed(pageBlock(DAILY), 'day'), repeat: { fill: true } } as Block;
    const l = layoutOutline([fill, typed(pageBlock(LINED), 'day')], 12, cal);
    expect(l.rows[0].repeats).toBe(11);
    expect(at(l.cells, 11)).toBe('day 11-11');
    expect(at(l.cells, 12)).toBe('day 11-12');
    // the dates after a pinned block come from its place in the outline, not its page
    const pinned = layoutOutline([typed(pageBlock(DAILY), 'day'), { ...typed(pageBlock(DAILY), 'day'), pin: 5 } as Block, typed(pageBlock(DAILY), 'day')], 8, cal).cells;
    expect([at(pinned, 1), at(pinned, 5), at(pinned, 2)]).toEqual(['day 11-01', 'day 11-02', 'day 11-03']);
    // a pinned block after the fill reads the day after the last one the fill got
    const long = layoutOutline([fill, { ...typed(pageBlock(LINED), 'day'), pin: 'last' } as Block], 10, cal);
    expect([long.rows[0].repeats, at(long.cells, 10)]).toEqual([9, 'day 11-10']);
  });

  it('says what dates a row covers', () => {
    const cal = calendarFor(2026, 11);
    const cells = run(cal).cells;
    const mine = (name: string) => cells.filter((c) => c?.page?.name === name);
    expect(datesCovered(mine('Daily'), cal)).toBe('Nov 1–30');
    expect(datesCovered(mine('Week'), cal)).toBe('weeks 1–5');
    expect(datesCovered(mine('Month review'), cal)).toBe('Nov');
    expect(datesCovered(cells.slice(0, 1), cal)).toBeNull();
    expect(datesCovered(layoutOutline([typed(pageBlock(DAILY, 3), 'day')], 4, cal).cells.slice(0, 1), cal)).toBe('Nov 1');
    // a row that skips dates (the first daily run of each fortnight) lists its runs
    expect(datesCovered(cells.filter((c) => c?.page?.name === 'Daily').slice(0, 7), cal)).toBe('Nov 1–7');
    const first = cells.filter((c) => c?.page?.name === 'Daily');
    expect(datesCovered([...first.slice(0, 7), ...first.slice(14, 21)], cal)).toBe('Nov 1–7, 15–21');
    expect(datesCovered([...first.slice(0, 7), ...first.slice(21, 28)], cal)).toBe('Nov 1–7, 22–28');
    const reviews = cells.filter((c) => c?.page?.name === 'Review');
    expect(datesCovered(reviews.slice(0, 3), cal)).toBe('weeks 1–3');
    expect(datesCovered([reviews[0], reviews[2]], cal)).toBe('weeks 1, 3');
  });

  it('drops a run that no longer suits the page type', () => {
    const o = setDates([typed(pageBlock(DAILY), 'day', toWeek)], [0], 'month');
    expect(o[0]).toMatchObject({ dates: 'month', repeat: { times: 1 } });
    expect(setDates(o, [0], null)[0]).not.toHaveProperty('dates');
  });
});

describe('the book file', () => {
  const book = (outline: unknown[]) => ({ ...emptyBook(), outline, calendar: calendarFor(2026, 11) });

  it('reads page types and runs to the end of the week or month, and refuses ones that do not fit', () => {
    const ok = readBook(book([{ type: 'page', page: null, dates: 'day', repeat: { to: 'month' } }]));
    expect(ok.ok).toBe(true);
    expect(readBook(book([{ type: 'page', page: null, dates: 'month', repeat: { to: 'week' } }])).ok).toBe(false);
    expect(readBook(book([{ type: 'page', page: null, repeat: { to: 'week' } }])).ok).toBe(false);
    expect(readBook(book([{ type: 'page', page: null, dates: 'sometimes', repeat: { times: 1 } }])).ok).toBe(false);
    expect(readBook(book([{ type: 'group', name: 'G', dates: 'day', children: [], repeat: { times: 1 } }])).ok).toBe(false);
  });

  it('opens a book made with the old date settings: each repeat is Once and Plain, and it says to set the page types again', () => {
    const old = readBook(book([
      { type: 'page', page: null, repeat: { each: 'day' } },
      { type: 'group', name: 'Weeks', repeat: { each: 'week' }, children: [{ type: 'page', page: null, repeat: { each: 'day', of: 'span' } }] },
    ]));
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.book.outline[0]).toMatchObject({ repeat: { times: 1 } });
    expect(old.book.outline[0]).not.toHaveProperty('dates');
    expect(bookLayout(old.book).issues).toEqual(['This book was made with the old date settings; set its page types again.']);
    expect(bookLayout(old.book).used).toBe(2);
  });
});
