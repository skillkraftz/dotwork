import type { Page } from '../format/types';
import type { Spread } from '../format/spread';
import type { Book } from '../book/book';
import type { Widget } from '../widgets';
import type { BookTemplate } from '../builtin/templates';

export type EntryKind = 'page' | 'spread' | 'book' | 'widget' | 'art' | 'template';
export const TABS = ['pages', 'spreads', 'art', 'books', 'widgets', 'favorites'] as const;
export type LibraryTab = (typeof TABS)[number];
export const TAB_LABEL: Record<LibraryTab, string> = { pages: 'Pages', spreads: 'Spreads', art: 'Art', books: 'Books', widgets: 'Widgets', favorites: 'Favorites' };

/**
 * One thing the library browser lists: something saved, or a built-in example (which can be opened or copied but never
 * changed). A template is a built-in that asks a few questions and builds a book.
 */
export type Entry =
  | { kind: 'page'; id: string; name: string; updated: string | null; example: boolean; data: Page }
  | { kind: 'spread'; id: string; name: string; updated: string | null; example: boolean; data: Spread }
  | { kind: 'book'; id: string; name: string; updated: string | null; example: boolean; data: Book }
  | { kind: 'widget'; id: string; name: string; updated: null; example: boolean; data: Widget }
  /** Saved art is a widget of one art element (see art/widget.ts). */
  | { kind: 'art'; id: string; name: string; updated: null; example: boolean; data: Widget }
  | { kind: 'template'; id: string; name: string; updated: null; example: true; data: BookTemplate };

/** Which kind each tab lists (Favorites lists any). */
const TAB_KINDS: Record<Exclude<LibraryTab, 'favorites'>, readonly EntryKind[]> = { pages: ['page'], spreads: ['spread'], art: ['art'], books: ['template', 'book'], widgets: ['widget'] };

/** The ids of built-in examples and widgets are prefixed, so that no saved item's id can clash with them. */
export const exampleId = (page: Page) => `example:${page.name}`;
export const widgetId = (w: Widget) => `widget:${w.id}`;
export const artId = (w: Widget) => `art:${w.id}`;
export const spreadId = (s: Spread) => `example:spread:${s.name}`;
export const templateId = (t: BookTemplate) => `template:${t.id}`;

/** A name matches a search when it contains every word typed, in any order, ignoring case. */
export function nameMatches(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = name.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** What a tab shows for a search: the tab's kind (or every starred entry), whose names match. */
export function visibleEntries(entries: readonly Entry[], tab: LibraryTab, query: string, isFavorite: (id: string) => boolean): Entry[] {
  return entries.filter((e) => (tab === 'favorites' ? isFavorite(e.id) : TAB_KINDS[tab].includes(e.kind)) && nameMatches(e.name, query));
}
