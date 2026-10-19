import { describe, expect, it } from 'vitest';
import {
  canMove, elementFromDrag, hitElement, hitHandle, moveElement, resizeElement, snapPoint,
} from '../src/geometry';
import { elementArea, limitsArea } from '../src/format/bounds';
import { expandTokens, findUnknownTokens } from '../src/format/tokens';
import { GRID_X_MM, GRID_Y_MM, type Box, type PageElement } from '../src/format/types';

const box: Box = { type: 'box', x: 2, y: 2, w: 5, h: 5 };

describe('page geometry', () => {
  it('centers the 27 x 44 grid on the 88.9 x 139.7 mm page', () => {
    expect(GRID_X_MM).toBeCloseTo(3.95, 10);
    expect(GRID_Y_MM).toBeCloseTo(3.85, 10);
  });
});

describe('snapping', () => {
  it('snaps to whole cells, or half cells when asked, and stays on the grid below the header', () => {
    expect(snapPoint({ x: 4.4, y: 7.6 }, false)).toEqual({ x: 4, y: 8 });
    expect(snapPoint({ x: 4.4, y: 7.6 }, true)).toEqual({ x: 4.5, y: 7.5 });
    expect(snapPoint({ x: -3, y: 0.2 }, false)).toEqual({ x: 0, y: 1 });
    expect(snapPoint({ x: 99, y: 99 }, true)).toEqual({ x: 27, y: 44 });
  });
});

describe('drawing', () => {
  it('builds area elements from a drag in any direction, and nothing from a zero-size drag', () => {
    expect(elementFromDrag('box', { x: 5, y: 9 }, { x: 2, y: 4 })).toEqual({ type: 'box', x: 2, y: 4, w: 3, h: 5 });
    expect(elementFromDrag('pattern', { x: 1, y: 2 }, { x: 1.5, y: 3 })).toMatchObject({ type: 'pattern', w: 0.5, h: 1 });
    expect(elementFromDrag('pattern', { x: 1, y: 2 }, { x: 4, y: 2 })).toBeNull();
    expect(elementFromDrag('box', { x: 1, y: 2 }, { x: 1, y: 2 })).toBeNull();
  });

  it('draws a rule along whichever axis the drag went furthest', () => {
    expect(elementFromDrag('rule', { x: 1, y: 5 }, { x: 9, y: 6 })).toEqual({ type: 'rule', x1: 1, y1: 5, x2: 9, y2: 5 });
    expect(elementFromDrag('rule', { x: 1, y: 5 }, { x: 2, y: 12 })).toEqual({ type: 'rule', x1: 1, y1: 5, x2: 1, y2: 12 });
  });

  it('lays checkboxes along the longer side of the drag', () => {
    expect(elementFromDrag('checkboxes', { x: 3, y: 4 }, { x: 4, y: 9 })).toEqual({ type: 'checkboxes', x: 3, y: 4, count: 5 });
    expect(elementFromDrag('checkboxes', { x: 8, y: 4 }, { x: 3, y: 5 })).toEqual({ type: 'checkboxes', x: 3, y: 4, count: 5, direction: 'across' });
  });
});

describe('moving', () => {
  it('keeps moved elements on the page and out of row 0', () => {
    expect(moveElement(box, -10, -10)).toEqual({ ...box, x: 0, y: 1 });
    expect(moveElement(box, 100, 100)).toEqual({ ...box, x: 22, y: 39 });
    expect(moveElement(box, 0.5, 1)).toEqual({ ...box, x: 2.5, y: 3 });
  });

  it('moves rules by both ends and checkboxes by their strip', () => {
    expect(moveElement({ type: 'rule', x1: 0, y1: 5, x2: 10, y2: 5 }, 100, 1)).toEqual({ type: 'rule', x1: 17, y1: 6, x2: 27, y2: 6 });
    expect(moveElement({ type: 'checkboxes', x: 0, y: 38, count: 4 }, 0, 10)).toEqual({ type: 'checkboxes', x: 0, y: 40, count: 4 });
  });

  it('tells whether a nudge would be blocked', () => {
    expect(canMove(box, -2, 0)).toBe(true);
    expect(canMove(box, -2.5, 0)).toBe(false);
    expect(canMove({ ...box, y: 1 }, 0, -0.5)).toBe(false);
  });
});

