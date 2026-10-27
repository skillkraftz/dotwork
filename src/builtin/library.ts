import { readPage } from '../format/read';
import { buildSpread, type Spread } from '../format/spread';
import type { Page } from '../format/types';
import { monthlyLayout } from './layout';
import {
  blankPage, bookNotesPage, bookNotesSetup, monthlyPageIndex, monthlyTracker, notesPage, patternsPage, plainIndex, purposeCover,
  questionsPage, weeklyPage, weeklyReflection, yearGoals, yearIndex,
} from './pages';
import { builtinWidgets } from './widgets';
import { builtinArt } from './art';
import { pageFiles, skipped } from './examples';
import type { Section } from '../book/sections';
import type { LibraryKind } from '../library/library';

// The pages, spreads and widgets that come with Dotwork: every page of the owner's books, as closely as the format allows.

/** The pages in examples/pages, in file order; one that isn't a valid page is skipped (the tests catch it). */
const filePages = (files: Record<string, unknown> = pageFiles): Page[] => Object.entries(files).flatMap(([path, raw]) => {
  const r = readPage(raw);
  if (r.ok) return [r.page];
  skipped(path, r.issues[0].message);
  return [];
});

/** The year and month the built-in samples are drawn for (the sample date of the editor). */
const SAMPLE = { year: 2026, month: 10 };

/** Every built-in page. Their names are reserved: a saved page can't take one. */
export const BUILTIN_PAGES: readonly Page[] = [
  monthlyTracker(SAMPLE.year, SAMPLE.month),
  weeklyReflection(),
  patternsPage(),
  questionsPage(),
  blankPage(),
  notesPage(),
  weeklyPage('right', false),
  weeklyPage('right', true),
  yearGoals(SAMPLE.year),
  yearIndex(SAMPLE.year),
  monthlyPageIndex(monthlyLayout(SAMPLE.year, SAMPLE.month).map((s) => s.note ?? null)),
  purposeCover(),
  plainIndex(),
  bookNotesSetup(),
  bookNotesPage(),
  ...filePages(),
];

/** The built-in page of this name, if it is there: the pages from examples/pages can be taken out. */
export const findBuiltinPage = (name: string): Page | undefined => BUILTIN_PAGES.find((p) => p.name === name);

const quoteList = (names: string[]) => names.map((n) => `“${n}”`).join(' and ');

/** What the Library should say about built-ins that are not there or not as designed, because a page was taken out of examples/pages. */
export interface BuiltinNotice { tab: 'spreads' | 'books'; text: string }
export const BUILTIN_NOTICES: BuiltinNotice[] = [];

/** The pages of this list that are not built in: the names of those taken out of examples/pages. */
export const missingPages = (names: readonly string[]): string[] => [...new Set(names)].filter((n) => !findBuiltinPage(n));

/** A spread of two built-in pages; none when either was taken out of examples/pages, and the Library says so. */
const spread = (name: string, left: string, right: string): Spread[] => {
  const [l, r] = [findBuiltinPage(left), findBuiltinPage(right)];
  if (!l || !r) BUILTIN_NOTICES.push({ tab: 'spreads', text: `“${name}” is left out: ${quoteList(missingPages([left, right]))} isn't in examples/pages.` });
  return l && r ? [buildSpread(name, l, r)] : [];
};

/** Pages that pair naturally, and the cover spread of each book. */
export const BUILTIN_SPREADS: readonly Spread[] = [
  ...spread('Lined spread', 'Lined page', 'Lined page'),
  ...spread('Dot grid spread', 'Dot grid page', 'Dot grid page'),
  ...spread('Notes spread', 'Notes', 'Notes'),
  ...spread('Ideas spread', 'Idea page', 'Dot grid page'),
  ...spread('Book notes spread', 'Book notes setup', 'Book notes'),
  // A mirror: on each page the GOAL / day column / OUTCOME strip is on the outer edge and the lines run to the spine.
  buildSpread('Weekly spread', weeklyPage('left', true), weeklyPage('right', true)),
  buildSpread('Weekly spread (undated)', weeklyPage('left', false), weeklyPage('right', false)),
  ...spread('Year planner covers', 'Year goals cover', 'Year index'),
  ...spread('Monthly journal covers', 'Monthly tracker', 'Monthly page index'),
  ...spread('Plain-book covers', 'Plain-book purpose cover', 'Plain-book index'),
];

export const BUILTIN_WIDGETS = builtinWidgets();
export const BUILTIN_ART = builtinArt();

/** Whether a built-in page or spread has this name (the built-in sections are checked by `isBuiltinSection`, which needs this file). */
export const isBuiltinName = (kind: LibraryKind, name: string): boolean =>
  (kind === 'page' ? BUILTIN_PAGES : kind === 'spread' ? BUILTIN_SPREADS : []).some((d) => d.name === name.trim());

/** A built-in can't be changed, so opening or placing one gives an editable copy under its own name plus “copy”. */
export const asCopy = <T extends Page | Spread | Section>(design: T): T => ({ ...structuredClone(design), name: `${design.name} copy` });
