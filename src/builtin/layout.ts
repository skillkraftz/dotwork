import { dayOfWeek, weekNumber } from '../format/dates';
import { MONTH_ABBR, MONTH_NAMES, WEEKDAY_ABBR, daysInMonth, isoDate } from './calendar';

// The order of pages in the monthly journal. Only what each page is, so the same layout can say what is on every page (the
// page index on its back cover) and then be turned into an outline (templates.ts).

export const BOOK_PAGES = 52;

export type Kind = 'daily' | 'reflection' | 'patterns' | 'questions' | 'notes' | 'idea' | 'dots' | 'weekly';
/** One page of a layout: its kind, the identity it prints, and what the page index says about it. */
export interface Slot { kind: Kind; identity?: string; note?: string }

/** Idea spreads (an idea page on the left, a dot grid on the right) and notes pages from the next page to page 52, ending with `tail` pages of notes. */
function ideasToEnd(into: Slot[], tail: number) {
  if (into.length >= BOOK_PAGES) return;
  if ((into.length + 1) % 2) into.push({ kind: 'notes' }); // a spread starts on a left (even) page
  const spreads = Math.max(0, Math.floor((BOOK_PAGES - into.length - tail) / 2));
  for (let s = 0; s < spreads; s++) into.push({ kind: 'idea', note: 'idea:' }, { kind: 'dots' });
  while (into.length < BOOK_PAGES) into.push({ kind: 'notes' });
}

/**
 * The monthly journal: a daily page for each day with a reflection after each Saturday (and one for a final partial
 * week), then the month's patterns and questions, then idea spreads and notes to page 52.
 */
export function monthlyLayout(year: number, month: number): Slot[] {
  const n = daysInMonth(year, month), mon = MONTH_ABBR[month - 1];
  const out: Slot[] = [];
  let runStart = 1;
  for (let d = 1; d <= n; d++) {
    const date = isoDate(year, month, d);
    out.push({ kind: 'daily', note: `${WEEKDAY_ABBR[dayOfWeek(date)]} ${d}` });
    if (dayOfWeek(date) === 6 || d === n) {
      const wk = weekNumber(date);
      out.push({ kind: 'reflection', identity: `WEEK ${wk}  ${mon} ${runStart === d ? d : `${runStart}-${d}`}`, note: `wk ${wk}` });
      runStart = d + 1;
    }
  }
  const name = MONTH_NAMES[month - 1];
  out.push({ kind: 'patterns', identity: `${name} REVIEW`, note: 'patterns' }, { kind: 'questions', identity: `${name} QUESTIONS`, note: 'questions' });
  ideasToEnd(out, 3);
  return out;
}
