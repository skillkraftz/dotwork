import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { importSvg } from '../src/art/import';
import { artProblems } from '../src/format/art';
import { readPage } from '../src/format/read';
import { formatIssue } from '../src/format/validate';
import { builtinArt } from '../src/builtin/art';
import { BUILTIN_ART, BUILTIN_PAGES, BUILTIN_SPREADS, BUILTIN_WIDGETS } from '../src/builtin/library';
import { builtinWidgets } from '../src/builtin/widgets';
import { TEMPLATES } from '../src/builtin/templates';

// The package's examples are found by looking in the folders: every file must be usable, and what is in a folder is
// what the Library shows.
const root = join(__dirname, '..', 'examples');
const files = (dir: string, ext: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).sort();
const read = (dir: string, f: string) => readFileSync(join(root, dir, f), 'utf8');
const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('examples/pages', () => {
  it('has the recreated journal-system pages', () => {
    for (const f of ['daily-good-time', 'idea-page', 'lined-page', 'dot-grid-page']) expect(files('pages', '.json')).toContain(`${f}.json`);
  });
  for (const f of files('pages', '.json')) {
    it(`${f} is a valid page, and it is in the library`, () => {
      const r = readPage(JSON.parse(read('pages', f)));
      expect(r.ok ? [] : r.issues.map(formatIssue)).toEqual([]);
      if (r.ok) expect(BUILTIN_PAGES.map((p) => p.name)).toContain(r.page.name);
    });
  }
});

describe('examples/widgets', () => {
  it('lists the starter widgets, whatever is in the folder', () => {
    expect(BUILTIN_WIDGETS.map((w) => w.name).sort()).toEqual(files('widgets', '.json').map((f) => (JSON.parse(read('widgets', f)) as { name: string }).name).sort());
    expect(BUILTIN_WIDGETS.length).toBeGreaterThanOrEqual(7);
  });
  it('shows a widget file that is added and drops one that is taken out, and skips one that is broken', () => {
    const warn = quiet();
    const box = { type: 'box', x: 0, y: 1, w: 3, h: 2 };
    const list = (o: Record<string, unknown>) => builtinWidgets(o).map((w) => [w.id, w.name]);
    expect(list({ '../../examples/widgets/one.json': { name: 'One', elements: [box] } })).toEqual([['builtin-one', 'One']]);
    expect(list({ '../../examples/widgets/one.json': { name: 'One', elements: [box] }, '../../examples/widgets/two.json': { name: 'Two', elements: [box] } })).toHaveLength(2);
    expect(list({ '../../examples/widgets/bad.json': { name: 'Bad', elements: [{ type: 'box', x: 0, y: 1, w: 0, h: 2 }] }, '../../examples/widgets/worse.json': { elements: [] } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('examples/art', () => {
  for (const f of files('art', '.svg')) {
    it(`${f} imports, with nothing left out`, () => {
      const r = importSvg(read('art', f));
      expect(r.ok ? r.dropped : r).toEqual([]);
    });
  }
  for (const f of files('art', '.json')) {
    it(`${f} lists presets that fit its art`, () => {
      const svg = f.replace(/\.json$/, '.svg');
      expect(files('art', '.svg')).toContain(svg);
      const r = importSvg(read('art', svg));
      if (!r.ok) throw new Error(r.reason);
      const { presets } = JSON.parse(read('art', f)) as { presets: { name: string; fills?: object; strokes?: object }[] };
      for (const p of presets) expect(artProblems({ ...r.art, fills: p.fills, strokes: p.strokes }), p.name).toEqual([]);
    });
  }
  it('lists each SVG and its presets in the library', () => {
    expect(BUILTIN_ART.map((w) => w.name)).toEqual(['Gauge', 'Engagement gauge', 'Energy gauge']);
  });
  it('puts the same art in each preset with the fills and lines set', () => {
    const [plain, engagement, energy] = BUILTIN_ART.map((w) => w.elements[0] as unknown as { paths: unknown; fills?: object; strokes?: object });
    expect(engagement.paths).toEqual(plain.paths);
    expect(engagement).toMatchObject({ fills: { 'left-half': 'none' }, strokes: { 'centre-line': 'none' } });
    expect(energy).toMatchObject({ fills: { 'left-half': 'medium' }, strokes: { 'centre-line': 'black' } });
    expect(plain.fills).toBeUndefined();
  });
  it('follows the folder: an SVG that is added shows up, a preset file with a bad preset is skipped, a broken SVG is named', () => {
    const warn = quiet();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="a" d="M0 0L10 0L10 10Z" fill="#000"/></svg>';
    const at = (n: string) => `../../examples/art/${n}`;
    expect(builtinArt({ [at('half-donut.svg')]: svg }, {}).map((w) => [w.id, w.name])).toEqual([['builtin-art-half-donut', 'Half donut']]);
    const presets = { [at('half-donut.json')]: { presets: [{ name: 'Light one', fills: { a: 'light' } }, { name: 'Bad', fills: { nope: 'light' } }, { fills: {} }] } };
    expect(builtinArt({ [at('half-donut.svg')]: svg }, presets).map((w) => w.name)).toEqual(['Half donut', 'Light one']);
    expect(builtinArt({ [at('broken.svg')]: '<svg' }, {})).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('preset 2'), expect.stringContaining('preset 3'), expect.stringContaining('broken.svg')]);
    warn.mockRestore();
  });
});

describe('what depends on a page by name', () => {
  it('has every page the spreads and books ask for', () => {
    for (const name of ['Lined spread', 'Dot grid spread', 'Ideas spread']) expect(BUILTIN_SPREADS.map((s) => s.name)).toContain(name);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });
});
