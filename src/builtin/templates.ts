import { emptyBook, setCover, type Book } from '../book/book';
import { fillRepeat, groupBlock, pageBlock, spreadBlock, type Block } from '../book/outline';
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
function assemble(name: string, outline: Block[], front: Page, back: Page): Book {
  const book = emptyBook(BOOK_PAGES);
  book.name = name;
  book.outline = outline;
  setCover(book, 0, front);
  setCover(book, BOOK_PAGES + 1, back);
  return book;
}

/** Idea pages (an idea page on the left, a dot grid on the right) as spreads, as many as fit. */
const ideaSpreads = (): Block => {
  const s = buildSpread('Idea spread', example('Idea page'), example('Dot grid page'));
  return { ...spreadBlock(s.name, s.left, s.right), repeat: fillRepeat() };
};

/** Notes pages pinned to the last pages of the book. */
const closingNotes = (n: number): Block => ({ ...pageBlock(notesPage(), n), pin: 'last' });

/** The pages from examples/pages that books are made with. */
const IDEAS = ['Idea page', 'Dot grid page'] as const;
const DAILY_BOOK = ['Daily Log', ...IDEAS] as const;

const YEAR: TemplateField = { key: 'year', label: 'Year', min: 2000, max: 2100, value: new Date().getFullYear() };

const monthlyJournal: BookTemplate = {
  id: 'monthly-journal',
  name: 'Monthly journal',
  description: 'One month of daily Good Time Journal pages with a reflection after each week, then patterns, questions, idea spreads to fill the book, and notes at the end. The tracker cover and the page index are filled in for the month. Dates print blank for now.',
  uses: DAILY_BOOK,
  fields: [YEAR, { key: 'month', label: 'Month', min: 1, max: 12, value: new Date().getMonth() + 1, hint: (v) => MONTH_NAMES[v - 1] ?? '' }],
  build(a = {}) {
    const year = a.year ?? YEAR.value, month = a.month ?? 1;
    const layout = monthlyLayout(year, month);
    const outline: Block[] = [];
    let days = 0;
    const flush = () => { if (days) outline.push(pageBlock(example('Daily Log'), days)); days = 0; };
    for (const s of layout) {
      if (s.kind === 'daily') { days++; continue; }
      flush();
      if (s.kind === 'reflection') outline.push(pageBlock(weeklyReflection(s.identity)));
      else if (s.kind === 'patterns') outline.push(pageBlock(patternsPage(s.identity)));
      else if (s.kind === 'questions') outline.push(pageBlock(questionsPage(s.identity)));
      else break; // the idea spreads and notes are the rest of the book
    }
    flush();
    outline.push(ideaSpreads(), closingNotes(3));
    return assemble(`${MONTH_NAMES[month - 1]} ${year} journal`, outline, monthlyTracker(year, month), monthlyPageIndex(layout.map((s) => s.note ?? null)));
  },
};

const yearPlanner: BookTemplate = {
  id: 'year-planner',
  name: 'Year planner',
  description: 'A weekly page for each week you choose, then idea spreads to fill the book. The year goals cover and the year index are made for that year. Dates print blank for now.',
  uses: IDEAS,
  fields: [
    YEAR,
    { key: 'first', label: 'First week', min: 1, max: 52, value: 1 },
    { key: 'last', label: 'Last week', min: 1, max: 52, value: 52 },
  ],
  build(a = {}) {
    const year = a.year ?? YEAR.value, first = a.first ?? 1;
    const weeks = Math.max(first, a.last ?? 52) - first + 1;
    // Page 1 is a right page, so the weeks go in pairs (right, left) with the day column on the outer edge of each.
    const outline: Block[] = [];
    if (weeks >= 2) outline.push(groupBlock('Weeks', [pageBlock(weeklyPage('right', true)), pageBlock(weeklyPage('left', true))], Math.floor(weeks / 2)));
    if (weeks % 2) outline.push(pageBlock(weeklyPage('right', true)));
    outline.push(ideaSpreads());
    return assemble(`${year} year planner`, outline, yearGoals(year), yearIndex(year));
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
