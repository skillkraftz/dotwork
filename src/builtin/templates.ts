import { emptyBook, setDates, setSlot, type Book } from '../book/book';
import type { Page } from '../format/types';
import { MONTH_NAMES } from './calendar';
import { BOOK_PAGES, ideaBookLayout, monthlyLayout, yearLayout, type Slot } from './layout';
import { builtinPage } from './library';
import { monthlyPageIndex, monthlyTracker, notesPage, patternsPage, plainIndex, purposeCover, questionsPage, weeklyPage, weeklyReflection, yearGoals, yearIndex, blankPage } from './pages';

/** A question a template asks: a whole number in a range. */
export interface TemplateField { key: string; label: string; min: number; max: number; value: number; hint?: (value: number) => string }

export interface BookTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
  /** Builds a complete 52-page book from the answers (a missing answer takes the field's default). */
  build(answers?: Record<string, number>): Book;
}

/** The design for a slot of a layout. */
function designFor(s: Slot, slotNumber: number): Page {
  switch (s.kind) {
    case 'daily': return builtinPage('Daily Good Time Journal');
    case 'reflection': return weeklyReflection(s.identity);
    case 'patterns': return patternsPage(s.identity);
    case 'questions': return questionsPage(s.identity);
    case 'idea': return builtinPage('Idea page');
    case 'dots': return builtinPage('Dot grid page');
    case 'notes': return notesPage();
    case 'weekly': return weeklyPage(slotNumber % 2 ? 'right' : 'left', true); // the day column stays on the outer edge
  }
}

/** A 52-page book from a layout, with its two covers. */
function assemble(name: string, layout: Slot[], front: Page, back: Page, page: (s: Slot, n: number) => Page = designFor): Book {
  if (layout.length !== BOOK_PAGES) throw new Error(`${name}: ${layout.length} pages, not ${BOOK_PAGES}.`);
  const book = emptyBook(BOOK_PAGES);
  book.name = name;
  layout.forEach((s, i) => setSlot(book, i + 1, page(s, i + 1)));
  setDates(book, 1, layout.map((s) => s.date ?? null));
  setSlot(book, 0, front);
  setSlot(book, BOOK_PAGES + 1, back);
  return book;
}

const YEAR: TemplateField = { key: 'year', label: 'Year', min: 2000, max: 2100, value: new Date().getFullYear() };

const monthlyJournal: BookTemplate = {
  id: 'monthly-journal',
  name: 'Monthly journal',
  description: 'One month of daily Good Time Journal pages with a reflection after each week, then patterns, questions, idea spreads and notes. The tracker cover and the page index are filled in for the month.',
  fields: [YEAR, { key: 'month', label: 'Month', min: 1, max: 12, value: new Date().getMonth() + 1, hint: (v) => MONTH_NAMES[v - 1] ?? '' }],
  build(a = {}) {
    const year = a.year ?? YEAR.value, month = a.month ?? 1;
    const layout = monthlyLayout(year, month);
    return assemble(`${MONTH_NAMES[month - 1]} ${year} journal`, layout, monthlyTracker(year, month), monthlyPageIndex(layout.map((s) => s.note ?? null)));
  },
};

const yearPlanner: BookTemplate = {
  id: 'year-planner',
  name: 'Year planner',
  description: 'A dated weekly page for each week you choose, then idea spreads. The year goals cover and the year index are made for that year.',
  fields: [
    YEAR,
    { key: 'first', label: 'First week', min: 1, max: 52, value: 1 },
    { key: 'last', label: 'Last week', min: 1, max: 52, value: 52 },
  ],
  build(a = {}) {
    const year = a.year ?? YEAR.value, first = a.first ?? 1;
    const last = Math.max(first, a.last ?? 52);
    return assemble(`${year} year planner`, yearLayout(year, first, last), yearGoals(year), yearIndex(year));
  },
};

/** A book with the purpose cover and the plain-book index. */
const plain = (id: string, name: string, description: string, layout: () => Slot[], page?: (s: Slot) => Page): BookTemplate => ({
  id, name, description, fields: [],
  build: () => assemble(name, layout(), purposeCover(), plainIndex(), page),
});
const all = (kind: Slot['kind']) => (): Slot[] => Array.from({ length: BOOK_PAGES }, () => ({ kind }));

export const TEMPLATES: readonly BookTemplate[] = [
  yearPlanner,
  monthlyJournal,
  plain('blank-journal', 'Blank journal', '52 blank pages, with the purpose cover and the plain-book index.', all('notes'), () => blankPage()),
  plain('lined-journal', 'Lined journal', '52 lined pages, with the purpose cover and the plain-book index.', all('notes'), () => builtinPage('Lined page')),
  plain('dot-grid-journal', 'Dot grid journal', '52 dot grid pages, with the purpose cover and the plain-book index.', all('dots')),
  plain('idea-book', 'Idea book', 'Idea spreads throughout (an idea page facing a dot grid), with the purpose cover and the plain-book index.', ideaBookLayout),
];
