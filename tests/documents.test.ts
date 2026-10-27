import { describe, expect, it } from 'vitest';
import { Autosave, DocSession, SAVE_DELAY_MS, isUntitled, type Adapter } from '../src/documents';
import { Library, MemoryBackend, type Backend, type LibraryItem } from '../src/library/library';
import { emptyPage, type Page } from '../src/format/types';
import { buildSpread, emptySpread, type Spread } from '../src/format/spread';
import { emptyBook, setSlot, type Book } from '../src/book/book';
import { readSection, type Section } from '../src/book/sections';
import { CANT_KEEP, Keeper } from '../src/library/keeper';
import { statusText } from '../src/documents';
import { Favorites } from '../src/library/favorites';
import { restoreBackup } from '../src/library/backup';
import { DEFAULT_PRINT } from '../src/book/impose';

const restore = (lib: Library, file: unknown) => restoreBackup(lib, new Favorites(null), file, DEFAULT_PRINT);

/** A clock the tests move by hand, so the 400 ms pause can be stepped through. */
function clock() {
  let now = 0, next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn: () => void, ms: number) { const id = next++; pending.set(id, { at: now + ms, fn }); return id; },
    clear(h: unknown) { pending.delete(h as number); },
    async advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); }
      await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    },
    get waiting() { return pending.size; },
  };
}

/** A backend that can be told to fail the way a full browser store does. */
class FlakyBackend extends MemoryBackend {
  failing = false;
  puts = 0;
  async put(item: LibraryItem) {
    if (this.failing) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    this.puts++;
    return super.put(item);
  }
}

const box = (x = 0): Page => ({ ...emptyPage(), name: 'x', elements: [{ type: 'box', x, y: 1, w: 2, h: 2 }] });

/** A page "on screen": the adapter reads and shows this one variable. */
function pageSetup(backend: Backend = new FlakyBackend(), opts: { builtinNames?: string[] } = {}) {
  let n = 0;
  const lib = new Library(backend, () => new Date(Date.UTC(2026, 9, 26, 12, 0, n)), () => `id${n++}`, (_k, name) => (opts.builtinNames ?? []).includes(name));
  let screen: Page = emptyPage();
  const adapter: Adapter<Page> = { read: (name) => ({ ...screen, name }), show: (d) => { screen = structuredClone(d); }, blank: emptyPage, isBlank: () => JSON.stringify({ ...screen, name: '' }) === JSON.stringify({ ...emptyPage(), name: '' }) };
  const t = clock();
  const session = new DocSession('page', lib, adapter, SAVE_DELAY_MS, t);
  return { lib, session, t, edit: (p: Page) => { screen = p; session.changed(); }, get screen() { return screen; } };
}

describe('naming', () => {
  it('Untitled, Untitled 2, Untitled 3 within a kind', async () => {
    const { lib } = pageSetup();
    expect((await lib.create('page', 'Untitled', emptyPage())).name).toBe('Untitled');
    expect((await lib.create('page', 'Untitled', emptyPage())).name).toBe('Untitled 2');
    expect((await lib.create('page', 'Untitled', emptyPage())).name).toBe('Untitled 3');
    expect((await lib.create('spread', 'Untitled', emptySpread())).name).toBe('Untitled'); // another kind has its own
  });

  it('a name already used gets " 2" added; nothing is refused or overwritten', async () => {
    const { lib } = pageSetup(new FlakyBackend(), { builtinNames: ['Lined page'] });
    const a = await lib.create('page', 'Daily', box(1));
    const b = await lib.create('page', ' Daily ', box(2));
    const c = await lib.create('page', 'Daily', box(3));
    const d = await lib.create('page', 'Lined page', box(4)); // a built-in's name counts as used
    expect([a.name, b.name, c.name, d.name]).toEqual(['Daily', 'Daily 2', 'Daily 3', 'Lined page 2']);
    expect(await lib.list()).toHaveLength(4);
    expect((await lib.get(a.id))!.data).toMatchObject({ elements: [{ x: 1 }] });
  });

  it('a rename keeps its own name, and takes " 2" when another has it', async () => {
    const { lib } = pageSetup();
    const a = await lib.create('page', 'A', emptyPage());
    const b = await lib.create('page', 'B', emptyPage());
    expect(await lib.rename(a.id, 'A')).toBe('A');
    expect(await lib.rename(b.id, 'A')).toBe('A 2');
  });

  it('knows an Untitled name', () => {
    expect(['Untitled', 'Untitled 2', 'Untitled 12'].every(isUntitled)).toBe(true);
    expect(['Untitled page', 'My Untitled', 'untitled'].some(isUntitled)).toBe(false);
  });
});

