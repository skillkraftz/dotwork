// The one-time move of saved widgets and art from the old `localStorage` key into the Library store (docs/product-model.md,
// D8). It exists for one release and is removed in phase 4: delete this file, its test, and its call in main.ts.
import { readWidget, kindOf, type Widget } from './widgets';
import type { Library } from './library/library';
import type { Problem } from './problems';
import { errorProblem } from './problems';

export const OLD_WIDGETS_KEY = 'dotwork.widgets';
/** Set once the move has worked, so it runs once. The old key is left as it was. */
export const MOVED_KEY = 'dotwork.widgets.moved';

export type MoveStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type MoveResult = { status: 'done' | 'nothing'; moved: number } | { status: 'failed'; problem: Problem };

/**
 * Copy the old widgets and art into the Library, each as a document with the same id and name (" 2" if the name is
 * taken), then mark the move done. If anything fails, what was copied is taken out again and nothing is marked, so
 * everything is as it was and the move is tried again next time. `keeping` says whether the Library is really being
 * written to the browser's storage; if it is not, the copies last for this visit only, so the move is not marked.
 */
export async function moveOldWidgets(storage: MoveStorage | null, library: Library, keeping: () => boolean = () => true): Promise<MoveResult> {
  const added: string[] = [];
  try {
    if (!storage) return { status: 'nothing', moved: 0 };
    if (storage.getItem(MOVED_KEY)) return { status: 'done', moved: 0 };
    const raw = storage.getItem(OLD_WIDGETS_KEY);
    const old: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(old)) throw new Error(`“${OLD_WIDGETS_KEY}” is not a list of widgets.`);
    const have = new Set((await library.list()).map((i) => i.id));
    for (const w of old as Partial<Widget>[]) {
      if (!w || typeof w.id !== 'string' || typeof w.name !== 'string' || !Array.isArray(w.elements)) continue; // not a widget: it was never listed either
      const kind = kindOf(w.elements);
      const data = readWidget({ name: w.name, elements: w.elements }, kind);
      if (!data.ok || have.has(w.id)) continue; // one that no longer fits the page format was never listed either
      await library.add({ id: w.id, kind, name: w.name, updated: new Date().toISOString(), data: data.widget });
      added.push(w.id);
    }
    if (keeping()) storage.setItem(MOVED_KEY, '1'); // copies in memory only are not a move
    return { status: added.length ? 'done' : 'nothing', moved: added.length };
  } catch (err) {
    for (const id of added) { try { await library.remove(id); } catch { /* it is only a copy; the old key still has the original */ } }
    return { status: 'failed', problem: errorProblem('Your saved widgets and art couldn’t be moved into the Library. They are still where they were, and Dotwork will try again next time.', err) };
  }
}
