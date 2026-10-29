import { describe, expect, it } from 'vitest';
import { convertGenerated, deleteElement, duplicateElements, groupAction, moreActions, selectAll, toggleGroup } from '../src/actions';
import { shadeRects, toneAt } from '../src/format/shade';
import { emptyPage, type Page, type PageElement, type Shade } from '../src/format/types';
import { validatePage } from '../src/format/validate';
import { distanceTo, tapCandidates, touchedBy } from '../src/geometry';
import { dropLoneGroups, newGroupId, regroup } from '../src/groups';
import { Store } from '../src/store';
import { weekBlock } from '../src/builtin/week';

const page = (elements: PageElement[]): Page => ({ ...emptyPage(), elements });

describe('shade tones', () => {
  const shade = (tones: string, extra: Partial<Shade> = {}): Shade => ({ type: 'shade', x: 2, y: 3, w: 4, h: 4, tones, ...extra });

  it('L is solid light, in one rectangle', () => {
    expect(shadeRects(shade('L'))).toEqual([{ x: 2, y: 3, w: 4, h: 4, tone: 'L' }]);
  });

  it('rows: each row takes the next tone, and LB is every other row', () => {
    expect(shadeRects(shade('LB')).map((r) => [r.y, r.h, r.tone])).toEqual([[3, 1, 'L'], [5, 1, 'L']]);
    expect(shadeRects(shade('LBBMBB', { h: 6 })).map((r) => [r.y, r.tone])).toEqual([[3, 'L'], [6, 'M']]);
    expect(shadeRects(shade('LM')).map((r) => [r.y, r.tone])).toEqual([[3, 'L'], [4, 'M'], [5, 'L'], [6, 'M']]);
  });

  it('columns: each column takes the next tone', () => {
    expect(shadeRects(shade('LB', { along: 'columns' })).map((r) => [r.x, r.w, r.tone])).toEqual([[2, 1, 'L'], [4, 1, 'L']]);
  });

  it('checker: the cell at row r, column c takes tone (r + c) mod length', () => {
    const els = shadeRects(shade('LB', { along: 'checker' }));
    const lit = new Set<string>();
    for (const r of els) for (let dy = 0; dy < r.h; dy++) for (let dx = 0; dx < r.w; dx++) lit.add(`${r.y + dy - 3},${r.x + dx - 2}`);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(lit.has(`${r},${c}`), `${r},${c}`).toBe((r + c) % 2 === 0);
    expect(toneAt({ tones: 'LMD', along: 'checker' }, 2, 2)).toBe('M'); // 4 mod 3 = 1
  });

  it('every widens each step, in multiples of half a cell, and the last step is cut to the area', () => {
    expect(shadeRects(shade('LB', { every: 2, h: 5 })).map((r) => [r.y, r.h])).toEqual([[3, 2], [7, 1]]);
    expect(shadeRects(shade('LB', { every: 0.5, h: 2 })).map((r) => [r.y, r.h])).toEqual([[3, 0.5], [4, 0.5]]);
  });

  it('a checker of one tone joins into a single rectangle', () => {
    expect(shadeRects(shade('M', { along: 'checker' }))).toHaveLength(1);
  });
});

describe('groups', () => {
  const box = (x: number, group?: string): PageElement => ({ type: 'box', x, y: 2, w: 2, h: 2, ...(group ? { group } : {}) });

  it('names new groups so they never clash', () => {
    expect(newGroupId([])).toBe('g1');
    expect(newGroupId([box(0, 'g1'), box(3, 'g2')])).toBe('g3');
  });

  it('regroup gives copies of a group a new name of their own', () => {
    const copies = regroup([box(0, 'g1'), box(3, 'g1'), box(6)], [box(0, 'g1'), box(3, 'g1')]);
    expect(copies.map((c) => c.group)).toEqual(['g2', 'g2', undefined]);
  });

  it('a group needs two: a lone member is let go', () => {
    expect(dropLoneGroups([box(0, 'g1'), box(3, 'g2'), box(6, 'g2')]).map((e) => e.group)).toEqual([undefined, 'g2', 'g2']);
  });
});

