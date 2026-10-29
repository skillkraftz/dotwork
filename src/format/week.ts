import { addDays, dayOfWeek, weekStartOn } from './dates';
import { expandTokens, sampleReading, blankTokens, offsetDayTokens, type Reading } from './tokens';
import { groupArea, translate } from '../geometry';
import type { DayFilter, Generated, Part, PageElement, Pattern, Rule } from './types';

// The week block (docs/page-format.md, `generated`; docs/product-model.md, D16): goals, then a day widget for each day of the page's week that
// is inside the calendar, then outcomes, in a box. Every weekday has one fixed row (where it sits in a full week), so a partial week keeps
// its days where they always are and the days outside the calendar become lined writing space.

/** Which week the editor's sample shows: all seven days, a first week of two days (Fri, Sat) or a last week of two (Sun, Mon). */
export const WEEK_PREVIEWS = ['full', 'first', 'last'] as const;
export type WeekPreview = (typeof WEEK_PREVIEWS)[number];
export const WEEK_PREVIEW_LABELS: Record<WeekPreview, string> = { full: 'Full week', first: 'First week (Fri–Sat)', last: 'Last week (Sun–Mon)' };

/** The rows of a week: the days a week has, and which of them the calendar has. */
export interface WeekDays {
  /** The date of each of the seven rows, or null when the page is undated (it prints a full week with blank dates). */
  dates: (string | null)[];
  /** Whether the calendar has each day: false rows are not drawn. */
  present: boolean[];
  /** What each day's tokens read from: the book's calendar and year, or nothing in the editor's sample. */
  weekStarts: number;
  cal: { start: string; end: string } | null;
  year: number | null;
}

const ROWS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The seven rows of the week a page reads. `read` is what the page reads in a book (a week; a day or month reads the week holding its first
 * day), null for a page with no calendar (a full week, dates blank), and undefined in the editor, where the sample week is shown as `preview` says.
 */
export function weekDays(read: Reading | null | undefined, preview: WeekPreview = 'full'): WeekDays {
  if (read === null) return { dates: ROWS.map(() => null), present: ROWS.map(() => true), weekStarts: 0, cal: null, year: null };
  const r = read ?? sampleReading('week');
  const from = r.from ?? weekStartOn(r.first, r.weekStarts);
  const dates = ROWS.map((i) => addDays(from, i));
  const inside = (d: string) => !r.cal || (d >= r.cal.start && d <= r.cal.end);
  // The sample: Fri and Sat are the days a month that starts on a Friday has in its first week, Sun and Mon the last.
  const sample = (i: number) => (preview === 'first' ? i >= 5 : preview === 'last' ? i <= 1 : true);
  return { dates, present: ROWS.map((i) => (read ? inside(dates[i]) : sample(i))), weekStarts: r.weekStarts, cal: r.cal ?? null, year: r.year };
}

/** Whether an element limited to some days shows on a day (null when no day is read: it shows). Saturday and Sunday are the weekend. */
export function shownOn(filter: DayFilter | undefined, date: string | null, row?: number, weekStarts = 0): boolean {
  if (!filter) return true;
  const dow = date ? dayOfWeek(date) : row === undefined ? null : (weekStarts + row) % 7;
  if (dow === null) return true;
  return (dow === 0 || dow === 6) === (filter === 'weekends');
}

/** A part's size in cells, from where its elements are. */
export const partArea = (part: Part) => groupArea(part.elements);
export const partHeight = (part: Part): number => partArea(part).h;

/** The height of one day row: what the box has left after the goals and the outcomes, in seven, in half cells. */
export const rowHeight = (el: Generated): number =>
  Math.floor(((el.h - partHeight(el.goals) - partHeight(el.outcomes)) / 7) * 2) / 2;

/** The smallest box the three parts fit: the goals, seven day rows and the outcomes, and the widest of the three across. */
export const naturalSize = (parts: Pick<Generated, 'goals' | 'day' | 'outcomes'>): { w: number; h: number } => ({
  w: Math.max(partArea(parts.goals).w, partArea(parts.day).w, partArea(parts.outcomes).w),
  h: partHeight(parts.goals) + 7 * partHeight(parts.day) + partHeight(parts.outcomes),
});

/** Where everything of a week block sits, in cells on the page: the y of the goals, of each present day's row and of the outcomes, and the lined spaces. */
export interface WeekLayout {
  rowH: number;
  /** The y of the goals and the outcomes; null when no day is inside the calendar. */
  goals: number | null;
  outcomes: number | null;
  /** The present days: row 0 to 6 in week order, and the y of its top. */
  days: { row: number; y: number }[];
  /** Lined writing space in place of the days before / after the calendar, each with the rule that sets it off at the edge facing the days. */
  above: { y: number; h: number } | null;
  below: { y: number; h: number } | null;
}

