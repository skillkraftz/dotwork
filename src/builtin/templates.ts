import { emptyBook, resizeBook, setCover, type Book } from '../book/book';
import { fillRepeat, freeBlock, groupBlock, pageBlock, spreadBlock, type Block, type DateKind, type PageBlock } from '../book/outline';
import { calendarFor, spansOf, type Calendar } from '../format/calendar';
import { addDays, weekStart } from '../format/dates';
import { buildSpread } from '../format/spread';
import type { Page } from '../format/types';
import { MONTH_NAMES } from './calendar';
import { BOOK_PAGES, monthlyLayout } from './layout';
import { BUILTIN_NOTICES, findBuiltinPage, missingPages } from './library';
import { monthlyPageIndex, monthlyTracker, notesPage, patternsPage, plainIndex, purposeCover, questionsPage, weeklyPage, weeklyReflection, yearGoals, yearIndex } from './pages';

/** A question a template asks: a whole number in a range. */
export interface TemplateField { key: string; label: string; min: number; max: number; value: number; hint?: (value: number) => string }

export interface BookTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
  /** The pages from examples/pages the book is made with; one that has been taken out is replaced by a notes page. */
  uses: readonly string[];
  /** Builds a complete 52-page book (an outline) from the answers (a missing answer takes the field's default). */
  build(answers?: Record<string, number>): Book;
}

/** A page from examples/pages, or the notes page if it has been taken out of the package. */
const example = (name: string): Page => findBuiltinPage(name) ?? notesPage();

/** A book from an outline, with its two covers. */
function assemble(name: string, outline: Block[], front: Page, back: Page, calendar?: Calendar): Book {
  const book = emptyBook(BOOK_PAGES);
  book.name = name;
  book.outline = outline;
  if (calendar) book.calendar = calendar;
  setCover(book, 0, front);
  setCover(book, BOOK_PAGES + 1, back);
  return book;
}

/** Idea pages (an idea page on the left, a dot grid on the right) as spreads, as many as fit. */
const ideaSpreads = (): Block => {
  const s = buildSpread('Idea spread', example('Idea page'), example('Dot grid page'));
  return { ...spreadBlock(s.name, s.left, s.right), repeat: fillRepeat() };
};

/** A page of a page type (it reads the next day, week or month; a review reads the week or month of the day pages before it), once. */
const typed = (page: Page, dates: DateKind): PageBlock => ({ ...pageBlock(page), dates });
/** Daily pages up to the end of each week: the first and last week are partial, so they make fewer. */
const dailyWeek = (page: Page): PageBlock => ({ ...typed(page, 'day'), repeat: { to: 'week' } });
/** One group repeat for each week of the calendar. */
const weekGroup = (cal: Calendar, children: PageBlock[]): Block => groupBlock('Weeks', children, spansOf(cal, 'week').length);

/** Notes pages pinned to the last pages of the book. */
const closingNotes = (n: number): Block => ({ ...pageBlock(notesPage(), n), pin: 'last' });

/** The pages from examples/pages that books are made with. */
const IDEAS = ['Idea page', 'Dot grid page'] as const;
const DAILY_BOOK = ['Daily Log', ...IDEAS] as const;

const YEAR: TemplateField = { key: 'year', label: 'Year', min: 2000, max: 2100, value: new Date().getFullYear() };

const monthlyJournal: BookTemplate = {
  id: 'monthly-journal',
  name: 'Monthly journal',
  description: 'One month of daily Good Time Journal pages with a reflection after each week, then patterns, questions, idea spreads to fill the book, and notes at the end. The tracker cover and the page index are filled in for the month. The book has the month as its calendar, so every page prints its day, week or month.',
  uses: DAILY_BOOK,
  fields: [YEAR, { key: 'month', label: 'Month', min: 1, max: 12, value: new Date().getMonth() + 1, hint: (v) => MONTH_NAMES[v - 1] ?? '' }],
  build(a = {}) {
    const year = a.year ?? YEAR.value, month = a.month ?? 1;
    const layout = monthlyLayout(year, month);
    // Each week of the month: a daily page for each day of it inside the month, then the week's reflection (a Week review). The month's pages after them are Month reviews: they read the month of the last day.
    const calendar = calendarFor(year, month);
    const weeks = weekGroup(calendar, [dailyWeek(example('Daily Log')), typed(weeklyReflection(), 'week-review')]);
    const outline: Block[] = [weeks, typed(patternsPage(), 'month-review'), typed(questionsPage(), 'month-review'), ideaSpreads(), closingNotes(3)];
    return assemble(`${MONTH_NAMES[month - 1]} ${year} journal`, outline, monthlyTracker(year, month), monthlyPageIndex(layout.map((s) => s.note ?? null)), calendar);
  },
};