describe('the Library keeps the name in the entry only', () => {
  it('writes no data.name for a page or spread, and gives it back on reading', async () => {
    const backend = new MemoryBackend();
    const lib = new Library(backend);
    const page = await lib.create('page', 'Daily', { ...box(), name: 'Something else' });
    const spread = await lib.create('spread', 'Ideas', emptySpread());
    for (const item of await backend.all()) expect('name' in item.data).toBe(false);
    expect((await lib.get(page.id))!.data.name).toBe('Daily');
    expect((await lib.get(spread.id))!.data.name).toBe('Ideas');
  });

  it('drops a data.name that an older entry still has the next time it is written', async () => {
    const backend = new MemoryBackend();
    await backend.put({ id: 'old', kind: 'page', name: 'Old', updated: '2026-01-01T00:00:00.000Z', data: { ...box(), name: 'Old' } });
    const lib = new Library(backend);
    await lib.write('page', 'old', 'Old', (await lib.get('old'))!.data as Page);
    expect('name' in (await backend.all())[0].data).toBe(false);
  });

  it('a backup file still carries the name in data, and reads without it', async () => {
    const lib = new Library(new MemoryBackend());
    await lib.create('page', 'Daily', box());
    const file = await lib.exportAll();
    expect((file.items[0].data as Page).name).toBe('Daily');
    const bare = structuredClone(file) as unknown as { items: { data: Record<string, unknown> }[] };
    delete bare.items[0].data.name;
    const other = new Library(new MemoryBackend());
    expect((await restore(other, bare)).ok).toBe(true);
    expect((await other.list())[0].data.name).toBe('Daily');
  });
});

describe('autosave', () => {
  it('writes once, 400 ms after the last change', async () => {
    const s = pageSetup();
    await s.session.startNew();
    const backend = s.lib as unknown as { backend: FlakyBackend };
    const before = backend.backend.puts;
    s.edit(box(1));
    expect(s.session.status).toBe('unsaved');
    await s.t.advance(300);
    s.edit(box(2)); // each change restarts the pause
    await s.t.advance(300);
    expect(backend.backend.puts).toBe(before);
    expect(s.session.status).toBe('unsaved');
    await s.t.advance(150);
    expect(backend.backend.puts).toBe(before + 1);
    expect(s.session.status).toBe('saved');
    expect(((await s.lib.get(s.session.id!))!.data as Page).elements[0]).toMatchObject({ x: 2 });
  });

  it('flushes at once when asked (the tab is hidden), without waiting for the pause', async () => {
    const s = pageSetup();
    await s.session.startNew();
    s.edit(box(7));
    expect(await s.session.flush()).toBe(true);
    expect(s.t.waiting).toBe(0);
    expect(((await s.lib.get(s.session.id!))!.data as Page).elements[0]).toMatchObject({ x: 7 });
  });

  it('a failed write shows Not saved with the real error, never Saved, and Retry works', async () => {
    const backend = new FlakyBackend();
    const s = pageSetup(backend);
    await s.session.startNew();
    backend.failing = true;
    s.edit(box(3));
    await s.t.advance(SAVE_DELAY_MS);
    expect(s.session.status).toBe('failed');
    expect((s.session.autosave.error as Error).name).toBe('QuotaExceededError');
    await s.t.advance(5000);
    expect(s.session.status).toBe('failed'); // it does not turn into Saved by itself
    expect(await s.session.flush()).toBe(false); // Retry while still full: still not saved
    backend.failing = false;
    expect(await s.session.flush()).toBe(true);
    expect(s.session.status).toBe('saved');
    expect(((await s.lib.get(s.session.id!))!.data as Page).elements[0]).toMatchObject({ x: 3 });
  });

  it('a change made while a write is running is written after it', async () => {
    const calls: number[] = [];
    let release = () => {};
    const t = clock();
    const a = new Autosave(() => { calls.push(calls.length); return new Promise<void>((r) => { release = r; }); }, 400, t);
    a.touch();
    const first = a.flush();
    expect(a.status).toBe('saving');
    a.touch();
    release();
    await first;
    expect(a.status).toBe('unsaved');
    await t.advance(400);
    release();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
  });

  it('a new document that cannot be created says Not saved at once', async () => {
    const backend = new FlakyBackend();
    backend.failing = true;
    const s = pageSetup(backend);
    await s.session.startNew();
    expect(s.session.name).toBe('Untitled');
    expect(s.session.status).toBe('failed');
    backend.failing = false;
    expect(await s.session.flush()).toBe(true);
    expect((await s.lib.list()).map((i) => i.name)).toEqual(['Untitled']);
  });
});

