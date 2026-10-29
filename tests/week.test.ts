import { describe, expect, it } from 'vitest';
import { calendarFor, readingOf, spansOf } from '../src/format/calendar';
import { readPage } from '../src/format/read';
import { suggestUnit, sampleFor, expandRead, type Reading } from '../src/format/tokens';
import { emptyPage, type Generated, type Page, type PageElement, type Pattern, type Shade, type Text } from '../src/format/types';
import { layoutWeek, naturalSize, resolveWeek, rowHeight, weekDays } from '../src/format/week';
import { weekBlock } from '../src/builtin/week';
import { BUILTIN_PAGES, findBuiltinPage } from '../src/builtin/library';
import { TEMPLATES } from '../src/builtin/templates';
import { bookLayout } from '../src/book/book';
import { elementMarkup } from '../src/render';
import { layoutPage } from '../src/print/layout';
import type { Item } from '../src/print/display';

const block = weekBlock()!;
const NOV = calendarFor(2026, 11), JAN = calendarFor(2027, 1);
const weeks = (cal: ReturnType<typeof calendarFor>) => spansOf(cal, 'week').map((s) => readingOf(cal, s));
const novLast = weeks(NOV)[4];
const [janFirst, , , , , janLast] = weeks(JAN);

const present = (r: Reading | null | undefined, preview?: 'full' | 'first' | 'last') => weekDays(r, preview).present.map((p) => (p ? 1 : 0)).join('');
/** What a resolved block prints in its day rows, in order. */
const texts = (els: PageElement[]) => els.filter((e): e is Text => e.type === 'text').map((e) => e.text);
const shades = (els: PageElement[]) => els.filter((e): e is Shade => e.type === 'shade');

describe('the week block\'s built-in widgets', () => {
  it('make a block 27 wide, with goals of 8 rows, a day row of 4 and outcomes of 7: the whole page below the header', () => {
    expect(block.kind).toBe('week');
    expect([block.x, block.y, block.w, block.h]).toEqual([0, 1, 27, 43]);
    expect(rowHeight(block)).toBe(4);
    expect(naturalSize(block)).toEqual({ w: 27, h: 43 });
  });
});

describe('which days a week block draws', () => {
  it('draws all seven in a full week, and only the ones inside the calendar in a partial one', () => {
    expect(present(weeks(NOV)[1])).toBe('1111111');
    expect(present(novLast)).toBe('1100000'); // Sun 29, Mon 30
    expect(present(janFirst)).toBe('0000011'); // Fri 1, Sat 2
    expect(present(janLast)).toBe('1000000'); // Sun 31
  });

  it('shows a full week with blank dates when the page reads nothing, and the sample week with the editor\'s preview switch', () => {
    expect(weekDays(null).dates).toEqual(Array(7).fill(null));
    expect(present(null)).toBe('1111111');
    expect(present(undefined)).toBe('1111111');
    expect(present(undefined, 'first')).toBe('0000011'); // Fri, Sat
    expect(present(undefined, 'last')).toBe('1100000'); // Sun, Mon
    expect(weekDays(undefined).dates[0]).toBe('2026-10-25');
  });
});

