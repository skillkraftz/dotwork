import type { Page } from '../format/types';
import { buildSpread } from '../format/spread';
import type { Section } from '../book/sections';
import { pageBlock, spreadBlock, type Child } from '../book/outline';
import { findBuiltinPage } from './library';
import { notesPage, patternsPage, weeklyPage, weeklyReflection } from './pages';

// Sections that come with Dotwork. Each is a group: placed in a book it adds its blocks, which repeat together.

/** A page from examples/pages, or the notes page if it has been taken out of the package. */
const example = (name: string): Page => findBuiltinPage(name) ?? notesPage();

const section = (name: string, children: Child[]): Section => ({ format: 'dotwork-section', version: 1, name, children });

const ideaSpread = (): Child => {
  const s = buildSpread('Idea spread', example('Idea page'), example('Dot grid page'));
  return spreadBlock(s.name, s.left, s.right);
};

/** A week of the Good Time journal: the weekly page, a daily page for each day, a reflection, notes. */
const WEEK = section('Journal week', [pageBlock(weeklyPage('right', true)), pageBlock(example('Daily Log'), 7), pageBlock(weeklyReflection()), pageBlock(notesPage())]);
const MONTH_END = section('Month-end review', [pageBlock(weeklyReflection()), pageBlock(patternsPage())]);
const IDEAS = section('Idea spread', [ideaSpread()]);
const BOOK_NOTES = section('Book notes', [pageBlock(example('Book notes'))]);

export const BUILTIN_SECTIONS: readonly Section[] = [WEEK, MONTH_END, IDEAS, BOOK_NOTES];

/** Whether a built-in section has this name: a saved section can't take it. */
export const isBuiltinSection = (name: string) => BUILTIN_SECTIONS.some((s) => s.name === name.trim());
