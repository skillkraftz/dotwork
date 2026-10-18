import { readPage } from '../format/read';
import { readSpread, type Spread } from '../format/spread';
import type { Page } from '../format/types';
import type { ValidationIssue } from '../format/validate';

export type LibraryKind = 'page' | 'spread';

interface ItemBase { id: string; name: string; /** ISO time of the last change. */ updated: string }
export type LibraryItem =
  | (ItemBase & { kind: 'page'; data: Page })
  | (ItemBase & { kind: 'spread'; data: Spread });

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

/** Check a parsed backup file; every page and spread inside is checked against the page format too. */
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
    if (raw.kind !== 'page' && raw.kind !== 'spread') return fail('kind', `${at}.kind`, `"kind" must be "page" or "spread", got ${JSON.stringify(raw.kind)}.`);
    const data = raw.kind === 'page' ? readPage(raw.data) : readSpread(raw.data);
    if (!data.ok) {
      for (const d of data.issues) issues.push({ ...d, path: `${at}.data${d.path === '(file)' ? '' : '.' + d.path}` });
      return;
    }
    if (issues.length > before) return;
    const base = { id: raw.id as string, name: raw.name as string, updated: raw.updated as string };
    items.push(raw.kind === 'page'
      ? { ...base, kind: 'page', data: (data as { page: Page }).page }
      : { ...base, kind: 'spread', data: (data as { spread: Spread }).spread });
  });
  return issues.length ? { ok: false, issues } : { ok: true, items };
}

/** Saved pages and spreads: save, open, rename, duplicate, delete, back up and restore. */
export class Library {
  constructor(
    private backend: Backend,
    private now: () => Date = () => new Date(),
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Newest first. */
  async list(): Promise<LibraryItem[]> {
    return (await this.backend.all()).sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<LibraryItem | undefined> {
    return (await this.backend.all()).find((i) => i.id === id);
  }

  async findByName(kind: LibraryKind, name: string): Promise<LibraryItem | undefined> {
    const want = name.trim();
    return (await this.backend.all()).find((i) => i.kind === kind && i.name === want);
  }

  /** Save under a name, keeping the page's or spread's own name in step. Saving over an existing name replaces it. */
  async save(kind: 'page', name: string, data: Page): Promise<LibraryItem>;
  async save(kind: 'spread', name: string, data: Spread): Promise<LibraryItem>;
  async save(kind: LibraryKind, name: string, data: Page | Spread): Promise<LibraryItem> {
    const clean = name.trim() || 'Untitled';
    const existing = await this.findByName(kind, clean);
    const item = { id: existing?.id ?? this.newId(), kind, name: clean, updated: this.now().toISOString(), data: { ...structuredClone(data), name: clean } } as LibraryItem;
    await this.backend.put(item);
    return item;
  }

  async rename(id: string, name: string): Promise<void> {
    const item = await this.get(id);
    const clean = name.trim();
    if (!item || !clean) return;
    await this.backend.put({ ...item, name: clean, updated: this.now().toISOString(), data: { ...item.data, name: clean } } as LibraryItem);
  }

  async duplicate(id: string): Promise<LibraryItem | undefined> {
    const item = await this.get(id);
    if (!item) return;
    const names = new Set((await this.backend.all()).filter((i) => i.kind === item.kind).map((i) => i.name));
    let name = `${item.name} copy`;
    for (let n = 2; names.has(name); n++) name = `${item.name} copy ${n}`;
    const copy = { ...item, id: this.newId(), name, updated: this.now().toISOString(), data: { ...structuredClone(item.data), name } } as LibraryItem;
    await this.backend.put(copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    await this.backend.remove(id);
  }

  async exportAll(): Promise<LibraryFile> {
    return { format: 'dotwork-library', version: 1, exported: this.now().toISOString(), items: await this.list() };
  }

  /** Add everything in a backup; an item with the same id as one already here replaces it. Nothing is added if any item is invalid. */
  async importFile(input: unknown): Promise<ImportResult> {
    const r = readLibraryFile(input);
    if (!r.ok) return r;
    const have = new Set((await this.backend.all()).map((i) => i.id));
    for (const item of r.items) await this.backend.put(item);
    const replaced = r.items.filter((i) => have.has(i.id)).length;
    return { ok: true, added: r.items.length - replaced, replaced };
  }
}