/**
 * Every weekday has the place it has in a full week: row `i` starts `i` rows under the goals' place. The goals sit just above the first present
 * day and the outcomes just under the last; the rows the missing days would have taken become lined space: above the goals in a first
 * (partial) week, below the outcomes in a last one, both for a calendar shorter than the week.
 */
export function layoutWeek(el: Generated, present: readonly boolean[]): WeekLayout {
  const g = partHeight(el.goals), o = partHeight(el.outcomes), rowH = rowHeight(el);
  const rowTop = (i: number) => el.y + g + i * rowH;
  const first = present.indexOf(true), last = present.lastIndexOf(true);
  if (first < 0) return { rowH, goals: null, outcomes: null, days: [], above: { y: el.y, h: el.h }, below: null };
  const outcomes = rowTop(last) + rowH;
  return {
    rowH,
    goals: rowTop(first) - g,
    outcomes,
    days: ROWS.filter((i) => present[i]).map((row) => ({ row, y: rowTop(row) })),
    above: first > 0 ? { y: el.y, h: first * rowH } : null,
    below: last < 6 ? { y: outcomes + o, h: (6 - last) * rowH } : null,
  };
}

const lines = (x: number, y: number, w: number, h: number): Pattern => ({ type: 'pattern', pattern: 'lines', x, y, w, h });
const rule = (x1: number, x2: number, y: number): Rule => ({ type: 'rule', x1, y1: y, x2, y2: y, weight: 'thin' });

/** A part's elements moved so its top-left corner is at (x, y). */
const placed = (part: Part, x: number, y: number): PageElement[] => {
  const a = partArea(part);
  return part.elements.map((e) => translate(structuredClone(e), x - a.x, y - a.y));
};

/**
 * The ordinary elements a week block draws, in page cells: what to draw for the week a page reads. In a day's row its text reads that
 * row's own day, and an element limited to weekends or weekdays shows or not for that day. Goals and outcomes keep their tokens (they read the page).
 */
export function resolveWeek(el: Generated, read: Reading | null | undefined, preview: WeekPreview = 'full'): PageElement[] {
  const week = weekDays(read, preview);
  const at = layoutWeek(el, week.present);
  const out: PageElement[] = [];
  const bare = (e: PageElement): PageElement => { const { days: _d, ...rest } = e; return rest as PageElement; };
  if (at.above) out.push(lines(el.x, at.above.y, el.w, at.above.h), rule(el.x, el.x + el.w, at.above.y + at.above.h));
  if (at.goals !== null) out.push(...placed(el.goals, el.x, at.goals).map(bare));
  for (const { row, y } of at.days) {
    const date = week.dates[row];
    const dayRead: Reading | null = date ? { kind: 'day', first: date, last: date, cal: week.cal, weekStarts: week.weekStarts, year: week.year } : null;
    for (const e of placed(el.day, el.x, y)) {
      if (!shownOn(e.days, date, row, week.weekStarts)) continue;
      const b = bare(e);
      out.push(b.type === 'text' ? { ...b, text: dayRead ? expandTokens(b.text, dayRead) : blankTokens(b.text) } : b);
    }
  }
  if (at.outcomes !== null) out.push(...placed(el.outcomes, el.x, at.outcomes).map(bare));
  if (at.below) out.push(rule(el.x, el.x + el.w, at.below.y), lines(el.x, at.below.y, el.w, at.below.h));
  return out;
}

/**
 * The plain elements a week block turns into: what it draws for a full week, with each day row's day tokens counted from the page's first day
 * (row k's {day} is {day+k}), so on a Week page every row still prints its own day. Kept as they are: positions, goals and outcomes. Lost: the
 * lined space and the hidden rows for days outside the calendar (all seven rows stay, their date tokens print blank), and `days` limits (an
 * element limited to weekends or weekdays stays only in the rows that are those days in a week starting Sunday).
 */
export function convertWeek(el: Generated): PageElement[] {
  const at = layoutWeek(el, ROWS.map(() => true));
  const out: PageElement[] = [];
  const bare = (e: PageElement): PageElement => { const { days: _d, ...rest } = e; return rest as PageElement; };
  out.push(...placed(el.goals, el.x, at.goals!).map(bare));
  for (const { row, y } of at.days) {
    for (const e of placed(el.day, el.x, y)) {
      if (!shownOn(e.days, null, row, 0)) continue;
      const b = bare(e);
      out.push(b.type === 'text' ? { ...b, text: offsetDayTokens(b.text, row) } : b);
    }
  }
  out.push(...placed(el.outcomes, el.x, at.outcomes!).map(bare));
  return out;
}
