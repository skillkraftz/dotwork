import { dayOfWeek, monthEnd, parts } from './dates';
import { SAMPLE_DATE, type Reading } from './tokens';

/** A month as the tracker tools read it: the weekday of its first day (0 is Sunday) and how many days it has. */
export interface MonthDays { first: number; days: number }

export const monthDays = (iso: string): MonthDays => ({ first: dayOfWeek(iso.slice(0, 8) + '01'), days: parts(monthEnd(iso)).day });

/**
 * The month a page reads: that of its reading's first day (a month page, a review, a day or week page, or a cover, which reads the calendar's
 * first month); the sample date's month where nothing is read (the editor); none for a page with no calendar, which prints these blank.
 */
export const monthOf = (read: Reading | null | undefined): MonthDays | null => (read === null ? null : monthDays(read === undefined ? SAMPLE_DATE : read.first));

/** Whether day `i` (counted from 0 at the month's first day) is a Saturday or a Sunday. */
export const isWeekend = (m: MonthDays, i: number): boolean => [0, 6].includes((m.first + i) % 7);
