import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineCapStyle, PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { importSvg, MAX_SVG_BYTES } from '../src/art/import';
import { artMatrix, artPaths, canFill, canStroke, defaultSize } from '../src/format/art';
import { artFromDrag } from '../src/geometry';
import { pointsOf, parseStored } from '../src/format/path';
import { formatIssue, validatePage } from '../src/format/validate';
import type { Art, Page } from '../src/format/types';
import { artColor, pageContent, SCREEN_ART_TONES } from '../src/render';
import { color, drawPage } from '../src/print/draw';
import { makeWidget, placeWidget } from '../src/widgets';

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const paths = (body: string, attrs?: string) => {
  const r = importSvg(svg(body, attrs));
  if (!r.ok) throw new Error(r.reason);
  return r.art.paths;
};
const ds = (body: string, attrs?: string) => paths(body, attrs).map((p) => p.d);

describe('shapes become paths', () => {
  it('a rect', () => expect(ds('<rect x="10" y="20" width="30" height="40"/>')).toEqual(['M10 20L40 20L40 60L10 60Z']));
  it('a rounded rect keeps its corners as curves', () => {
    const [d] = ds('<rect x="0" y="0" width="40" height="20" rx="5"/>');
    expect(d.startsWith('M5 0L35 0C')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    expect(d.endsWith('Z')).toBe(true);
  });
  it('a circle is four curves from its right-hand end', () =>
    expect(ds('<circle cx="50" cy="50" r="10"/>')).toEqual(['M60 50C60 55.523 55.523 60 50 60C44.477 60 40 55.523 40 50C40 44.477 44.477 40 50 40C55.523 40 60 44.477 60 50Z']));
  it('an ellipse uses both radii', () => {
    const pts = pointsOf(parse(ds('<ellipse cx="50" cy="50" rx="20" ry="10"/>')[0]));
    expect(Math.min(...pts.map((p) => p[0]))).toBe(30);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(70);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(40);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(60);
  });
  it('a line has a stroke and no fill', () => {
    expect(paths('<line x1="0" y1="0" x2="10" y2="10" stroke="#000"/>')).toEqual([{ d: 'M0 0L10 10', fill: 'none', stroke: 'black', stroke_mm: expect.any(Number) }]);
  });
  it('a polyline stays open and a polygon closes', () => {
    expect(ds('<polyline points="0,0 10,10 20,0" fill="none" stroke="#000"/>')).toEqual(['M0 0L10 10L20 0']);
    expect(ds('<polygon points="0 0 10 10 20 0"/>')).toEqual(['M0 0L10 10L20 0Z']);
  });
  it('a path with relative commands, shorthands and arcs is written with absolute M, L, C and Z', () => {
    expect(ds('<path d="M10 10 h20 v10 l-5 5 z"/>')).toEqual(['M10 10L30 10L30 20L25 25Z']);
    expect(ds('<path d="m10,10 20,0 0,10 z m5 5 l5 0"/>')).toEqual(['M10 10L30 10L30 20ZM15 15L20 15']);
    expect(ds('<path d="M0 0 Q 10 20 20 0 T 40 0"/>')[0]).toMatch(/^M0 0C[^L]*C[^L]*$/);
  });
  it('an arc becomes curves that stay on the circle', () => {
    const [d] = ds('<path d="M0 50 A50 50 0 0 1 100 50" fill="none" stroke="#000"/>');
    const pts = pointsOf(parse(d));
    expect(d.match(/C/g)).toHaveLength(2);
    expect(pts.at(-1)).toEqual([100, 50]);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0, 2); // over the top, clockwise on screen
  });
  it('arc flags may be run together', () => expect(ds('<path d="M0 0a5 5 0 0010 0" fill="none" stroke="#000"/>')[0].endsWith('10 0')).toBe(true));
  it('leaves out shapes with no size and shapes that draw nothing', () => {
    const r = importSvg(svg('<rect width="0" height="5"/><circle r="0"/><rect width="5" height="5" fill="none"/><rect width="9" height="9"/>'));
    expect(r.ok && r.art.paths).toHaveLength(1);
  });
});

function parse(d: string) {
  const r = parseStored(d);
  if (!r.ok) throw new Error(r.problem);
  return r.segs;
}

