import type { Page, PageElement } from './format/types';
import { canMove, cycleHit, moveElement } from './geometry';
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

/** How far a nudge button moves things: a whole cell, or half a cell when the half-cell toggle is on. */
export const nudgeStep = (store: Store) => (store.halfCells ? 0.5 : 1);

/** Whether pressing a nudge button in this direction (-1, 0 or 1 on each axis) would move the element. */
export function canNudge(store: Store, index: number, dirX: number, dirY: number): boolean {
  const el = store.page.elements[index];
  return !!el && !store.isLocked(index) && canMove(el, dirX * nudgeStep(store), dirY * nudgeStep(store));
}

/** The nudge buttons: one step (see `nudgeStep`) in a direction. */
export function nudgeButton(store: Store, index: number, dirX: number, dirY: number) {
  nudgeElement(store, index, dirX * nudgeStep(store), dirY * nudgeStep(store));
}

/** One step toward the front (drawn later) or the back; the element stays selected. */
export function shiftLayer(store: Store, index: number, by: 1 | -1) {
  store.select(index);
  reorderElement(store, index, index + by);
}

export interface ContextAction { id: 'duplicate' | 'delete' | 'forward' | 'backward' | 'beneath'; label: string; enabled: boolean; run(): void }

/**
 * The choices in the menu that long-pressing an element opens (the touch replacement for Alt-click and the
 * keyboard shortcuts). `hits` are the elements under the finger, topmost first.
 */
export function contextActions(store: Store, index: number, hits: number[]): ContextAction[] {
  const last = store.page.elements.length - 1;
  const free = !store.isLocked(index);
  const beneath = cycleHit(hits, index);
  return [
    { id: 'duplicate', label: 'Duplicate', enabled: free, run: () => duplicateElement(store, index) },
    { id: 'delete', label: 'Delete', enabled: free, run: () => deleteElement(store, index) },
    { id: 'forward', label: 'Bring forward', enabled: index < last, run: () => shiftLayer(store, index, 1) },
    { id: 'backward', label: 'Send backward', enabled: index > 0, run: () => shiftLayer(store, index, -1) },
    { id: 'beneath', label: 'Select the one underneath', enabled: hits.length > 1 && beneath !== undefined && beneath !== index, run: () => store.select(beneath ?? index) },
  ];
}
