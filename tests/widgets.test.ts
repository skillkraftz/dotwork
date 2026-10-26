import { describe, expect, it } from 'vitest';
import { addElements, canNudge, deleteElement, duplicateElement, nudgeButton, nudgeElement } from '../src/actions';
import { emptyPage, type Page, type PageElement } from '../src/format/types';
import { validatePage } from '../src/format/validate';
import { groupArea, moveGroup } from '../src/geometry';
import { Store } from '../src/store';
import { makeWidget, placeWidget, readWidget, WidgetStore } from '../src/widgets';
import { Library, MemoryBackend } from '../src/library/library';

const els = (): PageElement[] => [
  { type: 'box', x: 3, y: 5, w: 6, h: 4 },
  { type: 'text', x: 4, y: 6, text: 'Notes' },
  { type: 'checkboxes', x: 3, y: 10, count: 3 },
  { type: 'rule', x1: 12, y1: 5, x2: 12, y2: 12 },
];
const pageWith = (elements: PageElement[]): Page => ({ ...emptyPage(), elements });
const storeWith = (elements: PageElement[] = els()) => new Store(pageWith(elements));
let n = 0;
const makeLibrary = (backend = new MemoryBackend()) => new Library(backend, undefined, () => `id${++n}`);

describe('selecting several elements', () => {
  it('keeps a main selection and the others, in drawing order', () => {
    const s = storeWith();
    s.select(1);
    s.toggleSelect(3);
    s.toggleSelect(0);
    expect(s.selection).toEqual([0, 1, 3]);
    expect(s.selected).toBe(1);
    s.toggleSelect(3); // tapping a selected one again takes it out
    expect(s.selection).toEqual([0, 1]);
    s.toggleSelect(1); // taking out the main one hands over to another
    expect(s.selection).toEqual([0]);
    expect(s.selected).toBe(0);
    s.toggleSelect(0);
    expect(s.selection).toEqual([]);
    expect(s.selected).toBeNull();
  });

  it('plain select replaces it, and a selection follows its elements when others are deleted or reordered', () => {
    const s = storeWith();
    s.selectMany([1, 2, 3]);
    s.select(2);
    expect(s.selection).toEqual([2]);
    s.selectMany([1, 3]);
    deleteElement(s, 0); // not selected, but everything shifts down
    expect(s.selection).toEqual([]); // deleting clears the selection, as it always has
  });

  it('moves several together, keeping their positions relative to each other', () => {
    const s = storeWith();
    s.selectMany([0, 1, 2]);
    nudgeButton(s, 1, 1, 0); // the buttons act on the whole selection
    nudgeButton(s, 2, 0, 1);
    expect(s.page.elements.slice(0, 3)).toEqual([
      { type: 'box', x: 4, y: 6, w: 6, h: 4 },
      { type: 'text', x: 5, y: 7, text: 'Notes' },
      { type: 'checkboxes', x: 4, y: 11, count: 3 },
    ]);
    expect(s.page.elements[3]).toEqual(els()[3]); // the one that wasn't selected stays
    s.undo();
    s.undo();
    expect(s.page.elements).toEqual(els());
  });

  it('stops the whole group at the grid edge, so none of them is left behind', () => {
    const s = storeWith();
    s.selectMany([0, 3]);
    expect(canNudge(s, 0, -1, 0)).toBe(true);
    for (let i = 0; i < 5; i++) nudgeElement(s, 0, -1, 0);
    expect(s.page.elements[0]).toMatchObject({ x: 0 }); // the box reached the left edge...
    expect(s.page.elements[3]).toMatchObject({ x1: 9, x2: 9 }); // ...and the rule is still 9 cells from it, as before
    expect(canNudge(s, 0, -1, 0)).toBe(false);
    const moved = moveGroup(els(), 100, 100);
    expect(groupArea(moved)).toMatchObject({ x: 27 - groupArea(els()).w, y: 44 - groupArea(els()).h });
  });

  it('does not move a group that has a locked element in it', () => {
    const s = storeWith();
    s.selectMany([0, 1]);
    s.toggleLocked(1);
    expect(canNudge(s, 0, 1, 0)).toBe(false);
    nudgeElement(s, 0, 1, 0);
    expect(s.page.elements).toEqual(els());
  });

  it('copies and deletes them together', () => {
    const s = storeWith();
    s.selectMany([0, 1]);
    duplicateElement(s, 1);
    expect(s.page.elements).toHaveLength(6);
    expect(s.page.elements.slice(4)).toEqual([
      { type: 'box', x: 4, y: 6, w: 6, h: 4 },
      { type: 'text', x: 5, y: 7, text: 'Notes' },
    ]);
    expect(s.selection).toEqual([4, 5]); // the copies are what is selected now
    deleteElement(s, 4);
    expect(s.page.elements).toEqual(els());
    expect(s.selection).toEqual([]);
  });

  it('adds several new elements at once and selects them', () => {
    const s = storeWith([]);
    addElements(s, els());
    expect(s.selection).toEqual([0, 1, 2, 3]);
    expect(s.tool).toBe('select');
  });
});

