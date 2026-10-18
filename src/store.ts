import { emptyPage, type Page } from './format/types';
import { normalizePage } from './format/normalize';

export type Mode = 'edit' | 'preview';

const MAX_HISTORY = 200;
const COALESCE_MS = 1000;

/** Current page, selection, mode and undo/redo history. Pages are never mutated once committed. */
export class Store {
  page: Page;
  selected: number | null = null;
  mode: Mode = 'edit';

  private undoStack: Page[] = [];
  private redoStack: Page[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private listeners = new Set<() => void>();

  constructor(page: Page = emptyPage()) {
    this.page = page;
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

  /**
   * Replace the page with `next` (which the store takes ownership of; pass a clone).
   * Repeated commits with the same `coalesceKey` within a second share one undo step,
   * so typing in a field is undone as a whole.
   */
  commit(next: Page, coalesceKey?: string, now = Date.now()) {
    const merge = coalesceKey !== undefined && coalesceKey === this.lastKey && now - this.lastAt < COALESCE_MS;
    if (!merge) {
      this.undoStack.push(this.page);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    }
    this.lastKey = coalesceKey ?? null;
    this.lastAt = now;
    this.redoStack = [];
    this.page = normalizePage(next);
    this.clampSelection();
    this.emit();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.page);
    this.page = prev;
    this.afterHistoryMove();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.page);
    this.page = next;
    this.afterHistoryMove();
  }

  private afterHistoryMove() {
    this.lastKey = null;
    this.clampSelection();
    this.emit();
  }

  private clampSelection() {
    if (this.selected !== null && this.selected >= this.page.regions.length) this.selected = null;
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
}
