import type { Page } from '../format/types';
import { addDays, addMonths, dayOfWeek, parts, shortDate } from '../format/dates';
import { pageSpan } from '../format/tokens';
import { notesPage } from '../builtin/pages';
import { dateOf, getSlot, setDates, setSlot, type Book } from './book';
import { listPages } from './plan';
import type { Move, Recipe, Section, Step } from './sections';

// The book builder: a recipe is a list of steps, each repeating a section from the Library. These are pure functions;
// the Book view wraps them in a window.

/** A page range of the book, 1-based and inclusive. */
export type PageRange = [from: number, to: number];

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

/** The section made of pages `from`..`to` of the book. Its dates are kept relative to the first dated page. */
export function sectionFrom(book: Book, from: number, to: number, name: string, move: Move): Section {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const slots = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const dates = slots.map((n) => dateOf(book, n));
  const base = dates.find(Boolean) ?? null;
  return {
    format: 'dotwork-section', version: 1, name: name.trim() || 'Untitled',
    pages: slots.map((n) => structuredClone(getSlot(book, n))),
    days: dates.map((d) => (d && base ? daysBetween(base, d) : null)),
    weekday: base ? dayOfWeek(base) : 0,
    move: base ? move : 'none',
    left: lo % 2 === 0,
  };
}

/** How the section's dates would most likely move, for the Save window to start from. */
export function guessMove(book: Book, from: number, to: number): Move {
  const dated: string[] = [];
  let span: 'day' | 'week' | null = null;
  for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
    const d = dateOf(book, n), page = getSlot(book, n);
    if (!d) continue;
    dated.push(d);
    if (page && pageSpan(page)) span ??= pageSpan(page);
  }
  if (!dated.length) return 'none';
  if (new Set(dated).size > 1) return 'week';
  return span === 'day' ? 'day' : span === 'week' ? 'week' : 'month';
}

export interface Entry { page: Page | null; date: string | null }

/** What one step did: the pages it placed (not counting gap pages) and how many repeats that was. */
export interface StepResult { pages: number; repeats: number }

export interface BuildPlan {
  /** What goes on pages 1..page_count. */
  entries: Entry[];
  steps: StepResult[];
  /** Daily pages left out because their date falls outside the month ("each week of"). */
  leftOut: string[];
  /** Pages (1-based) where a gap page keeps a part on its side. */
  gaps: number[];
  /** Pages placed (steps and gap pages together), and pages left blank. */
  used: number;
  left: number;
  /** Why the steps can't be built, when they can't. */
  problem: string | null;
  recipe: Recipe;
  gapName: string;
}

const lastDayOf = (month: string) => addDays(addMonths(`${month}-01`, 1), -1);

/** Where the pages of a run of steps are laid, one after another, starting on slot `offset + 1`. */
class Layout {
  entries: Entry[] = [];
  gaps: number[] = [];
  leftOut: string[] = [];
  constructor(private gap: Page, private offset = 0) {}
  get slot() { return this.offset + this.entries.length + 1; }
  /** A gap page keeps a part on the side it began on. */
  align(left: boolean) {
    if ((this.slot % 2 === 0) !== left) { this.gaps.push(this.slot); this.entries.push({ page: this.gap, date: null }); }
  }
  /** One repeat of a section whose first dated page falls on `anchor`. */
  place(section: Section, anchor: string, inMonth: string | null) {
    this.align(section.left);
    section.pages.forEach((page, i) => {
      const days = section.days[i];
      const date = days === null ? null : addDays(anchor, days);
      if (inMonth && date && page && pageSpan(page) === 'day' && (date < `${inMonth}-01` || date > lastDayOf(inMonth))) { this.leftOut.push(date); return; }
      this.entries.push({ page, date });
    });
  }
}

/** The first date of repeat `k` of a section whose first repeat is on `base`. */
function anchorOf(move: Move, base: string, k: number): string {
  return move === 'day' ? addDays(base, k) : move === 'week' ? addDays(base, 7 * k) : move === 'month' ? addMonths(base, k) : base;
}

/** Run a step that is not a fill. Returns what it placed. */
function runStep(layout: Layout, step: Step, month: string): StepResult {
  const before = layout.entries.length, gapsBefore = layout.gaps.length;
  let repeats = 0;
  const r = step.repeat;
  if (r.kind === 'weeks') {
    const m = r.month ?? month, first = `${m}-01`, last = lastDayOf(m);
    // The week containing the 1st starts on the section's weekday on or before it; each repeat is a week later.
    const start = addDays(first, -((dayOfWeek(first) - step.section.weekday + 7) % 7));
    for (let base = start; base <= last; base = addDays(base, 7)) { layout.place(step.section, base, r.only_in_month ? m : null); repeats++; }
  } else if (r.kind === 'times') {
    const base = step.start ?? `${month}-01`;
    for (let k = 0; k < r.count; k++) { layout.place(step.section, anchorOf(step.section.move, base, k), null); repeats++; }
  }
  return { pages: layout.entries.length - before - (layout.gaps.length - gapsBefore), repeats };
}