describe('opening documents', () => {
  it('writes the open one first, and keeps both', async () => {
    const s = pageSetup();
    await s.session.startNew();
    const first = s.session.id!;
    s.edit(box(4));
    await s.session.startNew(); // no wait for the pause
    expect(s.session.name).toBe('Untitled 2');
    s.edit(box(9));
    await s.session.open((await s.lib.get(first))!);
    expect(s.screen.elements[0]).toMatchObject({ x: 4 });
    expect(s.session.name).toBe('Untitled');
    await s.session.flush();
    const names = (await s.lib.list()).map((i) => i.name).sort();
    expect(names).toEqual(['Untitled', 'Untitled 2']);
    const second = (await s.lib.findByName('page', 'Untitled 2'))!;
    expect((second.data as Page).elements[0]).toMatchObject({ x: 9 });
  });

  it('does not switch when the open one could not be written', async () => {
    const backend = new FlakyBackend();
    const s = pageSetup(backend);
    await s.session.startNew();
    backend.failing = true;
    s.edit(box(5));
    expect(await s.session.startNew()).toBe(false);
    expect(s.screen.elements[0]).toMatchObject({ x: 5 }); // still there to retry
    expect(s.session.status).toBe('failed');
  });

  it('opening does not touch the document (no write, same updated time)', async () => {
    const s = pageSetup();
    await s.session.startNew();
    s.edit(box(1)); // drawn on, so it is kept when another is started
    await s.session.flush();
    const item = (await s.lib.get(s.session.id!))!;
    const puts = (s.lib as unknown as { backend: FlakyBackend }).backend.puts;
    await s.session.startNew();
    await s.session.open(item);
    await s.session.flush();
    expect((s.lib as unknown as { backend: FlakyBackend }).backend.puts).toBe(puts + 1); // only the new Untitled 2
    expect((await s.lib.get(item.id))!.updated).toBe(item.updated);
  });

  it('an import adds a document named from the file, " 2" if taken, and opens it', async () => {
    const s = pageSetup();
    const file: Page = { ...box(6), name: 'Weekly' };
    await s.session.importAs(file);
    await s.session.importAs(file);
    expect(s.session.name).toBe('Weekly 2');
    expect((await s.lib.list()).map((i) => i.name).sort()).toEqual(['Weekly', 'Weekly 2']);
    expect(s.screen.elements[0]).toMatchObject({ x: 6 });
  });

  it('renames in place, " 2" when taken, and writes it', async () => {
    const s = pageSetup();
    await s.session.startNew();
    s.edit(box(1)); // drawn on, so the next New leaves it in the Library
    await s.session.startNew();
    expect(await s.session.rename('Untitled')).toBe('Untitled 2'); // the first Untitled has the name; its own old name is free again
    expect(await s.session.rename('Garden')).toBe('Garden');
    await s.session.flush();
    expect((await s.lib.get(s.session.id!))!.name).toBe('Garden');
    expect(s.session.untitled).toBe(false);
  });
});

