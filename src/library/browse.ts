import type { Page } from '../format/types';
import type { Spread } from '../format/spread';
import type { Book } from '../book/book';
import type { Widget } from '../widgets';

export type EntryKind = 'page' | 'spread' | 'book' | 'widget';
export const TABS = ['pages', 'spreads', 'books', 'widgets', 'favorites'] as const;
export type LibraryTab = (typeof TABS)[number];
export const TAB_LABEL: Record<LibraryTab, string> = { pages: 'Pages', spreads: 'Spreads', books: 'Books', widgets: 'Widgets', favorites: 'Favorites' };

/** One thing the library browser lists: something saved, a built-in example, or a saved widget. */
export type Entry =
  | { kind: 'page'; id: string; name: string; updated: string | null; example: boolean; data: Page }
  | { kind: 'spread'; id: string; name: string; updated: string | null; example: false; data: Spread }
  | { kind: 'book'; id: string; name: string; updated: string | null; example: false; data: Book }
  | { kind: 'widget'; id: string; name: string; updated: null; example: false; data: Widget };

/** Which kind each tab lists (Favorites lists any). */
const TAB_KIND: Record<Exclude<LibraryTab, 'favorites'>, EntryKind> = { pages: 'page', spreads: 'spread', books: 'book', widgets: 'widget' };

/** The ids of built-in examples and widgets are prefixed, so that no saved item's id can clash with them. */
export const exampleId = (page: Page) => `example:${page.name}`;
export const widgetId = (w: Widget) => `widget:${w.id}`;

/** A name matches a search when it contains every word typed, in any order, ignoring case. */
export function nameMatches(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = name.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** What a tab shows for a search: the tab's kind (or every starred entry), whose names match. */
export function visibleEntries(entries: readonly Entry[], tab: LibraryTab, query: string, isFavorite: (id: string) => boolean): Entry[] {
  return entries.filter((e) => (tab === 'favorites' ? isFavorite(e.id) : e.kind === TAB_KIND[tab]) && nameMatches(e.name, query));
}
