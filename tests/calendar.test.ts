import { describe, expect, it } from 'vitest';
import { calendarFor, calendarProblem, readingOf, spansOf } from '../src/format/calendar';
import { expandTokens, readsText, suggestUnit, type Reading } from '../src/format/tokens';
import { emptyPage, type Page } from '../src/format/types';
import { BUILTIN_PAGES } from '../src/builtin/library';
import { weeklyReflection } from '../src/builtin/pages';
import { bookExpand, bookLayout, coverReading, emptyBook, readBook, type Book } from '../src/book/book';
import { freeBlock, groupBlock, layoutOutline, pageBlock, setFreePage, setShared, spreadBlock, type Block, type Cell, type DateKind, type Repeat } from '../src/book/outline';

const text = (name: string, identity: string, ...texts: string[]): Page => ({
  ...emptyPage(), name, identity, elements: texts.map((t, i) => ({ type: 'text' as const, x: 0, y: 1 + i, text: t })),
});
const daily = text('Daily', '{weekday} {month} {day}');
const tracker = text('Tracker', '', '{day}', '{day+6}');
const reflection = text('Reflection', 'WEEK {week}  {month@start} {day@start}-{month@end} {day@end}');
const review = text('Month review', '{monthname} REVIEW');

const NOV = calendarFor(2026, 11), JAN = calendarFor(2027, 1), FEB = calendarFor(2027, 2);
const span = (cal: ReturnType<typeof calendarFor>, kind: 'day' | 'week' | 'month') => spansOf(cal, kind).map((s) => `${s.first.slice(5)}..${s.last.slice(5)}`);

/** What a cell prints for its identity. */
const prints = (c: Cell | null) => (c?.page && c.read ? expandTokens(c.page.identity ?? '', c.read) : '');
const typed = (b: Block, dates: DateKind, repeat?: Repeat): Block => ({ ...b, dates, ...(repeat ? { repeat } : {}) }) as Block;
/** A group that repeats once for each week of the calendar: the week tracker, a daily page for each day of the week, the week's reflection. */
const weeksGroup = (n = 5): Block => groupBlock('Weeks', [typed(pageBlock(tracker), 'week'), typed(pageBlock(daily), 'day', { to: 'week' }), typed(pageBlock(reflection), 'week-review')] as never[], n);

describe('the calendar', () => {
  it('has the days of November 2026, five weeks, the last Nov 29-30', () => {
    expect(calendarFor(2026, 11)).toEqual({ start: '2026-11-01', end: '2026-11-30', week_starts: 0 });
    expect(spansOf(NOV, 'day')).toHaveLength(30);
    expect(span(NOV, 'week')).toEqual(['11-01..11-07', '11-08..11-14', '11-15..11-21', '11-22..11-28', '11-29..11-30']);
    expect(span(NOV, 'month')).toEqual(['11-01..11-30']);
  });

  it('has six weeks in January 2027: Fri 1 to Sat 2, full weeks, then Sun 31', () => {
    expect(span(JAN, 'week')).toEqual(['01-01..01-02', '01-03..01-09', '01-10..01-16', '01-17..01-23', '01-24..01-30', '01-31..01-31']);
  });

  it('has February 2027: Mon 1 to Sat 6, full weeks, then Sun 28', () => {
    expect(span(FEB, 'week')).toEqual(['02-01..02-06', '02-07..02-13', '02-14..02-20', '02-21..02-27', '02-28..02-28']);
    expect(spansOf(FEB, 'day')).toHaveLength(28);
  });

  it('starts weeks on the day it is set to, and covers several months', () => {
    const monday = { ...NOV, week_starts: 1 };
    expect(span(monday, 'week')[0]).toBe('11-01..11-01'); // Sunday Nov 1 is the last day of the week before
    expect(span(monday, 'week')).toHaveLength(6);
    const two = calendarFor(2026, 11, 2);
    expect(two.end).toBe('2026-12-31');
    expect(span(two, 'month')).toEqual(['11-01..11-30', '12-01..12-31']);
  });

  it('rejects a calendar that is not real', () => {
    expect(calendarProblem(NOV)).toBeNull();
    expect(calendarProblem({ start: '2026-11-31', end: '2026-12-01', week_starts: 0 })).toMatch(/real dates/);
    expect(calendarProblem({ ...NOV, end: '2026-10-01' })).toMatch(/before/);
    expect(calendarProblem({ ...NOV, week_starts: 7 })).toMatch(/week_starts/);
    expect(calendarProblem({ start: '2026-01-01', end: '2030-01-01', week_starts: 0 })).toMatch(/at most/);
  });
});

