/** Where the starred ids are kept: the browser's local storage, or anything shaped like it (tests use a plain object). */
export type FavoritesStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'dotwork.favorites';

/** The starred items of the library, by id. Kept in the browser; the library backup does not carry them. */
export class Favorites {
  private ids: Set<string>;

  constructor(private storage: FavoritesStorage | null = null) {
    this.ids = new Set(this.load());
  }

  has(id: string): boolean { return this.ids.has(id); }

  /** Star or unstar; answers whether it is starred now. */
  toggle(id: string): boolean {
    const on = !this.ids.has(id);
    if (on) this.ids.add(id); else this.ids.delete(id);
    try { this.storage?.setItem(KEY, JSON.stringify([...this.ids])); } catch { /* storage full or blocked: the stars last for this visit */ }
    return on;
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  }
}
