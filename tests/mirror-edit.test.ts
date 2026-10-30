import { describe, expect, it } from 'vitest';
import { copyMirrored, nudgeElements, selectLayer } from '../src/actions';
import { BUILTIN_PAGES } from '../src/builtin/library';
import { mirrorElement, mirrorPage } from '../src/format/mirror';
import { emptyPage, type Box, type Generated, type Page, type PageElement, type Text } from '../src/format/types';
import { moveGroup, resizeElement } from '../src/geometry';
import { Store } from '../src/store';

const box = (more: Partial<Box> = {}): Box => ({ type: 'box', x: 2, y: 4, w: 5, h: 3, ...more });
const text = (more: Partial<Text> = {}): Text => ({ type: 'text', x: 3, y: 12, text: 'HELLO', ...more });
const left = (elements: PageElement[], more: Partial<Page> = {}): Page => ({ ...emptyPage(), side: 'left', mirror_left: true, elements, ...more });

describe('the flip is its own inverse', () => {
  it('gives every built-in page back exactly', () => {
    for (const page of BUILTIN_PAGES) expect(mirrorPage(mirrorPage(page)), page.name).toEqual(page);
  });

  it('gives back a text with every alignment and turn, and a box with some sides', () => {
    const els: PageElement[] = [
      ...(['right', 'center', undefined] as const).flatMap((align) => ([undefined, 90, 270] as const).map((rotate) => text({ ...(align ? { align } : {}), ...(rotate ? { rotate } : {}) }))),
      box({ sides: ['left', 'top'] }), box({ sides: ['right'] }), box(),
    ];
    for (const e of els) expect(mirrorElement(mirrorElement(e))).toEqual(e);
  });
});

describe('editing a page that is mirrored where it sits', () => {
  it('holds the page as drawn and gives the design back as it was made', () => {
    const made = left([box(), text({ align: 'right' })]);
    const s = new Store(made);
    expect(s.mirrored).toBe(true);
    expect(s.page.elements[0]).toMatchObject({ x: 20, w: 5 });
    expect(s.page.elements[1]).toMatchObject({ x: 24 } satisfies Partial<Text>);
    expect((s.page.elements[1] as Text).align).toBeUndefined(); // right-aligned on the design is left-aligned (the default) on the drawing
    expect(s.document).toEqual(made);
  });

  it('stores a move the other way', () => {
    const s = new Store(left([box()]));
    const moved = moveGroup([s.page.elements[0]], -3, 0)[0]; // dragged three cells toward the left of the screen
    const next = structuredClone(s.page);
    next.elements[0] = moved;
    s.commit(next);
    expect(s.page.elements[0]).toMatchObject({ x: 17 });
    expect(s.document.elements[0]).toMatchObject({ x: 5 }); // stored 2 + 3: toward the spine, as drawn
  });

  it('stores an arrow key the other way', () => {
    const s = new Store(left([box()]));
    nudgeElements(s, [0], 1, 0); // the right arrow
    expect(s.page.elements[0]).toMatchObject({ x: 21 });
    expect(s.document.elements[0]).toMatchObject({ x: 1 });
  });

  it('stores a resize from the left handle as a change of the right edge', () => {
    const s = new Store(left([box()]));
    const wider = resizeElement(s.page.elements[0], 'w', { x: 17, y: 4 })!; // the drawn box is 20 to 25; its left edge is dragged to 17
    expect(wider).toMatchObject({ x: 17, w: 8 });
    const next = structuredClone(s.page);
    next.elements[0] = wider;
    s.commit(next);
    expect(s.document.elements[0]).toMatchObject({ x: 2, w: 8 }); // the stored left edge stays; the stored right edge moved
  });

  it('stores an alignment chosen on the drawing, and a turn, the way round', () => {
    const s = new Store(left([text()])); // stored: left aligned
    expect(s.page.elements[0]).toMatchObject({ x: 24, align: 'right' }); // drawn: against its anchor from the left
    const next = structuredClone(s.page);
    (next.elements[0] as Text).align = 'center'; // chosen in Properties
    (next.elements[0] as Text).rotate = 90;
    s.commit(next);
    expect(s.document.elements[0]).toMatchObject({ x: 3, align: 'center', rotate: 270 });
    const again = structuredClone(s.page);
    delete (again.elements[0] as Text).align; // back to the default, which is left on the drawing
    s.commit(again);
    expect(s.document.elements[0]).toMatchObject({ align: 'right' });
  });

  it('flips the drawing at once when mirroring is turned on or off, and undo flips it back', () => {
    const s = new Store(left([box()], { mirror_left: undefined }));
    expect(s.page.elements[0]).toMatchObject({ x: 2 });
    s.commit({ ...structuredClone(s.page), mirror_left: true });
    expect(s.page.elements[0]).toMatchObject({ x: 20 });
    expect(s.document.elements[0]).toMatchObject({ x: 2 });
    s.commit((() => { const p = structuredClone(s.page); delete p.mirror_left; return p; })());
    expect(s.page.elements[0]).toMatchObject({ x: 2 });
    s.undo();
    expect(s.page.elements[0]).toMatchObject({ x: 20 });
    s.undo();
    expect(s.page.elements[0]).toMatchObject({ x: 2 });
  });

  it('counts the left half of a spread as a left page, whatever its side says', () => {
    const made = left([box()], { side: 'right' });
    const half = new Store(made, 'left');
    expect(half.mirrored).toBe(true);
    expect(half.page.side).toBe('left');
    expect(half.page.elements[0]).toMatchObject({ x: 20 });
    expect(half.document.elements[0]).toMatchObject({ x: 2 });
    const right = new Store(left([box()], { side: 'left' }), 'right');
    expect(right.mirrored).toBe(false); // the right half is never flipped
    expect(right.page.elements[0]).toMatchObject({ x: 2 });
  });

  it('holds a week block flipped in place and gives it back without the mark', () => {
    const week = BUILTIN_PAGES.find((p) => p.elements.some((e) => e.type === 'generated'))!;
    const s = new Store({ ...structuredClone(week), side: 'left', mirror_left: true });
    const block = s.page.elements.find((e) => e.type === 'generated') as Generated;
    expect(block.flipped).toBe(true);
    expect(s.document.elements.some((e) => e.type === 'generated' && 'flipped' in e)).toBe(false);
  });
});

