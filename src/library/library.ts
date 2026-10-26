import { readPage } from '../format/read';
import { readSpread, type Spread } from '../format/spread';
import { readBook, type Book } from '../book/book';
import { readSection, type Section } from '../book/sections';
import { readWidget, type WidgetData } from '../widgets';
import { readPrinter } from '../printer';
import type { PrintSettings } from '../book/impose';
import type { Page } from '../format/types';
import type { ValidationIssue } from '../format/validate';

export type LibraryKind = 'page' | 'spread' | 'book' | 'section' | 'widget' | 'art';
export const KINDS: readonly LibraryKind[] = ['page', 'spread', 'section', 'book', 'widget', 'art'];

interface ItemBase { id: string; name: string; /** ISO time of the last change. */ updated: string }
export type LibraryItem =
  | (ItemBase & { kind: 'page'; data: Page })
  | (ItemBase & { kind: 'spread'; data: Spread })
  | (ItemBase & { kind: 'book'; data: Book })
  | (ItemBase & { kind: 'section'; data: Section })
  /** A widget is a group of elements; art is a widget of one art element (see art/widget.ts). Both are `{ name, elements }`. */
  | (ItemBase & { kind: 'widget' | 'art'; data: WidgetData });

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
  /** The ids starred in the Library. */
  favorites?: string[];
  /** The printer profile, with both layouts' calibration. */
  printer?: PrintSettings;
}

/** An item of a backup that could not be read, with the reason. */
export interface RefusedItem { index: number; id: string | null; name: string; kind: string; reason: string }

export interface ReadBackup { items: LibraryItem[]; refused: RefusedItem[]; favorites: string[]; printer: PrintSettings | null; printerRefused: string | null }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a parsed backup file. A file that is not a backup at all is refused whole; a bad item inside one is left out and
 * listed in `refused` with the reason (the rest is still read), as is a printer profile that does not fit its limits.
 */
export function readLibraryFile(input: unknown): ({ ok: true } & ReadBackup) | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const fail = (rule: string, path: string, message: string) => issues.push({ rule, path, message });
  if (!isObject(input)) return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: 'A library file must be a JSON object.' }] };
  if (input.format !== 'dotwork-library') fail('format', 'format', `"format" must be "dotwork-library", got ${JSON.stringify(input.format)}.`);
  if (input.version !== 1) fail('version', 'version', `Unknown version ${JSON.stringify(input.version)}; this reader understands version 1.`);
  if (!Array.isArray(input.items)) fail('items-array', 'items', '"items" is required and must be an array (it may be empty).');
  if (input.favorites !== undefined && (!Array.isArray(input.favorites) || input.favorites.some((f) => typeof f !== 'string'))) fail('favorites', 'favorites', '"favorites" must be an array of ids (strings).');
  if (issues.length) return { ok: false, issues };
  const items: LibraryItem[] = [], refused: RefusedItem[] = [];
  const seen = new Set<string>();
  (input.items as unknown[]).forEach((raw, index) => {
    const at = `items[${index}]`;
    const bad: ValidationIssue[] = [];
    const reject = (rule: string, path: string, message: string) => bad.push({ rule, path, message });
    if (!isObject(raw)) { refused.push({ index, id: null, name: '(not an object)', kind: '?', reason: `${at}: an item must be an object.` }); return; }
    const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (id === null) reject('id', `${at}.id`, '"id" is required and must be a non-empty string.');
    else if (seen.has(id)) reject('id', `${at}.id`, `Duplicate id ${JSON.stringify(id)}.`);
    else seen.add(id);
    if (typeof raw.name !== 'string') reject('name', `${at}.name`, '"name" is required and must be a string.');
    if (typeof raw.updated !== 'string' || Number.isNaN(Date.parse(raw.updated))) reject('updated', `${at}.updated`, '"updated" must be an ISO date string.');
    const kind = KINDS.find((k) => k === raw.kind);
    if (!kind) reject('kind', `${at}.kind`, `"kind" must be ${KINDS.map((k) => `"${k}"`).join(', ')}, got ${JSON.stringify(raw.kind)}.`);
    const name = typeof raw.name === 'string' ? raw.name : '(no name)';
    const done = () => refused.push({ index, id, name, kind: String(raw.kind), reason: bad.map((d) => `${d.path}: ${d.message}`).join(' ') });
    if (!kind || bad.length) return done();
    const named = (d: unknown) => (isObject(d) && d.name === undefined ? { ...d, name: raw.name } : d); // the entry's name is the one copy
    const data = kind === 'page' ? readPage(named(raw.data)) : kind === 'spread' ? readSpread(named(raw.data)) : kind === 'section' ? readSection(named(raw.data))
      : kind === 'book' ? readBook(named(raw.data)) : readWidget(named(raw.data), kind);
    if (!data.ok) {
      for (const d of data.issues) bad.push({ ...d, path: `${at}.data${d.path === '(file)' ? '' : '.' + d.path}` });
      return done();
    }
    const base = { id: id as string, name, updated: raw.updated as string };
    items.push(kind === 'page' ? { ...base, kind, data: (data as { page: Page }).page }
      : kind === 'spread' ? { ...base, kind, data: (data as { spread: Spread }).spread }
        : kind === 'section' ? { ...base, kind, data: (data as { section: Section }).section }
          : kind === 'book' ? { ...base, kind, data: (data as { book: Book }).book }
            : { ...base, kind, data: (data as { widget: WidgetData }).widget });
  });
  let printer: PrintSettings | null = null, printerRefused: string | null = null;
  if (input.printer !== undefined) {
    const p = readPrinter(input.printer);
    if (p.ok) printer = p.value; else printerRefused = p.issues.map((d) => `printer.${d.path}: ${d.message}`).join(' ');
  }
  return { ok: true, items, refused, favorites: (input.favorites as string[] | undefined) ?? [], printer, printerRefused };
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
  async create(kind: LibraryKind, wanted: string, data: Page | Spread | Book | Section | WidgetData): Promise<LibraryItem> {
    const name = await this.uniqueName(kind, wanted);
    const item = { id: this.newId(), kind, name, updated: this.now().toISOString(), data: structuredClone(data) } as LibraryItem;
    await this.put(item);
    return withName(item);
  }

  /** Write the open document over its own entry (autosave). The name is the entry's; the data keeps none. */
  async write(kind: LibraryKind, id: string, name: string, data: Page | Spread | Book | Section | WidgetData): Promise<LibraryItem> {
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

  /** Everything saved (not the built-ins), with the starred ids and the printer profile when given. See docs/library-format.md. */
  async exportAll(extra: { favorites?: readonly string[]; printer?: PrintSettings } = {}): Promise<LibraryFile> {
    const file: LibraryFile = { format: 'dotwork-library', version: 1, exported: this.now().toISOString(), items: await this.list() }; // list() gives every item its name back in data
    if (extra.favorites) file.favorites = [...extra.favorites];
    if (extra.printer) file.printer = structuredClone(extra.printer);
    return file;
  }

  /**
   * Add a document as it is, under its own id and the free name nearest to `name` (a restore, or a move from the old
   * storage). It never replaces: an id already here is an error, so the caller decides what to do about it.
   */
  async add(item: LibraryItem, name = item.name): Promise<LibraryItem> {
    if ((await this.backend.all()).some((i) => i.id === item.id)) throw new Error(`There is already a document with the id ${item.id}.`);
    const clean = await this.uniqueName(item.kind, name);
    const added = { ...structuredClone(item), name: clean, data: { ...structuredClone(item.data), name: clean } } as LibraryItem;
    await this.put(added);
    return added;
  }
}
