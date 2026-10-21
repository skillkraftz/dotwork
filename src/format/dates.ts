// Calendar dates as 'YYYY-MM-DD' strings. Weeks run Sunday to Saturday and week 1 holds January 1,
// the same as journal-system. All arithmetic is in UTC so time zones and daylight saving don't matter.

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const toMs = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether the text is a real calendar date written as YYYY-MM-DD (so 2026-02-30 is not). */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const ms = toMs(value);
  return Number.isFinite(ms) && toIso(ms) === value;
}

/** Today's date on the clock the person is using, not UTC (which turns evening into tomorrow). */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const addDays = (iso: string, days: number): string => toIso(toMs(iso) + days * DAY_MS);

/** The date `months` calendar months on (or before, when negative), keeping the day of the month unless it is too long for that month: Jan 31 + 1 is Feb 28. */
export function addMonths(iso: string, months: number): string {
  const { year, month, day } = parts(iso);
  const index = year * 12 + (month - 1) + months, y = Math.floor(index / 12), m = (index % 12) + 1;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const last = parts(addDays(`${pad(m === 12 ? y + 1 : y, 4)}-${pad(m === 12 ? 1 : m + 1)}-01`, -1)).day;
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, last))}`;
}

/** 0 is Sunday. */
export const dayOfWeek = (iso: string): number => new Date(toMs(iso)).getUTCDay();

export const parts = (iso: string) => ({ year: +iso.slice(0, 4), month: +iso.slice(5, 7), day: +iso.slice(8, 10) });

/** The Sunday on or before a date. */
export const sundayOf = (iso: string): string => addDays(iso, -dayOfWeek(iso));

/** The Sunday that starts week 1 of a year: the one on or before January 1. */
export const weekOneStart = (year: number): string => sundayOf(`${String(year).padStart(4, '0')}-01-01`);

/** The Sunday that starts week `week` of `year`. Weeks past the year's last roll into the next year. */
export const weekStart = (year: number, week: number): string => addDays(weekOneStart(year), (week - 1) * 7);

/** Which week a date is in. The week holding January 1 is week 1 of the year that January belongs to. */
export function weekNumber(iso: string): number {
  const sunday = sundayOf(iso);
  const year = parts(addDays(sunday, 6)).year; // the week's Saturday decides the year
  return Math.round((toMs(sunday) - toMs(weekOneStart(year))) / (7 * DAY_MS)) + 1;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** What each token says on a date. {months} is the month, or "NOV / DEC" when the 7 days from the date reach the next month. */
export function dateValues(iso: string) {
  const p = parts(iso), end = parts(addDays(iso, 6));
  return {
    weekday: WEEKDAYS[dayOfWeek(iso)],
    month: MONTHS[p.month - 1],
    monthname: MONTH_NAMES[p.month - 1],
    day: String(p.day),
    year: String(p.year),
    week: String(weekNumber(iso)),
    months: end.month === p.month ? MONTHS[p.month - 1] : `${MONTHS[p.month - 1]} / ${MONTHS[end.month - 1]}`,
  };
}

/** "Sun Oct 18, 2026" */
export function formatDate(iso: string): string {
  const v = dateValues(iso);
  const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
  return `${cap(v.weekday)} ${cap(v.month)} ${v.day}, ${v.year}`;
}

/** "Oct 18" or, with the year, "Oct 18, 2026". */
export function shortDate(iso: string, withYear = false): string {
  const v = dateValues(iso);
  return `${v.month[0] + v.month.slice(1).toLowerCase()} ${v.day}${withYear ? `, ${v.year}` : ''}`;
}