describe('built-ins', () => {
  const builtin: Page = { ...box(8), name: 'Lined page' };

  it('open read-only: changes are not written', async () => {
    const s = pageSetup(new FlakyBackend(), { builtinNames: ['Lined page'] });
    await s.session.openBuiltin(builtin);
    expect(s.session.readOnly).toBe(true);
    expect(s.session.untitled).toBe(false);
    s.session.changed();
    await s.t.advance(1000);
    expect(await s.lib.list()).toHaveLength(0);
  });

  it('Edit a copy: asks for a name, creates the document, carries on in it with the edit that was attempted', async () => {
    const s = pageSetup(new FlakyBackend(), { builtinNames: ['Lined page'] });
    await s.session.openBuiltin(builtin);
    await s.session.makeCopy('Lined page copy', () => s.edit(box(11)));
    expect(s.session.readOnly).toBe(false);
    expect(s.session.name).toBe('Lined page copy');
    const [saved] = await s.lib.list();
    expect(saved.name).toBe('Lined page copy');
    expect((saved.data as Page).elements[0]).toMatchObject({ x: 11 });
    // and the built-in itself is untouched
    expect(builtin.elements[0]).toMatchObject({ x: 8 });
  });

  it('a taken copy name gets " 2"', async () => {
    const s = pageSetup(new FlakyBackend(), { builtinNames: ['Lined page'] });
    await s.lib.create('page', 'Lined page copy', emptyPage());
    await s.session.openBuiltin(builtin);
    await s.session.makeCopy('Lined page copy');
    expect(s.session.name).toBe('Lined page copy 2');
  });
});

describe('a spread is a document too', () => {
  it('saves its two pages under one name', async () => {
    let n = 0;
    const lib = new Library(new MemoryBackend(), undefined, () => `s${n++}`);
    let screen: Spread = emptySpread();
    const adapter: Adapter<Spread> = {
      read: (name) => buildSpread(name, screen.left, screen.right),
      show: (d) => { screen = structuredClone(d); },
      blank: emptySpread,
      isBlank: () => JSON.stringify(screen) === JSON.stringify(emptySpread()),
    };
    const t = clock();
    const session = new DocSession('spread', lib, adapter, SAVE_DELAY_MS, t);
    await session.startNew();
    screen = buildSpread('x', box(1), box(2));
    session.changed();
    expect(await session.flush()).toBe(true);
    const item = (await lib.get(session.id!))!;
    expect(item.name).toBe('Untitled');
    expect((item.data as Spread).right.elements[0]).toMatchObject({ x: 2 });
  });
});


/** A book "on screen": the adapter reads and shows one variable, as the page tests do. */
function bookSetup(backend: Backend = new FlakyBackend(), opts: { builtinNames?: string[] } = {}) {
  let n = 0;
  const lib = new Library(backend, () => new Date(Date.UTC(2026, 9, 26, 12, 0, n)), () => `b${n++}`, (k, name) => k === 'book' && (opts.builtinNames ?? []).includes(name));
  let screen: Book = emptyBook();
  const adapter: Adapter<Book> = {
    read: (name) => ({ ...screen, name }),
    show: (d) => { screen = structuredClone(d); },
    blank: emptyBook,
    isBlank: () => JSON.stringify({ ...screen, name: '' }) === JSON.stringify({ ...emptyBook(), name: '' }),
  };
  const t = clock();
  const session = new DocSession('book', lib, adapter, SAVE_DELAY_MS, t);
  const edit = (change: (b: Book) => void) => { const b = structuredClone(screen); change(b); screen = b; session.changed(); };
  return { lib, session, t, edit, get screen() { return screen; } };
}

