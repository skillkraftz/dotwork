import type { Page } from '../format/types';
import { addDays, dayOfWeek, parts, shortDate } from '../format/dates';
import { pageSpan, usesDates } from '../format/tokens';
import { notesPage } from '../builtin/pages';
import { dateOf, getSlot, setDates, setSlot, type Book, type Recipe, type RecipePart } from './book';
import { listPages } from './plan';

// "Build by week": a section of pages (a weekly page, seven daily pages, a reflection, notes) repeated for each week
// touching a month, then what comes after the weeks, filler, and an end. Pure functions; the Book view wraps them.

/** A page range of the book, 1-based and inclusive. */
export type PageRange = [from: number, to: number];

/** What the Build by week window asks for. Everything but the section and the month is optional. */
export interface WeeksInput {
  section: PageRange;
  /** The month to build. */
  year: number;
  month: number;
  after?: PageRange | null;
  fill?: PageRange | null;
  fillCut?: boolean;
  end?: PageRange | null;
}

export interface Entry { page: Page | null; date: string | null }

export interface WeeksPlan {
  /** What goes on pages 1..page_count. Pages the build doesn't reach are blank. */
  entries: Entry[];
  weeks: number;
  /** Pages used by the weeks, by what follows them, by the fill (and its repeats) and at the end. */
  counts: { weeks: number; after: number; fill: number; fillRepeats: number; end: number };
  /** Daily pages left out because their date falls outside the month. */
  leftOut: string[];
  /** Pages (1-based) where a gap page keeps a part on its side. */
  gaps: number[];
  /** Pages the build needs beyond the book's length. The build can't be applied while this is over 0. */
  over: number;
  /** Pages left blank in the book. */
  under: number;
  recipe: Recipe;
}

const monthOf = (year: number, month: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
const range = (r: PageRange) => [Math.min(...r), Math.max(...r)] as PageRange;
const size = (r: PageRange) => r[1] - r[0] + 1;

/** The part a range of the book becomes in a recipe. */
function partOf(book: Book, r: PageRange): RecipePart {
  const [from, to] = range(r);
  return { pages: Array.from({ length: size([from, to]) }, (_, i) => structuredClone(getSlot(book, from + i))), left: from % 2 === 0 };
}

export interface WeeksProblem { problem: string }

/** The recipe a window's answers make, or why they can't. Ranges are page numbers in the book as it is now. */
export function recipeFrom(book: Book, input: WeeksInput): Recipe | WeeksProblem {
  const last = book.page_count;
  const check = (r: PageRange | null | undefined, what: string) => {
    if (!r) return null;
    const [a, b] = range(r);
    return a < 1 || b > last || !Number.isInteger(a) || !Number.isInteger(b) ? `${what}: pages must be from 1 to ${last}.` : null;
  };
  const bad = check(input.section, 'Section') ?? check(input.after, 'After the weeks') ?? check(input.fill, 'Fill') ?? check(input.end, 'End');
  if (bad) return { problem: bad };
  const [from, to] = range(input.section);
  const base = firstDated(book, from, to);
  if (!base) return { problem: `Pages ${from}–${to} have no dates. Date the first week with Dates… first.` };
  const section = partOf(book, [from, to]);
  section.days = Array.from({ length: to - from + 1 }, (_, i) => {
    const d = dateOf(book, from + i);
    return d ? Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(base + 'T00:00:00Z')) / 86_400_000) : null;
  });
  const maybe = (r: PageRange | null | undefined) => (r ? partOf(book, r) : undefined);
  const [after, fill, end] = [maybe(input.after), maybe(input.fill), maybe(input.end)];
  return {
    month: monthOf(input.year, input.month), weekday: dayOfWeek(base), section,
    ...(after ? { after } : {}), ...(fill ? { fill } : {}), ...(fill && input.fillCut ? { fill_cut: true } : {}), ...(end ? { end } : {}),
  };
}

/** The date of the first dated page in a range. */
export function firstDated(book: Book, from: number, to: number): string | null {
  for (let n = from; n <= to; n++) { const d = dateOf(book, n); if (d) return d; }
  return null;
}

/** The month a section is for: the month of its first daily date, else of its first date. */
export function sectionMonth(book: Book, from: number, to: number): { year: number; month: number } | null {
  let first: string | null = null;
  for (let n = from; n <= to; n++) {
    const d = dateOf(book, n), page = getSlot(book, n);
    if (!d) continue;
    first ??= d;
    if (page && pageSpan(page) === 'day') return { year: parts(d).year, month: parts(d).month };
  }
  return first ? { year: parts(first).year, month: parts(first).month } : null;
}

