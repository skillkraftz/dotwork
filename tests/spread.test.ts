import { describe, expect, it } from 'vitest';
import { buildSpread, emptySpread, readSpread, withSide } from '../src/format/spread';
import { emptyPage } from '../src/format/types';
import { pageContent, thumbnailSvg } from '../src/render';

describe('spreads', () => {
  it('builds a spread from any two pages, putting each on its own side', () => {
    const s = buildSpread('Pair', { ...emptyPage(), side: 'right' }, { ...emptyPage(), side: 'left' });
    expect(s.left.side).toBe('left');
    expect(s.right.side).toBe('right');
    expect(readSpread(s).ok).toBe(true);
  });

  it('does not change the page it was built from', () => {
    const page = emptyPage();
    withSide(page, 'left');
    expect(page.side).toBeUndefined();
  });

  it('round-trips through JSON', () => {
    const s = emptySpread();
    const r = readSpread(JSON.parse(JSON.stringify(s)));
    expect(r.ok && r.spread).toEqual(s);
  });

  it('rejects a wrong format, version, name and a page on the wrong side', () => {
    const s = emptySpread();
    const rules = (v: unknown) => { const r = readSpread(v); return r.ok ? [] : r.issues.map((i) => i.rule); };
    expect(rules({ ...s, format: 'dotwork-page' })).toContain('format');
    expect(rules({ ...s, version: 3 })).toContain('version');
    expect(rules({ ...s, name: 4 })).toContain('name');
    expect(rules({ ...s, left: { ...s.left, side: 'right' } })).toContain('spread-side');
    expect(rules({ ...s, right: { ...s.right, side: undefined } })).toContain('spread-side');
    expect(rules(null)).toEqual(['root-object']);
  });

  it('reports problems inside a page with the page named in the path', () => {
    const s = emptySpread();
    const bad = { ...s, right: { ...s.right, elements: [{ type: 'box', x: 0.3, y: 1, w: 2, h: 2 }] } };
    const r = readSpread(bad);
    expect(!r.ok && r.issues[0].path).toBe('right.elements[0].x');
  });

  it('draws the header on the correct side of each page', () => {
    const { left, right } = buildSpread('s', { ...emptyPage(), identity: 'MON' }, { ...emptyPage(), identity: 'TUE' });
    // Left page: identity by the spine (right edge), number at the outer (left) corner.
    expect(pageContent(left, { mode: 'export' })).toMatch(/<text x="81" [^>]*font-weight="700"[^>]*text-anchor="end"[^>]*>MON</);
    expect(pageContent(left, { mode: 'export' })).toMatch(/<text x="0" [^>]*>47</);
    // Right page: identity by the spine (left edge), number at the outer (right) corner.
    expect(pageContent(right, { mode: 'export' })).toMatch(/<text x="0" [^>]*font-weight="700"[^>]*>TUE</);
    expect(pageContent(right, { mode: 'export' })).toMatch(/<text x="81" [^>]*text-anchor="end">47</);
  });

  it('draws a thumbnail of one page or of two side by side', () => {
    const s = emptySpread();
    expect(thumbnailSvg([s.left])).toContain('viewBox="0 0 88.9 139.7"');
    const two = thumbnailSvg([s.left, s.right]);
    expect(two).toContain('viewBox="0 0 177.8 139.7"');
    expect(two).toContain('translate(88.9 0)');
  });
});