describe('a book is a document too', () => {
  it('starts Untitled, saves itself after the pause, and holds its name in the entry only', async () => {
    const b = bookSetup();
    expect(await b.session.startNew()).toBe(true);
    expect(b.session.name).toBe('Untitled');
    expect(b.session.untitled).toBe(true);
    b.edit((x) => { x.page_numbers = false; });
    expect(b.session.status).toBe('unsaved');
    await b.t.advance(SAVE_DELAY_MS);
    expect(b.session.status).toBe('saved');
    const item = (await b.lib.get(b.session.id!))!;
    expect(item.kind).toBe('book');
    expect((item.data as Book).page_numbers).toBe(false);
    expect((item.data as Book).name).toBe('Untitled'); // filled in on read
    expect('name' in (await (b.lib as unknown as { backend: Backend }).backend.all())[0].data).toBe(false); // not stored twice
  });

  it('flushes at once when the tab is hidden, without waiting for the pause', async () => {
    const backend = new FlakyBackend();
    const b = bookSetup(backend);
    await b.session.startNew();
    const before = backend.puts;
    b.edit((x) => setSlot(x, 1, box(3)));
    expect(await b.session.flush()).toBe(true);
    expect(backend.puts).toBe(before + 1);
    expect(b.session.status).toBe('saved');
  });

  it('says Not saved when the write fails, never Saved, and Retry writes it', async () => {
    const backend = new FlakyBackend();
    const b = bookSetup(backend);
    await b.session.startNew();
    backend.failing = true;
    b.edit((x) => { x.page_numbers = false; });
    expect(await b.session.flush()).toBe(false);
    expect(b.session.status).toBe('failed');
    expect(statusText(b.session.status)).toBe('Not saved');
    backend.failing = false;
    expect(await b.session.flush()).toBe(true);
    expect(statusText(b.session.status)).toBe('Saved');
  });

  it('opening another book writes the current one first and replaces nothing', async () => {
    const b = bookSetup();
    await b.session.startNew();
    await b.session.rename('First');
    b.edit((x) => { x.page_numbers = false; }); // not written yet
    const other = await b.lib.create('book', 'Second', { ...emptyBook(), name: 'Second' });
    expect(await b.session.open(other)).toBe(true);
    expect(b.session.name).toBe('Second');
    const first = (await b.lib.list()).find((i) => i.name === 'First')!;
    expect((first.data as Book).page_numbers).toBe(false); // written before switching
    expect(await b.lib.list()).toHaveLength(2);
  });

  it('an import adds a document named from the file, with " 2" when taken, and opens it', async () => {
    const b = bookSetup();
    const file = { ...emptyBook(), name: 'Field notes' };
    await b.session.importAs(file);
    expect(b.session.name).toBe('Field notes');
    await b.session.importAs(file);
    expect(b.session.name).toBe('Field notes 2');
    expect((await b.lib.list()).map((i) => i.name).sort()).toEqual(['Field notes', 'Field notes 2']);
  });

  it('a built-in book is read-only; Edit a copy takes a name and the first write has the attempted edit', async () => {
    const b = bookSetup();
    const builtin = { ...emptyBook(), name: 'Idea book' };
    await b.session.openBuiltin(builtin);
    expect(b.session.readOnly).toBe(true);
    b.session.changed(); // nothing is written for a built-in
    expect(b.session.status).toBe('saved');
    expect(await b.lib.list()).toHaveLength(0);
    await b.session.makeCopy('Idea book copy', () => b.edit((x) => { x.page_numbers = false; }));
    expect(b.session.readOnly).toBe(false);
    const saved = (await b.lib.list())[0];
    expect(saved.name).toBe('Idea book copy');
    expect((saved.data as Book).page_numbers).toBe(false);
    expect(b.session.status).toBe('saved');
  });
});

describe('sections are documents', () => {
  const section = (name: string): Section => ({ format: 'dotwork-section', version: 1, name, pages: [null, null], days: [0, 1], weekday: 1, move: 'week', left: false });

  it('are named like the rest: a taken name gets " 2", a rename keeps its own, nothing is replaced', async () => {
    const lib = new Library(new MemoryBackend());
    const a = await lib.create('section', 'Week', section('Week'));
    const b = await lib.create('section', 'Week', section('Week'));
    expect([a.name, b.name]).toEqual(['Week', 'Week 2']);
    expect(await lib.rename(b.id, 'Week')).toBe('Week 2');
    expect(await lib.rename(b.id, 'Review')).toBe('Review');
    expect(readSection((await lib.get(b.id))!.data).ok).toBe(true); // the name is put back in the data for the reader
    expect((await lib.get(b.id))!.data.name).toBe('Review');
  });

  it('Duplicate and Delete work on them, and a backup restores them with their names', async () => {
    const lib = new Library(new MemoryBackend());
    const a = await lib.create('section', 'Week', section('Week'));
    const copy = (await lib.duplicate(a.id))!;
    expect(copy.name).toBe('Week copy');
    await lib.remove(a.id);
    const file = await lib.exportAll();
    const restored = new Library(new MemoryBackend());
    expect(await restore(restored, file)).toMatchObject({ ok: true, summary: { added: 1 } });
    expect((await restored.list())[0].name).toBe('Week copy');
  });
});

