import { describe, expect, it } from 'vitest';
import { CAP_HEIGHT_EM, centered, drawnText, elementArea } from '../src/format/bounds';
import { mirrorElement } from '../src/format/mirror';
import { moveGroup, uncenter } from '../src/geometry';
import { readPage } from '../src/format/read';
import { layoutPage } from '../src/print/layout';
import type { Item } from '../src/print/display';
import { pageContent } from '../src/render';
import { emptyPage, GRID_X_MM, GRID_Y_MM, PITCH_MM as P, type Page, type Text } from '../src/format/types';
import { TEXT_SIZE_MM } from '../src/format/bounds';

const text = (more: Partial<Text> = {}): Text => ({ type: 'text', x: 1, y: 1, text: 'AB', ...more });
const pageOf = (...elements: Page['elements']): Page => ({ ...emptyPage(), elements });

/** Where the middle of the capitals falls, in cells, from the position the text is laid out at (baseline mm = band top + P - 0.6). */
function capMiddle(t: Text) {
  const d = drawnText(t);
  const size = TEXT_SIZE_MM[d.size ?? 'label'];
  const mid = P - 0.6 - (CAP_HEIGHT_EM * size) / 2;
  const rot = d.rotate ?? 0;
  return rot === 90 ? { x: d.x + mid / P, y: d.y } : rot === 270 ? { x: d.x - mid / P, y: d.y } : { x: d.x, y: d.y + mid / P };
}

describe('centering text in an area', () => {
  it.each([[0, 0, 4, 4], [2, 3, 5, 3], [3, 7, 1, 1], [1, 10, 8, 2], [0.5, 4.5, 3.5, 6.5]])('puts the capitals of text in a box at (%s,%s) %s x %s at its middle', (x, y, w, h) => {
    const area = { x, y, w, h };
    for (const size of ['label', 'heading'] as const) {
      const m = capMiddle(centered(text({ size }), area));
      expect(m.x).toBeCloseTo(x + w / 2, 9);
      expect(m.y).toBeCloseTo(y + h / 2, 9);
    }
  });

  it('centres rotated text the same way, across its band', () => {
    const area = { x: 4, y: 6, w: 3, h: 7 };
    for (const rotate of [90, 270] as const) {
      const m = capMiddle(centered(text({ rotate, size: 'heading' }), area));
      expect(m.x).toBeCloseTo(5.5, 9);
      expect(m.y).toBeCloseTo(9.5, 9);
    }
  });

  it('ignores align, and its area follows the drawn text', () => {
    const area = { x: 2, y: 2, w: 6, h: 2 };
    const a = drawnText({ ...text({ align: 'left' }), center_in: area });
    const b = drawnText({ ...text({ align: 'right' }), center_in: area });
    expect(a).toEqual(b);
    const box = elementArea({ ...text({ align: 'left' }), center_in: area });
    expect(box.x + box.w / 2).toBeCloseTo(5, 9);
  });

  it('stores the nearest half cell and the area, and draws in the screen and the print the same', () => {
    const t = centered(text(), { x: 2, y: 3, w: 5, h: 4 });
    expect(t).toMatchObject({ center_in: { x: 2, y: 3, w: 5, h: 4 }, align: 'center' });
    expect(Number.isInteger(t.x * 2) && Number.isInteger(t.y * 2)).toBe(true);
    const items: Item[] = [];
    layoutPage(pageOf(t), { x: 0, y: 0, pageNumber: null, expand: (s: string) => s }, items);
    const drawn = items.find((i) => i.k === 'text' && i.str === 'AB') as { x: number; y: number; align: string };
    const d = drawnText(t);
    expect(drawn.align).toBe('middle');
    expect(drawn.x).toBeCloseTo(GRID_X_MM + d.x * P, 6);
    expect(drawn.y).toBeCloseTo(GRID_Y_MM + d.y * P + P - 0.6, 6);
    const svg = pageContent(pageOf(t), { mode: 'preview' });
    expect(svg).toContain(`translate(${(d.x * P).toFixed(3).replace(/\.?0+$/, '')} `);
  });

  it('mirrors the area on a left page', () => {
    const t = centered(text(), { x: 2, y: 3, w: 5, h: 4 });
    expect((mirrorElement(t) as Text).center_in).toEqual({ x: 20, y: 3, w: 5, h: 4 });
  });
});

describe('moving centered text', () => {
  const t = centered(text(), { x: 2, y: 3, w: 5, h: 4 });
  const box = { type: 'box' as const, x: 2, y: 3, w: 5, h: 4 };

  it('moved by itself comes loose and snaps to the grid', () => {
    const [moved] = moveGroup([t], 1, 0);
    expect(moved.center_in).toBeUndefined();
    expect(moved).toMatchObject({ x: Math.round(t.x) + 1, y: Math.round(t.y) });
    const [half] = moveGroup([t], 0.5, 0, undefined, 0.5);
    expect(half.x * 2 % 1).toBe(0);
    expect(uncenter(centered(text(), { x: 0, y: 2, w: 3, h: 3 }), 1)).toMatchObject({ x: 2 });
  });

  it('moved with others keeps its place in the area', () => {
    const [mt, mb] = moveGroup([t, box], 3, 2);
    expect((mt as Text).center_in).toEqual({ x: 5, y: 5, w: 5, h: 4 });
    expect(mb).toMatchObject({ x: 5, y: 5 });
    const c = capMiddle(mt as Text);
    expect(c.x).toBeCloseTo(7.5, 9);
    expect(c.y).toBeCloseTo(7, 9);
  });
});

describe('reading pages', () => {
  const page = (el: object) => ({ format: 'dotwork-page', version: 2, name: 'P', grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements: [el] });
  it('reads text with and without center_in, and refuses a broken area', () => {
    expect(readPage(page({ type: 'text', x: 1, y: 2, text: 'Hi' })).ok).toBe(true);
    expect(readPage(page({ type: 'text', x: 1, y: 2, text: 'Hi', align: 'center', center_in: { x: 0.5, y: 2.25, w: 3, h: 1.5 } })).ok).toBe(true);
    expect(readPage(page({ type: 'text', x: 1, y: 2, text: 'Hi', center_in: { x: 0, y: 2, w: -1, h: 1 } })).ok).toBe(false);
    expect(readPage(page({ type: 'text', x: 1, y: 2, text: 'Hi', center_in: 'box' })).ok).toBe(false);
  });
});