describe('resizing', () => {
  it('moves the named edges to the new point', () => {
    expect(resizeElement(box, 'e', { x: 10, y: 0 })).toEqual({ ...box, w: 8 });
    expect(resizeElement(box, 'nw', { x: 1, y: 1 })).toEqual({ ...box, x: 1, y: 1, w: 6, h: 6 });
    expect(resizeElement(box, 's', { x: 0, y: 4.5 })).toEqual({ ...box, h: 2.5 });
  });

  it('refuses a resize that leaves nothing', () => {
    expect(resizeElement(box, 'e', { x: 2, y: 0 })).toBeNull();
    expect(resizeElement(box, 'e', { x: 1, y: 0 })).toBeNull();
  });

  it('slides the ends of a rule along it', () => {
    const h: PageElement = { type: 'rule', x1: 2, y1: 5, x2: 8, y2: 5 };
    expect(resizeElement(h, 'p2', { x: 12, y: 9 })).toEqual({ ...h, x2: 12 });
    const v: PageElement = { type: 'rule', x1: 4, y1: 2, x2: 4, y2: 8 };
    expect(resizeElement(v, 'p1', { x: 9, y: 3 })).toEqual({ ...v, y1: 3 });
    expect(resizeElement(h, 'p1', { x: 8, y: 5 })).toBeNull();
  });

  it('finds edges, corners and rule ends under a point but not a box’s inside', () => {
    const big: Box = { type: 'box', x: 2, y: 2, w: 10, h: 10 };
    expect(hitHandle(big, { x: 2, y: 2 }, 0.5)).toBe('nw');
    expect(hitHandle(big, { x: 7, y: 12 }, 0.5)).toBe('s');
    expect(hitHandle(big, { x: 12.2, y: 7 }, 0.5)).toBe('e');
    expect(hitHandle(big, { x: 7, y: 7 }, 0.5)).toBeNull();
    expect(hitHandle(big, { x: 20, y: 20 }, 0.5)).toBeNull();
    expect(hitHandle({ type: 'rule', x1: 2, y1: 5, x2: 8, y2: 5 }, { x: 8.2, y: 5.1 }, 0.5)).toBe('p2');
    expect(hitHandle({ type: 'text', x: 1, y: 1, text: 'a' }, { x: 1, y: 1 }, 0.5)).toBeNull();
  });
});

describe('hit testing', () => {
  it('hits shades and patterns anywhere inside, boxes only on their drawn sides', () => {
    const shade: PageElement = { type: 'pattern', pattern: 'none', background: 'light', x: 2, y: 2, w: 4, h: 4 };
    expect(hitElement(shade, { x: 3, y: 3 }, 0.1)).toBe(true);
    expect(hitElement(shade, { x: 6.5, y: 3 }, 0.1)).toBe(false);
    expect(hitElement(box, { x: 4, y: 4 }, 0.2)).toBe(false);
    expect(hitElement(box, { x: 4, y: 2.1 }, 0.2)).toBe(true);
    expect(hitElement({ ...box, sides: ['top'] }, { x: 2.1, y: 4 }, 0.2)).toBe(false);
  });

  it('hits rules near the line and checkboxes in their cells', () => {
    const rule: PageElement = { type: 'rule', x1: 0, y1: 5, x2: 10, y2: 5 };
    expect(hitElement(rule, { x: 4, y: 5.1 }, 0.2)).toBe(true);
    expect(hitElement(rule, { x: 4, y: 6 }, 0.2)).toBe(false);
    const cb: PageElement = { type: 'checkboxes', x: 1, y: 1, count: 3, every: 2 };
    expect(hitElement(cb, { x: 1.5, y: 3.5 }, 0)).toBe(true);
    expect(hitElement(cb, { x: 1.5, y: 2.5 }, 0)).toBe(false); // the gap between boxes
  });
});

describe('element areas', () => {
  it('covers a checkbox strip including its spacing', () => {
    expect(elementArea({ type: 'checkboxes', x: 1, y: 2, count: 4, every: 2 })).toEqual({ x: 1, y: 2, w: 1, h: 7 });
    expect(elementArea({ type: 'checkboxes', x: 1, y: 2, count: 4, direction: 'across' })).toEqual({ x: 1, y: 2, w: 4, h: 1 });
  });

  it('estimates text from its length, alignment and rotation', () => {
    const t = { type: 'text', x: 10, y: 5, text: 'abcdefghij' } as const; // 10 glyphs of 1.38 mm = 4.6 cells
    const a = elementArea(t);
    expect(a.w).toBeCloseTo(4.6, 5);
    expect(a.x).toBeGreaterThan(10);
    expect(a.h).toBe(1);
    expect(elementArea({ ...t, align: 'right' }).x + a.w).toBeLessThan(10);
    expect(elementArea({ ...t, align: 'center' }).x).toBeCloseTo(10 - 2.3, 5);
    // Rotated 90, the text climbs from the anchor in the band to its right; rotated 270 it descends in the band to its left.
    expect(elementArea({ ...t, rotate: 90 })).toMatchObject({ x: 10, w: 1 });
    expect(elementArea({ ...t, rotate: 90 }).y + a.w).toBeLessThan(5);
    expect(elementArea({ ...t, rotate: 270 })).toMatchObject({ x: 9, w: 1 });
    expect(elementArea({ ...t, rotate: 270 }).y).toBeGreaterThan(5);
  });

  it('limits text to its anchor band', () => {
    expect(limitsArea({ type: 'text', x: 3, y: 4, text: 'a' })).toEqual({ x: 3, y: 4, w: 0, h: 1 });
    expect(limitsArea({ type: 'text', x: 3, y: 4, text: 'a', rotate: 270 })).toEqual({ x: 2, y: 4, w: 1, h: 0 });
  });
});

describe('tokens', () => {
  it('expands known tokens and leaves unknown ones', () => {
    expect(expandTokens('{weekday} {month} {day}')).toBe('MON OCT 26');
    expect(expandTokens('{nope}')).toBe('{nope}');
    expect(findUnknownTokens('{day} {nope} {x}')).toEqual(['nope', 'x']);
  });
});
