import { readPage } from '../format/read';
import { readSpread, type Spread } from '../format/spread';
import { readBook, type Book } from '../book/book';
import { readSection, type Section } from '../book/sections';
import type { Page } from '../format/types';
import type { ValidationIssue } from '../format/validate';

export type LibraryKind = 'page' | 'spread' | 'book' | 'section';

interface ItemBase { id: string; name: string; /** ISO time of the last change. */ updated: string }
export type LibraryItem =
  | (ItemBase & { kind: 'page'; data: Page })
  | (ItemBase & { kind: 'spread'; data: Spread })
  | (ItemBase & { kind: 'book'; data: Book })
  | (ItemBase & { kind: 'section'; data: Section });

/** Where items are kept. IndexedDB in the browser, memory in tests. */
export interface Backend {
  all(): Promise<LibraryItem[]>;
  put(item: LibraryItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryBackend implements Backend {
  private items = new Map<string, LibraryItem>();
  async all() { return [...this.items.values()].map((i) => structuredClone(i)); }
  async put(item: LibraryItem) { this.items.set(item.id, structuredClone(item)); }
  async remove(id: string) { this.items.delete(id); }
}

/** The backup file: the whole library as one JSON file. See docs/library-format.md. */
export interface LibraryFile {
  format: 'dotwork-library';
  version: 1;
  exported: string;
  items: LibraryItem[];
}

export type ImportResult = { ok: true; added: number; replaced: number } | { ok: false; issues: ValidationIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check a parsed backup file; every page, spread and book inside is checked against the page format too. */
export function readLibraryFile(input: unknown): { ok: true; items: LibraryItem[] } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });
  if (!isObject(input)) return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: 'A library file must be a JSON object.' }] };
  if (input.format !== 'dotwork-library') fail('format', 'format', `"format" must be "dotwork-library", got ${JSON.stringify(input.format)}.`);
  if (input.version !== 1) fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 1.`);
  if (!Array.isArray(input.items)) {
    fail('items-array', 'items', '"items" is required and must be an array (it may be empty).');
    return { ok: false, issues };
  }
  const items: LibraryItem[] = [];
  const seen = new Set<string>();
  input.items.forEach((raw: unknown, i: number) => {
    const at = `items[${i}]`;
    if (!isObject(raw)) return fail('item-object', at, 'An item must be an object.');
    const before = issues.length;
    if (typeof raw.id !== 'string' || !raw.id) fail('id', `${at}.id`, '"id" is required and must be a non-empty string.');
    else if (seen.has(raw.id)) fail('id', `${at}.id`, `Duplicate id ${JSON.stringify(raw.id)}.`);
    else seen.add(raw.id);
    if (typeof raw.name !== 'string') fail('name', `${at}.name`, '"name" is required and must be a string.');
    if (typeof raw.updated !== 'string' || Number.isNaN(Date.parse(raw.updated))) fail('updated', `${at}.updated`, '"updated" must be an ISO date string.');
    if (raw.kind !== 'page' && raw.kind !== 'spread' && raw.kind !== 'book' && raw.kind !== 'section') return fail('kind', `${at}.kind`, `"kind" must be "page", "spread", "book" or "section", got ${JSON.stringify(raw.kind)}.`);
    const named = (d: unknown) => (isObject(d) && d.name === undefined ? { ...d, name: raw.name } : d); // the entry's name is the one copy
    const data = raw.kind === 'page' ? readPage(named(raw.data)) : raw.kind === 'spread' ? readSpread(named(raw.data)) : raw.kind === 'section' ? readSection(named(raw.data)) : readBook(named(raw.data));
    if (!data.ok) {
      for (const d of data.issues) issues.push({ ...d, path: `${at}.data${d.path === '(file)' ? '' : '.' + d.path}` });
      return;
    }
    if (issues.length > before) return;
    const base = { id: raw.id as string, name: raw.name as string, updated: raw.updated as string };
    items.push(raw.kind === 'page' ? { ...base, kind: 'page', data: (data as { page: Page }).page }
      : raw.kind === 'spread' ? { ...base, kind: 'spread', data: (data as { spread: Spread }).spread }
        : raw.kind === 'section' ? { ...base, kind: 'section', data: (data as { section: Section }).section }
          : { ...base, kind: 'book', data: (data as { book: Book }).book });
  });
  return issues.length ? { ok: false, issues } : { ok: true, items };
}

/** Every kind keeps its name in the entry only; `data.name` is filled in when read and left out when written. */
const withName = (item: LibraryItem): LibraryItem => ({ ...item, data: { ...item.data, name: item.name } }) as LibraryItem;
const withoutName = (item: LibraryItem): LibraryItem => {
  const { name: _name, ...data } = item.data as { name?: string };
  return { ...item, data } as LibraryItem;
};

/** Saved pages, spreads, sections and books: open, autosave, rename, duplicate, delete, back up and restore. */
export class Library {
  constructor(
    private backend: Backend,
    private now: () => Date = () => new Date(),
    private newId: () => string = () => crypto.randomUUID(),
    /** Whether a name belongs to a built-in example. Saved items can't take one, so a built-in is never overwritten. */
    private reserved: (kind: LibraryKind, name: string) => boolean = () => false,
  ) {}

  private checkName(kind: LibraryKind, name: string) {
    if (this.reserved(kind, name)) throw new Error(`“${name.trim()}” is the name of a built-in example. Choose another name; the built-in can't be replaced.`);
  }

  private async items(): Promise<LibraryItem[]> {
    return (await this.backend.all()).map(withName);
  }

  private put(item: LibraryItem): Promise<void> {
    return this.backend.put(withoutName(structuredClone(item)));
  }

  /** Newest first. */
  async list(): Promise<LibraryItem[]> {
    return (await this.items()).sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<LibraryItem | undefined> {
    return (await this.items()).find((i) => i.id === id);
  }

  async findByName(kind: LibraryKind, name: string): Promise<LibraryItem | undefined> {
    const want = name.trim();
    return (await this.items()).find((i) => i.kind === kind && i.name === want);
  }

  /** Save under a name, keeping the page's or spread's own name in step. Saving over an existing name replaces it. */
  async save(kind: 'page', name: string, data: Page): Promise<LibraryItem>;
  async save(kind: 'spread', name: string, data: Spread): Promise<LibraryItem>;
  async save(kind: 'book', name: string, data: Book): Promise<LibraryItem>;
  async save(kind: 'section', name: string, data: Section): Promise<LibraryItem>;
  async save(kind: LibraryKind, name: string, data: Page | Spread | Book | Section): Promise<LibraryItem> {
    const clean = name.trim() || 'Untitled';
    this.checkName(kind, clean);
    const existing = await this.findByName(kind, clean);
    const item = { id: existing?.id ?? this.newId(), kind, name: clean, updated: this.now().toISOString(), data: { ...structuredClone(data), name: clean } } as LibraryItem;
    await this.put(item);
    return item;
  }

  /**
   * `wanted` as a name nobody has in this kind: with " 2" added (then " 3"…) when it is taken, by a saved item or a
   * built-in. `exceptId` is the item being renamed, which may keep its own name.
   */
  async uniqueName(kind: LibraryKind, wanted: string, exceptId?: string): Promise<string> {
    const base = wanted.trim() || 'Untitled';
    const taken = new Set((await this.items()).filter((i) => i.kind === kind && i.id !== exceptId).map((i) => i.name));
    const isTaken = (n: string) => taken.has(n) || this.reserved(kind, n);
    let name = base;
    for (let n = 2; isTaken(name); n++) name = `${base} ${n}`;
    return name;
  }

  /** Add a new document under a name that is free (see `uniqueName`). Nothing is ever replaced. */
  async create(kind: LibraryKind, wanted: string, data: Page | Spread | Book | Section): Promise<LibraryItem> {
    const name = await this.uniqueName(kind, wanted);
    const item = { id: this.newId(), kind, name, updated: this.now().toISOString(), data: structuredClone(data) } as LibraryItem;
    await this.put(item);
    return withName(item);
  }

  /** Write the open document over its own entry (autosave). The name is the entry's; the data keeps none. */
  async write(kind: LibraryKind, id: string, name: string, data: Page | Spread | Book | Section): Promise<LibraryItem> {
    const item = { id, kind, name, updated: this.now().toISOString(), data: structuredClone(data) } as LibraryItem;
    await this.put(item);
    return withName(item);
  }

  /** Rename; a name already used gets " 2" added. Returns the name it ended with. */
  async rename(id: string, name: string): Promise<string | undefined> {
    const item = await this.get(id);
    const wanted = name.trim();
    if (!item || !wanted) return;
    const clean = await this.uniqueName(item.kind, wanted, id);
    await this.put({ ...item, name: clean, updated: this.now().toISOString(), data: { ...item.data, name: clean } } as LibraryItem);
    return clean;
  }

  async duplicate(id: string): Promise<LibraryItem | undefined> {
    const item = await this.get(id);
    if (!item) return;
    const names = new Set((await this.items()).filter((i) => i.kind === item.kind).map((i) => i.name));
    let name = `${item.name} copy`;
    for (let n = 2; names.has(name); n++) name = `${item.name} copy ${n}`;
    const copy = { ...item, id: this.newId(), name, updated: this.now().toISOString(), data: { ...structuredClone(item.data), name } } as LibraryItem;
    await this.put(copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    await this.backend.remove(id);
  }

  async exportAll(): Promise<LibraryFile> {
    return { format: 'dotwork-library', version: 1, exported: this.now().toISOString(), items: await this.list() }; // list() gives every page and spread its name back in data
  }

  /** Add everything in a backup; an item with the same id as one already here replaces it. Nothing is added if any item is invalid. */
  async importFile(input: unknown): Promise<ImportResult> {
    const r = readLibraryFile(input);
    if (!r.ok) return r;
    const have = new Set((await this.backend.all()).map((i) => i.id));
    for (const item of r.items) await this.put(item);
    const replaced = r.items.filter((i) => have.has(i.id)).length;
    return { ok: true, added: r.items.length - replaced, replaced };
  }
}
