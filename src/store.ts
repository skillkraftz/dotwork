import { emptyPage, type Page } from './format/types';
import { membersOf } from './groups';
import type { IconChoice } from './geometry';
import type { Widget } from './widgets';
import type { WeekPreview } from './format/week';

export type Mode = 'edit' | 'preview';
export type Tool = 'select' | 'pattern' | 'shade' | 'box' | 'rule' | 'checkboxes' | 'text' | 'sequence' | 'icon' | 'widget' | 'art';

const MAX_HISTORY = 200;
const COALESCE_MS = 1000;

interface Snapshot { page: Page; ids: number[] }

/**
 * Current page, selection, mode, tool and undo/redo history. Pages are never mutated once committed.
 * Each element has an id that follows it through reordering, so hiding and locking (which are editor
 * view state, not part of the file) stay with the right element.
 */
export class Store {
  page: Page;
  ids: number[];
  /** The main selected element (the one the properties show); `others` are the rest of a multiple selection, by id. */
  selected: number | null = null;
  others = new Set<number>();
  /** The group being edited from inside: its pieces are picked one at a time instead of as a whole. */
  editingGroup: string | null = null;
  /** What the icon tool places, and what the widget tool places: set by the Advanced picker. */
  icon: IconChoice = { name: 'star', size: 1, tone: 'black' };
  widget: Widget | null = null;
  /** The art the art tool draws into a rectangle (a widget of one art element). */
  art: Widget | null = null;
  mode: Mode = 'edit';
  tool: Tool = 'select';
  halfCells = false;
  /** Which sample week a week block shows while designing: editor view state, not part of the file. */
  weekPreview: WeekPreview = 'full';
  hidden = new Set<number>();
  locked = new Set<number>();
  /** The id of the picture whose "Move picture" is on: dragging it (or the arrow keys) moves the picture inside its box, not the box. Editor view state. */
  movePictureId: number | null = null;

  /**
   * Set while a built-in is open. A change is not made; it is handed here with a function that makes it, to be called
   * once the built-in has a copy to carry on in.
   */
  guard: ((apply: () => void) => void) | null = null;

  private nextId = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private listeners = new Set<() => void>();

  constructor(page: Page = emptyPage()) {
    this.page = page;
    this.ids = page.elements.map(() => this.nextId++);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.syncGroup();
    if (this.movePictureId !== null && !this.movingPicture) this.movePictureId = null; // it ends when something else is selected
    if (this.centeringId !== null && !this.ids.includes(this.centeringId)) this.centeringId = null; // the text is gone

    this.listeners.forEach((fn) => fn());
  }

  /** Editing inside a group ends when the group is gone, or when something outside it is selected. */
  private syncGroup() {
    const g = this.editingGroup;
    if (g === null) return;
    const members = membersOf(this.page.elements, g);
    if (members.length < 2 || this.selection.some((i) => !members.includes(i))) this.editingGroup = null;
  }

  /** Start editing inside a group. */
  enterGroup(group: string) {
    if (membersOf(this.page.elements, group).length < 2) return;
    this.editingGroup = group;
    this.emit();
  }

  leaveGroup() {
    if (this.editingGroup === null) return;
    this.editingGroup = null;
    this.emit();
  }

  /** The elements a tap on `index` selects: its whole group (the usable members), or just itself while editing inside that group. */
  pickSet(index: number): number[] {
    const g = this.page.elements[index]?.group;
    if (g === undefined || g === this.editingGroup) return [index];
    return membersOf(this.page.elements, g).filter((i) => i === index || (!this.isHidden(i) && !this.isLocked(i)));
  }