const monthlyLog: BookTemplate = {
  id: 'monthly-log',
  name: 'Monthly log',
  description: 'One month, week by week: the weekly page (its days outside the month print blank), a daily log for each day of the week inside the month, and the weekly reflection. Free pages take the rest of the book, and the month review is the last page. The book has the month as its calendar, so every page prints its day, week or month.',
  uses: DAILY_BOOK.slice(0, 1),
  fields: [YEAR, { key: 'month', label: 'Month', min: 1, max: 12, value: new Date().getMonth() + 1, hint: (v) => MONTH_NAMES[v - 1] ?? '' }],
  build(a = {}) {
    const year = a.year ?? YEAR.value, month = a.month ?? 1;
    const calendar = calendarFor(year, month);
    const weeks = weekGroup(calendar, [typed(weeklyPage('left', true), 'week'), dailyWeek(example('Daily Log')), typed(weeklyReflection(), 'week-review')]);
    const review: Block = { ...typed(patternsPage(), 'month-review'), pin: 'last' };
    return assemble(`${MONTH_NAMES[month - 1]} ${year} log`, [weeks, freeBlock(), review], purposeCover(), plainIndex(), calendar);
  },
};

const yearPlanner: BookTemplate = {
  id: 'year-planner',
  name: 'Year planner',
  description: 'The Weekly spread for each week you choose (a week on each page, the day strip on the outer edge of both), then idea spreads to fill the book. The year goals cover and the year index are made for that year. The book has a calendar from the first to the last week, and each weekly page prints its week. A whole year takes 56 pages: page 1 is a gap page, because the spreads start on a left page.',
  uses: IDEAS,
  fields: [
    YEAR,
    { key: 'first', label: 'First week', min: 1, max: 52, value: 1 },
    { key: 'last', label: 'Last week', min: 1, max: 52, value: 52 },
  ],
  build(a = {}) {
    const year = a.year ?? YEAR.value, first = a.first ?? 1, last = Math.max(first, a.last ?? 52);
    // The weeks you chose, kept inside the year so the calendar (and so the week numbers) are the year's.
    const jan1 = `${String(year).padStart(4, '0')}-01-01`, dec31 = `${String(year).padStart(4, '0')}-12-31`;
    const open = weekStart(year, first), close = addDays(weekStart(year, last), 6);
    const calendar: Calendar = { start: open > jan1 ? open : jan1, end: close < dec31 ? close : dec31, week_starts: 0 };
    // The Weekly spread (the day strip on the outer edge of both pages) is a Week page with each page its own date: the left page week k, the right page k+1.
    const weekly = buildSpread('Weekly spread', weeklyPage('left', true), weeklyPage('right', true));
    const spreads = Math.ceil(spansOf(calendar, 'week').length / 2);
    const outline: Block[] = [{ ...spreadBlock(weekly.name, weekly.left, weekly.right, spreads), dates: 'week', shared: false }, ideaSpreads()];
    const book = assemble(`${year} year planner`, outline, yearGoals(year), yearIndex(year), calendar);
    // Page 1 is a right page, so the spreads start on page 2 (page 1 is a gap page): a whole year of weeks needs more than 52 pages.
    resizeBook(book, Math.max(BOOK_PAGES, 1 + 2 * spreads));
    return book;
  },
};

/** A book with the purpose cover and the plain-book index. */
const plain = (id: string, name: string, description: string, uses: readonly string[], outline: () => Block[]): BookTemplate => ({
  id, name, description, uses, fields: [],
  build: () => assemble(name, outline(), purposeCover(), plainIndex()),
});
const fillWith = (page: Page | null): Block => ({ ...pageBlock(page), repeat: fillRepeat() });

export const TEMPLATES: readonly BookTemplate[] = [
  yearPlanner,
  monthlyJournal,
  monthlyLog,
  plain('blank-journal', 'Blank journal', 'Blank pages to the end of the book, with the purpose cover and the plain-book index.', [], () => [fillWith(null)]),
  plain('lined-journal', 'Lined journal', 'Lined pages to the end of the book, with the purpose cover and the plain-book index.', ['Lined page'], () => [fillWith(example('Lined page'))]),
  plain('dot-grid-journal', 'Dot grid journal', 'Dot grid pages to the end of the book, with the purpose cover and the plain-book index.', ['Dot grid page'], () => [fillWith(example('Dot grid page'))]),
  plain('idea-book', 'Idea book', 'Idea spreads throughout (an idea page facing a dot grid), a notes page at each end, with the purpose cover and the plain-book index.', IDEAS, () => [pageBlock(notesPage()), ideaSpreads(), closingNotes(1)]),
];

// A book made with a page that was taken out of examples/pages still builds, with a notes page there: the Library says so.
for (const t of TEMPLATES) {
  const gone = missingPages(t.uses);
  if (gone.length) BUILTIN_NOTICES.push({ tab: 'books', text: `“${t.name}” uses a notes page where ${gone.map((n) => `“${n}”`).join(' and ')} would go: ${gone.length > 1 ? "they aren't" : "it isn't"} in examples/pages.` });
}
