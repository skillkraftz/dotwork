import { describe, expect, it } from 'vitest';
import { Library, MemoryBackend, readLibraryFile } from '../src/library/library';
import { Favorites } from '../src/library/favorites';
import { restoreBackup, printerRows, summaryProblem } from '../src/library/backup';
import { DEFAULT_PRINT, clonePrint } from '../src/book/impose';
import { emptyBook } from '../src/book/book';
import { emptyPage, type Page, type PageElement } from '../src/format/types';
import { emptySpread } from '../src/format/spread';
import { TEMPLATES } from '../src/builtin/templates';
import { DocSession, type Adapter } from '../src/documents';

let n = 0;
const make = (backend = new MemoryBackend()) => new Library(backend, undefined, () => `id${++n}`);
const memory = (start: Record<string, string> = {}) => {
  const data = { ...start };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
};
const page = (name: string, x = 0): Page => ({ ...emptyPage(), name, elements: [{ type: 'box', x, y: 1, w: 2, h: 2 }] });
const box: PageElement[] = [{ type: 'box', x: 0, y: 0, w: 5, h: 4 }];
const art = { type: 'art', x: 0, y: 1, w: 3, h: 3, view_box: [0, 0, 10, 10], paths: [{ d: 'M0 0L10 0L10 10Z', fill: 'black', stroke: 'none', stroke_mm: 0 }] } as unknown as PageElement;
const restore = (lib: Library, fav: Favorites, file: unknown, printer = DEFAULT_PRINT) => restoreBackup(lib, fav, file, printer);
const summary = async (r: ReturnType<typeof restore>) => { const x = await r; if (!x.ok) throw new Error(JSON.stringify(x.issues)); return x.summary; };
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A library with one of everything. */
async function full() {
  const lib = make();
  await lib.create('page', 'Daily', page('x'));
  await lib.create('spread', 'Ideas', emptySpread());
  await lib.create('book', 'Journal', { ...emptyBook(), name: 'Journal' });
  await lib.create('widget', 'Notes box', { name: 'Notes box', elements: box });
  await lib.create('art', 'Star', { name: 'Star', elements: [art] });
  return lib;
}

describe('what a backup holds', () => {
  it('has every kind of document, the favorites and the printer profile with both layouts', async () => {
    const lib = await full();
    const printer = clonePrint(DEFAULT_PRINT);
    printer.creep_per_sheet_mm = 0.31;
    printer.layouts.letter_two_up.back_offset_x_mm = 1.25;
    const file = roundTrip(await lib.exportAll({ favorites: ['a', 'b'], printer }));
    expect(file.items.map((i) => i.kind).sort()).toEqual(['art', 'book', 'page', 'spread', 'widget']);
    expect(file.favorites).toEqual(['a', 'b']);
    expect(Object.keys(file.printer!.layouts)).toEqual(Object.keys(DEFAULT_PRINT.layouts));
    const read = readLibraryFile(file);
    expect(read.ok && read.items).toHaveLength(5);
    expect(read.ok && read.printer).toEqual(printer);
    expect(read.ok && read.favorites).toEqual(['a', 'b']);
  });

  it('a backup from before (no favorites, no printer) still reads', async () => {
    const file = roundTrip(await (await full()).exportAll());
    const read = readLibraryFile(file);
    expect(read.ok && read.favorites).toEqual([]);
    expect(read.ok && read.printer).toBeNull();
  });
});