/** Lay out the pages of a recipe in a book of `count` pages. */
export function planWeeks(recipe: Recipe, count: number, gap: Page = notesPage()): WeeksPlan {
  const [year, month] = recipe.month.split('-').map(Number);
  const first = `${recipe.month}-01`;
  const lastDay = addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`, -1);
  const entries: Entry[] = [];
  const gaps: number[] = [], leftOut: string[] = [];
  const slot = () => entries.length + 1;
  /** A gap page keeps a part on the side it began on. */
  const align = (part: RecipePart) => { if ((slot() % 2 === 0) !== part.left) { gaps.push(slot()); entries.push({ page: gap, date: null }); } };
  /** Pages of a part with nothing to say about the week: dated the first of the month if they print a date. */
  const place = (part: RecipePart, take = part.pages.length) =>
    part.pages.slice(0, take).forEach((page) => entries.push({ page, date: usesDates(page) ? first : null }));

  // The week containing the 1st starts on the section's weekday on or before it; each repeat is a week later.
  const start = addDays(first, -((dayOfWeek(first) - recipe.weekday + 7) % 7));
  let weeks = 0;
  for (let base = start; base <= lastDay; base = addDays(base, 7)) {
    weeks++;
    align(recipe.section);
    recipe.section.pages.forEach((page, i) => {
      const days = recipe.section.days![i];
      if (days === null) { entries.push({ page, date: null }); return; }
      const date = addDays(base, days);
      if (page && pageSpan(page) === 'day' && (date < first || date > lastDay)) { leftOut.push(date); return; }
      entries.push({ page, date });
    });
  }
  const weeksPages = entries.length - gaps.length;
  if (recipe.after) { align(recipe.after); place(recipe.after); }
  const afterPages = recipe.after?.pages.length ?? 0;

  // The end sits on the last pages of the book. If it would begin on the wrong side it moves a page earlier, and the
  // last page is a gap.
  const endPart = recipe.end;
  const endBlock: Entry[] = endPart ? endPart.pages.map((page) => ({ page, date: usesDates(page) ? first : null })) : [];
  if (endPart && ((count - endBlock.length + 1) % 2 === 0) !== endPart.left) { endBlock.push({ page: gap, date: null }); gaps.push(count); }
  const endStart = count - endBlock.length + 1;

  // Filler runs from here to where the end begins.
  let fillPages = 0, fillRepeats = 0;
  if (recipe.fill && entries.length < endStart - 1) {
    align(recipe.fill);
    const length = recipe.fill.pages.length, space = Math.max(0, endStart - slot());
    const whole = Math.floor(space / length), rest = space % length;
    for (let r = 0; r < whole; r++) { place(recipe.fill); fillRepeats++; }
    if (recipe.fill_cut && rest) { place(recipe.fill, rest); fillRepeats++; }
    fillPages = whole * length + (recipe.fill_cut ? rest : 0);
    entries.length = Math.min(entries.length, endStart - 1); // a gap that left no room for the fill isn't kept
  }

  const over = Math.max(0, entries.length + endBlock.length - count);
  const under = Math.max(0, endStart - 1 - entries.length);
  const blanks = Array.from({ length: under }, (): Entry => ({ page: null, date: null }));
  return {
    entries: [...entries, ...blanks, ...endBlock], weeks, leftOut, gaps, over, under, recipe,
    counts: { weeks: weeksPages, after: afterPages, fill: fillPages, fillRepeats, end: endPart?.pages.length ?? 0 },
  };
}

/** Runs of consecutive dates in words: "Nov 29–30, Jan 1–2". */
function dateRuns(dates: string[]): string {
  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs[runs.length - 1];
    if (run && addDays(run[run.length - 1], 1) === d) run.push(d); else runs.push([d]);
  }
  return runs.map((r) => (r.length === 1 ? shortDate(r[0]) : `${shortDate(r[0])}–${parts(r[r.length - 1]).day}`)).join(', ');
}

/** What a plan will do, in sentences, for the window to show before anything changes. */
export function weeksSummary(plan: WeeksPlan, count: number): string[] {
  const c = plan.counts, lines: string[] = [];
  const monthName = shortDate(`${plan.recipe.month}-01`).split(' ')[0];
  const bits = [`${c.weeks} page${c.weeks === 1 ? '' : 's'} for ${plan.weeks} week${plan.weeks === 1 ? '' : 's'} of ${monthName}`];
  if (c.after) bits.push(`${c.after} after the weeks`);
  if (c.fill) bits.push(`${c.fill} of fill (${c.fillRepeats} repeat${c.fillRepeats === 1 ? '' : 's'})`);
  if (c.end) bits.push(`${c.end} at the end`);
  lines.push(`${bits.join(', ')}.`);
  if (plan.leftOut.length) lines.push(`Left out, because they fall outside ${monthName}: ${plan.leftOut.length} daily page${plan.leftOut.length === 1 ? '' : 's'} (${dateRuns(plan.leftOut)}).`);
  if (plan.gaps.length) lines.push(`Inserted a Notes page on ${listPages(plan.gaps)} so spreads stay on the right sides.`);
  if (plan.over) lines.push(`${plan.over} page${plan.over === 1 ? '' : 's'} over the book’s ${count}: shorten the ranges, or make the book longer in Settings.`);
  else if (plan.under) lines.push(`${plan.under} page${plan.under === 1 ? '' : 's'} under the book’s ${count}: left blank.`);
  else lines.push(`Fills the book’s ${count} pages exactly.`);
  return lines;
}

/** Put a plan in the book: every page, its date and the recipe. Returns the pages whose page number had to be turned off. Call it inside an undo step. */
export function applyWeeks(book: Book, plan: WeeksPlan): number[] {
  const off: number[] = [];
  for (let n = 1; n <= book.page_count; n++) if (setSlot(book, n, plan.entries[n - 1]?.page ?? null)) off.push(n);
  delete book.dates;
  setDates(book, 1, Array.from({ length: book.page_count }, (_, i) => plan.entries[i]?.date ?? null));
  book.recipe = structuredClone(plan.recipe);
  return off;
}
