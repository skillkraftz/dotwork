import type { Page, PageElement } from './format/types';
import { canMove, moveElement } from './geometry';
import type { Store } from './store';

const clone = (page: Page) => structuredClone(page);

/** Put a new element on top of the page and select it. */
export function addElement(store: Store, el: PageElement) {
  const next = clone(store.page);
  next.elements.push(el);
  store.selected = next.elements.length - 1;
  store.tool = 'select';
  store.commit(next);
}

export function deleteElement(store: Store, index: number) {
  const next = clone(store.page);
  next.elements.splice(index, 1);
  const ids = store.ids.filter((_, i) => i !== index);
  store.selected = null;
  store.commit(next, undefined, ids);
}

/** Move the element at `from` so it ends up at `to` in drawing order (higher is on top). */
export function reorderElement(store: Store, from: number, to: number) {
  const last = store.page.elements.length - 1;
  to = Math.max(0, Math.min(last, to));
  if (from === to) return;
  const next = clone(store.page);
  const ids = [...store.ids];
  next.elements.splice(to, 0, ...next.elements.splice(from, 1));
  ids.splice(to, 0, ...ids.splice(from, 1));
  store.selected = store.selected === from ? to : store.selected;
  store.commit(next, undefined, ids);
}

/** Copy an element just above itself, nudged one cell so the copy is visible; it becomes the selection. */
export function duplicateElement(store: Store, index: number) {
  const src = store.page.elements[index];
  if (!src) return;
  const next = clone(store.page);
  const offset = [[1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => canMove(src, dx, dy)) ?? [0, 0];
  next.elements.splice(index + 1, 0, moveElement(structuredClone(src), offset[0], offset[1]));
  const ids = [...store.ids];
  ids.splice(index + 1, 0, -1); // replaced below with a fresh id by the store
  store.selected = index + 1;
  store.commit(next, undefined, store.freshIds(ids));
}

/** Move the selected element by whole or half cells; stops at the grid edge. */
export function nudgeElement(store: Store, index: number, dx: number, dy: number) {
  const el = store.page.elements[index];
  if (!el || store.isLocked(index) || !canMove(el, dx, dy)) return;
  const next = clone(store.page);
  next.elements[index] = moveElement(el, dx, dy);
  store.commit(next, `nudge:${store.idAt(index)}`);
}