describe('where the rows of a week block sit', () => {
  const at = (r: Reading) => layoutWeek(block, weekDays(r).present);

  it('puts goals, seven day rows and outcomes in a full week, with no lined space', () => {
    const l = at(weeks(NOV)[1]);
    expect(l.goals).toBe(1);
    expect(l.days.map((d) => d.y)).toEqual([9, 13, 17, 21, 25, 29, 33]);
    expect(l.outcomes).toBe(37);
    expect([l.above, l.below]).toEqual([null, null]);
  });

  it('keeps every day on its full-week row in the first week of January 2027 (Fri 1, Sat 2): goals above them, lined space and a rule on top', () => {
    const l = at(janFirst);
    expect(l.days).toEqual([{ row: 5, y: 29 }, { row: 6, y: 33 }]); // the rows Fri and Sat have in a full week
    expect(l.goals).toBe(21); // directly above Friday
    expect(l.outcomes).toBe(37);
    expect(l.above).toEqual({ y: 1, h: 20 }); // five days of 4 rows
    expect(l.below).toBeNull();
  });

  it('keeps every day on its full-week row in the last week of November 2026 (Sun 29, Mon 30): goals on top, outcomes under Monday, a rule and lined space below', () => {
    const l = at(novLast);
    expect(l.days).toEqual([{ row: 0, y: 9 }, { row: 1, y: 13 }]);
    expect(l.goals).toBe(1);
    expect(l.outcomes).toBe(17); // directly under Monday
    expect(l.above).toBeNull();
    expect(l.below).toEqual({ y: 24, h: 20 }); // five days of 4 rows, down to the bottom of the box (row 44)
  });

  it('fills the box exactly in every kind of week: what is drawn plus the lined space is the height of the box', () => {
    for (const r of [weeks(NOV)[1], novLast, janFirst, janLast]) {
      const l = at(r);
      const top = l.above ? l.above.y : l.goals!;
      const bottom = l.below ? l.below.y + l.below.h : l.outcomes! + 7;
      expect([top, bottom]).toEqual([1, 44]);
    }
  });

  it('sets the lined space by the row height, which comes from the box', () => {
    const tall: Generated = { ...block, h: 43 + 7 * 2 }; // rows of 6
    expect(rowHeight(tall)).toBe(6);
    expect(layoutWeek(tall, weekDays(novLast).present).below).toEqual({ y: 1 + 8 + 12 + 7, h: 30 });
    expect(rowHeight({ ...block, h: 43.5 })).toBe(4); // half cells that do not make a row are left over
  });
});

