import { describe, expect, it } from 'vitest';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';
import { buildSpread, emptySpread } from '../src/format/spread';
import { emptyPage, type Page } from '../src/format/types';

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
    expect(await b.importFile(file)).toEqual({ ok: true, added: 2, replaced: 0 });
    expect(await b.list()).toEqual(await a.list());
  });

  it('importing again replaces by id instead of duplicating', async () => {
    const lib = make();
    await lib.save('page', 'P', page('P'));
    const file = JSON.parse(JSON.stringify(await lib.exportAll()));
    expect(await lib.importFile(file)).toEqual({ ok: true, added: 0, replaced: 1 });
    expect(await lib.list()).toHaveLength(1);
  });

  it('rejects a bad file and adds nothing', async () => {
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
    const r = await lib.importFile(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toBe('items[1].data.elements[0].x');
    expect(await lib.list()).toHaveLength(1);
  });

  it('checks the file itself', () => {
    const rules = (v: unknown) => { const r = readLibraryFile(v); return r.ok ? [] : r.issues.map((i) => i.rule); };
    const item = { id: 'a', kind: 'page', name: 'N', updated: '2026-10-18T00:00:00Z', data: page('N') };
    const file = { format: 'dotwork-library', version: 1, exported: '', items: [item] };
    expect(rules(file)).toEqual([]);
    expect(rules({ ...file, format: 'x' })).toContain('format');
    expect(rules({ ...file, version: 2 })).toContain('version');
    expect(rules({ ...file, items: 3 })).toContain('items-array');
    expect(rules({ ...file, items: [{ ...item, kind: 'book' }] })).toContain('kind');
    expect(rules({ ...file, items: [item, item] })).toContain('id');
    expect(rules({ ...file, items: [{ ...item, updated: 'yesterday' }] })).toContain('updated');
    expect(rules({ ...file, items: [{ ...item, kind: 'spread' }] })).toContain('format'); // a page where a spread belongs
    expect(rules('nope')).toEqual(['root-object']);
  });

  it('converts version 1 pages found in a backup', () => {
    const v1 = { format: 'dotwork-page', version: 1, name: 'Old', grid: { cols: 27, rows: 44, pitch_mm: 3 }, regions: [] };
    const r = readLibraryFile({ format: 'dotwork-library', version: 1, exported: '', items: [{ id: 'a', kind: 'page', name: 'Old', updated: '2026-10-18T00:00:00Z', data: v1 }] });
    expect(r.ok && (r.items[0].data as Page).version).toBe(2);
  });
});
