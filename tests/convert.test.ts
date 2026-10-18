import { describe, expect, it } from 'vitest';
import { readPage } from '../src/format/read';
import { validatePage } from '../src/format/validate';

const v1 = (regions: unknown[], extra: object = {}) => ({
  format: 'dotwork-page', version: 1, name: 'Old', identity: '{weekday} {month} {day}',
  grid: { cols: 27, rows: 44, pitch_mm: 3 }, regions, ...extra,
});

function convert(regions: unknown[]) {
  const r = readPage(v1(regions));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  expect(r.converted).toBe(true);
  expect(validatePage(r.page)).toEqual([]);
  return r.page;
}

describe('version 1 conversion', () => {
  it('keeps the name and identity and becomes version 2', () => {
    const p = convert([]);
    expect(p).toMatchObject({ version: 2, name: 'Old', identity: '{weekday} {month} {day}', elements: [] });
    expect(p.side).toBeUndefined();
    const r = readPage(v1([], { identity: undefined }));
    expect(r.ok && 'identity' in r.page).toBe(false);
  });

  it('rejects an invalid version 1 file with the version 1 rule', () => {
    const r = readPage(v1([{ x: 0, y: 0, w: 1, h: 1, fill: 'blank' }]));
    expect(!r.ok && r.issues[0].rule).toBe('header-row');
  });

  it('turns each fill into a pattern, and blank into nothing', () => {
    for (const fill of ['lines', 'vlines', 'grid', 'dots']) {
      expect(convert([{ x: 1, y: 2, w: 3, h: 4, fill }]).elements).toEqual([{ type: 'pattern', pattern: fill, x: 1, y: 2, w: 3, h: 4 }]);
    }
    expect(convert([{ x: 1, y: 2, w: 3, h: 4, fill: 'blank' }]).elements).toEqual([]);
  });

  it('turns a checkbox fill into checkboxes every second row plus lines beside them', () => {
    expect(convert([{ x: 2, y: 3, w: 10, h: 5, fill: 'checkboxes' }]).elements).toEqual([
      { type: 'checkboxes', x: 2, y: 3, count: 3, every: 2, size: 0.6 },
      { type: 'pattern', pattern: 'lines', x: 3, y: 3, w: 9, h: 5 },
    ]);
    // A region one cell wide has no room for lines.
    expect(convert([{ x: 0, y: 1, w: 1, h: 2, fill: 'checkboxes' }]).elements).toHaveLength(1);
  });

  it('groups borders into boxes by weight', () => {
    const els = convert([{ x: 0, y: 1, w: 5, h: 5, fill: 'blank', border: { top: 'thin', bottom: 'thick', left: 'thin' } }]).elements;
    expect(els).toEqual([
      { type: 'box', x: 0, y: 1, w: 5, h: 5, weight: 'thin', sides: ['top', 'left'] },
      { type: 'box', x: 0, y: 1, w: 5, h: 5, weight: 'thick', sides: ['bottom'] },
    ]);
    const all = convert([{ x: 0, y: 1, w: 5, h: 5, fill: 'blank', border: { top: 'thin', bottom: 'thin', left: 'thin', right: 'thin' } }]).elements;
    expect(all).toEqual([{ type: 'box', x: 0, y: 1, w: 5, h: 5, weight: 'thin' }]);
  });

  it('turns labels into text, anchored where version 1 drew them', () => {
    const labels = [{ text: 'a' }, { text: 'b', row: 2, align: 'right' }, { text: 'c', vertical: true }];
    expect(convert([{ x: 3, y: 4, w: 6, h: 5, fill: 'blank', labels }]).elements).toEqual([
      { type: 'text', x: 3, y: 4, text: 'a' },
      { type: 'text', x: 9, y: 6, text: 'b', align: 'right' },
      { type: 'text', x: 3, y: 9, text: 'c', rotate: 90 },
    ]);
  });

  it('orders each region as fill, then borders, then labels, region by region', () => {
    const els = convert([
      { x: 0, y: 1, w: 5, h: 3, fill: 'lines', border: { bottom: 'thin' }, labels: [{ text: 'x' }] },
      { x: 0, y: 4, w: 5, h: 3, fill: 'dots' },
    ]).elements.map((e) => e.type);
    expect(els).toEqual(['pattern', 'box', 'text', 'pattern']);
  });
});