describe('restoring a backup', () => {
  it('adds into an empty library, so everything is back', async () => {
    const file = roundTrip(await (await full()).exportAll());
    const lib = make();
    const s = await summary(restore(lib, new Favorites(null), file));
    expect(s).toMatchObject({ added: 5, skipped: 0, keptBoth: 0, refused: [] });
    expect((await lib.list()).map((i) => [i.kind, i.name]).sort()).toEqual([['art', 'Star'], ['book', 'Journal'], ['page', 'Daily'], ['spread', 'Ideas'], ['widget', 'Notes box']]);
  });

  it('skips a document that is already here and identical, however many times', async () => {
    const lib = await full();
    const file = roundTrip(await lib.exportAll());
    const fav = new Favorites(null);
    expect(await summary(restore(lib, fav, file))).toMatchObject({ added: 0, skipped: 5, keptBoth: 0 });
    expect(await summary(restore(lib, fav, file))).toMatchObject({ added: 0, skipped: 5, keptBoth: 0 });
    expect(await lib.list()).toHaveLength(5);
  });

  it('twice into an empty library makes no duplicates, even when a name had to change the first time', async () => {
    const file = roundTrip(await (await full()).exportAll());
    const lib = make();
    await lib.create('page', 'Daily', page('other', 5)); // a different page that has the name
    await summary(restore(lib, new Favorites(null), file));
    const second = await summary(restore(lib, new Favorites(null), file));
    expect(second).toMatchObject({ added: 0, skipped: 5 });
    expect((await lib.list()).filter((i) => i.kind === 'page').map((i) => i.name).sort()).toEqual(['Daily', 'Daily 2']);
  });

  it('keeps both when the id is here but the content differs, and overwrites nothing', async () => {
    const lib = await full();
    const file = roundTrip(await lib.exportAll());
    const daily = (await lib.list()).find((i) => i.kind === 'page')!;
    await lib.write('page', daily.id, 'Daily', page('x', 7)); // edited since the backup
    const s = await summary(restore(lib, new Favorites(null), file));
    expect(s).toMatchObject({ added: 0, skipped: 4, keptBoth: 1 });
    const pages = (await lib.list()).filter((i) => i.kind === 'page');
    expect(pages.map((p) => p.name).sort()).toEqual(['Daily', 'Daily (from backup)']);
    expect((pages.find((p) => p.name === 'Daily')!.data as Page).elements[0]).toMatchObject({ x: 7 }); // the edit is still there
    expect((pages.find((p) => p.name === 'Daily (from backup)')!.data as Page).elements[0]).toMatchObject({ x: 0 });
    // restoring again: the backup's copy is already here under its own id? No: it is a new document, so the differing one is kept again.
    // That is the rule (nothing is overwritten or deleted); it only happens while the edited one differs from the backup.
  });

  it('never deletes: documents not in the backup stay', async () => {
    const lib = make();
    await lib.create('page', 'Mine', page('m'));
    const file = roundTrip(await (await full()).exportAll());
    await summary(restore(lib, new Favorites(null), file));
    expect((await lib.list()).some((i) => i.name === 'Mine')).toBe(true);
    expect(await lib.list()).toHaveLength(6);
  });

  it('merges favorites and never unstars', async () => {
    const storage = memory({ 'dotwork.favorites': JSON.stringify(['mine', 'both']) });
    const fav = new Favorites(storage);
    const file = roundTrip(await (await full()).exportAll({ favorites: ['both', 'theirs', 'theirs'] }));
    const s = await summary(restore(make(), fav, file));
    expect(s.favoritesAdded).toBe(1);
    expect(fav.list().sort()).toEqual(['both', 'mine', 'theirs']);
    expect(JSON.parse(storage.data['dotwork.favorites']).sort()).toEqual(['both', 'mine', 'theirs']);
  });

  it('offers the printer profile when it differs, and never applies it', async () => {
    const mine = clonePrint(DEFAULT_PRINT);
    mine.creep_per_sheet_mm = 0.2;
    const theirs = clonePrint(DEFAULT_PRINT);
    theirs.creep_per_sheet_mm = 0.31;
    const file = roundTrip(await (await full()).exportAll({ printer: theirs }));
    const s = await summary(restore(make(), new Favorites(null), file, mine));
    expect(s.printer).toEqual(theirs);
    expect(mine.creep_per_sheet_mm).toBe(0.2); // restoreBackup has no way to change it
    const rows = printerRows(mine, theirs);
    expect(rows.find((r) => r.label === 'creep per sheet mm')).toEqual({ label: 'creep per sheet mm', mine: '0.2', theirs: '0.31' });
    expect(rows.some((r) => r.label.startsWith('letter_two_up') || r.label.includes('back offset x mm'))).toBe(true);
    // the same profile is not worth asking about
    expect((await summary(restore(make(), new Favorites(null), file, theirs))).printer).toBeNull();
    // and a profile that doesn't fit its limits is refused with the reason, the documents still come
    const broken = roundTrip(file) as { printer: { creep_per_sheet_mm: number } };
    broken.printer.creep_per_sheet_mm = 99;
    const r = await summary(restore(make(), new Favorites(null), broken, mine));
    expect(r.printer).toBeNull();
    expect(r.added).toBe(5);
    expect(r.printerRefused).toContain('creep_per_sheet_mm');
  });

  it('refuses a bad item with the reason and adds the rest', async () => {
    const file = roundTrip(await (await full()).exportAll()) as { items: { kind: string; data: { elements?: unknown[] } }[] };
    file.items.find((i) => i.kind === 'widget')!.data.elements = [{ type: 'shade', x: 0, y: 0, w: 1, h: 1 }];
    const s = await summary(restore(make(), new Favorites(null), file));
    expect(s.added).toBe(4);
    expect(s.refused).toHaveLength(1);
    expect(s.refused[0]).toMatchObject({ name: 'Notes box', kind: 'widget' });
    const p = summaryProblem('x.json', s);
    expect(p.lines.join(' ')).toContain('Refused 1');
    expect(p.details).toContain('Notes box');
  });

  it('a file that is not a backup is refused whole', async () => {
    const r = await restore(make(), new Favorites(null), { format: 'nope' });
    expect(r.ok).toBe(false);
  });

  it('a write the browser refuses is listed as refused, and the rest goes on', async () => {
    const backend = new MemoryBackend();
    const real = backend.put.bind(backend);
    backend.put = async (item) => { if (item.kind === 'spread') throw new Error('quota'); return real(item); };
    const file = roundTrip(await (await full()).exportAll());
    const s = await summary(restore(make(backend), new Favorites(null), file));
    expect(s.added).toBe(4);
    expect(s.refused[0].reason).toContain('quota');
  });
});

describe('a template book', () => {
  const adapter = (): Adapter<ReturnType<typeof emptyBook>> => {
    let shown = emptyBook();
    return { read: (name) => ({ ...shown, name }), show: (d) => { shown = d; }, blank: emptyBook, isBlank: () => false };
  };

  it('built with a year becomes a document at once, named from the template, and a second gets " 2"', async () => {
    const lib = make();
    const session = new DocSession('book', lib, adapter());
    const planner = TEMPLATES.find((t) => t.id === 'year-planner')!;
    expect(planner.fields.length).toBeGreaterThan(0);
    await session.importAs(planner.build({ year: 2026 }));
    expect(session.name).toBe('2026 year planner');
    expect(session.readOnly).toBe(false);
    expect(session.status).toBe('saved');
    expect(session.id).not.toBeNull();
    expect((await lib.list()).map((i) => i.name)).toEqual(['2026 year planner']);
    await session.importAs(planner.build({ year: 2026 }));
    expect((await lib.list()).map((i) => i.name).sort()).toEqual(['2026 year planner', '2026 year planner 2']);
  });

  it('only the templates with no questions are left to open read-only', () => {
    expect(TEMPLATES.filter((t) => t.fields.length === 0).map((t) => t.id)).toEqual(['blank-journal', 'lined-journal', 'dot-grid-journal', 'idea-book']);
  });
});