describe('an Untitled document nobody drew on is not kept', () => {
  it('is deleted when another document is opened or started', async () => {
    const s = pageSetup();
    await s.session.startNew();
    const first = s.session.id!;
    expect(s.session.pristine).toBe(true);
    const other = await s.lib.create('page', 'Other', box(1));
    await s.session.open(other);
    expect(await s.lib.get(first)).toBeUndefined();
    expect(s.session.name).toBe('Other');
  });

  it('New on an empty Untitled keeps that one instead of piling up more', async () => {
    const s = pageSetup();
    await s.session.startNew();
    const id = s.session.id;
    await s.session.startNew();
    expect(s.session.id).toBe(id);
    expect(await s.lib.list()).toHaveLength(1);
  });

  it('is kept once edited, and kept once named', async () => {
    const edited = pageSetup();
    await edited.session.startNew();
    edited.edit(box(2));
    expect(edited.session.pristine).toBe(false);
    await edited.session.startNew();
    expect((await edited.lib.list()).map((i) => i.name).sort()).toEqual(['Untitled', 'Untitled 2']);

    const named = pageSetup();
    await named.session.startNew();
    await named.session.rename('Garden');
    await named.session.flush();
    await named.session.startNew();
    expect((await named.lib.list()).map((i) => i.name).sort()).toEqual(['Garden', 'Untitled']);
    expect(named.session.name).toBe('Untitled'); // the new one; Garden is still there
  });

  it('applies to books, and to a built-in or import opened over it', async () => {
    const b = bookSetup();
    await b.session.startNew();
    await b.session.openBuiltin({ ...emptyBook(), name: 'Year planner' });
    expect(await b.lib.list()).toHaveLength(0);
    await b.session.startNew();
    await b.session.importAs({ ...emptyBook(), name: 'Imported' });
    expect((await b.lib.list()).map((i) => i.name)).toEqual(['Imported']);
  });

  it('a close discards it too, and an edited one stays', async () => {
    const b = bookSetup();
    await b.session.startNew();
    expect(await b.session.discardIfPristine()).toBe(true);
    expect(await b.lib.list()).toHaveLength(0);
    await b.session.startNew();
    b.edit((x) => { x.page_numbers = false; });
    await b.session.flush();
    expect(await b.session.discardIfPristine()).toBe(false);
    expect(await b.lib.list()).toHaveLength(1);
  });
});

describe('when the browser can’t keep documents', () => {
  it('without IndexedDB it says so, keeps working from memory, and never says Saved', async () => {
    const keeper = new Keeper(null);
    await keeper.start();
    expect(keeper.keeping).toBe(false);
    expect(CANT_KEEP).toMatch(/can’t keep your documents/);
    expect(CANT_KEEP).toMatch(/Export/);
    const lib = new Library(keeper);
    let screen = emptyPage();
    const session = new DocSession('page', lib, { read: (name) => ({ ...screen, name }), show: (d) => { screen = d; }, blank: emptyPage, isBlank: () => false });
    expect(await session.startNew()).toBe(true);
    expect(session.status).toBe('saved'); // the write to memory worked...
    expect(statusText(session.status, keeper.keeping)).toBe('Not saved'); // ...but the mark never claims it is kept
    expect((await lib.list()).map((i) => i.name)).toEqual(['Untitled']);
  });

  it('a storage that refuses to open, or refuses the first write, falls back to memory', async () => {
    const refusing = Object.assign(new FlakyBackend(), { check: async () => { throw new Error('private mode'); } });
    const a = new Keeper(refusing);
    await a.start();
    expect(a.keeping).toBe(false);

    const failing = new FlakyBackend();
    failing.failing = true;
    const b = new Keeper(failing);
    await b.start();
    expect(b.keeping).toBe(true);
    let told = 0;
    b.subscribe(() => told++);
    const lib = new Library(b);
    await lib.create('page', 'x', emptyPage()); // does not throw: it is kept in memory
    expect(b.keeping).toBe(false);
    expect(told).toBe(1);
    expect(await lib.list()).toHaveLength(1);
  });

  it('a write that fails after one has worked is an ordinary failure: Not saved, with Retry', async () => {
    const disk = new FlakyBackend();
    const k = new Keeper(disk);
    const lib = new Library(k);
    await lib.create('page', 'x', emptyPage());
    disk.failing = true;
    await expect(lib.create('page', 'y', emptyPage())).rejects.toThrow();
    expect(k.keeping).toBe(true);
  });
});
