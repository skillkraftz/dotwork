import { describe, expect, it } from 'vitest';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';
import { buildSpread, emptySpread } from '../src/format/spread';
import { emptyPage, type Page } from '../src/format/types';
import { Favorites } from '../src/library/favorites';
import { restoreBackup } from '../src/library/backup';
import { DEFAULT_PRINT } from '../src/book/impose';

const restore = (lib: Library, file: unknown) => restoreBackup(lib, new Favorites(null), file, DEFAULT_PRINT);

function make() {
  let t = 0, n = 0;
  const lib = new Library(new MemoryBackend(), () => new Date(Date.UTC(2026, 9, 18, 12, 0, t++)), () => `id${n++}`);
  return lib;
}
const page = (name: string, x = 0): Page => ({ ...emptyPage(), name, elements: [{ type: 'box', x, y: 1, w: 2, h: 2 }] });

describe('Library', () => {
  it('saves pages and spreads under names and lists newest first', async () => {
    const lib = make();
    await lib.save('page', 'Daily', page('x'));
    await lib.save('spread', 'Ideas', emptySpread());
    const items = await lib.list();
    expect(items.map((i) => [i.kind, i.name])).toEqual([['spread', 'Ideas'], ['page', 'Daily']]);
    expect(items[1].data.name).toBe('Daily'); // the file's own name follows the library name
  });

  it('does not share objects with what it was given', async () => {
    const lib = make();
    const p = page('A');
    const item = await lib.save('page', 'A', p);
    p.elements.length = 0;
    expect((await lib.get(item.id))!.data).toMatchObject({ elements: [{ type: 'box' }] });
  });

  it('saving under an existing name of the same kind replaces it', async () => {
    const lib = make();
    const first = await lib.save('page', 'Daily', page('x', 0));
    const second = await lib.save('page', ' Daily ', page('x', 5));
    expect(second.id).toBe(first.id);
    expect(await lib.list()).toHaveLength(1);
    await lib.save('spread', 'Daily', emptySpread()); // a spread may share a page's name
    expect(await lib.list()).toHaveLength(2);
  });

  it('renames, ignoring an empty name', async () => {
    const lib = make();
    const a = await lib.save('page', 'A', page('A'));
    await lib.rename(a.id, '  ');
    expect((await lib.get(a.id))!.name).toBe('A');
    await lib.rename(a.id, 'B');
    const got = (await lib.get(a.id))!;
    expect([got.name, got.data.name]).toEqual(['B', 'B']);
  });

  it('duplicates with a fresh id and a unique "copy" name', async () => {
    const lib = make();
    const a = await lib.save('page', 'A', page('A'));
    const c1 = (await lib.duplicate(a.id))!;
    const c2 = (await lib.duplicate(a.id))!;
    expect([c1.name, c2.name]).toEqual(['A copy', 'A copy 2']);
    expect(new Set([a.id, c1.id, c2.id]).size).toBe(3);
    expect(c1.data.name).toBe('A copy');
    expect(await lib.duplicate('nope')).toBeUndefined();
  });

  it('deletes', async () => {
    const lib = make();
    const a = await lib.save('page', 'A', page('A'));
    await lib.remove(a.id);
    expect(await lib.list()).toEqual([]);
  });

  it('saves a page from a spread and builds a spread from two saved pages', async () => {
    const lib = make();
    const s = buildSpread('S', page('L', 0), page('R', 3));
    const l = await lib.save('page', 'From left', s.left);
    const r = await lib.save('page', 'From right', s.right);
    expect((l.data as Page).side).toBe('left');
    const rebuilt = buildSpread('Rebuilt', r.data as Page, l.data as Page); // swapped sides on purpose
    expect(rebuilt.left.name).toBe('From right');
    expect(rebuilt.left.side).toBe('left');
    expect(rebuilt.right.side).toBe('right');
    expect((await lib.save('spread', 'Rebuilt', rebuilt)).kind).toBe('spread');
  });
});

describe('Library backup', () => {
  it('exports everything and imports it into an empty library', async () => {
    const a = make();
    await a.save('page', 'P', page('P'));
    await a.save('spread', 'S', emptySpread());
    const file = JSON.parse(JSON.stringify(await a.exportAll()));
    expect(file).toMatchObject({ format: 'dotwork-library', version: 1 });

    const b = make();
    expect(await restore(b, file)).toMatchObject({ ok: true, summary: { added: 2, skipped: 0, keptBoth: 0 } });
    expect(await b.list()).toEqual(await a.list());
  });

  it('restoring again skips what is already here instead of duplicating', async () => {
    const lib = make();
    await lib.save('page', 'P', page('P'));
    const file = JSON.parse(JSON.stringify(await lib.exportAll()));
    expect(await restore(lib, file)).toMatchObject({ ok: true, summary: { added: 0, skipped: 1, keptBoth: 0 } });
    expect(await lib.list()).toHaveLength(1);
  });

  it('refuses a bad item with the reason, and still restores the rest', async () => {
    const lib = make();
    await lib.save('page', 'Keep', page('Keep'));
    const good = JSON.parse(JSON.stringify(await make().exportAll()));
    const bad = {
      ...good,
      items: [
        { id: 'a', kind: 'page', name: 'Ok', updated: '2026-10-18T00:00:00Z', data: page('Ok') },
        { id: 'b', kind: 'page', name: 'Bad', updated: '2026-10-18T00:00:00Z', data: { ...page('Bad'), elements: [{ type: 'box', x: 0.2, y: 1, w: 2, h: 2 }] } },
      ],
    };
    const r = await restore(lib, bad);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.added).toBe(1);
      expect(r.summary.refused).toHaveLength(1);
      expect(r.summary.refused[0]).toMatchObject({ id: 'b', name: 'Bad', kind: 'page' });
      expect(r.summary.refused[0].reason).toContain('items[1].data.elements[0].x');
    }
    expect((await lib.list()).map((i) => i.name).sort()).toEqual(['Keep', 'Ok']);
  });

  it('checks the file itself, and refuses a bad item without refusing the file', () => {
    const rules = (v: unknown) => { const r = readLibraryFile(v); return r.ok ? [] : r.issues.map((i) => i.rule); };
    const refused = (v: unknown) => { const r = readLibraryFile(v); return r.ok ? r.refused.length : -1; };
    const item = { id: 'a', kind: 'page', name: 'N', updated: '2026-10-18T00:00:00Z', data: page('N') };
    const file = { format: 'dotwork-library', version: 1, exported: '', items: [item] };
    expect(rules(file)).toEqual([]);
    expect(rules({ ...file, format: 'x' })).toContain('format');
    expect(rules({ ...file, version: 2 })).toContain('version');
    expect(rules({ ...file, items: 3 })).toContain('items-array');
    expect(rules({ ...file, favorites: [1] })).toContain('favorites');
    expect(rules('nope')).toEqual(['root-object']);
    expect(refused({ ...file, items: [{ ...item, kind: 'notebook' }] })).toBe(1);
    expect(refused({ ...file, items: [item, item] })).toBe(1); // the second one with the same id
    expect(refused({ ...file, items: [{ ...item, updated: 'yesterday' }] })).toBe(1);
    expect(refused({ ...file, items: [{ ...item, kind: 'spread' }] })).toBe(1); // a page where a spread belongs
    expect(refused({ ...file, items: ['x'] })).toBe(1);
  });
});
