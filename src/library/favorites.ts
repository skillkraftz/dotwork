/** Where the starred ids are kept: the browser's local storage, or anything shaped like it (tests use a plain object). */
export type FavoritesStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'dotwork.favorites';

/** The starred items of the library, by id. Kept in the browser; the library backup carries them. */
export class Favorites {
  private ids: Set<string>;

  constructor(private storage: FavoritesStorage | null = null) {
    this.ids = new Set(this.load());
  }

  has(id: string): boolean { return this.ids.has(id); }

  list(): string[] { return [...this.ids]; }

  /** Star or unstar; answers whether it is starred now. */
  toggle(id: string): boolean {
    const on = !this.ids.has(id);
    if (on) this.ids.add(id); else this.ids.delete(id);
    this.save();
    return on;
  }

  /** Star all of these too (a restored backup); nothing is unstarred. Answers how many were new. */
  merge(ids: readonly string[]): number {
    const fresh = ids.filter((id, i) => !this.ids.has(id) && ids.indexOf(id) === i);
    fresh.forEach((id) => this.ids.add(id));
    if (fresh.length) this.save();
    return fresh.length;
  }

  private save() {
    try { this.storage?.setItem(KEY, JSON.stringify([...this.ids])); } catch { /* storage full or blocked: the stars last for this visit */ }
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  }
}
