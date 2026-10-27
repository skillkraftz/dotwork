import { readPage } from '../format/read';
import { readSpread, type Spread } from '../format/spread';
import type { Page } from '../format/types';
import { monthlyLayout } from './layout';
import {
  blankPage, monthlyPageIndex, monthlyTracker, notesPage, patternsPage, plainIndex, purposeCover,
  questionsPage, weeklyPage, weeklyReflection, yearGoals, yearIndex,
} from './pages';
import { builtinWidgets } from './widgets';
import { builtinArt } from './art';
import { pageFiles, skipped, spreadFiles } from './examples';
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
  ...filePages(),
];

/** The built-in page of this name, if it is there: the pages from examples/pages can be taken out. */
export const findBuiltinPage = (name: string): Page | undefined => BUILTIN_PAGES.find((p) => p.name === name);

/** What the Library should say about built-ins that are not there or not as designed, because a page was taken out of examples/pages. */
export interface BuiltinNotice { tab: 'books'; text: string }
export const BUILTIN_NOTICES: BuiltinNotice[] = [];

/** The pages of this list that are not built in: the names of those taken out of examples/pages. */
export const missingPages = (names: readonly string[]): string[] => [...new Set(names)].filter((n) => !findBuiltinPage(n));

/** The spreads in examples/spreads, in file order; one that isn't a valid spread is skipped (the tests catch it). */
const fileSpreads = (files: Record<string, unknown> = spreadFiles): Spread[] => Object.entries(files).flatMap(([path, raw]) => {
  const r = readSpread(raw);
  if (r.ok) return [r.spread];
  skipped(path, r.issues[0].message);
  return [];
});

/** Every built-in spread. Their names are reserved: a saved spread can't take one. */
export const BUILTIN_SPREADS: readonly Spread[] = fileSpreads();

export const BUILTIN_WIDGETS = builtinWidgets();
export const BUILTIN_ART = builtinArt();

/** Whether a built-in page or spread has this name (the built-in sections are checked by `isBuiltinSection`, which needs this file). */
export const isBuiltinName = (kind: LibraryKind, name: string): boolean =>
  (kind === 'page' ? BUILTIN_PAGES : kind === 'spread' ? BUILTIN_SPREADS : []).some((d) => d.name === name.trim());

/** A built-in can't be changed, so opening or placing one gives an editable copy under its own name plus “copy”. */
export const asCopy = <T extends Page | Spread | Section>(design: T): T => ({ ...structuredClone(design), name: `${design.name} copy` });