describe('transforms are flattened', () => {
  const vb = 'viewBox="-50 -50 200 200"';
  it('translate, scale and nesting', () => {
    expect(ds('<g transform="translate(10 20)"><rect width="5" height="5" transform="scale(2)"/></g>', vb)).toEqual(['M10 20L20 20L20 30L10 30Z']);
  });
  it('rotate about a point', () => {
    expect(ds('<rect width="10" height="5" transform="rotate(90)"/>', vb)).toEqual(['M0 0L0 10L-5 10L-5 0Z']);
    expect(ds('<rect width="10" height="5" transform="rotate(180 5 2.5)"/>', vb)).toEqual(['M10 5L0 5L0 0L10 0Z']);
  });
  it('matrix and skew', () => {
    expect(ds('<rect width="10" height="10" transform="matrix(1 0 0 1 3 4)"/>', vb)).toEqual(['M3 4L13 4L13 14L3 14Z']);
    expect(ds('<rect width="10" height="10" transform="skewX(45)"/>', vb)).toEqual(['M0 0L10 0L20 10L10 10Z']);
  });
  it('a transform scales the line width with it', () => {
    const wide = paths('<line x1="0" y1="0" x2="10" y2="0" stroke="#000" stroke-width="1" transform="scale(3)"/>')[0].stroke_mm;
    const thin = paths('<line x1="0" y1="0" x2="10" y2="0" stroke="#000" stroke-width="1"/>')[0].stroke_mm;
    expect(wide).toBeCloseTo(thin * 3, 1);
  });
  it('leaves no transform attribute in the result', () => expect(JSON.stringify(paths('<g transform="rotate(10)"><path d="M0 0L9 9" stroke="#000"/></g>'))).not.toContain('transform'));
});

describe('colors snap to the nearest tone', () => {
  const fill = (color: string) => {
    const r = importSvg(svg(`<rect width="10" height="10" fill="${color}" stroke="${color === 'none' || color === 'transparent' || color.endsWith(',0)') ? '#000' : color}"/>`));
    return r.ok ? r.art.paths[0].fill : r.reason;
  };
  it.each([
    ['#000', 'black'], ['#000000', 'black'], ['black', 'black'], ['#111', 'black'],
    ['#808080', 'gray'], ['gray', 'gray'], ['rgb(120,120,120)', 'gray'], ['red', 'gray'],
    ['#bdbdbd', 'dark'], ['#c8c8c8', 'dark'],
    ['#dcdcdc', 'medium'], ['lightgray', 'medium'],
    ['#efefef', 'light'], ['#f0f0f0', 'light'], ['whitesmoke', 'light'],
    ['#fff', 'white'], ['white', 'white'], ['rgb(100%,100%,100%)', 'white'],
    ['none', 'none'], ['transparent', 'none'], ['rgba(0,0,0,0)', 'none'],
  ])('%s is %s', (input, tone) => expect(fill(input)).toBe(tone));

  it('a stroke snaps the same way, and no stroke means none', () => {
    const [p] = paths('<rect width="10" height="10" fill="#efefef" stroke="#222" stroke-width="2"/>');
    expect([p.fill, p.stroke]).toEqual(['light', 'black']);
    expect(paths('<rect width="10" height="10"/>')[0]).toMatchObject({ fill: 'black', stroke: 'none', stroke_mm: 0 });
  });
  it('is inherited from groups and read from the style attribute', () => {
    expect(paths('<g fill="#dcdcdc"><rect width="5" height="5"/><rect width="5" height="5" style="fill:#fff;stroke:#000"/></g>').map((p) => [p.fill, p.stroke]))
      .toEqual([['medium', 'none'], ['white', 'black']]);
  });
});

describe('what is left out is reported', () => {
  const dropped = (body: string) => { const r = importSvg(svg(body + '<rect width="10" height="10"/>')); return r.ok ? r.dropped : ['refused: ' + r.reason]; };
  it('lists text, images, gradients, filters, masks, scripts, styles and links', () => {
    const d = dropped(`<text x="1" y="1">Hi</text><image href="photo.png"/>
      <defs><linearGradient id="g"/><filter id="f"/><mask id="m"/></defs><script>alert(1)</script><style>.a{fill:red}</style>
      <use href="#g"/><a href="https://example.com"><rect width="3" height="3"/></a>`);
    expect(d).toEqual(expect.arrayContaining(['text', 'images', 'gradients', 'filters', 'masks', 'scripts', 'styles', 'use elements', 'links to other files']));
  });
  it('counts repeats and still keeps the shapes', () => {
    const r = importSvg(svg('<text>a</text><text>b</text><circle r="5" cx="5" cy="5"/>'));
    expect(r).toMatchObject({ ok: true, dropped: ['text (2)'] });
    expect(r.ok && r.art.paths).toHaveLength(1);
  });
  it('notes filter, mask and clip-path attributes, gradient fills, transparency and dashes', () => {
    const d = dropped('<rect width="4" height="4" filter="url(#f)" mask="url(#m)" clip-path="url(#c)" fill="url(#g)" opacity="0.5" stroke="#000" stroke-dasharray="2 1"/>');
    expect(d).toEqual(expect.arrayContaining(['filters', 'masks', 'clip paths', 'gradient and pattern paints (drawn in medium)', 'transparency (drawn solid)', 'dashed lines (drawn solid)']));
  });
  it('says nothing for a clean file', () => expect(dropped('<title>x</title><desc>y</desc>')).toEqual([]));
  it('hidden shapes are skipped', () => {
    const r = importSvg(svg('<rect width="4" height="4" display="none"/><rect width="5" height="5"/>'));
    expect(r.ok && r.art.paths).toHaveLength(1);
  });
});