describe('what a week block draws', () => {
  const lined = (els: PageElement[]) => els.filter((e): e is Pattern => e.type === 'pattern' && e.pattern === 'lines' && e.w === 27).map((e) => [e.y, e.h]);
  const rules = (els: PageElement[]) => els.filter((e) => e.type === 'rule' && e.x1 === 0 && e.x2 === 27 && e.weight === 'thin').map((e) => (e as { y1: number }).y1);

  it('draws lined space of the ruled-line style with a rule between it and the goals (first week) or the outcomes (last week)', () => {
    const first = resolveWeek(block, janFirst);
    expect(lined(first)).toEqual([[1, 20]]);
    expect(rules(first)).toContain(21);
    const last = resolveWeek(block, novLast);
    expect(lined(last)).toEqual([[24, 20]]);
    expect(rules(last)).toContain(24);
    expect(lined(resolveWeek(block, weeks(NOV)[1]))).toEqual([]); // a full week has none
  });

  it('shows the weekend shading only on Saturday and Sunday rows', () => {
    // 27 wide strip of 2: x 25
    const strip = (r: Reading | null | undefined) => shades(resolveWeek(block, r)).map((s) => s.y);
    expect(strip(weeks(NOV)[1])).toEqual([9, 33]); // Sun, Sat
    expect(strip(novLast)).toEqual([9]); // Sun 29 (Mon 30 is a weekday)
    expect(strip(janFirst)).toEqual([33]); // Sat 2 (Fri 1 is a weekday)
    expect(strip(janLast)).toEqual([9]);
    // a week that starts on Monday has its Saturday and Sunday last
    const monday = { ...weeks({ ...NOV, week_starts: 1 })[1] };
    expect(strip(monday)).toEqual([29, 33]);
  });

  it('reads each row\'s own day in a day widget: SUN 29 and MON 30, and nothing for the days outside the month', () => {
    const t = texts(resolveWeek(block, novLast));
    expect(t).toEqual(expect.arrayContaining(['SUN', '29', 'MON', '30', 'GOAL', 'OUTCOME']));
    for (const gone of ['TUE', 'WED', 'THU', 'FRI', 'SAT', '1', '2', '5']) expect(t).not.toContain(gone);
    expect(texts(resolveWeek(block, janFirst)).filter((s) => s !== 'GOAL' && s !== 'OUTCOME')).toEqual(['FRI', '1', 'SAT', '2']);
    expect(texts(resolveWeek(block, weeks(NOV)[0])).filter((s) => !/^[A-Z]{4,}$/.test(s))).toEqual(['SUN', '1', 'MON', '2', 'TUE', '3', 'WED', '4', 'THU', '5', 'FRI', '6', 'SAT', '7']);
    // a month changes inside a week: Dec 27 - Jan 2 reads each day's own month and date
    expect(texts(resolveWeek(block, weeks(calendarFor(2026, 12, 2))[4])).filter((s) => /^\d+$/.test(s))).toEqual(['27', '28', '29', '30', '31', '1', '2']);
  });

  it('prints blank dates for a page that reads nothing, with the day names still labelling the rows', () => {
    const t = texts(resolveWeek(block, null));
    expect(t.filter((s) => s !== 'GOAL' && s !== 'OUTCOME')).toEqual(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  });

  it('shows the sample week in the editor, and the first or last week the preview switch picks', () => {
    const run = (p?: 'full' | 'first' | 'last') => texts(resolveWeek(block, undefined, p)).filter((s) => s !== 'GOAL' && s !== 'OUTCOME');
    expect(run()).toEqual(['SUN', '25', 'MON', '26', 'TUE', '27', 'WED', '28', 'THU', '29', 'FRI', '30', 'SAT', '31']);
    expect(run('first')).toEqual(['FRI', '30', 'SAT', '31']);
    expect(run('last')).toEqual(['SUN', '25', 'MON', '26']);
    expect(lined(resolveWeek(block, undefined, 'first'))).toEqual([[1, 20]]);
    expect(lined(resolveWeek(block, undefined, 'last'))).toEqual([[24, 20]]);
  });
});

describe('elements limited to weekends or weekdays', () => {
  const day = (date: string): Reading => ({ kind: 'day', first: date, last: date, cal: { start: '2026-11-01', end: '2026-11-30' }, weekStarts: 0, year: 2026 });
  const only = (days: 'weekends' | 'weekdays'): PageElement => ({ type: 'box', x: 0, y: 1, w: 3, h: 3, days });

  it('show on a day page for its own day, and always where no day is read', () => {
    const shown = (e: PageElement, r: Reading | null | undefined) => elementMarkup(e, r === undefined ? undefined : expandRead(r)) !== '';
    expect(shown(only('weekends'), day('2026-11-01'))).toBe(true); // a Sunday
    expect(shown(only('weekends'), day('2026-11-02'))).toBe(false); // a Monday
    expect(shown(only('weekdays'), day('2026-11-02'))).toBe(true);
    expect(shown(only('weekdays'), day('2026-11-07'))).toBe(false); // a Saturday
    expect(shown(only('weekends'), undefined)).toBe(true); // the editor
    expect(shown(only('weekends'), null)).toBe(true); // undated
    expect(shown(only('weekdays'), weeks(NOV)[1])).toBe(true); // a week page reads no single day
  });

  it('are left out of the printed page for the days they do not show on', () => {
    const page: Page = { ...emptyPage(), elements: [only('weekends')] };
    const boxes = (r: Reading) => { const out: Item[] = []; layoutPage(page, { x: 0, y: 0, pageNumber: null, expand: expandRead(r) }, out); return out.filter((i) => i.k === 'line').length; };
    expect(boxes(day('2026-11-01'))).toBeGreaterThan(0);
    expect(boxes(day('2026-11-03'))).toBe(0);
  });

  it('are read from files: weekends and weekdays are the only values', () => {
    const file = (days: unknown) => ({ ...emptyPage(), elements: [{ type: 'box', x: 0, y: 1, w: 3, h: 3, days }] });
    expect(readPage(file('weekends')).ok).toBe(true);
    expect(readPage(file('weekdays')).ok).toBe(true);
    const bad = readPage(file('sundays'));
    expect(bad.ok ? '' : bad.issues[0].path).toBe('elements[0].days');
  });
});

describe('a week block in a file', () => {
  const page = (g: unknown): unknown => ({ ...emptyPage(), identity: '', elements: [g] });

  it('is read as it is written, with its three widgets inside', () => {
    expect(readPage(JSON.parse(JSON.stringify(page(block)))).ok).toBe(true);
  });

  it('refuses a box too short for the parts, too narrow, a part that is not a widget, another generated element inside, and an unknown kind', () => {
    const why = (g: unknown) => { const r = readPage(page(g)); return r.ok ? '' : r.issues[0].message; };
    expect(why({ ...block, h: 40 })).toMatch(/need at least 43/);
    expect(why({ ...block, w: 20 })).toMatch(/widest part is 27/);
    expect(why({ ...block, goals: { name: 'x', elements: [] } })).toMatch(/at least one element/);
    expect(why({ ...block, day: { name: 'x', elements: [block] } })).toMatch(/can't hold another/);
    expect(why({ ...block, kind: 'month' })).toMatch(/"kind"/);
    expect(why({ ...block, outcomes: { name: 'x', elements: [{ type: 'rule', x1: 0, y1: 1, x2: 5, y2: 2 }] } })).toMatch(/horizontal or vertical/);
  });

  it('makes a page a week page whatever it says', () => {
    const planner = findBuiltinPage('Week planner')!;
    expect(suggestUnit(planner)).toBe('week');
    expect(sampleFor(planner).read).toBeUndefined();
  });
});

/** The ink of a laid out page: its text, shaded rectangles, and each line style as the stretches it covers (touching or overlapping lines are one). */
function ink(items: Item[]) {
  const f = (n: number) => +n.toFixed(3);
  const covered = new Map<string, [number, number][]>();
  for (const i of items) {
    if (i.k !== 'line') continue;
    const across = i.y1 === i.y2, grow = i.cap === 'square' ? i.w / 2 : 0;
    const [a, b] = across ? [Math.min(i.x1, i.x2), Math.max(i.x1, i.x2)] : [Math.min(i.y1, i.y2), Math.max(i.y1, i.y2)];
    const key = `${across ? 'h' : 'v'} ${f(across ? i.y1 : i.x1)} ${f(i.w)} ${i.c}`;
    covered.set(key, [...(covered.get(key) ?? []), [a - grow, b + grow]]);
  }
  const lines = [...covered].map(([key, spans]) => {
    const merged: [number, number][] = [];
    for (const s of spans.sort((p, q) => p[0] - q[0])) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]);
    }
    return `${key}: ${merged.map(([p, q]) => `${f(p)}..${f(q)}`).join(' ')}`;
  }).sort();
  const words = items.filter((i) => i.k === 'text').map((i) => JSON.stringify(i)).sort();
  const rects = items.filter((i) => i.k === 'rect').map((i) => JSON.stringify(i)).sort();
  return { lines, words, rects };
}