  /** Select what a tap on `index` means: the element, or its whole group; the tapped one is the main one. */
  pick(index: number) {
    const set = this.pickSet(index);
    if (set.length === 1) this.select(index);
    else this.selectMany([...set.filter((i) => i !== index), index]);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** The id of the text waiting to be centered in the next element tapped ("Center in…"), if any. */
  private centeringId: number | null = null;

  /** Index of the text waiting to be centered in the next element tapped, or null. */
  get centering(): number | null {
    const i = this.centeringId === null ? -1 : this.ids.indexOf(this.centeringId);
    return i < 0 ? null : i;
  }

  startCentering(index: number) {
    this.centeringId = this.ids[index] ?? null;
    this.emit();
  }

  endCentering() {
    if (this.centeringId === null) return;
    this.centeringId = null;
    this.emit();
  }

  /** Whether "Move picture" is on for the one picture that is selected. */
  get movingPicture(): boolean {
    const i = this.selected;
    if (this.movePictureId === null || i === null || this.others.size > 0 || this.ids[i] !== this.movePictureId) return false;
    const type = this.page.elements[i]?.type;
    return type === 'image' || type === 'art';
  }

  /** Turn "Move picture" on or off for the selected picture. */
  setMovePicture(on: boolean) {
    const i = this.selected;
    this.movePictureId = on && i !== null ? this.ids[i] : null;
    this.emit();
  }

  /** Indexes of every selected element, in drawing order. */
  get selection(): number[] {
    if (this.selected === null) return [];
    return this.ids.flatMap((id, i) => (i === this.selected || this.others.has(id) ? [i] : []));
  }
  isSelected(index: number) { return index === this.selected || this.others.has(this.ids[index]); }

  /** Id of the element at `index` (for hidden and locked). */
  idAt(index: number): number { return this.ids[index]; }
  isHidden(index: number) { return this.hidden.has(this.ids[index]); }
  isLocked(index: number) { return this.locked.has(this.ids[index]); }
  get hiddenIndexes(): Set<number> {
    return new Set(this.ids.flatMap((id, i) => (this.hidden.has(id) ? [i] : [])));
  }

  toggleHidden(index: number) { this.toggle(this.hidden, this.ids[index]); }
  toggleLocked(index: number) { this.toggle(this.locked, this.ids[index]); }
  private toggle(set: Set<number>, id: number) {
    if (!set.delete(id)) set.add(id);
    this.emit();
  }

  /**
   * Replace the page with `next` (which the store takes ownership of; pass a clone).
   * `ids` says which element ids `next.elements` carry; leave it out when elements were only edited in
   * place or added at the end. Repeated commits with the same `coalesceKey` within a second share one
   * undo step, so typing in a field is undone as a whole.
   */
  commit(next: Page, coalesceKey?: string, ids?: number[], now = Date.now()) {
    if (this.guard) {
      const guard = this.guard;
      guard(() => this.commit(next, coalesceKey, ids, now));
      return;
    }
    const merge = coalesceKey !== undefined && coalesceKey === this.lastKey && now - this.lastAt < COALESCE_MS;
    if (!merge) {
      this.undoStack.push({ page: this.page, ids: this.ids });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    }
    this.lastKey = coalesceKey ?? null;
    this.lastAt = now;
    this.redoStack = [];
    this.ids = ids ?? this.fitIds(next.elements.length);
    this.page = next;
    this.clampSelection();
    this.emit();
  }

  /** Give every -1 in `ids` a new id. */
  freshIds(ids: number[]): number[] {
    return ids.map((id) => (id === -1 ? this.nextId++ : id));
  }

  private fitIds(count: number): number[] {
    const ids = this.ids.slice(0, count);
    while (ids.length < count) ids.push(this.nextId++);
    return ids;
  }

  /** Open another document: its page, with the selection and the undo history of the one before cleared (undo is per open document). */
  load(page: Page) {
    this.selected = null;
    this.others.clear();
    this.editingGroup = null;
    this.hidden.clear();
    this.locked.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
    this.page = page;
    this.ids = page.elements.map(() => this.nextId++);
    this.emit();
  }

  /** Put a different page in place of this one as a change (a page chosen from the Library for one side of a spread); undo brings the old one back. */
  replace(page: Page) {
    this.selected = null;
    this.others.clear();
    this.editingGroup = null;
    this.hidden.clear();
    this.locked.clear();
    this.commit(page, undefined, page.elements.map(() => this.nextId++));
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ page: this.page, ids: this.ids });
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ page: this.page, ids: this.ids });
    this.restore(next);
  }

  private restore(s: Snapshot) {
    this.page = s.page;
    this.ids = s.ids;
    this.lastKey = null;
    this.clampSelection();
    this.emit();
  }

  private clampSelection() {
    if (this.selected !== null && this.selected >= this.page.elements.length) this.selected = null;
    for (const id of this.others) if (!this.ids.includes(id)) this.others.delete(id);
    if (this.selected === null) this.others.clear();
  }

  /** Select just this element (or nothing). */
  select(index: number | null) {
    if (index !== null && index >= this.page.elements.length) index = null; // a change a guard is holding back has not made it yet
    if (index === this.selected && this.others.size === 0) return;
    this.selected = index;
    this.others.clear();
    this.emit();
  }

  /** Add the element to the selection, or take it out if it is already in. */
  toggleSelect(index: number) {
    if (this.selected === null) { this.selected = index; this.emit(); return; }
    if (index === this.selected) {
      const rest = this.selection.filter((i) => i !== index);
      this.selectMany(rest);
      return;
    }
    const id = this.ids[index];
    if (!this.others.delete(id)) this.others.add(id);
    this.emit();
  }

  /** Select several elements at once; the last is the main one. */
  selectMany(indexes: readonly number[]) {
    indexes = indexes.filter((i) => i < this.page.elements.length);
    this.selected = indexes.length ? indexes[indexes.length - 1] : null;
    this.others = new Set(indexes.slice(0, -1).map((i) => this.ids[i]));
    this.emit();
  }

  /** Choose the icon the icon tool places. */
  setIcon(icon: IconChoice) {
    this.icon = icon;
    this.emit();
  }

  /** Choose the art the art tool places. */
  setArt(art: Widget | null) {
    this.art = art;
    this.emit();
  }

  /** Choose the widget the widget tool places. */
  setWidget(widget: Widget | null) {
    this.widget = widget;
    this.emit();
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.editingGroup = null;
    this.emit();
  }

  setTool(tool: Tool) {
    if (tool === this.tool) return;
    this.tool = tool;
    this.editingGroup = null;
    this.emit();
  }

  setWeekPreview(preview: WeekPreview) {
    if (preview === this.weekPreview) return;
    this.weekPreview = preview;
    this.emit();
  }

  setHalfCells(on: boolean) {
    if (on === this.halfCells) return;
    this.halfCells = on;
    this.emit();
  }
}