/** Lay out the steps of a recipe in a book of `count` pages. */
export function planSteps(recipe: Recipe, count: number): BuildPlan {
  const gap = recipe.gap ?? notesPage();
  const steps = recipe.steps;
  const fillAt = steps.findIndex((s) => s.repeat.kind === 'fill');
  const results: StepResult[] = steps.map(() => ({ pages: 0, repeats: 0 }));
  const head = new Layout(gap);
  for (let i = 0; i < (fillAt < 0 ? steps.length : fillAt); i++) results[i] = runStep(head, steps[i], recipe.month);

  const blank = (): Entry => ({ page: null, date: null });
  /** The plan for these entries: `middle` of them are blank pages between the fill and the tail, and a book not yet full ends in blanks. */
  const finish = (entries: Entry[], middle: number, layouts: Layout[], trailing: number[] = []): BuildPlan => {
    const placed = entries.length - middle;
    return {
      entries: entries.length < count ? [...entries, ...Array.from({ length: count - entries.length }, blank)] : entries,
      steps: results, leftOut: layouts.flatMap((l) => l.leftOut),
      gaps: [...layouts.flatMap((l) => l.gaps), ...trailing].filter((n) => n <= count).sort((x, y) => x - y),
      used: placed, left: Math.max(0, count - placed), problem: placed > count ? tooMany(placed, count) : null, recipe, gapName: gap.name,
    };
  };

  if (fillAt < 0) return finish(head.entries, 0, [head]);

  // The steps after the fill sit on the last pages of the book. The tail begins on the latest slot where all of it fits.
  const tailSteps = steps.slice(fillAt + 1);
  const headLen = head.entries.length;
  let tail: Layout | null = null, tailStart = count + 1;
  if (tailSteps.length) {
    const lay = (from: number) => {
      const l = new Layout(gap, from - 1);
      tailSteps.forEach((s, i) => { results[fillAt + 1 + i] = runStep(l, s, recipe.month); });
      return l;
    };
    for (let s = count; s > headLen; s--) {
      const l = lay(s);
      if (s + l.entries.length - 1 <= count) { tail = l; tailStart = s; break; }
    }
    if (!tail) { tail = lay(headLen + 1); tailStart = headLen + 1; }
  }
  // Filler runs from the head to where the tail begins.
  const fill = steps[fillAt];
  let repeats = 0;
  const space0 = tailStart - 1 - headLen;
  if (space0 > 0) {
    head.align(fill.section.left);
    const length = fill.section.pages.length, space = Math.max(0, tailStart - head.slot);
    const base = fill.start ?? `${recipe.month}-01`;
    for (let k = 0; k < Math.floor(space / length); k++) { head.place(fill.section, anchorOf(fill.section.move, base, k), null); repeats++; }
    head.entries.length = Math.min(head.entries.length, tailStart - 1); // a gap that left no room for the fill isn't kept
    head.gaps = head.gaps.filter((n) => n < tailStart);
  }
  results[fillAt] = { pages: repeats * fill.section.pages.length, repeats };

  const tailEntries = tail?.entries ?? [];
  // Pages after the tail up to the end of the book are gap pages.
  const after = tail ? Math.max(0, count - (tailStart + tailEntries.length - 1)) : 0;
  const trailing = Array.from({ length: after }, (_, i) => tailStart + tailEntries.length + i);
  const middle = Math.max(0, tailStart - 1 - head.entries.length);
  const entries = [...head.entries, ...Array.from({ length: middle }, blank), ...tailEntries, ...trailing.map((): Entry => ({ page: gap, date: null }))];
  return finish(entries, middle, [head, ...(tail ? [tail] : [])], trailing);
}

const tooMany = (placed: number, count: number) =>
  `The steps need ${placed} pages but the book has ${count}: ${placed - count} too many. Remove a step, repeat less, or make the book longer in Settings.`;

/** Runs of consecutive dates in words: "Nov 29–30, Jan 1–2". */
function dateRuns(dates: string[]): string {
  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs[runs.length - 1];
    if (run && addDays(run[run.length - 1], 1) === d) run.push(d); else runs.push([d]);
  }
  return runs.map((r) => (r.length === 1 ? shortDate(r[0]) : `${shortDate(r[0])}–${parts(r[r.length - 1]).day}`)).join(', ');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const monthName = (month: string) => shortDate(`${month}-01`).split(' ')[0];

/** "38 of 52 used, 14 left": how full the book is. */
export function usageLine(plan: BuildPlan, count: number): string {
  return plan.used > count ? `${plan.used} of ${count} used: ${plan.used - count} too many` : `${plan.used} of ${count} used, ${plan.left} left`;
}

/** What one step adds, in words: "Week × 5 weeks of Nov: 46 pages". */
export function stepLine(step: Step, result: StepResult, month: string): string {
  const r = step.repeat;
  const times = r.kind === 'weeks' ? `${plural(result.repeats, 'week')} of ${monthName(r.month ?? month)}` : r.kind === 'times' ? `× ${r.count}` : `${plural(result.repeats, 'repeat')}`;
  return `${step.section.name}, ${times}: ${plural(result.pages, 'page')}`;
}

/** What a plan will do, in sentences, for the window to show before anything changes. */
export function buildSummary(plan: BuildPlan, count: number): string[] {
  const lines = [usageLine(plan, count)];
  if (plan.problem) lines.push(plan.problem);
  if (plan.leftOut.length) lines.push(`Left out, because they fall outside the month: ${plural(plan.leftOut.length, 'daily page')} (${dateRuns(plan.leftOut)}).`);
  if (plan.gaps.length) lines.push(`Added a gap page (${plan.gapName}) on ${listPages(plan.gaps)}, so spreads stay on the right sides.`);
  return lines;
}

/** Put a plan in the book: every page, its date and the recipe. Returns the pages whose page number had to be turned off. Call it inside an undo step. */
export function applyBuild(book: Book, plan: BuildPlan): number[] {
  if (plan.problem) throw new Error(plan.problem);
  const off: number[] = [];
  for (let n = 1; n <= book.page_count; n++) if (setSlot(book, n, plan.entries[n - 1]?.page ?? null)) off.push(n);
  delete book.dates;
  setDates(book, 1, Array.from({ length: book.page_count }, (_, i) => plan.entries[i]?.date ?? null));
  book.recipe = structuredClone(plan.recipe);
  return off;
}