describe('what a page reads', () => {
  const week = (cal: ReturnType<typeof calendarFor>, i: number): Reading => readingOf(cal, spansOf(cal, 'week')[i]);
  const read = (r: Reading, t: string) => expandTokens(t, r);

  it('numbers weeks by the book’s year: Dec 27 to Jan 2 is week 53 in a December 2026 book and week 1 in a January 2027 book', () => {
    const dec = calendarFor(2026, 12), jan = JAN;
    expect(read(week(dec, 4), 'WEEK {week}')).toBe('WEEK 53');
    expect(read(week(jan, 0), 'WEEK {week}')).toBe('WEEK 1');
    expect(read(week(NOV, 0), '{week}')).toBe('45');
    expect(read(week(NOV, 4), '{week}')).toBe('49');
    expect(read(week(JAN, 5), '{week}')).toBe('6');
  });

  it('reads a week page from the week’s start, so day columns never shift, and @start and @end from the days inside the calendar', () => {
    expect(read(week(NOV, 4), '{month@start} {day@start} – {month@end} {day@end}')).toBe('NOV 29 – NOV 30');
    expect(read(week(NOV, 1), '{month@start} {day@start} – {month@end} {day@end}')).toBe('NOV 8 – NOV 14');
    expect(read(week(JAN, 0), '{weekday@start} {day@start}…{weekday@end} {day@end}')).toBe('FRI 1…SAT 2');
    expect(read(week(NOV, 0), '{weekday} {day} {weekday+1} {day+1} {day+6}')).toBe('SUN 1 MON 2 7');
    expect(read(week(JAN, 0), '{weekday}{day} {weekday+4}{day+4} {weekday+5}{day+5}')).toBe('SUN THU FRI1'); // Dec 27 to Jan 2: the days before the 1st are blank
    expect(read(week(JAN, 0), '{month} {year}')).toBe(' '); // the week's Sunday is in December, outside the calendar
    expect(read(week(NOV, 4), '{week+1}')).toBe('50');
    expect(read(week(calendarFor(2026, 12), 0), '{months}')).toBe('DEC');
    expect(read(week(calendarFor(2026, 12), 4), '{months}')).toBe('DEC');
    expect(read(week(JAN, 0), '{months}')).toBe('JAN');
  });

  it('prints the week tracker with fixed weekday columns and blank days outside the calendar', () => {
    const tracker = BUILTIN_PAGES.find((p) => p.name === 'week tracker checklist')!;
    const column = (r: Reading) => tracker.elements.flatMap((e) => (e.type === 'text' && /\{(weekday|day)/.test(e.text) ? [expandTokens(e.text, r)] : [])).join('|');
    expect(column(week(NOV, 0))).toBe('SUN|1|MON|2|TUE|3|WED|4|THU|5|FRI|6|SAT|7');
    expect(column(week(NOV, 4))).toBe('SUN|29|MON|30|TUE||WED||THU||FRI||SAT|'); // the last week of November 2026
    expect(column(week(JAN, 0))).toBe('SUN||MON||TUE||WED||THU||FRI|1|SAT|2'); // the first week of January 2027
    expect(column(week(JAN, 5))).toBe('SUN|31|MON||TUE||WED||THU||FRI||SAT|');
  });

  it('prints the Weekly reflection’s range from @start to @end', () => {
    const identity = weeklyReflection().identity!;
    expect(read(week(NOV, 4), identity)).toBe('WEEK 49  NOV 29-NOV 30');
    expect(read(week(JAN, 0), identity)).toBe('WEEK 1  JAN 1-JAN 2');
    expect(read(week(calendarFor(2026, 12), 4), identity)).toBe('WEEK 53  DEC 27-DEC 31');
  });

  it('reads a day page its day and a month page its month', () => {
    const d = spansOf(NOV, 'day')[0], m = spansOf(NOV, 'month')[0];
    expect(read({ ...d, weekStarts: 0, year: 2026 }, '{weekday} {month} {day} wk{week}')).toBe('SUN NOV 1 wk45');
    expect(read({ ...m, weekStarts: 0, year: 2026 }, '{monthname} {year} {day@end} {month+1}')).toBe('NOVEMBER 2026 30 DEC');
  });

  it('suggests a repeat from the tokens', () => {
    expect(suggestUnit(daily)).toBe('day');
    expect(suggestUnit(tracker)).toBe('week'); // {day+6}
    expect(suggestUnit(reflection)).toBe('week');
    expect(suggestUnit(review)).toBe('month');
    expect(suggestUnit(text('x', '{weekday} {day} week {week}'))).toBe('day'); // the week number is only extra
    expect(suggestUnit(text('x', 'WEEK {week}'))).toBe('week');
    expect(suggestUnit(text('x', 'NOTES'))).toBeNull();
    expect(suggestUnit(null)).toBeNull();
  });

  it('says what the first repeat prints', () => {
    const r = (kind: 'day' | 'week', cal = NOV): Reading => ({ ...spansOf(cal, kind)[0], weekStarts: 0, year: 2026 });
    expect(readsText(daily, r('day'), true)).toBe('SUN NOV 1');
    expect(readsText(tracker, r('week'), true)).toBe('NOV 1 – NOV 7');
    expect(readsText(reflection, r('week'), true)).toBe('WEEK 45  NOV 1-NOV 7');
    expect(readsText(reflection, week(NOV, 4), true)).toBe('WEEK 49  NOV 29-NOV 30'); // the partial last week, from @start to @end
    expect(readsText(text('Notes', 'NOTES'), r('day'), true)).toBeNull();
    expect(readsText(daily, null, false)).toBe('blank, no calendar');
    expect(readsText(daily, null, true)).toBe('outside the calendar');
  });
});

describe('dates come from page types and order', () => {
  const weeks = weeksGroup;

  it('gives a group each week its week, and a day page for each day of the week inside the calendar', () => {
    const l = layoutOutline([weeks()], 52, NOV);
    expect(l.used).toBe(40); // 5 weeks × (tracker + reflection) + 30 days
    expect(l.cells[0]!.read).toMatchObject({ kind: 'week', first: '2026-11-01', last: '2026-11-07' });
    expect(prints(l.cells[1])).toBe('SUN NOV 1');
    expect(prints(l.cells[7])).toBe('SAT NOV 7');
    expect(prints(l.cells[8])).toBe('WEEK 45  NOV 1-NOV 7');
    expect(l.cells[9]!.read).toMatchObject({ kind: 'week', first: '2026-11-08' });
    expect(l.cells[36]!.read).toMatchObject({ first: '2026-11-29', last: '2026-11-30' }); // the last week's tracker
    expect(prints(l.cells[37])).toBe('SUN NOV 29');
    expect(prints(l.cells[38])).toBe('MON NOV 30');
    expect(prints(l.cells[39])).toBe('WEEK 49  NOV 29-NOV 30');
    expect(l.cells[40]).toBeNull();
  });

  it('makes fewer day pages in a partial first and last week', () => {
    const jan = layoutOutline([weeks(6)], 52, JAN);
    expect(jan.used).toBe(43); // 6 weeks × 2 + 31 days
    expect(prints(jan.cells[1])).toBe('FRI JAN 1');
    expect(prints(jan.cells[2])).toBe('SAT JAN 2');
    expect(prints(jan.cells[3])).toBe('WEEK 1  JAN 1-JAN 2');
    expect(prints(jan.cells[41])).toBe('SUN JAN 31');
    expect(prints(jan.cells[42])).toBe('WEEK 6  JAN 31-JAN 31');
    expect(layoutOutline([weeks(5)], 52, FEB).used).toBe(38);
  });

  it('reads nothing on a Plain block, and nothing at all without a calendar', () => {
    expect(layoutOutline([pageBlock(daily, 2)], 8, NOV).cells[0]!.read).toBeNull();
    expect(layoutOutline([typed(pageBlock(daily, 2), 'day')], 8).cells[0]!.read).toBeNull();
    const l = layoutOutline([weeks()], 52);
    expect(l.used).toBe(15); // each repeat of the group: the tracker, one undated day page (a run to the end of the week is one copy), the reflection
    expect(l.cells.slice(0, 3).map((c) => c!.read)).toEqual([null, null, null]);
  });

  it('runs a Day page to the end of the month, a Week page too, and repeats a Month page by number', () => {
    expect(layoutOutline([typed(pageBlock(daily), 'day', { to: 'month' })], 52, NOV).used).toBe(30);
    expect(layoutOutline([typed(pageBlock(reflection), 'week', { to: 'month' })], 52, JAN).used).toBe(6);
    expect(layoutOutline([typed(pageBlock(review, 2), 'month')], 52, calendarFor(2026, 11, 2)).used).toBe(2);
  });

  it('gives a spread one date for both pages, or each page its own: two a copy, the left page k and the right page k+1', () => {
    const left = { ...daily, side: 'left' as const }, right = { ...daily, side: 'right' as const };
    const s = typed(spreadBlock('Daily spread', left, right), 'day', { to: 'month' });
    const lead = pageBlock(null); // page 1 is a right page, so the spreads start on page 2
    const same = layoutOutline([lead, s], 64, NOV);
    expect(same.used).toBe(61); // 30 spreads, both pages the same day
    expect([1, 2, 3, 4].map((i) => prints(same.cells[i]))).toEqual(['SUN NOV 1', 'SUN NOV 1', 'MON NOV 2', 'MON NOV 2']);
    const own = layoutOutline([lead, setShared([s], [0], false)[0]], 52, NOV);
    expect(own.used).toBe(31); // 15 spreads of 2 days
    expect([1, 2, 3, 30].map((i) => prints(own.cells[i]))).toEqual(['SUN NOV 1', 'MON NOV 2', 'TUE NOV 3', 'MON NOV 30']);
    const odd = layoutOutline([lead, setShared([s], [0], false)[0]], 52, calendarFor(2026, 12)); // 31 days
    expect(odd.used).toBe(33);
    expect(odd.cells[32]!.read).toBeNull(); // the last right page has no day left, and that is no problem
    expect(odd.issues).toEqual([]);
    const wk = layoutOutline([lead, { ...typed(spreadBlock('W', left, right), 'week', { to: 'month' }), shared: false } as Block], 52, NOV);
    expect(wk.used).toBe(7); // a gap page, then 3 spreads of two weeks (the last right page has no week left)
    expect([1, 2, 3, 4, 5, 6].map((i) => wk.cells[i]!.read?.first)).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', undefined]);
  });

  it('prints the dates in the book’s pages, and nothing without a calendar', () => {
    const book: Book = { ...emptyBook(), calendar: NOV, outline: [weeks()] };
    const page = (n: number) => bookExpand(book, n)('{weekday} {month} {day}');
    expect(page(2)).toBe('SUN NOV 1');
    expect(page(38)).toBe('SUN NOV 29');
    expect(bookExpand(book, 52)('{day}')).toBe(''); // nothing placed
    expect(bookExpand({ ...book, calendar: undefined }, 2)('{day}')).toBe('');
    expect(bookLayout(book)).not.toBe(bookLayout({ ...book, calendar: JAN })); // a new calendar is worked out again
  });

  it('reads the calendar’s first month on all four covers, and nothing without a calendar', () => {
    const book: Book = { ...emptyBook(), calendar: NOV, outline: [weeks()] };
    const tokens = '{monthname} {month} {year} {monthname+1} {month+1} {year+1} {day}';
    for (const slot of [-1, 0, 53, 54]) expect(bookExpand(book, slot)(tokens)).toBe('NOVEMBER NOV 2026 DECEMBER DEC 2027 1');
    expect(bookExpand(book, 0)('{months}')).toBe('NOV');
    // a calendar that starts mid-month reads its first day inside the calendar
    const part: Book = { ...book, calendar: { start: '2026-11-18', end: '2026-12-31', week_starts: 0 } };
    expect(bookExpand(part, 0)('{monthname} {day}')).toBe('NOVEMBER 18');
    expect(bookExpand({ ...book, calendar: undefined }, 0)(tokens)).toBe('      ');
    expect(coverReading({ ...book, calendar: undefined })).toBeNull();
  });
});

describe('free pages and the calendar', () => {
  const free = (pages: (Page | null)[]) => freeBlock(pages);
  const notes = text('Book notes', 'BOOK NOTES');
  const outline = (pages: (Page | null)[], weeks = 5): Block[] => [weeksGroup(weeks), free(pages), { ...typed(pageBlock(review), 'month-review'), pin: 'last' } as Block];
  const freeAt = (l: ReturnType<typeof layoutOutline>) => l.cells.flatMap((c, i) => (c && c.kind === 'free' ? [`${i + 1}:${c.free}:${c.page?.name ?? '-'}`] : []));

  it('take the pages the weeks leave, and keep what is placed when the calendar changes', () => {
    const nov = layoutOutline(outline([null, null, notes]), 52, NOV), jan = layoutOutline(outline([null, null, notes], 6), 52, JAN);
    expect(nov.used).toBe(52);
    expect(nov.rows[1].pages).toBe(11);
    expect(jan.rows[1].pages).toBe(8);
    expect(freeAt(nov)).toContain('43:2:Book notes'); // free page 3 (index 2): page 40 + 3
    expect(freeAt(jan)).toContain('46:2:Book notes');
    expect(nov.cells[51]!.page?.name).toBe('Month review');
    expect(prints(nov.cells[51])).toBe('NOVEMBER REVIEW');
  });

  it('are kept when they no longer fit, marked, and the book is over', () => {
    const o = outline([...Array(9).fill(null), notes], 6); // free page 10 holds a design
    expect(layoutOutline(outline([...Array(9).fill(null), notes]), 52, NOV).over).toBe(0);
    const jan = layoutOutline(o, 52, JAN); // January leaves 8 pages
    expect(jan.rows[1].beyond).toEqual([8, 9]);
    expect(jan.over).toBe(2);
    expect(jan.used).toBe(54);
    expect(jan.cells.flatMap((c) => (c?.kind === 'free' ? [c.free] : [])).length).toBe(8); // the pinned review keeps page 52
    // clearing the design that doesn't fit takes it out; nothing else is dropped
    const cleared = setFreePage(o, [1], 9, null);
    expect(cleared[1]).toMatchObject({ type: 'free', pages: [] });
    expect(layoutOutline(cleared, 52, JAN).over).toBe(0);
  });

  it('put a design on a page, padding the list with blank pages', () => {
    const o = setFreePage([free([])], [0], 2, notes);
    expect(o[0]).toMatchObject({ type: 'free', pages: [null, null, { name: 'Book notes' }] });
    expect(layoutOutline(o, 8).cells.map((c) => c?.page?.name ?? '-')).toEqual(['-', '-', 'Book notes', '-', '-', '-', '-', '-']);
  });
});

describe('the book file', () => {
  const book = (calendar: unknown): Book => ({ ...emptyBook(), calendar: calendar as Book['calendar'], outline: [typed(pageBlock(daily), 'day', { to: 'month' })] });

  it('reads a calendar and the page types, and keeps them when read again', () => {
    const b = book(NOV);
    b.outline = [weeksGroup(), setShared([typed(spreadBlock('S', { ...daily, side: 'left' }, { ...daily, side: 'right' }), 'day', { to: 'week' })], [0], false)[0]];
    const r = readBook(JSON.parse(JSON.stringify(b)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.book).toEqual(b);
  });

  it('refuses a calendar that is not real', () => {
    expect(readBook(JSON.parse(JSON.stringify(book({ start: '2026-02-30', end: '2026-03-01', week_starts: 0 })))).ok).toBe(false);
  });
});
