import type { Page } from '../format/types';
import { usesDates } from '../format/tokens';
import type { Move, Section, Step } from '../book/sections';
import { findBuiltinPage } from './library';
import { notesPage, patternsPage, weeklyPage, weeklyReflection } from './pages';

// Sections that come with Dotwork, and the "Weekly journal" preset of book builder steps made from them.

/** A page from examples/pages, or the notes page if it has been taken out of the package. */
const example = (name: string): Page => findBuiltinPage(name) ?? notesPage();

/** A built-in section: each page that prints a date is dated the section's first day, unless `days` says otherwise. */
const section = (name: string, pages: Page[], move: Move, left: boolean, days?: (number | null)[]): Section => ({
  format: 'dotwork-section', version: 1, name, pages, move, left, weekday: 0,
  days: days ?? pages.map((p) => (usesDates(p) ? 0 : null)),
});

const daily = () => example('Daily Log');

/** A week of the Good Time journal: the weekly page, a daily page for each day Sunday to Saturday, a reflection, notes. Ten pages from a right-hand page. */
const WEEK = section('Journal week', [weeklyPage('right', true), ...Array.from({ length: 7 }, daily), weeklyReflection(), notesPage()], 'week', false,
  [0, 0, 1, 2, 3, 4, 5, 6, 0, null]);
const MONTH_END = section('Month-end review', [weeklyReflection(), patternsPage()], 'none', true);
const IDEAS = section('Idea spread', [example('Idea page'), example('Dot grid page')], 'none', true);
const BOOK_NOTES = section('Book notes', [example('Book notes')], 'none', true);

export const BUILTIN_SECTIONS: readonly Section[] = [WEEK, MONTH_END, IDEAS, BOOK_NOTES];

/** Whether a built-in section has this name: a saved section can't take it. */
export const isBuiltinSection = (name: string) => BUILTIN_SECTIONS.some((s) => s.name === name.trim());

export interface Preset { id: string; name: string; description: string; steps: Step[] }

/** What "Build by week" used to be: the week section for each week of the month, then the month-end pages, idea spreads to fill, and the book notes. */
export const PRESETS: readonly Preset[] = [{
  id: 'weekly-journal',
  name: 'Weekly journal',
  description: 'The journal week for each week of the month, then the month-end review, idea spreads to fill the book, and the book notes.',
  steps: [
    { section: WEEK, repeat: { kind: 'weeks', only_in_month: true } },
    { section: MONTH_END, repeat: { kind: 'times', count: 1 } },
    { section: IDEAS, repeat: { kind: 'fill' } },
    { section: BOOK_NOTES, repeat: { kind: 'times', count: 1 } },
  ],
}];

/** A built-in section by name. */
export const findBuiltinSection = (name: string): Section | undefined => BUILTIN_SECTIONS.find((s) => s.name === name);
