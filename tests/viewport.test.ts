import { describe, expect, it } from 'vitest';
import { fitView, panBy, pinchOf, revealRect, scaleOf, toScreen, viewRect, zoomAt, MAX_ZOOM, type Rect, type Size } from '../src/viewport';

const box: Rect = { x: -8, y: -6, w: 104.9, h: 151.7 };
const phone: Size = { w: 390, h: 700 };

describe('viewport', () => {
  it('fits the whole box at zoom 1 and centres it', () => {
    const v = fitView(box, phone);
    expect(v.zoom).toBe(1);
    const r = viewRect(v, box, phone);
    expect(r.x).toBeLessThanOrEqual(box.x);
    expect(r.x + r.w).toBeGreaterThanOrEqual(box.x + box.w);
    expect(r.y).toBeLessThanOrEqual(box.y);
    expect(r.y + r.h).toBeGreaterThanOrEqual(box.y + box.h);
    expect(v.cx).toBeCloseTo(box.x + box.w / 2);
  });

  it('fits above an inset: the whole box is in the visible part and nothing is hidden under the sheet', () => {
    const inset = 300;
    const v = fitView(box, phone, inset);
    expect(v.zoom).toBeLessThan(1);
    const r = toScreen(box, v, box, phone);
    expect(r.y).toBeGreaterThanOrEqual(-0.001);
    expect(r.y + r.h).toBeLessThanOrEqual(phone.h - inset + 0.001);
    expect(r.x).toBeGreaterThanOrEqual(-0.001);
    expect(r.x + r.w).toBeLessThanOrEqual(phone.w + 0.001);
  });

  it('zooms about a point and keeps the point under the fingers', () => {
    const v = fitView(box, phone);
    const at = { x: 100, y: 200 };
    const before = viewRect(v, box, phone);
    const s0 = scaleOf(v, box, phone);
    const mm = { x: before.x + at.x * s0, y: before.y + at.y * s0 };
    const z = zoomAt(v, 2, at, box, phone);
    expect(z.zoom).toBe(2);
    const after = viewRect(z, box, phone);
    const s1 = scaleOf(z, box, phone);
    expect(after.x + at.x * s1).toBeCloseTo(mm.x);
    expect(after.y + at.y * s1).toBeCloseTo(mm.y);
  });

  it('limits zoom', () => {
    const v = fitView(box, phone);
    expect(zoomAt(v, 1000, { x: 0, y: 0 }, box, phone).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v, 0.0001, { x: 0, y: 0 }, box, phone).zoom).toBeLessThan(1);
  });

  it('pans so the content follows the fingers, and stays on the page', () => {
    const z = zoomAt(fitView(box, phone), 3, { x: 195, y: 350 }, box, phone);
    const p = panBy(z, 50, -30, box, phone);
    const s = scaleOf(z, box, phone);
    expect(p.cx).toBeCloseTo(z.cx - 50 * s);
    expect(p.cy).toBeCloseTo(z.cy + 30 * s);
    const far = panBy(z, -1e6, -1e6, box, phone);
    expect(far.cx).toBeGreaterThanOrEqual(box.x - phone.w * scaleOf(z, box, phone) / 2);
    expect(far.cy).toBeGreaterThanOrEqual(box.y - phone.h * scaleOf(z, box, phone) / 2);
  });

  it('reveals a rectangle hidden under the sheet by scrolling, and leaves a visible one alone', () => {
    const inset = 330;
    const zoomed = zoomAt(fitView(box, phone), 2, { x: 195, y: 350 }, box, phone);
    const lowDown: Rect = { x: 20, y: 120, w: 12, h: 9 };
    const hidden = toScreen(lowDown, zoomed, box, phone);
    expect(hidden.y + hidden.h).toBeGreaterThan(phone.h - inset);
    const v = revealRect(zoomed, lowDown, box, phone, inset);
    expect(v.zoom).toBe(zoomed.zoom);
    const r = toScreen(lowDown, v, box, phone);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(phone.h - inset);
    expect(revealRect(v, lowDown, box, phone, inset)).toEqual(v);
  });

  it('zooms out to reveal something bigger than the room above the sheet', () => {
    const inset = 400;
    const big: Rect = { x: 0, y: 0, w: 81, h: 130 };
    const v = revealRect(fitView(box, phone), big, box, phone, inset);
    const r = toScreen(big, v, box, phone);
    expect(v.zoom).toBeLessThan(1);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(phone.h - inset);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(phone.w);
  });

  it('measures a pinch', () => {
    const p = pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(p.dist).toBe(50);
    expect(p.mid).toEqual({ x: 15, y: 20 });
  });
});