describe('the Week planner', () => {
  const printed = (page: Page, expand = sampleFor(page)) => { const out: Item[] = []; layoutPage(page, { x: 0, y: 0, pageNumber: null, expand }, out); return ink(out); };
  // The planner is made to mirror on a left page; the tracker it matches is not, so it is compared as made (mirroring off, see mirror.test.ts).
  const planner = { ...findBuiltinPage('Week planner')!, mirror_left: undefined }, tracker = findBuiltinPage('week tracker checklist')!;

  it('is a built-in page of one week block with the tracker\'s header: no identity, the page number\'s corner kept', () => {
    expect(planner.elements).toHaveLength(1);
    expect(planner.elements[0].type).toBe('generated');
    expect([planner.identity, planner.side, planner.page_number]).toEqual([tracker.identity, tracker.side, tracker.page_number]);
    expect(BUILTIN_PAGES.map((p) => p.name)).toContain('week tracker checklist'); // kept as it is
  });

  it('looks the same as the week tracker checklist in a full week: the same lines, shading, boxes and words in the same places', () => {
    const full = weeks(NOV)[1]; // Nov 8-14: both pages read the same week
    const a = printed(planner, expandRead(full)), b = printed(tracker, expandRead(full));
    expect(a.words).toEqual(b.words);
    expect(a.rects).toEqual(b.rects);
    expect(a.lines).toEqual(b.lines);
    // and in the editor, where both show the sample week
    expect(printed(planner)).toEqual(printed(tracker));
  });

  it('differs from the tracker in a partial week only by the lined space, and keeps every shown day where the tracker has it', () => {
    const a = printed(planner, expandRead(novLast)), b = printed(tracker, expandRead(novLast));
    // the tracker prints SUN 29, MON 30 and then five blank-dated rows: the planner prints just the two
    const days = (w: string[]) => w.map((s) => JSON.parse(s)).filter((i) => i.str !== '' && !/GOAL|OUTCOME/.test(i.str)).map((i) => [i.str, i.y]);
    const shown = days(a.words).filter(([s]) => /^(SUN|MON|\d+)$/.test(s as string));
    expect(shown.length).toBe(4);
    for (const d of shown) expect(days(b.words)).toContainEqual(d);
  });
});

