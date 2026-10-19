import { addDays, dayOfWeek, parts, weekNumber, weekStart } from '../format/dates';

/** Days in a month (month 1 to 12). */
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const isoDate = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
export const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The month a week of the year is listed under: the month of its Thursday (so a week mostly in one month goes
 * there), except that week 1 is always January. Matches journal-system's year index.
 */
export function monthOfWeek(year: number, week: number): number {
  if (week <= 1) return 1;
  const thursday = parts(addDays(weekStart(year, week), 4));
  return thursday.year > year ? 12 : thursday.year < year ? 1 : thursday.month;
}

/** The first of the 52 weeks of each month, for month 1 to 12, or null for a month that holds none. */
export function monthStarts(year: number): (number | null)[] {
  const starts: (number | null)[] = Array(12).fill(null);
  for (let w = 1; w <= 52; w++) {
    const m = monthOfWeek(year, w) - 1;
    if (starts[m] === null) starts[m] = w;
  }
  return starts;
}

/** The first and last dates of a month. */
export const monthSpan = (year: number, month: number) => ({ first: isoDate(year, month, 1), last: isoDate(year, month, daysInMonth(year, month)) });

export { addDays, dayOfWeek, weekNumber };
