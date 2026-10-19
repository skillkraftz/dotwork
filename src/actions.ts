import type { Page, PageElement } from './format/types';
import { canMove, cycleHit, moveGroup } from './geometry';
import type { Store } from './store';

const clone = (page: Page) => structuredClone(page);

/** Put a new element on top of the page and select it. */
export function addElement(store: Store, el: PageElement) {
  const next = clone(store.page);
  next.elements.push(el);
  store.selected = next.elements.length - 1;
  store.others.clear();
  store.tool = 'select';
  store.commit(next);
}

/** Put several new elements on top of the page, in order, and select them all. */
export function addElements(store: Store, els: PageElement[]) {
  if (!els.length) return;
  const next = clone(store.page);
  const first = next.elements.length;
  next.elements.push(...els);
  store.tool = 'select';
  store.commit(next);
  store.selectMany(els.map((_, i) => first + i));
}

/** The elements an action aimed at `index` applies to: the whole selection when `index` is part of a multiple one. */
function targets(store: Store, index: number): number[] {
  const sel = store.selection;
  return sel.length > 1 && sel.includes(index) ? sel : [index];
}

/** Delete these elements (locked ones stay). */
export function deleteElements(store: Store, indexes: readonly number[]) {
  const gone = new Set(indexes.filter((i) => !store.isLocked(i)));
  if (!gone.size) return;
  const next = clone(store.page);
  next.elements = next.elements.filter((_, i) => !gone.has(i));
  const ids = store.ids.filter((_, i) => !gone.has(i));
  store.selected = null;
  store.others.clear();
  store.commit(next, undefined, ids);
}

export function deleteElement(store: Store, index: number) {
  deleteElements(store, targets(store, index));
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

/** Offsets to try for a copy, so that it lands visibly beside the original but still on the page. */
const COPY_OFFSETS = [[1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Copy elements, nudged one cell so the copies are visible; the copies become the selection. One element's copy sits
 * just above it; copies of several go on top of the page, keeping their order.
 */
export function duplicateElements(store: Store, indexes: readonly number[]) {
  const src = indexes.map((i) => store.page.elements[i]).filter(Boolean);
  if (!src.length) return;
  const [dx, dy] = COPY_OFFSETS.find(([x, y]) => canMove(src, x, y)) ?? [0, 0];
  const copies = moveGroup(structuredClone(src), dx, dy);
  if (src.length > 1) { addElements(store, copies); return; }
  const index = indexes[0];
  const next = clone(store.page);
  next.elements.splice(index + 1, 0, copies[0]);
  const ids = [...store.ids];
  ids.splice(index + 1, 0, -1); // replaced below with a fresh id by the store
  store.selected = index + 1;
  store.others.clear();
  store.commit(next, undefined, store.freshIds(ids));
}

export function duplicateElement(store: Store, index: number) {
  duplicateElements(store, targets(store, index));
}

/** Move elements together by whole or half cells; they stop at the grid edge as a group. */
export function nudgeElements(store: Store, indexes: readonly number[], dx: number, dy: number) {
  const src = indexes.map((i) => store.page.elements[i]).filter(Boolean);
  if (!src.length || indexes.some((i) => store.isLocked(i)) || !canMove(src, dx, dy)) return;
  const next = clone(store.page);
  moveGroup(src, dx, dy).forEach((el, k) => { next.elements[indexes[k]] = el; });
  store.commit(next, `nudge:${indexes.map((i) => store.idAt(i)).join(',')}`);
}

/** Move the selected element (or the whole selection it is part of) by whole or half cells; stops at the grid edge. */
export function nudgeElement(store: Store, index: number, dx: number, dy: number) {
  nudgeElements(store, targets(store, index), dx, dy);
}

/** How far a nudge button moves things: a whole cell, or half a cell when the half-cell toggle is on. */
export const nudgeStep = (store: Store) => (store.halfCells ? 0.5 : 1);

/** Whether pressing a nudge button in this direction (-1, 0 or 1 on each axis) would move the element. */
export function canNudge(store: Store, index: number, dirX: number, dirY: number): boolean {
  const idx = targets(store, index);
  const els = idx.map((i) => store.page.elements[i]);
  return els.every(Boolean) && !idx.some((i) => store.isLocked(i)) && canMove(els, dirX * nudgeStep(store), dirY * nudgeStep(store));
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
