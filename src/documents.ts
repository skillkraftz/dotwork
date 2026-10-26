// The open page or spread is a Library document, and it saves itself. This file is the logic only (no screen): when a
// change is written, what the "Saved" mark may say, how a document is named, and how a built-in becomes a named copy.
import type { Page } from './format/types';
import type { Spread } from './format/spread';
import type { Library, LibraryItem } from './library/library';

export type DocKind = 'page' | 'spread';

/** How long to wait after the last change before writing it. */
export const SAVE_DELAY_MS = 400;

/**
 * `saved` is only ever the state after a write that worked and with nothing changed since. `unsaved` is a change waiting
 * for its write; `failed` is a write the browser refused (the reason is in `error`).
 */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed';

interface Timers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Runs `write` a moment after the last `touch`, or at once on `flush`, and keeps an honest account of how it went. */
export class Autosave {
  status: SaveStatus = 'saved';
  error: unknown = null;
  private dirty = false;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private write: () => Promise<void>, private delay = SAVE_DELAY_MS, private timers: Timers = realTimers) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(status: SaveStatus) {
    this.status = status;
    this.listeners.forEach((fn) => fn());
  }

  private clear() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Something changed: write it after a pause (each change restarts the pause). */
  touch() {
    this.dirty = true;
    this.clear();
    this.timer = this.timers.set(() => { this.timer = null; void this.flush(); }, this.delay);
    if (this.status !== 'saving') this.set('unsaved');
  }

  /** Start over with nothing to write (another document was opened). */
  reset() {
    this.clear();
    this.dirty = false;
    this.error = null;
    this.set('saved');
  }

  /** Write now if anything is waiting, or if the last write failed (Retry). Resolves when it is done; check `status`. */
  flush(): Promise<void> {
    this.clear();
    if (this.running) return this.running.then(() => (this.dirty || this.status === 'failed' ? this.flush() : undefined));
    if (!this.dirty && this.status !== 'failed') return Promise.resolve();
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    this.dirty = false;
    this.set('saving');
    try {
      await this.write();
      this.error = null;
      this.set(this.dirty ? 'unsaved' : 'saved');
    } catch (err) {
      this.error = err;
      this.dirty = true;
      this.set('failed');
    }
  }
}

/** How the open document is put on the screen and read back. `D` is a whole page or spread file, with its name. */
export interface Adapter<D> {
  read(name: string): D;
  /** Show this document (its own undo history starts empty). */
  show(data: D): void;
  blank(): D;
}

export const UNTITLED = 'Untitled';
const UNTITLED_RE = /^Untitled( \d+)?$/;
export const isUntitled = (name: string) => UNTITLED_RE.test(name.trim());

/** The data of a page or spread entry, or a built-in, as the file it is. */
type Content<K extends DocKind> = K extends 'page' ? Page : Spread;

/**
 * One open document of a kind. It is a Library entry (`id`, `name`) that every change is written to, or a built-in
 * (`builtin`) that is read-only until it is copied. Switching documents writes the current one first.
 */
export class DocSession<K extends DocKind> {
  /** The Library entry. Null for a built-in, and for a new document until its first write has worked. */
  id: string | null = null;
  name = '';
  /** The name of the built-in being shown, or null. */
  builtin: string | null = null;
  readonly autosave: Autosave;
  private listeners = new Set<() => void>();

  constructor(readonly kind: K, private library: Library, private adapter: Adapter<Content<K>>, delay = SAVE_DELAY_MS, timers?: Timers) {
    this.autosave = new Autosave(() => this.persist(), delay, timers);
    this.autosave.subscribe(() => this.emit());
  }

  /** Called when the name, the built-in state or the save status changes. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach((fn) => fn()); }

  get readOnly() { return this.builtin !== null; }
  get untitled() { return !this.readOnly && isUntitled(this.name); }
  get status(): SaveStatus { return this.autosave.status; }

  private async persist() {
    const data = this.adapter.read(this.name);
    if (this.id === null) {
      const item = await this.library.create(this.kind, this.name, data);
      this.id = item.id;
      this.name = item.name;
    } else {
      await this.library.write(this.kind, this.id, this.name, data);
    }
    this.emit();
  }

  /** A change was made to the open document. */
  changed() {
    if (!this.readOnly) this.autosave.touch();
  }

  /** Write what is waiting. Resolves true when nothing is left unwritten. */
  async flush(): Promise<boolean> {
    await this.autosave.flush();
    return this.autosave.status === 'saved';
  }

  private attach(id: string | null, name: string, builtin: string | null) {
    this.id = id;
    this.name = name;
    this.builtin = builtin;
    this.autosave.reset();
    this.emit();
  }

  /** Start a document named Untitled (Untitled 2… if taken). False if the one open could not be written first. */
  async startNew(): Promise<boolean> {
    if (!(await this.flush())) return false;
    const name = await this.library.uniqueName(this.kind, UNTITLED);
    this.attach(null, name, null);
    this.adapter.show(this.adapter.blank());
    this.autosave.touch();
    await this.flush(); // it is in the Library from the start; if that fails, the mark says so
    return true;
  }

  /** Open a saved document. False if the one open could not be written first. */
  async open(item: LibraryItem): Promise<boolean> {
    if (!(await this.flush())) return false;
    this.attach(item.id, item.name, null);
    this.adapter.show(item.data as Content<K>);
    return true;
  }

  /** Open a built-in, read-only. */
  async openBuiltin(data: Content<K>): Promise<boolean> {
    if (!(await this.flush())) return false;
    this.attach(null, data.name, data.name);
    this.adapter.show(structuredClone(data));
    return true;
  }

  /** Add a document from a file, named from it (with " 2" if taken), and open it. */
  async importAs(data: Content<K>): Promise<boolean> {
    if (!(await this.flush())) return false;
    const name = await this.library.uniqueName(this.kind, data.name);
    this.attach(null, name, null);
    this.adapter.show({ ...structuredClone(data), name });
    this.autosave.touch();
    await this.flush();
    return true;
  }

  /**
   * Turn the open built-in into a document of its own under `name` and carry on in it. `edit` makes the change that was
   * attempted (if any), so the copy has it from its first write.
   */
  async makeCopy(name: string, edit?: () => void): Promise<void> {
    const wanted = await this.library.uniqueName(this.kind, name);
    this.attach(null, wanted, null);
    edit?.();
    this.autosave.touch();
    await this.flush();
  }

  /** Give the open document a name; one that is taken gets " 2" added. Returns the name it got. */
  async rename(name: string): Promise<string> {
    if (this.readOnly) return this.name;
    const clean = await this.library.uniqueName(this.kind, name, this.id ?? undefined);
    if (clean !== this.name) {
      this.name = clean;
      this.emit();
      this.autosave.touch();
    }
    return clean;
  }

  /** The entry this session shows was renamed or removed elsewhere (the Library window). */
  renamedElsewhere(id: string, name: string) {
    if (this.id === id) { this.name = name; this.emit(); }
  }
}