describe('selecting groups', () => {
  const grouped = () => new Store(page([
    { type: 'box', x: 1, y: 2, w: 4, h: 3, group: 'g1' },
    { type: 'text', x: 2, y: 3, text: 'Hi', group: 'g1' },
    { type: 'rule', x1: 10, y1: 10, x2: 15, y2: 10 },
  ]));

  it('tapping any piece selects the whole group, with the tapped piece as the main one', () => {
    const s = grouped();
    s.pick(0);
    expect(s.selection).toEqual([0, 1]);
    expect(s.selected).toBe(0);
    s.pick(2);
    expect(s.selection).toEqual([2]);
  });

  it('inside a group, pieces are picked one at a time; picking outside leaves it', () => {
    const s = grouped();
    s.pick(0);
    s.enterGroup('g1');
    s.select(1);
    expect(s.editingGroup).toBe('g1');
    s.pick(0);
    expect(s.selection).toEqual([0]);
    s.pick(2); // outside
    expect(s.editingGroup).toBeNull();
    expect(s.selection).toEqual([2]);
  });

  it('editing ends when the group is gone or the tool changes', () => {
    const s = grouped();
    s.enterGroup('g1');
    deleteElement(s, 0); // leaves one piece
    expect(s.editingGroup).toBeNull();
    const t = grouped();
    t.enterGroup('g1');
    t.setTool('box');
    expect(t.editingGroup).toBeNull();
  });

  it('needs two pieces to enter a group', () => {
    const s = new Store(page([{ type: 'box', x: 1, y: 2, w: 4, h: 3, group: 'g1' }]));
    s.enterGroup('g1');
    expect(s.editingGroup).toBeNull();
  });

  it('does not take hidden or locked pieces along', () => {
    const s = grouped();
    s.toggleLocked(1);
    s.pick(0);
    expect(s.selection).toEqual([0]);
  });
});

describe('group and ungroup', () => {
  const three = () => new Store(page([
    { type: 'box', x: 1, y: 2, w: 2, h: 2 },
    { type: 'box', x: 5, y: 2, w: 2, h: 2 },
    { type: 'box', x: 9, y: 2, w: 2, h: 2 },
  ]));

  it('groups a multi-selection, then offers Ungroup, and undo takes it back', () => {
    const s = three();
    s.selectMany([0, 1]);
    expect(groupAction(s)).toBe('group');
    toggleGroup(s);
    expect(s.page.elements.map((e) => e.group)).toEqual(['g1', 'g1', undefined]);
    expect(groupAction(s)).toBe('ungroup');
    expect(s.selection).toEqual([0, 1]);
    toggleGroup(s);
    expect(s.page.elements.map((e) => e.group)).toEqual([undefined, undefined, undefined]);
    s.undo();
    expect(s.page.elements[0].group).toBe('g1');
    expect(validatePage(s.page)).toEqual([]);
  });

  it('does nothing for a single plain element', () => {
    const s = three();
    s.select(0);
    expect(groupAction(s)).toBeNull();
  });

  it('grouping two groups together makes one', () => {
    const s = three();
    s.selectMany([0, 1]); toggleGroup(s);
    s.selectMany([1, 2]); // part of the first group and a loose one
    toggleGroup(s);
    expect(s.page.elements.map((e) => e.group)).toEqual([undefined, 'g2', 'g2']); // the lone piece left behind is let go
  });

  it('moving and deleting a group act on all of it', () => {
    const s = three();
    s.selectMany([0, 1]); toggleGroup(s);
    s.select(2);
    s.pick(1);
    deleteElement(s, 1);
    expect(s.page.elements).toHaveLength(1);
    expect(s.page.elements[0].group).toBeUndefined();
  });

  it('a copy of a group is a group of its own; a piece copied inside a group joins it', () => {
    const s = three();
    s.selectMany([0, 1]); toggleGroup(s);
    s.pick(0);
    duplicateElements(s, s.selection);
    expect(s.page.elements.map((e) => e.group)).toEqual(['g1', 'g1', undefined, 'g2', 'g2']);
    const t = three();
    t.selectMany([0, 1]); toggleGroup(t);
    t.enterGroup('g1');
    t.select(0);
    duplicateElements(t, [0]);
    expect(t.page.elements.map((e) => e.group)).toEqual(['g1', 'g1', 'g1', undefined]);
  });

  it('select all takes every visible, unlocked element', () => {
    const s = three();
    s.toggleLocked(2);
    selectAll(s);
    expect(s.selection).toEqual([0, 1]);
  });
});

