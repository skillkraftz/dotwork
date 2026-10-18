import { describe, expect, it } from 'vitest';
import { formatIssue } from '../src/format/validate';
import { validatePageV1 as validatePage } from '../src/format/validate-v1';

const base = () => ({
  format: 'dotwork-page',
  version: 1,
  name: 'Test',
  grid: { cols: 27, rows: 44, pitch_mm: 3 },
  regions: [{ x: 0, y: 1, w: 27, h: 5, fill: 'lines' }] as Record<string, unknown>[],
});

const rules = (page: unknown) => validatePage(page).map((i) => i.rule);

describe('validatePageV1 (old files, before conversion)', () => {
  it('accepts a minimal page and the spec example', () => {
    expect(validatePage(base())).toEqual([]);
    expect(validatePage({ ...base(), regions: [] })).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(rules(null)).toEqual(['root-object']);
    expect(rules([])).toEqual(['root-object']);
  });

  it('rejects the wrong format', () => {
    expect(rules({ ...base(), format: 'other' })).toContain('format');
  });

  it('rejects an unknown version', () => {
    expect(rules({ ...base(), version: 2 })).toContain('version');
    expect(rules({ ...base(), version: undefined })).toContain('version');
  });

  it('requires a string name', () => {
    expect(rules({ ...base(), name: undefined })).toContain('name');
    expect(rules({ ...base(), name: 3 })).toContain('name');
  });

  it('allows identity to be missing or empty, but it must be a string', () => {
    expect(validatePage({ ...base(), identity: '' })).toEqual([]);
    expect(rules({ ...base(), identity: 5 })).toContain('identity');
  });

  it('rejects unknown tokens in identity and in labels', () => {
    expect(validatePage({ ...base(), identity: '{weekday} {month} {monthname} {day} {year} {week}' })).toEqual([]);
    const a = validatePage({ ...base(), identity: '{weekdy}' });
    expect(a.map((i) => i.rule)).toEqual(['token']);
    expect(a[0].message).toContain('{weekdy}');

    const page = base();
    page.regions[0].labels = [{ text: 'Due {tomorrow}' }];
    const b = validatePage(page);
    expect(b[0].rule).toBe('token');
    expect(b[0].path).toBe('regions[0].labels[0].text');
  });

  it('requires the exact version 1 grid', () => {
    expect(rules({ ...base(), grid: undefined })).toContain('grid');
    expect(rules({ ...base(), grid: { cols: 27, rows: 44, pitch_mm: 4 } })).toContain('grid');
    expect(rules({ ...base(), grid: { cols: 26, rows: 44, pitch_mm: 3 } })).toContain('grid');
  });

  it('requires a regions array', () => {
    expect(rules({ ...base(), regions: undefined })).toEqual(['regions-array']);
    expect(rules({ ...base(), regions: {} })).toEqual(['regions-array']);
  });

  it('rejects regions that are not objects or lack integer coordinates', () => {
    expect(rules({ ...base(), regions: [3] })).toEqual(['region-object']);
    const r = { x: 0.5, y: 1, w: 2, h: 2, fill: 'blank' };
    expect(rules({ ...base(), regions: [r] })).toEqual(['region-integers']);
    expect(rules({ ...base(), regions: [{ y: 1, w: 2, h: 2, fill: 'blank' }] })).toEqual(['region-integers']);
  });

  it('rejects a region in row 0', () => {
    expect(rules({ ...base(), regions: [{ x: 0, y: 0, w: 2, h: 2, fill: 'blank' }] })).toEqual(['header-row']);
  });

  it('rejects regions smaller than one cell', () => {
    expect(rules({ ...base(), regions: [{ x: 0, y: 1, w: 0, h: 2, fill: 'blank' }] })).toContain('size');
    expect(rules({ ...base(), regions: [{ x: 0, y: 1, w: 2, h: 0, fill: 'blank' }] })).toContain('size');
  });

  it('rejects regions outside the grid', () => {
    const out = (r: object) => rules({ ...base(), regions: [{ fill: 'blank', ...r }] });
    expect(out({ x: 26, y: 1, w: 2, h: 1 })).toEqual(['bounds']);
    expect(out({ x: 0, y: 43, w: 1, h: 2 })).toEqual(['bounds']);
    expect(out({ x: -1, y: 1, w: 1, h: 1 })).toEqual(['bounds']);
    expect(out({ x: 0, y: -1, w: 1, h: 1 })).toEqual(['bounds']);
    expect(out({ x: 26, y: 43, w: 1, h: 1 })).toEqual([]);
  });

  it('rejects overlapping regions but allows touching ones', () => {
    const a = { x: 0, y: 1, w: 5, h: 5, fill: 'blank' };
    expect(rules({ ...base(), regions: [a, { ...a, x: 4 }] })).toEqual(['no-overlap']);
    expect(rules({ ...base(), regions: [a, { ...a, x: 5 }] })).toEqual([]);
    expect(rules({ ...base(), regions: [a, { ...a, y: 6 }] })).toEqual([]);
    const issue = validatePage({ ...base(), regions: [a, { ...a, x: 4 }] })[0];
    expect(issue.path).toBe('regions[1]');
    expect(issue.message).toContain('regions[0]');
  });

  it('rejects unknown fills and accepts every known one', () => {
    for (const fill of ['blank', 'lines', 'vlines', 'grid', 'dots', 'checkboxes']) {
      expect(validatePage({ ...base(), regions: [{ x: 0, y: 1, w: 1, h: 1, fill }] })).toEqual([]);
    }
    expect(rules({ ...base(), regions: [{ x: 0, y: 1, w: 1, h: 1, fill: 'hatch' }] })).toEqual(['fill']);
    expect(rules({ ...base(), regions: [{ x: 0, y: 1, w: 1, h: 1 }] })).toEqual(['fill']);
  });

  it('checks borders', () => {
    const withBorder = (border: unknown) => rules({ ...base(), regions: [{ x: 0, y: 1, w: 1, h: 1, fill: 'blank', border }] });
    expect(withBorder({ top: 'thin', bottom: 'thick', left: 'thin', right: 'thick' })).toEqual([]);
    expect(withBorder({ top: 'medium' })).toEqual(['border']);
    expect(withBorder({ middle: 'thin' })).toEqual(['border']);
    expect(withBorder('thin')).toEqual(['border']);
  });

  it('checks labels', () => {
    const withLabels = (labels: unknown) => rules({ ...base(), regions: [{ x: 0, y: 1, w: 3, h: 2, fill: 'lines', labels }] });
    expect(withLabels([{ text: 'a' }, { text: 'b', row: 1, align: 'right', vertical: true }])).toEqual([]);
    expect(withLabels('x')).toEqual(['labels']);
    expect(withLabels([5])).toEqual(['label-object']);
    expect(withLabels([{}])).toEqual(['label-text']);
    expect(withLabels([{ text: 'a', row: 2 }])).toEqual(['label-row']);
    expect(withLabels([{ text: 'a', row: -1 }])).toEqual(['label-row']);
    expect(withLabels([{ text: 'a', row: 0.5 }])).toEqual(['label-row']);
    expect(withLabels([{ text: 'a', align: 'center' }])).toEqual(['label-align']);
    expect(withLabels([{ text: 'a', vertical: 'yes' }])).toEqual(['label-vertical']);
  });

  it('reports every problem, with a path and the rule name', () => {
    const issues = validatePage({ ...base(), version: 3, regions: [{ x: 0, y: 0, w: 1, h: 1, fill: 'x' }] });
    expect(issues.map((i) => i.rule).sort()).toEqual(['fill', 'header-row', 'version']);
    expect(formatIssue(issues[0])).toMatch(/\(rule: [a-z-]+\)$/);
  });
});
