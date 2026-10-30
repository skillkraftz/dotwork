import type { Area, Generated, Page, PageElement } from './format/types';
import { mirrorElement } from './format/mirror';
import { validateElement } from './format/validate';
import { isPicture, panTo, resetView, tidyView, type PictureView } from './format/picture';
import { centered, headerOf } from './format/bounds';
import { boundsOf, canMove, cycleHit, moveGroup } from './geometry';
import { dropLoneGroups, membersOf, newGroupId, regroup } from './groups';
import { convertWeek } from './format/week';
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
  next.elements = dropLoneGroups(next.elements.filter((_, i) => !gone.has(i)));
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
  const moved = moveGroup(structuredClone(src), dx, dy);
  // A piece copied from inside a group joins that group; copies of whole groups are groups of their own.
  const inside = store.editingGroup !== null && src.every((e) => e.group === store.editingGroup);
  const copies = inside ? moved : dropLoneGroups(regroup(moved, store.page.elements));
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

/** The area "Center in…" centers in when `target` is tapped: the element's area, or for a grouped element the area of the whole group (without the text itself). */
export function centerTarget(store: Store, textIndex: number, target: number): Area {
  const els = store.page.elements;
  const g = els[target].group;
  const members = g === undefined ? [target] : membersOf(els, g).filter((i) => i !== textIndex);
  return boundsOf((members.length ? members : [target]).map((i) => els[i]));
}

/** Center the text at `textIndex` in the area of the element at `target`: one undo step. Returns false if it can't be done. */
export function centerTextIn(store: Store, textIndex: number, target: number): boolean {
  const text = store.page.elements[textIndex];
  if (text?.type !== 'text' || textIndex === target || !store.page.elements[target] || store.isLocked(textIndex)) return false;
  const next = clone(store.page);
  next.elements[textIndex] = centered(text, centerTarget(store, textIndex, target), headerOf(store.page).top);
  store.commit(next);
  return true;
}