describe('the More menu', () => {
  it('holds bring forward, send backward, select underneath, save as widget and half cells', () => {
    const s = new Store(page([{ type: 'box', x: 1, y: 2, w: 2, h: 2 }, { type: 'box', x: 1, y: 2, w: 2, h: 2 }]));
    let saved = false;
    const items = moreActions(s, 0, [1, 0], () => { saved = true; });
    expect(items.map((i) => i.id)).toEqual(['forward', 'backward', 'beneath', 'widget', 'half']);
    expect(items.map((i) => i.enabled)).toEqual([true, false, true, true, true]);
    items.find((i) => i.id === 'widget')!.run();
    expect(saved).toBe(true);
    items.find((i) => i.id === 'half')!.run();
    expect(s.halfCells).toBe(true);
  });
});

describe('finding what a finger meant', () => {
  const els: PageElement[] = [
    { type: 'shade', tones: 'L', x: 2, y: 2, w: 20, h: 20 },
    { type: 'rule', x1: 4, y1: 10, x2: 14, y2: 10 },
    { type: 'text', x: 4, y: 5, text: 'Label' },
  ];

  it('measures the distance to what is drawn: a box only by its sides', () => {
    const box: PageElement = { type: 'box', x: 2, y: 2, w: 10, h: 10 };
    expect(distanceTo(box, { x: 7, y: 7 })).toBe(5);
    expect(distanceTo(box, { x: 2, y: 7 })).toBe(0);
    expect(distanceTo(els[1], { x: 8, y: 11 })).toBe(1);
    expect(distanceTo(els[1], { x: 16, y: 10 })).toBe(2);
  });

  it('a near miss picks the nearest mark within reach, even over a shaded area', () => {
    // 1 cell below the rule, inside the shade: the rule is the nearest mark
    expect(tapCandidates(els, { x: 8, y: 11 }, 2)[0]).toBe(1);
    // the text is nearer to this point than the rule
    expect(tapCandidates(els, { x: 5, y: 7 }, 2)[0]).toBe(2);
  });

  it('with nothing in reach, the area under the finger is picked; outside everything, nothing', () => {
    expect(tapCandidates(els, { x: 18, y: 18 }, 2)).toEqual([0]);
    expect(tapCandidates(els, { x: 26, y: 40 }, 2)).toEqual([]);
    expect(tapCandidates(els, { x: 23, y: 20 }, 2)).toEqual([0]); // just beside the shade
  });

  it('leaves out what is hidden or locked, and ties go to the one on top', () => {
    expect(tapCandidates(els, { x: 8, y: 11 }, 2, (i) => i !== 1)[0]).toBe(0); // without the rule, the shade under the finger
    expect(tapCandidates(els, { x: 8, y: 11 }, 2, (i) => i !== 0)).toEqual([1]);
    const stacked: PageElement[] = [{ type: 'rule', x1: 2, y1: 5, x2: 9, y2: 5 }, { type: 'rule', x1: 2, y1: 5, x2: 9, y2: 5 }];
    expect(tapCandidates(stacked, { x: 5, y: 5 }, 2)[0]).toBe(1);
  });

  it('a dragged box touches what it overlaps, and a box element only by its sides', () => {
    expect(touchedBy(els[1], { x: 8, y: 9, w: 1, h: 2 })).toBe(true);
    expect(touchedBy(els[1], { x: 8, y: 11, w: 1, h: 2 })).toBe(false);
    const box: PageElement = { type: 'box', x: 2, y: 2, w: 10, h: 10 };
    expect(touchedBy(box, { x: 5, y: 5, w: 2, h: 2 })).toBe(false); // wholly inside the outline
    expect(touchedBy(box, { x: 1, y: 6, w: 3, h: 1 })).toBe(true); // crosses the left side
    expect(touchedBy({ type: 'checkboxes', x: 2, y: 2, count: 3 }, { x: 2.5, y: 4.5, w: 1, h: 1 })).toBe(true);
  });
});

describe('convert to elements', () => {
  it('replaces a selected week block with one valid group of its plain elements, in one undo step', () => {
    const store = new Store(page([{ type: 'rule', x1: 1, y1: 1, x2: 5, y2: 1 }, weekBlock()!]));
    store.select(1);
    expect(groupAction(store)).toBe('convert');
    convertGenerated(store);
    const els = store.page.elements;
    expect(els.some((e) => e.type === 'generated')).toBe(false);
    expect(els[0].group).toBeUndefined();
    expect(new Set(els.slice(1).map((e) => e.group))).toEqual(new Set(['g1']));
    expect(validatePage(store.page)).toEqual([]);
    expect(store.selection).toEqual(els.slice(1).map((_, i) => i + 1));
    expect(groupAction(store)).toBe('ungroup');
    store.undo();
    expect(store.page.elements.map((e) => e.type)).toEqual(['rule', 'generated']);
  });
});