describe('the Monthly log', () => {
  const log = TEMPLATES.find((t) => t.id === 'monthly-log')!;

  it('has the weekly page, a daily log to the end of each week and the weekly reflection in its week group, free pages for the rest, and the review pinned last', () => {
    const book = log.build({ year: 2026, month: 11 });
    expect(book.calendar).toEqual(NOV);
    expect(book.outline.map((b) => b.type)).toEqual(['group', 'free', 'page']);
    const group = book.outline[0] as Extract<typeof book.outline[number], { type: 'group' }>;
    expect(group).toMatchObject({ repeat: { times: 5 } }); // a repeat for each week of November
    expect(group.children.map((c) => (c.type === 'page' ? c.page?.name : c.type))).toEqual(['Year journal weekly page (dated)', 'Daily Log', 'Weekly reflection']);
    expect(group.children.map((c) => (c.type === 'page' ? [c.dates, c.repeat] : null))).toEqual([['week', { times: 1 }], ['day', { to: 'week' }], ['week-review', { times: 1 }]]);
    expect(book.outline[2]).toMatchObject({ pin: 'last', dates: 'month-review', repeat: { times: 1 } });
  });

  it('fits every month of 2026 and 2027 in 52 pages with the month review on page 52, and puts the weekly page of November\'s last week on page 37', () => {
    for (const year of [2026, 2027]) for (let month = 1; month <= 12; month++) {
      const book = log.build({ year, month });
      const layout = bookLayout(book);
      expect(layout.over, `${year}-${month}`).toBe(0);
      expect(layout.cells[51]?.page?.name, `${year}-${month}`).toBe('Patterns & takeaways');
    }
    const nov = bookLayout(log.build({ year: 2026, month: 11 }));
    expect(nov.cells[36]?.page?.name).toBe('Year journal weekly page (dated)');
    expect(nov.cells[36]?.read).toMatchObject({ kind: 'week', first: '2026-11-29', last: '2026-11-30', from: '2026-11-29' });
    expect(nov.cells[0]?.page?.name).toBe('Year journal weekly page (dated)');
    expect(nov.cells.filter((c) => c?.kind === 'free')).toHaveLength(11); // 41 to 51
    const jan = bookLayout(log.build({ year: 2027, month: 1 }));
    expect(jan.cells[0]?.read).toMatchObject({ first: '2027-01-01', last: '2027-01-02', from: '2026-12-27' });
    expect(jan.cells.filter((c) => c?.kind === 'free')).toHaveLength(8);
  });
});