/** Move elements together by whole or half cells; they stop at the grid edge as a group. */
export function nudgeElements(store: Store, indexes: readonly number[], dx: number, dy: number) {
  const src = indexes.map((i) => store.page.elements[i]).filter(Boolean);
  if (!src.length || indexes.some((i) => store.isLocked(i)) || !canMove(src, dx, dy, headerOf(store.page))) return;
  const next = clone(store.page);
  moveGroup(src, dx, dy, headerOf(store.page), nudgeStep(store)).forEach((el, k) => { next.elements[indexes[k]] = el; });
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
  return els.every(Boolean) && !idx.some((i) => store.isLocked(i)) && canMove(els, dirX * nudgeStep(store), dirY * nudgeStep(store), headerOf(store.page));
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

/**
 * A click on layer `i` in the Layers list. Plain: select it (its whole group, as a tap on the page does). `toggle` (Ctrl/Cmd+click, or a tap in
 * Select mode): add it to the selection or take it out. `range` (Shift+click): select every layer from `anchor`, the one clicked last, to this one.
 * Returns 'one' for a plain click, which the panel follows by showing the layer's properties.
 */
export function selectLayer(store: Store, i: number, how: { toggle: boolean; range: boolean }, anchor: number | null): 'one' | 'many' {
  if (how.range && anchor !== null && anchor < store.page.elements.length) {
    const [from, to] = anchor < i ? [anchor, i] : [i, anchor];
    const rows = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    store.selectMany([...new Set(rows.flatMap((r) => store.pickSet(r)))].sort((a, b) => a - b));
  } else if (how.toggle || how.range) {
    const set = store.pickSet(i), now = store.selection;
    store.selectMany(store.isSelected(i) ? now.filter((r) => !set.includes(r)) : [...new Set([...now, ...set])].sort((a, b) => a - b));
  } else {
    store.pick(i);
    return 'one';
  }
  return 'many';
}

/** Select everything that can be selected: visible, unlocked elements. */
export function selectAll(store: Store) {
  const all = store.page.elements.flatMap((_, i) => (!store.isHidden(i) && !store.isLocked(i) ? [i] : []));
  if (all.length) store.selectMany(all);
}

/** The plain elements a week block turns into, as it is drawn: a block held flipped (see format/mirror.ts) is converted as made and then each piece flipped. */
const plainElements = (el: Generated): PageElement[] => (el.flipped ? convertWeek(mirrorElement(el) as Generated).map(mirrorElement) : convertWeek(el));

/** Replace the selected generated element with the plain elements it draws, as one group in the same places. One undo step; the new group stays selected. */
export function convertGenerated(store: Store) {
  const index = store.selected;
  const el = index === null ? undefined : store.page.elements[index];
  if (index === null || el?.type !== 'generated' || store.selection.length !== 1 || store.isLocked(index)) return;
  const next = clone(store.page);
  const group = newGroupId(next.elements.filter((_, i) => i !== index));
  const plain = plainElements(el).map((e) => ({ ...e, group }));
  next.elements.splice(index, 1, ...plain);
  next.elements = dropLoneGroups(next.elements);
  const ids = [...store.ids];
  ids.splice(index, 1, ...plain.map(() => -1));
  store.others.clear();
  store.selected = index;
  store.commit(next, undefined, store.freshIds(ids));
  store.selectMany(plain.map((_, k) => index + k));
}

/** What the Group / Ungroup button does for the selection: ungroup when all of it is in one group, group when it is several elements, convert when it is one generated block, else nothing. */
export function groupAction(store: Store): 'group' | 'ungroup' | 'convert' | null {
  const els = store.selection.map((i) => store.page.elements[i]);
  if (!els.length || store.selection.some((i) => store.isLocked(i))) return null;
  if (els.length === 1 && els[0].type === 'generated') return 'convert';
  const first = els[0].group;
  if (first !== undefined && els.every((e) => e.group === first)) return 'ungroup';
  return els.length > 1 ? 'group' : null;
}

/** Make the selected elements one group, or take them out of theirs. The selection stays. */
export function toggleGroup(store: Store) {
  const action = groupAction(store);
  if (!action || action === 'convert') return;
  const chosen = new Set(store.selection);
  const next = clone(store.page);
  if (action === 'group') {
    const group = newGroupId(next.elements);
    next.elements.forEach((e, i) => { if (chosen.has(i)) e.group = group; });
    next.elements = dropLoneGroups(next.elements); // a piece left alone in its old group is let go
  } else {
    next.elements.forEach((e, i) => { if (chosen.has(i)) delete e.group; });
    next.elements = dropLoneGroups(next.elements);
  }
  store.commit(next);
}

export interface ContextAction { id: 'duplicate' | 'delete' | 'forward' | 'backward' | 'beneath' | 'widget' | 'half'; label: string; enabled: boolean; run(): void }

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

/** What the More button offers for the selection: the rest of the things that can be done to it. */
export function moreActions(store: Store, index: number, hits: number[], saveWidget: () => void): ContextAction[] {
  const last = store.page.elements.length - 1;
  const beneath = cycleHit(hits, index);
  return [
    { id: 'forward', label: 'Bring forward', enabled: index < last, run: () => shiftLayer(store, index, 1) },
    { id: 'backward', label: 'Send backward', enabled: index > 0, run: () => shiftLayer(store, index, -1) },
    { id: 'beneath', label: 'Select underneath', enabled: hits.length > 1 && beneath !== undefined && beneath !== index, run: () => store.select(beneath ?? index) },
    { id: 'widget', label: 'Save as widget', enabled: true, run: saveWidget },
    { id: 'half', label: `Half cells: ${store.halfCells ? 'on' : 'off'}`, enabled: true, run: () => store.setHalfCells(!store.halfCells) },
  ];
}

/** The picture at `index` with its zoom, pan or rotation changed (or all reset, with null): one undo step per `key` within a second, so a slider drag is one. Returns false when nothing changed. */
export function setPicture(store: Store, index: number, change: PictureView | null, key = 'picture'): boolean {
  const el = store.page.elements[index];
  if (!el || !isPicture(el) || store.isLocked(index)) return false;
  const after = change === null ? resetView(el) : tidyView(el, change);
  if (JSON.stringify(after) === JSON.stringify(el)) return false;
  const next = clone(store.page);
  next.elements[index] = after;
  store.commit(next, `${key}:${store.idAt(index)}`);
  return true;
}

/** Slide a picture inside its box by (dx, dy) cells. */
export function nudgePicture(store: Store, index: number, dx: number, dy: number) {
  const el = store.page.elements[index];
  if (!el || !isPicture(el)) return;
  const after = panTo(el, (el.pan_x ?? 0) + dx, (el.pan_y ?? 0) + dy);
  setPicture(store, index, { pan_x: after.pan_x ?? 0, pan_y: after.pan_y ?? 0 }, 'nudge-picture');
}

/**
 * Copy the elements of `from`, as they are drawn, flipped left to right onto `to`, replacing what `to` has: the same flip a mirrored page
 * is drawn with, but the result is ordinary elements (no mirror setting). A week block is copied as the plain elements it draws. One undo
 * step in `to`. Elements that don't fit `to` (its header row is taken) are left out; returns how many were copied and how many left out.
 */
export function copyMirrored(from: Store, to: Store): { copied: number; skipped: number } {
  const flipped = from.page.elements.flatMap((e) => (e.type === 'generated' ? plainElements(e) : [e])).map(mirrorElement);
  const header = headerOf(to.page);
  const fits = dropLoneGroups(flipped.filter((e) => validateElement(e, 'element', header).length === 0));
  const next = clone(to.page);
  next.elements = fits;
  to.selected = null;
  to.others.clear();
  to.commit(next, undefined, to.freshIds(fits.map(() => -1)));
  return { copied: fits.length, skipped: flipped.length - fits.length };
}
