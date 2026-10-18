import { describe, expect, it } from 'vitest';
import { dotAt, hitHandle, moveRect, placementProblem, rectFromDots, resizeRect } from '../src/geometry';
import { expandTokens, findUnknownTokens } from '../src/format/tokens';
import { normalizePage } from '../src/format/normalize';
import { emptyPage } from '../src/format/types';

describe('placementProblem', () => {
  const other = { x: 5, y: 5, w: 3, h: 3 };
  it('accepts a free spot', () => {
    expect(placementProblem({ x: 0, y: 1, w: 5, h: 4 }, [other])).toBeNull();
    expect(placementProblem({ x: 8, y: 5, w: 3, h: 3 }, [other])).toBeNull(); // touching is fine
  });
  it('refuses row 0, overlap, off-page and empty regions with a reason', () => {
    expect(placementProblem({ x: 0, y: 0, w: 5, h: 4 }, [])).toMatch(/Row 0/);
    expect(placementProblem({ x: 6, y: 6, w: 1, h: 1 }, [other])).toMatch(/overlap/);
    expect(placementProblem({ x: 26, y: 1, w: 2, h: 1 }, [])).toMatch(/edge/);
    expect(placementProblem({ x: 0, y: 43, w: 1, h: 2 }, [])).toMatch(/edge/);
    expect(placementProblem({ x: 1, y: 1, w: 0, h: 3 }, [])).toMatch(/at least one cell/);
  });
});

describe('dragging helpers', () => {
  it('snaps points to the nearest dot and clamps to the grid', () => {
    expect(dotAt(4.4, 7.6)).toEqual({ x: 1, y: 3 });
    expect(dotAt(-10, 500)).toEqual({ x: 0, y: 44 });
  });
  it('builds a rect from two dots in any direction', () => {
    expect(rectFromDots({ x: 5, y: 9 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 4, w: 3, h: 5 });
  });
  it('keeps moved regions on the page and out of row 0', () => {
    expect(moveRect({ x: 2, y: 2, w: 5, h: 5 }, -10, -10)).toEqual({ x: 0, y: 1, w: 5, h: 5 });
    expect(moveRect({ x: 2, y: 2, w: 5, h: 5 }, 100, 100)).toEqual({ x: 22, y: 39, w: 5, h: 5 });
  });
  it('resizes by moving edges to dots', () => {
    const r = { x: 2, y: 2, w: 5, h: 5 };
    expect(resizeRect(r, 'e', { x: 10, y: 0 })).toEqual({ x: 2, y: 2, w: 8, h: 5 });
    expect(resizeRect(r, 'nw', { x: 1, y: 1 })).toEqual({ x: 1, y: 1, w: 6, h: 6 });
    expect(resizeRect(r, 's', { x: 0, y: 4 })).toEqual({ x: 2, y: 2, w: 5, h: 2 });
    expect(placementProblem(resizeRect(r, 'e', { x: 2, y: 0 }), [])).not.toBeNull();
  });
  it('finds edges and corners but not the interior', () => {
    const r = { x: 2, y: 2, w: 10, h: 10 }; // 6..36 mm
    expect(hitHandle(r, 6, 6, 2)).toBe('nw');
    expect(hitHandle(r, 20, 36, 2)).toBe('s');
    expect(hitHandle(r, 36.5, 20, 2)).toBe('e');
    expect(hitHandle(r, 20, 20, 2)).toBeNull();
    expect(hitHandle(r, 50, 50, 2)).toBeNull();
  });
});

describe('tokens', () => {
  it('expands known tokens and leaves unknown ones', () => {
    expect(expandTokens('{weekday} {month} {day}, {year} wk {week} {monthname}')).toBe('MON OCT 26, 2026 wk 44 OCTOBER');
    expect(expandTokens('{nope}')).toBe('{nope}');
    expect(findUnknownTokens('{day} {nope} {x}')).toEqual(['nope', 'x']);
  });
});

describe('normalizePage', () => {
  it('drops empty borders and labels and clamps label rows', () => {
    const p = emptyPage();
    p.regions = [
      { x: 0, y: 1, w: 3, h: 2, fill: 'lines', border: {}, labels: [] },
      { x: 0, y: 4, w: 3, h: 2, fill: 'lines', labels: [{ text: 'a', row: 7 }] },
    ];
    normalizePage(p);
    expect(p.regions[0]).toEqual({ x: 0, y: 1, w: 3, h: 2, fill: 'lines' });
    expect(p.regions[1].labels![0].row).toBe(1);
  });
});
