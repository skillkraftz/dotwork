import { describe, expect, it } from 'vitest';
import { emptyPage } from '../src/format/types';
import { emptySpread } from '../src/format/spread';
import { emptyBook } from '../src/book/book';
import { Favorites } from '../src/library/favorites';
import { artId, exampleId, nameMatches, visibleEntries, widgetId, type Entry } from '../src/library/browse';

const page = (name: string) => ({ ...emptyPage(), name });
const entries: Entry[] = [
  { kind: 'page', id: 'p1', name: 'Weekly plan', updated: '2026-01-02T00:00:00Z', example: false, data: page('Weekly plan') },
  { kind: 'page', id: exampleId(page('Monthly tracker')), name: 'Monthly tracker', updated: null, example: true, data: page('Monthly tracker') },
  { kind: 'spread', id: 's1', name: 'Week spread', updated: '2026-01-03T00:00:00Z', example: false, data: emptySpread() },
  { kind: 'book', id: 'b1', name: 'Field notes', updated: '2026-01-04T00:00:00Z', example: false, data: emptyBook() },
  { kind: 'widget', id: widgetId({ id: 'w1', name: 'Notes box', elements: [] }), name: 'Notes box', updated: null, example: false, data: { id: 'w1', name: 'Notes box', elements: [] } },
  { kind: 'art', id: artId({ id: 'a1', name: 'Gauge', elements: [] }), name: 'Gauge', updated: null, example: false, data: { id: 'a1', name: 'Gauge', elements: [] } },
];
const names = (tab: Parameters<typeof visibleEntries>[1], query = '', stars: string[] = []) =>
  visibleEntries(entries, tab, query, (id) => stars.includes(id)).map((e) => e.name);

describe('library search', () => {
  it('matches every word typed, in any order, ignoring case', () => {
    expect(nameMatches('Monthly tracker', 'TRACKER month')).toBe(true);
    expect(nameMatches('Monthly tracker', 'week')).toBe(false);
    expect(nameMatches('Monthly tracker', '   ')).toBe(true); // nothing typed matches everything
  });
});

describe('library tabs', () => {
  it('lists each kind under its own tab, with the examples among the pages', () => {
    expect(names('pages')).toEqual(['Weekly plan', 'Monthly tracker']);
    expect(names('spreads')).toEqual(['Week spread']);
    expect(names('books')).toEqual(['Field notes']);
    expect(names('widgets')).toEqual(['Notes box']);
    expect(names('art')).toEqual(['Gauge']);
  });

  it('searches within the tab, and Favorites lists only what is starred, of any kind', () => {
    expect(names('pages', 'month')).toEqual(['Monthly tracker']);
    expect(names('spreads', 'month')).toEqual([]);
    expect(names('favorites')).toEqual([]);
    expect(names('favorites', '', ['s1', 'w1'].map((id) => (id === 'w1' ? 'widget:w1' : id)))).toEqual(['Week spread', 'Notes box']);
    expect(names('favorites', 'box', ['s1', 'widget:w1'])).toEqual(['Notes box']);
  });
});

describe('favorites', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('stars and unstars, and is kept in storage', () => {
    const storage = memory();
    const f = new Favorites(storage);
    expect(f.has('a')).toBe(false);
    expect(f.toggle('a')).toBe(true);
    expect(f.has('a')).toBe(true);
    expect(new Favorites(storage).has('a')).toBe(true); // a later visit
    expect(f.toggle('a')).toBe(false);
    expect(new Favorites(storage).has('a')).toBe(false);
  });

  it('copes with storage that is missing, broken or full', () => {
    expect(new Favorites(null).toggle('a')).toBe(true);
    expect(new Favorites({ getItem: () => '{not json', setItem: () => {} }).has('a')).toBe(false);
    expect(new Favorites({ getItem: () => '[1,"b"]', setItem: () => {} }).has('b')).toBe(true);
    const full = new Favorites({ getItem: () => null, setItem: () => { throw new Error('full'); } });
    expect(full.toggle('a')).toBe(true);
    expect(full.has('a')).toBe(true);
  });
});
