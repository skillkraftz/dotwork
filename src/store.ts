import { emptyPage, type Page } from './format/types';

export type Mode = 'edit' | 'preview';
export type Tool = 'select' | 'shade' | 'pattern' | 'box' | 'rule' | 'checkboxes' | 'text';

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
  selected: number | null = null;
  mode: Mode = 'edit';
  tool: Tool = 'select';
  halfCells = false;
  hidden = new Set<number>();
  locked = new Set<number>();

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
    this.listeners.forEach((fn) => fn());
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

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

  /** Start over with a different page (new, imported or an example); undo can still bring the old one back. */
  replace(page: Page) {
    this.selected = null;
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
  }

  select(index: number | null) {
    if (index === this.selected) return;
    this.selected = index;
    this.emit();
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.emit();
  }

  setTool(tool: Tool) {
    if (tool === this.tool) return;
    this.tool = tool;
    this.emit();
  }

  setHalfCells(on: boolean) {
    if (on === this.halfCells) return;
    this.halfCells = on;
    this.emit();
  }
}
