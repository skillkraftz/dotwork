import { MemoryBackend, type Backend, type LibraryItem } from './library';

/** What the notice at the top says when documents can't be kept. */
export const CANT_KEEP = 'This browser can’t keep your documents (it has no storage for them, or it is a private window). Dotwork keeps working, but only in memory: everything is lost when this tab is closed or reloaded. Export what you want to keep.';

/**
 * The Library's backend. It uses the browser's IndexedDB; when that is missing, refuses to open, or refuses the first
 * write, it carries on from memory and says so (`keeping` is false and `reason` says why), so nothing ever looks saved
 * when it was not. A write that fails later, after one has worked, is an ordinary failure: the mark says Not saved.
 */
export class Keeper implements Backend {
  private current: Backend;
  private wrote = false;
  /** Whether documents are being written to the browser's storage. */
  keeping = true;
  reason: unknown = null;
  private listeners = new Set<() => void>();

  /** `disk` is null where there is no IndexedDB at all. */
  constructor(private disk: (Backend & { check?(): Promise<void> }) | null) {
    this.current = disk ?? new MemoryBackend();
    if (!disk) this.keeping = false;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fallBack(reason: unknown) {
    this.current = new MemoryBackend();
    this.keeping = false;
    this.reason = reason;
    this.listeners.forEach((fn) => fn());
  }

  /** Try the storage once, before anything is opened (private modes refuse here). */
  async start(): Promise<void> {
    if (!this.disk || !this.keeping) return;
    try { await this.disk.check?.(); } catch (err) { this.fallBack(err); }
  }

  all() { return this.current.all(); }
  remove(id: string) { return this.current.remove(id); }

  async put(item: LibraryItem): Promise<void> {
    try {
      await this.current.put(item);
      if (this.keeping) this.wrote = true;
    } catch (err) {
      if (this.keeping && !this.wrote) { this.fallBack(err); return this.current.put(item); } // a write that fails at start
      throw err;
    }
  }
}