describe('refusals give the reason', () => {
  const why = (text: string) => { const r = importSvg(text); return r.ok ? 'imported' : r.reason; };
  it('nothing to draw', () => expect(why(svg('<text>only text</text>'))).toMatch(/Nothing in this file can be drawn/));
  it('not an SVG', () => {
    expect(why('hello')).toMatch(/no <svg> element/);
    expect(why('<svg><g></svg>')).toMatch(/doesn't match|isn't a readable/);
  });
  it('too many shapes', () => expect(why(svg('<rect width="1" height="1"/>'.repeat(201)))).toMatch(/201 shapes; art may have at most 200/));
  it('too much path data', () => {
    const d = 'M0 0' + 'L1.123 2.456'.repeat(4000);
    expect(why(svg(`<path d="${d}"/>`))).toMatch(/characters of path data/);
  });
  it('a file that is too large', () => expect(why(' '.repeat(MAX_SVG_BYTES + 1))).toMatch(/MB; art files over/));
  it('a drawing with no size', () => expect(why(svg('<line x1="0" y1="5" x2="10" y2="5" stroke="#000"/>', ''))).toMatch(/no width or no height/));
});

describe('the view box', () => {
  const box = (attrs: string, body = '<rect x="10" y="10" width="20" height="10"/>') => { const r = importSvg(svg(body, attrs)); return r.ok ? r.art.view_box : r.reason; };
  it('is the file\'s own', () => expect(box('viewBox="0 0 100 50"')).toEqual([0, 0, 100, 50]));
  it('comes from width and height without one', () => expect(box('width="80" height="40"')).toEqual([0, 0, 80, 40]));
  it('comes from the drawing without either', () => expect(box('')).toEqual([10, 10, 20, 10]));
  it('widens to hold a drawing that reaches outside it', () => expect(box('viewBox="0 0 20 20"')).toEqual([0, 0, 30, 20]));
});

describe('placing art in its area', () => {
  const art = (over: Partial<Art> = {}): Art => ({ type: 'art', x: 2, y: 3, w: 10, h: 10, view_box: [0, 0, 100, 50], paths: [{ d: 'M0 0L100 0L100 50L0 50Z', fill: 'light', stroke: 'black', stroke_mm: 0.3 }], ...over });
  const corners = (a: Art) => pointsOf(parse(artPaths(a)[0].d));

  it('fit keeps the proportions and centers the art', () => {
    // A 30 x 30 mm box at (6, 9) mm holds 100 x 50 art at 0.3 mm per unit: 30 x 15 mm, centered vertically.
    expect(corners(art())).toEqual([[6, 16.5], [36, 16.5], [36, 31.5], [6, 31.5]]);
    expect(artMatrix(art())[0]).toBeCloseTo(0.3);
  });
  it('fit by height centers sideways', () => {
    // 100 x 50 art in a 60 x 12 mm box is limited by the height: 24 x 12 mm, centered across the 60 mm.
    expect(corners(art({ w: 20, h: 4 }))[0]).toEqual([6 + (60 - 24) / 2, 9]);
  });
  it('stretch fills the area, changing the proportions', () => {
    expect(corners(art({ scaling: 'stretch' }))).toEqual([[6, 9], [36, 9], [36, 39], [6, 39]]);
  });
  it('a view box that does not start at zero is moved to the area', () => {
    const a = art({ view_box: [50, 50, 100, 50], paths: [{ d: 'M50 50L150 100', fill: 'none', stroke: 'black', stroke_mm: 0.3 }], w: 10, h: 5 });
    expect(corners(a)).toEqual([[6, 9], [36, 24]]);
  });
  it('line widths do not change when the art is resized', () => {
    const small = artPaths(art({ w: 4, h: 2 })), big = artPaths(art({ w: 20, h: 10 }));
    expect(small[0].stroke_mm).toBe(0.3);
    expect(big[0].stroke_mm).toBe(0.3);
    expect(small[0].d).not.toBe(big[0].d);
    expect(markup(art({ w: 4, h: 2 }))).toContain('stroke-width="0.3"');
    expect(markup(art({ w: 20, h: 10 }))).toContain('stroke-width="0.3"');
    expect(markup(art({ w: 20, h: 10 }))).not.toContain('scale(');
  });
  it('a first size keeps the art\'s shape at ten cells on the long side', () => {
    expect(defaultSize([0, 0, 100, 54])).toEqual({ w: 10, h: 5.5 });
    expect(defaultSize([0, 0, 20, 100])).toEqual({ w: 2, h: 10 });
  });
});