describe('saved widgets', () => {
  it('keeps the elements with their positions relative to the group’s top-left corner', () => {
    const w = makeWidget('w1', ' Notes box ', els());
    expect(w.name).toBe('Notes box');
    expect(w.elements[0]).toMatchObject({ type: 'box', x: 0, y: 0 });
    expect(w.elements[1]).toMatchObject({ type: 'text', x: 1, y: 1 });
    expect(w.elements[3]).toMatchObject({ type: 'rule', x1: 9, y1: 0, x2: 9, y2: 7 });
    expect(els()[0]).toMatchObject({ x: 3 }); // the page's own elements were not changed
  });

  it('saves from one page and places on another as a matching group', async () => {
    const widgets = new WidgetStore(makeLibrary());
    const a = storeWith();
    a.selectMany([0, 1, 2, 3]);
    const saved = await widgets.add('Notes', a.selection.map((i) => a.page.elements[i]));

    const b = new Store(pageWith([{ type: 'rule', x1: 0, y1: 40, x2: 10, y2: 40 }]));
    addElements(b, placeWidget(saved, { x: 10, y: 20 }));
    expect(b.page.elements).toHaveLength(5);
    // the copies match the originals, shifted to the new spot: the originals were at (3, 5)
    const placed = b.page.elements.slice(1);
    expect(placed).toEqual(els().map((e) => (e.type === 'rule'
      ? { ...e, x1: e.x1 + 7, x2: e.x2 + 7, y1: e.y1 + 15, y2: e.y2 + 15, group: 'g1' }
      : { ...e, x: (e as { x: number }).x + 7, y: (e as { y: number }).y + 15, group: 'g1' })));
    expect(validatePage(b.page)).toEqual([]);
    expect(b.selection).toEqual([1, 2, 3, 4]);

    // no link back: editing a copy leaves the widget alone
    (b.page.elements[1] as { x: number }).x = 0;
    expect(widgets.get(saved.id)!.elements[0]).toMatchObject({ x: 0, y: 0 });
    expect(widgets.get(saved.id)!.elements).toHaveLength(4);
  });

  it('moves a widget back onto the page if it would hang off the edge', () => {
    const w = makeWidget('w', 'w', els()); // 9 wide, 8 tall
    const out = placeWidget(w, { x: 26, y: 43 });
    expect(groupArea(out)).toMatchObject({ x: 18, y: 36 });
    expect(validatePage(pageWith(out))).toEqual([]);
    expect(groupArea(placeWidget(w, { x: -3, y: 0 }))).toMatchObject({ x: 0, y: 1 }); // and below the header
  });

  it('is a Library document: it is there next time, can be renamed and deleted', async () => {
    const backend = new MemoryBackend();
    const first = new WidgetStore(makeLibrary(backend));
    const w = await first.add('Habit row', els().slice(0, 2));
    await first.add('Another', els().slice(2));
    const next = new WidgetStore(makeLibrary(backend));
    await next.refresh();
    expect(next.list().map((x) => x.name)).toEqual(['Habit row', 'Another']);
    await first.rename(w.id, 'Habits');
    await first.remove(first.list().find((x) => x.name === 'Another')!.id);
    const again = new WidgetStore(makeLibrary(backend));
    await again.refresh();
    expect(again.list().map((x) => x.name)).toEqual(['Habits']);
    expect(again.list()[0].elements).toEqual(w.elements);
  });

  it('keeps one art element as art, and a taken name gets " 2"', async () => {
    const lib = makeLibrary();
    const store = new WidgetStore(lib);
    await store.add('Star', [{ type: 'art', x: 0, y: 1, w: 3, h: 3, view_box: [0, 0, 10, 10], paths: [{ d: 'M0 0L10 0L10 10Z', fill: 'black', stroke: 'none', stroke_mm: 0 }] } as unknown as PageElement]);
    await store.add('Box', els().slice(0, 1));
    const second = await store.add('Box', els().slice(0, 1));
    expect(second.name).toBe('Box 2');
    expect((await lib.list()).map((i) => [i.kind, i.name]).sort()).toEqual([['art', 'Star'], ['widget', 'Box'], ['widget', 'Box 2']]);
  });

  it('tells its listeners, and a damaged widget document is refused', async () => {
    let calls = 0;
    const store = new WidgetStore(makeLibrary());
    store.subscribe(() => calls++);
    await store.add('A', els());
    expect(calls).toBe(1);
    expect(readWidget({ name: 'Bad', elements: [{ type: 'shade', x: 0, y: 0, w: 1, h: 1 }] }, 'widget').ok).toBe(false);
    expect(readWidget({ name: 'Bad' }, 'widget').ok).toBe(false);
    expect(readWidget({ name: 'Ok', elements: els() }, 'widget').ok).toBe(true);
    expect(readWidget({ name: 'Not art', elements: els() }, 'art').ok).toBe(false);
  });
});
