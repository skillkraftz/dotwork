import { COLS, ROWS, type PageElement } from './format/types';
import { validateElement } from './format/validate';
import { groupArea, translate, type Pt } from './geometry';
import { newGroupId } from './groups';
import { errorProblem, type Problem } from './problems';
import type { Library, LibraryItem } from './library/library';
import type { ValidationIssue } from './format/validate';

/**
 * A saved group of elements. Their positions are relative to the group's top-left corner, which is (0, 0), so
 * the group can be put down anywhere. Placing one adds ordinary copies: nothing links them back to the widget.
 */
export interface Widget { id: string; name: string; elements: PageElement[] }

/** What a widget or art document holds: the Library entry has the id, the name is kept once in the entry (`data.name` is filled in when read). */
export interface WidgetData { name: string; elements: PageElement[] }

/** Saved art is a widget of one art element (see art/widget.ts); the Library keeps it as its own kind. */
export const kindOf = (elements: readonly PageElement[]): 'widget' | 'art' => (elements.length === 1 && (elements[0].type === 'art' || elements[0].type === 'image') ? 'art' : 'widget');

/** Check a widget or art document: its elements fit the page format wherever it is placed, and art is exactly one art element. */
export function readWidget(data: unknown, kind: 'widget' | 'art'): { ok: true; widget: WidgetData } | { ok: false; issues: ValidationIssue[] } {
  const fail = (message: string): { ok: false; issues: ValidationIssue[] } => ({ ok: false, issues: [{ rule: 'widget', path: 'elements', message }] });
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, issues: [{ rule: 'root-object', path: '(file)', message: `A ${kind} must be a JSON object.` }] };
  const d = data as { name?: unknown; elements?: unknown };
  if (typeof d.name !== 'string') return { ok: false, issues: [{ rule: 'name', path: 'name', message: '"name" is required and must be a string.' }] };
  if (!Array.isArray(d.elements) || d.elements.length === 0) return fail('"elements" must be a non-empty array.');
  const widget: WidgetData = { name: d.name, elements: d.elements as PageElement[] };
  if (kindOf(widget.elements) !== kind) return fail(kind === 'art' ? 'Art is exactly one art or image element.' : 'A widget is not a single art or image element (that is art).');
  let issues: ValidationIssue[];
  try {
    issues = placeWidget({ id: '', ...widget }, { x: 0, y: 1 }).flatMap((el, i) => validateElement(el, `elements[${i}]`));
  } catch (err) {
    issues = [{ rule: 'element', path: 'elements', message: `The elements can't be placed: ${(err as Error).message}` }];
  }
  return issues.length ? { ok: false, issues } : { ok: true, widget };
}

const asWidget = (item: LibraryItem & { kind: 'widget' | 'art' }): Widget => ({ id: item.id, name: item.name, elements: item.data.elements });

/** A widget from elements on a page, with positions relative to their top-left corner. */
export function makeWidget(id: string, name: string, elements: readonly PageElement[]): Widget {
  const a = groupArea(elements);
  // Groups belong to the page they were made on: a widget is placed as one new group of its own.
  return { id, name: name.trim() || 'Widget', elements: elements.map((el) => { const { group: _gone, ...rest } = translate(structuredClone(el), -a.x, -a.y); return rest as PageElement; }) };
}

/** How many cells across and down a widget covers. */
export function widgetSize(widget: Widget): { w: number; h: number } {
  const { w, h } = groupArea(widget.elements);
  return { w, h };
}

/**
 * Copies of the widget's elements with its top-left corner at `at`, moved back inside the page if it would hang off.
 * Several elements are placed as one group (named so as not to clash with the groups already on the page, `existing`).
 */
export function placeWidget(widget: Widget, at: Pt, existing: readonly PageElement[] = []): PageElement[] {
  const { w, h } = widgetSize(widget);
  const x = Math.max(0, Math.min(COLS - w, at.x)), y = Math.max(1, Math.min(ROWS - h, at.y));
  const group = widget.elements.length > 1 ? newGroupId(existing) : undefined;
  return widget.elements.map((el) => {
    const placed = translate(structuredClone(el), x, y);
    if (group !== undefined) placed.group = group;
    return placed;
  });
}

/**
 * The saved widgets and art: Library documents of kind `widget` and `art`, kept here as a list that can be read at once
 * (the pickers draw from it). Changes are written to the Library first and then shown; the Library window changes
 * documents itself and calls `refresh`.
 */
export class WidgetStore {
  private widgets: Widget[] = [];
  private listeners = new Set<() => void>();
  /** Where a failed rename or delete is reported (the caller of `add` gets the error instead). */
  onError: (problem: Problem) => void = () => {};

  constructor(private library: Library) {}

  list(): readonly Widget[] { return this.widgets; }
  get(id: string): Widget | undefined { return this.widgets.find((w) => w.id === id); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read the saved widgets and art again from the Library. */
  async refresh(): Promise<void> {
    const items = await this.library.list();
    this.widgets = items.filter((i): i is LibraryItem & { kind: 'widget' | 'art' } => i.kind === 'widget' || i.kind === 'art').reverse().map(asWidget); // oldest first
    this.listeners.forEach((fn) => fn());
  }

  /** Save elements as a new widget (or art, for one art element); a taken name gets " 2". Throws if the browser refuses. */
  async add(name: string, elements: readonly PageElement[]): Promise<Widget> {
    const kind = kindOf(elements);
    const made = makeWidget('', name || (kind === 'art' ? 'Art' : 'Widget'), elements);
    const item = await this.library.create(kind, made.name, { name: made.name, elements: made.elements });
    await this.refresh();
    return asWidget(item as LibraryItem & { kind: 'widget' | 'art' });
  }

  async rename(id: string, name: string): Promise<void> {
    try { await this.library.rename(id, name); await this.refresh(); } catch (err) { this.onError(errorProblem('Couldn’t rename it.', err)); }
  }

  async remove(id: string): Promise<void> {
    try { await this.library.remove(id); await this.refresh(); } catch (err) { this.onError(errorProblem('Couldn’t delete it.', err)); }
  }
}