const markup = (a: Art) => pageContent(pageOf(a), { mode: 'export', pageNumber: null });
const pageOf = (...elements: Art[]): Page => ({ format: 'dotwork-page', version: 2, name: 'T', grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements });

describe('the screen and the PDF draw the same paths', () => {
  const a: Art = {
    type: 'art', x: 4, y: 6, w: 10, h: 6, view_box: [0, 0, 100, 54], scaling: 'stretch',
    paths: [
      { d: 'M4 50C4 33 12 18 27 10L38 29C30 33 26 41 26 50Z', fill: 'light', stroke: 'black', stroke_mm: 0.3 },
      { d: 'M50 50L17 27', fill: 'none', stroke: 'gray', stroke_mm: 0.5 },
      { d: 'M46 50L54 50L50 46Z', fill: 'dark', stroke: 'none', stroke_mm: 0 },
    ],
  };

  it('SVG path data and the PDF path data are the same strings', async () => {
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage();
    const spy = vi.spyOn(sheet, 'drawSvgPath');
    drawPage(sheet, pageOf(a), { x: 0, y: 0, sheetHeight: 139.7, fonts: {} as never, pageNumber: null, expand: (t) => t });
    const onScreen = [...markup(a).matchAll(/<path class="art" d="([^"]+)"/g)].map((m) => m[1]);
    expect(onScreen).toEqual(artPaths(a).map((p) => p.d));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(onScreen);
  });

  it('draws fills, lines and widths with the print tones', async () => {
    const tones = { shade: { L: '#f1f1f1', M: '#d1d1d1', D: '#a1a1a1' }, grayText: '#707070' };
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage();
    const spy = vi.spyOn(sheet, 'drawSvgPath');
    drawPage(sheet, pageOf(a), { x: 0, y: 0, sheetHeight: 139.7, fonts: {} as never, pageNumber: null, expand: (t) => t, tones });
    const opts = spy.mock.calls.map((c) => c[1]!);
    expect(opts[0]).toMatchObject({ color: color('#f1f1f1'), borderColor: color('#000000'), borderWidth: 0.3 });
    expect(opts[1].color).toBeUndefined();
    expect(opts[1]).toMatchObject({ borderColor: color('#707070'), borderWidth: 0.5 });
    expect(opts[2]).toMatchObject({ color: color('#a1a1a1') });
    expect(opts[2].borderColor).toBeUndefined();
    // The scale is points per mm, so a width in mm stays that wide on paper.
    expect(opts[0].scale).toBeCloseTo(72 / 25.4);
  });

  it('the screen uses the fixed grays', () => {
    const m = markup(a);
    expect(m).toContain('fill="#efefef" stroke="#000" stroke-width="0.3"');
    expect(m).toContain('fill="none" stroke="#808080" stroke-width="0.5"');
    expect(m).toContain('fill="#bdbdbd"/>');
  });

  it('the PDF is written', async () => {
    const pdf = await PDFDocument.create();
    drawPage(pdf.addPage([252, 396]), pageOf(a), { x: 0, y: 0, sheetHeight: 139.7, fonts: {} as never, pageNumber: null, expand: (t) => t });
    expect((await pdf.save()).length).toBeGreaterThan(300);
  });
});

