import { describe, expect, it } from 'vitest';
import { Autosave, DocSession, SAVE_DELAY_MS, isUntitled, type Adapter } from '../src/documents';
import { Library, MemoryBackend, type Backend, type LibraryItem } from '../src/library/library';
import { emptyPage, type Page } from '../src/format/types';
import { buildSpread, emptySpread, type Spread } from '../src/format/spread';

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
  const adapter: Adapter<Page> = { read: (name) => ({ ...screen, name }), show: (d) => { screen = structuredClone(d); }, blank: emptyPage };
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
    expect((await other.importFile(bare)).ok).toBe(true);
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