describe('Copy mirrored', () => {
  const pair = (leftEls: PageElement[], rightEls: PageElement[] = []) => ({
    from: new Store({ ...emptyPage(), side: 'left', elements: leftEls }, 'left'),
    to: new Store({ ...emptyPage(), side: 'right', elements: rightEls }, 'right'),
  });

  it('puts the elements flipped on the other page, in the same order', () => {
    const { from, to } = pair([box({ x: 2, w: 5 }), { type: 'rule', x1: 0, y1: 9, x2: 10, y2: 9 }]);
    expect(copyMirrored(from, to)).toEqual({ copied: 2, skipped: 0 });
    expect(to.page.elements).toEqual([box({ x: 20, w: 5 }), { type: 'rule', x1: 27, y1: 9, x2: 17, y2: 9 }]);
    expect(from.page.elements).toHaveLength(2); // this page is left as it is
  });

  it('keeps text readable: the anchor and the alignment swap', () => {
    const { from, to } = pair([text({ x: 3 }), text({ x: 20, align: 'right', y: 14 }), text({ x: 13, align: 'center', y: 16 })]);
    copyMirrored(from, to);
    expect(to.page.elements).toEqual([text({ x: 24, align: 'right' }), text({ x: 7, align: undefined, y: 14 }), text({ x: 14, align: 'center', y: 16 })].map((t) => JSON.parse(JSON.stringify(t))));
  });

  it('swaps the sides of a box that has only some', () => {
    const { from, to } = pair([box({ sides: ['left', 'top'] })]);
    copyMirrored(from, to);
    expect(to.page.elements[0]).toEqual(box({ x: 20, sides: ['right', 'top'] }));
  });

  it('is plain elements, with no mirror setting on the page', () => {
    const { from, to } = pair([box()]);
    copyMirrored(from, to);
    expect(to.document.mirror_left).toBeUndefined();
    expect(to.document.elements).toEqual(to.page.elements);
  });

  it('replaces what the other page had, as one undo step', () => {
    const { from, to } = pair([box()], [box({ x: 10 }), text()]);
    copyMirrored(from, to);
    expect(to.page.elements).toHaveLength(1);
    to.undo();
    expect(to.page.elements).toHaveLength(2);
    expect(to.canUndo).toBe(false);
  });

  it('copies a drawing as it is shown: a mirrored left page gives its mirror image, which is the stored design', () => {
    const from = new Store(left([box({ x: 2, w: 5 })]), 'left');
    const to = new Store({ ...emptyPage(), side: 'right' }, 'right');
    copyMirrored(from, to);
    expect(from.page.elements[0]).toMatchObject({ x: 20 }); // shown flipped
    expect(to.document.elements[0]).toMatchObject({ x: 2 }); // the other page shows the flip of that
  });

  it('leaves out what does not fit the other page’s header row, and says how many', () => {
    const { from, to } = pair([{ ...box(), y: 0, h: 2 }, box({ y: 6 })]);
    to.commit({ ...structuredClone(to.page), identity: 'ID' }); // an identity takes row 0
    const done = copyMirrored(from, to);
    expect(done).toEqual({ copied: 1, skipped: 1 });
  });
});