describe('art in a page file', () => {
  const base = (el: unknown, extra: object = {}) => ({ format: 'dotwork-page', version: 2, name: 'T', grid: { cols: 27, rows: 44, pitch_mm: 3 }, identity: 'X', ...extra, elements: [el] });
  const art = (over: object = {}) => ({ type: 'art', x: 1, y: 1, w: 5, h: 3, view_box: [0, 0, 10, 10], paths: [{ d: 'M0 0L10 0L10 10Z', fill: 'light', stroke: 'black', stroke_mm: 0.3 }], ...over });
  const rules = (page: unknown) => validatePage(page).map((i) => i.rule);

  it('accepts art', () => {
    expect(validatePage(base(art()))).toEqual([]);
    expect(validatePage(base(art({ scaling: 'stretch' })))).toEqual([]);
  });
  it('rejects bad scaling, view box and paths', () => {
    expect(validatePage(base(art({ scaling: 'cover' }))).map(formatIssue)[0]).toMatch(/scaling/);
    expect(rules(base(art({ view_box: [0, 0, 0, 10] })))).toEqual(['art']);
    expect(rules(base(art({ view_box: [0, 0, 10] })))).toEqual(['art']);
    expect(rules(base(art({ paths: [] })))).toEqual(['art']);
    expect(rules(base(art({ paths: undefined })))).toEqual(['art']);
  });
  it('rejects path data that does not parse', () => {
    for (const d of ['', 'M0 0 Q 5 5 10 10', 'M0', 'L0 0', 'M0 0L1', 'M0 0 l5 5', 'hello', 'M0 0C1 1 2 2 3Z', 'M0 0ZL5 5']) {
      expect(rules(base(art({ paths: [{ d, fill: 'none', stroke: 'black', stroke_mm: 0.3 }] }))), d).toEqual(['art']);
    }
  });
  it('rejects tones, widths and stray points', () => {
    const one = (p: object) => art({ paths: [{ d: 'M0 0L10 10', fill: 'none', stroke: 'black', stroke_mm: 0.3, ...p }] });
    expect(rules(base(one({ fill: 'red' })))).toEqual(['art']);
    expect(rules(base(one({ stroke: 'purple' })))).toEqual(['art']);
    expect(rules(base(one({ stroke_mm: -1 })))).toEqual(['art']);
    expect(rules(base(one({ stroke_mm: 9 })))).toEqual(['art']);
    expect(rules(base(one({ stroke_mm: 0 })))).toEqual(['art']);
    expect(rules(base(one({ stroke: 'none', stroke_mm: 0 })))).toEqual([]);
    expect(validatePage(base(one({ d: 'M0 0L20 10' }))).map(formatIssue)[0]).toMatch(/outside the view box/);
  });
  it('rejects too many paths and too much data', () => {
    const many = Array.from({ length: 201 }, () => ({ d: 'M0 0L1 1', fill: 'none', stroke: 'black', stroke_mm: 0.3 }));
    expect(rules(base(art({ paths: many })))).toEqual(['art']);
    const long = [{ d: 'M0 0' + 'L1 1'.repeat(10001), fill: 'none', stroke: 'black', stroke_mm: 0.3 }];
    expect(rules(base(art({ paths: long })))).toEqual(['art']);
  });
  it('stays inside the grid like a box', () => {
    expect(rules(base(art({ x: 25 })))).toEqual(['bounds']);
    expect(rules(base(art({ y: 42 })))).toEqual(['bounds']);
    expect(rules(base(art({ w: 0 })))).toEqual(['size']);
    expect(rules(base(art({ x: 1.25 })))).toEqual(['half-cell']);
  });
  it('follows the header rules: row 0 belongs to the header, except where the page has no identity; the page number corner stays clear', () => {
    expect(rules(base(art({ y: 0 })))).toEqual(['header-row']);
    expect(rules(base(art({ y: 0 }), { identity: '' }))).toEqual([]);
    expect(rules(base(art({ y: 0, x: 24, w: 3 }), { identity: '', side: 'right' }))).toEqual(['header-corner']);
    expect(rules(base(art({ y: 0, x: 0, w: 2 }), { identity: '', side: 'left' }))).toEqual(['header-corner']);
    expect(rules(base(art({ y: 0, x: 24, w: 3 }), { identity: '', page_number: false }))).toEqual([]);
  });
  it('accepts the Good Time example page, with its six gauges', () => {
    const page = JSON.parse(readFileSync(join(__dirname, '..', 'examples', 'pages', 'daily-good-time.json'), 'utf8'));
    const gauges = page.elements.filter((e: { type: string }) => e.type === 'art');
    expect(gauges).toHaveLength(6);
    // Engagement (left) and Energy (right) of each row
    expect(gauges.map((g: Art) => g.fills?.['left-half'])).toEqual(['none', 'medium', 'none', 'medium', 'none', 'medium']);
    expect(gauges.map((g: Art) => g.strokes?.['centre-line'])).toEqual(['none', 'black', 'none', 'black', 'none', 'black']);
    expect(validatePage(page)).toEqual([]);
  });
});

describe('the half-donut gauge', () => {
  const text = readFileSync(join(__dirname, 'fixtures', 'half-donut-gauge.svg'), 'utf8');
  it('imports as three tinted wedges, a needle and a hub, with nothing left out', () => {
    const r = importSvg(text);
    if (!r.ok) throw new Error(r.reason);
    expect(r.dropped).toEqual([]);
    expect(r.art.view_box).toEqual([0, 0, 100, 54]);
    expect(r.art.paths.map((p) => [p.fill, p.stroke])).toEqual([['light', 'black'], ['medium', 'black'], ['dark', 'black'], ['none', 'black'], ['black', 'none']]);
    // Stroke widths are as wide as they look at the first size: 1 unit of 100 across 30 mm is 0.3 mm; the needle's 2 units, 0.6.
    expect(r.art.paths.map((p) => p.stroke_mm)).toEqual([0.3, 0.3, 0.3, 0.6, 0]);
    // The needle was drawn in a rotated group: now it is plain coordinates, up and to the left of the hub.
    expect(r.art.paths[3].d).toMatch(/^M50 50L17\.\d+ 27\.\d+$/);
    expect(validatePage({ format: 'dotwork-page', version: 2, name: 'G', grid: { cols: 27, rows: 44, pitch_mm: 3 }, identity: 'x', elements: [{ type: 'art', x: 2, y: 2, w: 10, h: 5.5, ...r.art }] })).toEqual([]);
  });
});

