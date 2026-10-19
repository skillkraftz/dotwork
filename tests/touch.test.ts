import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canNudge, contextActions, nudgeButton, nudgeStep, shiftLayer } from '../src/actions';
import { cycleHit, handlesFor, hitHandle, hitHandlePoint } from '../src/geometry';
import { LongPress } from '../src/longpress';
import { emptyPage, type Page } from '../src/format/types';
import { Store } from '../src/store';

const page = (): Page => ({
  ...emptyPage(),
  elements: [
    { type: 'pattern', pattern: 'lines', x: 4, y: 6, w: 10, h: 8 },
    { type: 'box', x: 6, y: 8, w: 6, h: 6 },
    { type: 'rule', x1: 2, y1: 20, x2: 9, y2: 20 },
  ],
});
const types = (s: Store) => s.page.elements.map((e) => e.type);

describe('long-press menu actions', () => {
  it('lists the five choices and enables them sensibly', () => {
    const s = new Store(page());
    const a = contextActions(s, 2, [2]);
    expect(a.map((x) => x.id)).toEqual(['duplicate', 'delete', 'forward', 'backward', 'beneath']);
    const on = Object.fromEntries(a.map((x) => [x.id, x.enabled]));
    expect(on).toEqual({ duplicate: true, delete: true, forward: false, backward: true, beneath: false });
  });

  it('duplicate copies the element above itself and selects the copy', () => {
    const s = new Store(page());
    contextActions(s, 1, [1, 0]).find((a) => a.id === 'duplicate')!.run();
    expect(types(s)).toEqual(['pattern', 'box', 'box', 'rule']);
    expect(s.selected).toBe(2);
  });

  it('delete removes it and clears the selection', () => {
    const s = new Store(page());
    s.select(1);
    contextActions(s, 1, [1]).find((a) => a.id === 'delete')!.run();
    expect(types(s)).toEqual(['pattern', 'rule']);
    expect(s.selected).toBeNull();
  });

  it('bring forward and send backward move one step and keep the element selected', () => {
    const s = new Store(page());
    contextActions(s, 0, [0]).find((a) => a.id === 'forward')!.run();
    expect(types(s)).toEqual(['box', 'pattern', 'rule']);
    expect(s.selected).toBe(1);
    contextActions(s, 1, [1]).find((a) => a.id === 'backward')!.run();
    expect(types(s)).toEqual(['pattern', 'box', 'rule']);
    expect(s.selected).toBe(0);
    s.undo();
    expect(types(s)).toEqual(['box', 'pattern', 'rule']);
  });

  it('selects the one underneath, wrapping round to the top', () => {
    const s = new Store(page());
    s.select(1);
    const hits = [1, 0]; // topmost first
    const beneath = () => contextActions(s, s.selected!, hits).find((a) => a.id === 'beneath')!;
    expect(beneath().enabled).toBe(true);
    beneath().run();
    expect(s.selected).toBe(0);
    beneath().run();
    expect(s.selected).toBe(1);
  });

  it('refuses to change a locked element', () => {
    const s = new Store(page());
    s.toggleLocked(0);
    const a = contextActions(s, 0, [0]);
    expect(a.find((x) => x.id === 'duplicate')!.enabled).toBe(false);
    expect(a.find((x) => x.id === 'delete')!.enabled).toBe(false);
  });

  it('shiftLayer selects the element first, so a menu opened on an unselected one still follows it', () => {
    const s = new Store(page());
    s.select(2);
    shiftLayer(s, 0, 1);
    expect(types(s)).toEqual(['box', 'pattern', 'rule']);
    expect(s.selected).toBe(1);
  });
});

describe('cycleHit', () => {
  it('steps down through the stack and wraps', () => {
    expect(cycleHit([3, 2, 0], 3)).toBe(2);
    expect(cycleHit([3, 2, 0], 0)).toBe(3);
    expect(cycleHit([3, 2, 0], null)).toBe(3);
    expect(cycleHit([3, 2, 0], 7)).toBe(3);
    expect(cycleHit([], 1)).toBeUndefined();
  });
});