describe('selecting several layers', () => {
  const store = () => {
    const s = new Store({ ...emptyPage(), elements: [0, 1, 2, 3, 4].map((i) => box({ x: i * 4, w: 3 })) });
    return s;
  };

  it('a click selects one, and Ctrl/Cmd+click adds or removes', () => {
    const s = store();
    expect(selectLayer(s, 1, { toggle: false, range: false }, null)).toBe('one');
    expect(s.selection).toEqual([1]);
    selectLayer(s, 3, { toggle: true, range: false }, 1);
    expect(s.selection).toEqual([1, 3]);
    selectLayer(s, 4, { toggle: true, range: false }, 3);
    expect(s.selection).toEqual([1, 3, 4]);
    selectLayer(s, 3, { toggle: true, range: false }, 4);
    expect(s.selection).toEqual([1, 4]);
    selectLayer(s, 2, { toggle: false, range: false }, 3);
    expect(s.selection).toEqual([2]); // a plain click starts again
  });

  it('Shift+click selects every layer from the last one clicked to this one, either way', () => {
    const s = store();
    selectLayer(s, 1, { toggle: false, range: false }, null);
    expect(selectLayer(s, 3, { toggle: false, range: true }, 1)).toBe('many');
    expect(s.selection).toEqual([1, 2, 3]);
    selectLayer(s, 0, { toggle: false, range: true }, 3);
    expect(s.selection).toEqual([0, 1, 2, 3]);
    selectLayer(s, 4, { toggle: false, range: true }, null); // nothing clicked before: just this one added
    expect(s.selection).toContain(4);
  });

  it('a grouped layer selects its whole group, as on the page', () => {
    const s = new Store({ ...emptyPage(), elements: [{ ...box(), group: 'a' }, box({ x: 5 }), { ...box({ x: 9 }), group: 'a' }, box({ x: 14 })] });
    selectLayer(s, 0, { toggle: false, range: false }, null);
    expect(s.selection).toEqual([0, 2]);
    selectLayer(s, 3, { toggle: true, range: false }, 0);
    expect(s.selection).toEqual([0, 2, 3]);
    selectLayer(s, 2, { toggle: true, range: false }, 3); // taking one piece out takes the group
    expect(s.selection).toEqual([3]);
  });

  it('the selection the page shows is the one the list made, and moving works on all of it', () => {
    const s = store();
    selectLayer(s, 0, { toggle: false, range: false }, null);
    selectLayer(s, 2, { toggle: false, range: true }, 0);
    expect(s.selection).toEqual([0, 1, 2]);
    nudgeElements(s, s.selection, 0, 2);
    expect(s.page.elements.map((e) => (e as Box).y)).toEqual([6, 6, 6, 4, 4]);
  });
});