describe('library art is copied into the page', () => {
  it('placing a saved art makes an independent copy at the chosen place', () => {
    const el: Art = { type: 'art', x: 7, y: 9, w: 6, h: 3, view_box: [0, 0, 10, 5], paths: [{ d: 'M0 0L10 5', fill: 'none', stroke: 'black', stroke_mm: 0.3 }] };
    const widget = makeWidget('w1', 'Gauge', [el]);
    const [placed] = placeWidget(widget, { x: 3, y: 4 }) as Art[];
    expect(placed).toMatchObject({ type: 'art', x: 3, y: 4, w: 6, h: 3, view_box: [0, 0, 10, 5] });
    placed.paths[0].d = 'M0 0L1 1';
    expect(widget.elements[0]).toMatchObject({ paths: [{ d: 'M0 0L10 5' }] });
  });
});

const gaugeSvg = readFileSync(join(__dirname, '..', 'examples', 'art', 'gauge.svg'), 'utf8');
const gaugeArt = () => { const r = importSvg(gaugeSvg); if (!r.ok) throw new Error(r.reason); return r; };
const gauge = (extra: Partial<Art> = {}): Art => ({ type: 'art', x: 2, y: 2, w: 10, h: 6, ...gaugeArt().art, ...extra });
const energy = () => gauge({ fills: { 'left-half': 'medium' }, strokes: { 'centre-line': 'black' } });
const engagement = () => gauge({ fills: { 'left-half': 'none' }, strokes: { 'centre-line': 'none' } });
const pageWith = (el: object) => ({ format: 'dotwork-page', version: 2, name: 'T', identity: 'x', grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements: [el] });

