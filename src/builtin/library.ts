import { readPage } from '../format/read';
import { buildSpread, type Spread } from '../format/spread';
import type { Page } from '../format/types';
import daily from '../../examples/daily-good-time.json';
import dots from '../../examples/dot-grid-page.json';
import idea from '../../examples/idea-page.json';
import lined from '../../examples/lined-page.json';
import shade from '../../examples/shade-and-lines.json';
import { monthlyLayout } from './layout';
import {
  blankPage, bookNotesPage, bookNotesSetup, monthlyPageIndex, monthlyTracker, notesPage, patternsPage, plainIndex, purposeCover,
  questionsPage, weeklyPage, weeklyReflection, yearGoals, yearIndex,
} from './pages';
import { builtinWidgets } from './widgets';

// The pages, spreads and widgets that come with Dotwork: every page of the owner's books, as closely as the format allows.

const fromJson = (raw: unknown): Page => {
  const r = readPage(raw);
  if (!r.ok) throw new Error(`A built-in page is invalid: ${r.issues[0].message}`);
  return r.page;
};

/** The year and month the built-in samples are drawn for (the sample date of the editor). */
const SAMPLE = { year: 2026, month: 10 };

/** Every built-in page. Their names are reserved: a saved page can't take one. */
export const BUILTIN_PAGES: readonly Page[] = [
  monthlyTracker(SAMPLE.year, SAMPLE.month),
  fromJson(daily),
  weeklyReflection(),
  patternsPage(),
  questionsPage(),
  fromJson(idea),
  fromJson(lined),
  fromJson(dots),
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
  fromJson(shade),
];

export function builtinPage(name: string): Page {
  const page = BUILTIN_PAGES.find((p) => p.name === name);
  if (!page) throw new Error(`There is no built-in page called “${name}”.`);
  return page;
}

const spread = (name: string, left: string, right: string) => buildSpread(name, builtinPage(left), builtinPage(right));

/** Pages that pair naturally, and the cover spread of each book. */
export const BUILTIN_SPREADS: readonly Spread[] = [
  spread('Lined spread', 'Lined page', 'Lined page'),
  spread('Dot grid spread', 'Dot grid page', 'Dot grid page'),
  spread('Notes spread', 'Notes', 'Notes'),
  spread('Ideas spread', 'Idea page', 'Dot grid page'),
  spread('Book notes spread', 'Book notes setup', 'Book notes'),
  // A mirror: on each page the GOAL / day column / OUTCOME strip is on the outer edge and the lines run to the spine.
  buildSpread('Weekly spread', weeklyPage('left', true), weeklyPage('right', true)),
  buildSpread('Weekly spread (undated)', weeklyPage('left', false), weeklyPage('right', false)),
  spread('Year planner covers', 'Year goals cover', 'Year index'),
  spread('Monthly journal covers', 'Monthly tracker', 'Monthly page index'),
  spread('Plain-book covers', 'Plain-book purpose cover', 'Plain-book index'),
];

export const BUILTIN_WIDGETS = builtinWidgets();

/** Whether a built-in of this kind already has this name. */
export const isBuiltinName = (kind: 'page' | 'spread' | 'book', name: string): boolean =>
  (kind === 'page' ? BUILTIN_PAGES : kind === 'spread' ? BUILTIN_SPREADS : []).some((d) => d.name === name.trim());

/** A built-in can't be changed, so opening or placing one gives an editable copy under its own name plus “copy”. */
export const asCopy = <T extends Page | Spread>(design: T): T => ({ ...structuredClone(design), name: `${design.name} copy` });
