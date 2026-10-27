import { addDays, addMonths, daysBetween, isDate, monthEnd, parts, weekStartOn } from './dates';
import type { Reading, Unit } from './tokens';

// A book's calendar: the stretch of days its pages are dated from (docs/book-format.md, The calendar). It stores only `start`,
// `end` and the day weeks start on; the days, weeks and months of it are worked out here.

export interface Calendar {
  /** The first day, 'YYYY-MM-DD'. */
  start: string;
  /** The last day. */
  end: string;
  /** The day a week starts on: 0 is Sunday (the default), 1 Monday... 6 Saturday. */
  week_starts: number;
}

/** The longest a calendar may be, so a mistyped year can't make thousands of pages. */
export const MAX_CALENDAR_DAYS = 800;

/** Why a calendar can't be used, or null when it is fine. */
export function calendarProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '"calendar" must be an object with "start", "end" and "week_starts".';
  const c = raw as Record<string, unknown>;
  if (!isDate(c.start) || !isDate(c.end)) return '"calendar.start" and "calendar.end" must be real dates written YYYY-MM-DD.';
  if (c.end < c.start) return '"calendar.end" must not be before "calendar.start".';
  if (daysBetween(c.start, c.end) + 1 > MAX_CALENDAR_DAYS) return `A calendar is at most ${MAX_CALENDAR_DAYS} days long.`;
  if (!Number.isInteger(c.week_starts) || (c.week_starts as number) < 0 || (c.week_starts as number) > 6) return '"calendar.week_starts" must be a whole number from 0 (Sunday) to 6 (Saturday).';
  return null;
}

/** The calendar of `months` whole months from a month (1 to 12) of a year. */
export function calendarFor(year: number, month: number, months = 1, weekStarts = 0): Calendar {
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  return { start, end: monthEnd(addMonths(start, Math.max(1, months) - 1)), week_starts: weekStarts };
}

/** The year the calendar starts in: the year its weeks are numbered by. */
export const calendarYear = (c: Calendar): number => parts(c.start).year;

/** How many whole months the calendar reaches, from the month it starts in. */
export const calendarMonths = (c: Calendar): number => (parts(c.end).year * 12 + parts(c.end).month) - (parts(c.start).year * 12 + parts(c.start).month) + 1;

/** One day, week or month of a calendar: the days of it inside the calendar (or inside a span asked about). */
export interface Span { kind: Unit; first: string; last: string }

/**
 * The days, weeks or months of the calendar, in order. A week is a calendar week that touches the range, a month a calendar month
 * that touches it; the first and last may be partial, and say so by `first` and `last`, which are only the days inside the range.
 * `within` narrows the range to a span (the days of a week group's week); a range with no days gives none.
 */
export function spansOf(cal: Calendar, kind: Unit, within?: { first: string; last: string }): Span[] {
  const first = within && within.first > cal.start ? within.first : cal.start;
  const last = within && within.last < cal.end ? within.last : cal.end;
  const out: Span[] = [];
  if (first > last) return out;
  if (kind === 'day') {
    for (let d = first; d <= last; d = addDays(d, 1)) out.push({ kind, first: d, last: d });
    return out;
  }
  if (kind === 'week') {
    for (let w = weekStartOn(first, cal.week_starts); w <= last; w = addDays(w, 7)) {
      out.push({ kind, first: w > first ? w : first, last: addDays(w, 6) < last ? addDays(w, 6) : last });
    }
    return out;
  }
  for (let m = first.slice(0, 8) + '01'; m <= last; m = addMonths(m, 1)) {
    out.push({ kind, first: m > first ? m : first, last: monthEnd(m) < last ? monthEnd(m) : last });
  }
  return out;
}

/** What a page placed for this span reads. */
export const readingOf = (cal: Calendar, span: Span): Reading => ({ ...span, weekStarts: cal.week_starts, year: calendarYear(cal) });
