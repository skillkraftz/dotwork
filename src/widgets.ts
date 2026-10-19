import { COLS, ROWS, type PageElement } from './format/types';
import { validateElement } from './format/validate';
import { groupArea, translate, type Pt } from './geometry';

/**
 * A saved group of elements. Their positions are relative to the group's top-left corner, which is (0, 0), so
 * the group can be put down anywhere. Placing one adds ordinary copies: nothing links them back to the widget.
 */
export interface Widget { id: string; name: string; elements: PageElement[] }

const KEY = 'dotwork.widgets';

/** A widget from elements on a page, with positions relative to their top-left corner. */
export function makeWidget(id: string, name: string, elements: readonly PageElement[]): Widget {
  const a = groupArea(elements);
  return { id, name: name.trim() || 'Widget', elements: elements.map((el) => translate(structuredClone(el), -a.x, -a.y)) };
}

/** How many cells across and down a widget covers. */
export function widgetSize(widget: Widget): { w: number; h: number } {
  const { w, h } = groupArea(widget.elements);
  return { w, h };
}

/** Copies of the widget's elements with its top-left corner at `at`, moved back inside the page if it would hang off. */
export function placeWidget(widget: Widget, at: Pt): PageElement[] {
  const { w, h } = widgetSize(widget);
  const x = Math.max(0, Math.min(COLS - w, at.x)), y = Math.max(1, Math.min(ROWS - h, at.y));
  return widget.elements.map((el) => translate(structuredClone(el), x, y));
}

/** The place the widget list is kept: the browser's local storage, or anything shaped like it (tests use a plain object). */
export type WidgetStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The saved widgets, kept in the browser next to the library. */
export class WidgetStore {
  private widgets: Widget[] = [];
  private listeners = new Set<() => void>();

  constructor(private storage: WidgetStorage | null = null, private newId: () => string = () => crypto.randomUUID()) {
    this.widgets = this.load();
  }

  list(): readonly Widget[] { return this.widgets; }
  get(id: string): Widget | undefined { return this.widgets.find((w) => w.id === id); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(name: string, elements: readonly PageElement[]): Widget {
    const widget = makeWidget(this.newId(), name, elements);
    this.widgets = [...this.widgets, widget];
    this.changed();
    return widget;
  }

  rename(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    this.widgets = this.widgets.map((w) => (w.id === id ? { ...w, name: clean } : w));
    this.changed();
  }

  remove(id: string) {
    this.widgets = this.widgets.filter((w) => w.id !== id);
    this.changed();
  }

  private changed() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.widgets)); } catch { /* storage full or blocked: the widgets last for this visit */ }
    this.listeners.forEach((fn) => fn());
  }

  /** What was saved, leaving out any widget that no longer fits the page format. */
  private load(): Widget[] {
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((w): w is Widget =>
        !!w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.elements) && w.elements.length > 0
        && placeWidget(w, { x: 0, y: 1 }).every((el) => validateElement(el).length === 0));
    } catch { return []; }
  }
}