describe('the gauge', () => {
  it('imports with nothing left out: its ids, round line ends, and the unfilled right half kept', () => {
    const r = gaugeArt();
    expect(r.dropped).toEqual([]);
    expect(r.art.view_box).toEqual([0, 0, 30, 16]);
    expect(r.art.paths.map((p) => p.id)).toEqual(['left-half', 'right-half', 'centre-line', 'ticks', undefined, undefined, undefined]);
    expect(r.art.paths.map((p) => p.linecap)).toEqual([undefined, undefined, 'round', 'round', 'round', undefined, undefined]);
    expect(r.art.paths[0]).toMatchObject({ fill: 'medium', stroke: 'none', stroke_mm: 0 });
    expect(r.art.paths[1]).toMatchObject({ fill: 'none', stroke: 'none' });
  });

  it('offers a fill to closed or filled paths and a line to stroked ones, and nothing that changes nothing', () => {
    const named = Object.fromEntries(gaugeArt().art.paths.filter((p) => p.id).map((p) => [p.id, [canFill(p), canStroke(p)]]));
    expect(named).toEqual({ 'left-half': [true, false], 'right-half': [true, false], 'centre-line': [false, true], ticks: [false, true] });
    // a closed path with a line gets both; an open filled path gets a fill (the file closes it); a bare open one gets neither
    expect(canFill({ d: 'M0 0L5 0L5 5Z', fill: 'none' })).toBe(true);
    expect(canStroke({ stroke: 'black', stroke_mm: 0.3 })).toBe(true);
    expect(canFill({ d: 'M0 0L5 0L5 5', fill: 'light' })).toBe(true);
    expect(canFill({ d: 'M0 0L5 5', fill: 'none' })).toBe(false);
    expect(canStroke({ stroke: 'none', stroke_mm: 0 })).toBe(false);
  });

  it('is the Energy dial by default: the left half in medium, the centre line on', () => {
    const drawn = artPaths(gauge());
    expect(drawn).toHaveLength(6); // right-half draws nothing
    expect(drawn[0]).toMatchObject({ fill: 'medium', stroke: 'none' });
    expect(artPaths(energy())).toEqual(drawn);
      });

  it('is the Engagement dial with the left half unfilled and the centre line off; the ticks still show', () => {
    const drawsPath = (el: Art, id: string) => artPaths({ ...el, paths: el.paths.filter((p) => p.id === id) }).length > 0;
    const e = engagement();
    expect(artPaths(e)).toHaveLength(artPaths(energy()).length - 2);
    expect(drawsPath(e, 'ticks')).toBe(true);
    expect(drawsPath(e, 'centre-line')).toBe(false);
    expect(drawsPath(e, 'left-half')).toBe(false);
    expect(drawsPath(energy(), 'centre-line')).toBe(true);
    expect(drawsPath(energy(), 'left-half')).toBe(true);
  });

  it('draws both dials on screen with round caps, and gray lines when asked', () => {
    expect(markup(energy()).match(/stroke-linecap="round"/g)).toHaveLength(3);
    expect(markup(engagement()).match(/stroke-linecap="round"/g)).toHaveLength(2);
    const medium = `fill="${artColor('medium', SCREEN_ART_TONES)}"`;
    expect(markup(energy())).toContain(medium);
    expect(markup(engagement())).not.toContain(medium);
    const gray = artPaths(gauge({ strokes: { 'centre-line': 'gray' } }));
    expect(gray.filter((p) => p.stroke === 'gray')).toHaveLength(1);
  });

  it('draws both dials in the PDF with round line caps, the same paths as the screen', async () => {
    const tones = { shade: { L: '#f1f1f1', M: '#d1d1d1', D: '#a1a1a1' }, grayText: '#707070' };
    for (const [el, rounds] of [[energy(), 3], [engagement(), 2]] as const) {
      const pdf = await PDFDocument.create();
      const sheet = pdf.addPage();
      const spy = vi.spyOn(sheet, 'drawSvgPath');
      drawPage(sheet, pageOf(el), { x: 0, y: 0, sheetHeight: 139.7, fonts: {} as never, pageNumber: null, expand: (t) => t, tones });
      expect(spy.mock.calls.map((c) => c[0])).toEqual(artPaths(el).map((p) => p.d));
      const caps = spy.mock.calls.map((c) => (c[1] as { borderLineCap?: number }).borderLineCap);
      expect(caps.filter((c) => c === LineCapStyle.Round)).toHaveLength(rounds);
      const medium = spy.mock.calls.filter((c) => JSON.stringify((c[1] as { color?: unknown }).color) === JSON.stringify(color('#d1d1d1')));
      expect(medium).toHaveLength(rounds === 3 ? 1 : 0); // the left half is medium in Energy, and gone in Engagement
    }
  });

  it('on the Energy dial, ticks set to none hide the tick marks on screen and in the PDF, and nothing else', async () => {
    const off = { ...energy(), strokes: { 'centre-line': 'black', ticks: 'none' } } as Art;
    const ticks = gaugeArt().art.paths.find((p) => p.id === 'ticks')!;
    // The one path holds the two side ticks and the one at the top: its line control turns all three off together.
    expect(ticks.d.match(/M/g)).toHaveLength(3);
    const drawsPath = (el: Art, id: string) => artPaths({ ...el, paths: el.paths.filter((p) => p.id === id) }).length > 0;
    expect(drawsPath(energy(), 'ticks')).toBe(true);
    expect(drawsPath(off, 'ticks')).toBe(false);
    expect(drawsPath(off, 'centre-line')).toBe(true);
    expect(artPaths(off)).toHaveLength(artPaths(energy()).length - 1);
    // screen: one round-capped line fewer (the centre line and the baseline stay)
    expect(markup(energy()).match(/stroke-linecap="round"/g)).toHaveLength(3);
    expect(markup(off).match(/stroke-linecap="round"/g)).toHaveLength(2);
    // PDF: the same path is not drawn
    const tones = { shade: { L: '#f1f1f1', M: '#d1d1d1', D: '#a1a1a1' }, grayText: '#707070' };
    const calls = async (el: Art) => {
      const pdf = await PDFDocument.create();
      const sheet = pdf.addPage();
      const spy = vi.spyOn(sheet, 'drawSvgPath');
      drawPage(sheet, pageOf(el), { x: 0, y: 0, sheetHeight: 139.7, fonts: {} as never, pageNumber: null, expand: (t) => t, tones });
      return spy.mock.calls.map((c) => c[0]);
    };
    const [before, after] = [await calls(energy()), await calls(off)];
    const tickPath = artPaths({ ...energy(), paths: [ticks] })[0].d;
    expect(before).toContain(tickPath);
    expect(after).not.toContain(tickPath);
    expect(after).toHaveLength(before.length - 1);
  });

  it('validates fills and strokes', () => {
    expect(validatePage(pageWith(energy()))).toEqual([]);
    expect(validatePage(pageWith(gauge({ strokes: { nope: 'black' } }))).map((i) => i.rule)).toEqual(['art']);
    expect(validatePage(pageWith(gauge({ strokes: { 'centre-line': 'dark' as never } }))).map((i) => i.rule)).toEqual(['art']);
    expect(validatePage(pageWith(gauge({ fills: { nope: 'dark' } }))).map((i) => i.rule)).toEqual(['art']);
    expect(validatePage(pageWith(gauge({ fills: { 'left-half': 'black' as never } }))).map((i) => i.rule)).toEqual(['art']);
    const cap = gauge(); cap.paths[2].linecap = 'pointy' as never;
    expect(validatePage(pageWith(cap)).map((i) => i.rule)).toEqual(['art']);
    const dup = gauge(); dup.paths[1].id = 'left-half';
    expect(validatePage(pageWith(dup)).map((i) => i.rule)).toEqual(['art']);
    const bad = gauge(); bad.paths[0].id = 'has space';
    expect(validatePage(pageWith(bad)).map((i) => i.rule)).toEqual(['art']);
  });

  it('a line with no line of its own can\'t be given one', () => {
    expect(artPaths(gauge({ strokes: { 'left-half': 'black' } }))[0]).toMatchObject({ stroke: 'none', stroke_mm: 0 });
  });
});