describe('nudge buttons and the half-cell toggle', () => {
  it('move a whole cell, or half a cell when the toggle is on', () => {
    const s = new Store(page());
    expect(nudgeStep(s)).toBe(1);
    nudgeButton(s, 0, 1, 0);
    nudgeButton(s, 0, 0, 1);
    expect(s.page.elements[0]).toMatchObject({ x: 5, y: 7 });
    s.setHalfCells(true);
    expect(nudgeStep(s)).toBe(0.5);
    nudgeButton(s, 0, -1, 0);
    nudgeButton(s, 0, 0, -1);
    expect(s.page.elements[0]).toMatchObject({ x: 4.5, y: 6.5 });
    s.setHalfCells(false);
    nudgeButton(s, 0, 1, 0);
    expect(s.page.elements[0]).toMatchObject({ x: 5.5, y: 6.5 });
  });

  it('moves a rule at both of its ends', () => {
    const s = new Store(page());
    s.setHalfCells(true);
    nudgeButton(s, 2, 0, 1);
    expect(s.page.elements[2]).toMatchObject({ y1: 20.5, y2: 20.5 });
  });

  it('is one undo step for quick presses, and undoes', () => {
    const s = new Store(page());
    nudgeButton(s, 0, 1, 0);
    nudgeButton(s, 0, 1, 0);
    s.undo();
    expect(s.page.elements[0]).toMatchObject({ x: 4 });
  });

  it('stops at the grid edge and the header row, and says so through canNudge', () => {
    const s = new Store({ ...emptyPage(), elements: [{ type: 'box', x: 0, y: 1, w: 3, h: 3 }] });
    expect(canNudge(s, 0, -1, 0)).toBe(false);
    expect(canNudge(s, 0, 0, -1)).toBe(false);
    expect(canNudge(s, 0, 1, 0)).toBe(true);
    nudgeButton(s, 0, -1, 0);
    expect(s.page.elements[0]).toMatchObject({ x: 0, y: 1 });
    s.setHalfCells(true);
    expect(canNudge(s, 0, 0, -1)).toBe(false);
  });

  it('does nothing to a locked element', () => {
    const s = new Store(page());
    s.toggleLocked(0);
    expect(canNudge(s, 0, 1, 0)).toBe(false);
    nudgeButton(s, 0, 1, 0);
    expect(s.page.elements[0]).toMatchObject({ x: 4 });
  });
});

describe('finger-sized handles', () => {
  const el = page().elements[0]; // shade 4,6 10x8
  it('hitHandlePoint takes only the drawn handles, so the rest of an edge still moves the element', () => {
    expect(hitHandlePoint(el, { x: 9, y: 6.3 }, 1.5)).toBe('n'); // middle of the top edge is a handle
    expect(hitHandlePoint(el, { x: 6.5, y: 6 }, 1.5)).toBeNull(); // elsewhere along the edge is not
    expect(hitHandle(el, { x: 6.5, y: 6 }, 1.5)).toBe('n'); // the mouse version grabs the whole edge
  });

  it('picks the nearest handle and respects the tolerance', () => {
    expect(hitHandlePoint(el, { x: 14.4, y: 14.4 }, 1.5)).toBe('se');
    expect(hitHandlePoint(el, { x: 17, y: 17 }, 1.5)).toBeNull();
    expect(handlesFor(el)).toHaveLength(8);
  });
});

describe('LongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the delay when the finger stays', () => {
    const fire = vi.fn();
    const lp = new LongPress(8, 500);
    lp.start(10, 10, fire);
    vi.advanceTimersByTime(499);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fire).toHaveBeenCalledOnce();
    expect(lp.pending).toBe(false);
  });

  it('forgives a small wobble but not a drag', () => {
    const fire = vi.fn();
    const lp = new LongPress(8, 500);
    lp.start(10, 10, fire);
    lp.move(14, 12);
    vi.advanceTimersByTime(600);
    expect(fire).toHaveBeenCalledOnce();
    lp.start(10, 10, fire);
    lp.move(30, 10);
    vi.advanceTimersByTime(600);
    expect(fire).toHaveBeenCalledOnce();
  });

  it('does not fire when released or cancelled first', () => {
    const fire = vi.fn();
    const lp = new LongPress(8, 500);
    lp.start(0, 0, fire);
    vi.advanceTimersByTime(300);
    lp.cancel();
    vi.advanceTimersByTime(600);
    expect(fire).not.toHaveBeenCalled();
  });
});