describe('line caps and ignored attributes', () => {
  const cap = (attrs: string, wrap = (b: string) => b) => {
    const r = importSvg(svg(wrap(`<line x1="1" y1="1" x2="9" y2="9" stroke="#000" ${attrs}/>`)));
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  it('reads stroke-linecap from the attribute, the style and a parent group', () => {
    expect(cap('stroke-linecap="round"').art.paths[0].linecap).toBe('round');
    expect(cap('style="stroke-linecap:square"').art.paths[0].linecap).toBe('square');
    expect(cap('', (b) => `<g stroke-linecap="round">${b}</g>`).art.paths[0].linecap).toBe('round');
    expect(cap('stroke-linecap="butt"', (b) => `<g stroke-linecap="round">${b}</g>`).art.paths[0].linecap).toBeUndefined();
    expect(cap('').art.paths[0].linecap).toBeUndefined();
  });
  it('says when a line cap could not be understood', () => {
    const r = cap('stroke-linecap="pointy"');
    expect(r.dropped.join()).toContain('line caps');
    expect(r.art.paths[0].linecap).toBeUndefined();
  });
  it('lists the attributes it ignores, and says nothing about their defaults', () => {
    const body = '<path d="M0 0L9 0L9 9Z" fill="#000" stroke="#000" stroke-linejoin="round" fill-rule="evenodd" stroke-miterlimit="10" stroke-dashoffset="2" vector-effect="non-scaling-stroke" paint-order="stroke"/>';
    const r = importSvg(svg(body));
    expect(r.dropped.join('\n')).toMatch(/line joins/);
    for (const what of [/line joins/, /even-odd/, /miter limits/, /dash offsets/, /vector effects/, /paint order/]) expect(r.dropped.join('\n')).toMatch(what);
    expect(importSvg(svg('<path d="M0 0L9 0L9 9Z" stroke="#000" stroke-linejoin="miter" fill-rule="nonzero" stroke-miterlimit="4" visibility="visible"/>', 'viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"')).dropped).toEqual([]);
    expect(importSvg(svg('<rect width="5" height="5"/>', 'viewBox="0 0 100 100" preserveAspectRatio="none"')).dropped.join()).toContain('preserveAspectRatio');
  });
  it('does not draw what is hidden', () => {
    const r = importSvg(svg('<rect width="5" height="5"/><g visibility="hidden"><rect width="6" height="6"/></g>'));
    expect(r.ok && r.art.paths).toHaveLength(1);
  });
  it('keeps the file\'s own attributes out of the report when they do nothing (ids, metadata, namespaces)', () => {
    expect(importSvg(svg('<metadata><x:data xmlns:x="urn:x">AAAA</x:data></metadata><rect id="a" data-x="1" width="5" height="5"/>')).dropped).toEqual([]);
  });
});

describe('art drawn into a rectangle', () => {
  const base: Art = { type: 'art', x: 0, y: 1, w: 10, h: 5.5, view_box: [0, 0, 30, 16], paths: [{ d: 'M0 0L30 16', fill: 'none', stroke: 'black', stroke_mm: 0.3 }], fills: { a: 'none' } };
  it('fills the dragged rectangle, whichever way it was dragged, keeping the preset', () => {
    expect(artFromDrag(base, { x: 4, y: 6 }, { x: 10, y: 9 })).toMatchObject({ x: 4, y: 6, w: 6, h: 3, fills: { a: 'none' } });
    expect(artFromDrag(base, { x: 10, y: 9 }, { x: 4, y: 6 })).toMatchObject({ x: 4, y: 6, w: 6, h: 3 });
  });
  it('puts it down at its first size when tapped, kept on the page and below the header', () => {
    expect(artFromDrag(base, { x: 3, y: 10 }, { x: 3, y: 10 })).toMatchObject({ x: 3, y: 10, w: 10, h: 5.5 });
    expect(artFromDrag(base, { x: 27, y: 44 }, { x: 27, y: 44 })).toMatchObject({ x: 17, y: 38.5 });
    expect(artFromDrag(base, { x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toMatchObject({ x: 0, y: 1 });
  });
  it('is nothing for a line with no inside, and an independent copy', () => {
    expect(artFromDrag(base, { x: 3, y: 10 }, { x: 8, y: 10 })).toBeNull();
    const el = artFromDrag(base, { x: 3, y: 3 }, { x: 9, y: 6 })!;
    el.paths[0].d = 'M0 0L1 1';
    expect(base.paths[0].d).toBe('M0 0L30 16');
  });
});
