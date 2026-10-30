import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { artPlacement, artPaths } from '../src/format/art';
import { asCover, headerOf } from '../src/format/bounds';
import { fromDataUrl, imageInfo, jpegOrientation, storedSize, toDataUrl } from '../src/format/image';
import { mirrorElement } from '../src/format/mirror';
import { clampPan, contentMatrix, hasView, imageMatrix, mirrorView, panLimit, pictureRect, placePicture, tidyView, withView } from '../src/format/picture';
import { readPage } from '../src/format/read';
import { COLS, GRID_X_MM, GRID_Y_MM, PITCH_MM as P, type Art, type Image, type Page } from '../src/format/types';
import { formatIssue, validatePage } from '../src/format/validate';
import { headerItems, pageContent } from '../src/render';
import { correct } from '../src/print/correct';
import type { Item } from '../src/print/display';
import { drawItems, embedImages } from '../src/print/draw';
import { layoutPage } from '../src/print/layout';
import { transformOf } from '../src/print/sheets';
import { dataUrl, makeJpgHeader, makePng } from './png';
import { DEFAULT_PRINT } from '../src/book/impose';

const png = makePng(4, 4);
const image = (over: Partial<Image> = {}): Image => ({ type: 'image', x: 2, y: 3, w: 10, h: 5, src: dataUrl(png), width_px: 4, height_px: 4, ...over });
const pageOf = (elements: Page['elements'], extra: Partial<Page> = {}): Page => ({ format: 'dotwork-page', version: 2, name: 'T', grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements, ...extra });
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('an image fits its box and stays in proportion', () => {
  const boxes = [{ x: 2, y: 3, w: 10, h: 5 }, { x: 2, y: 3, w: 4, h: 12 }, { x: 0, y: 1, w: 6, h: 6 }, { x: 5, y: 5, w: 0.5, h: 20 }];
  it('centres it in boxes of every shape, never stretching', () => {
    for (const box of boxes) for (const content of [{ w: 100, h: 100 }, { w: 300, h: 100 }, { w: 100, h: 300 }]) {
      const p = placePicture(box, content);
      near(p.cx, (box.x + box.w / 2) * P);
      near(p.cy, (box.y + box.h / 2) * P);
      near(p.sx, p.sy);
      near(p.w / p.h, content.w / content.h);
      expect(p.w).toBeLessThanOrEqual(box.w * P + 1e-9);
      expect(p.h).toBeLessThanOrEqual(box.h * P + 1e-9);
      // it touches the box on the side that limits it
      expect(Math.max(p.w - box.w * P, p.h - box.h * P)).toBeCloseTo(0, 6);
    }
  });
  it('a square in a wide box is as tall as the box, and square', () => {
    const p = placePicture({ x: 2, y: 3, w: 10, h: 5 }, { w: 4, h: 4 });
    near(p.w, 15); near(p.h, 15);
    near(pictureRect(p).x, 2 * P + (10 * P - 15) / 2);
  });
  it('the clip is the box', () => expect(placePicture({ x: 2, y: 3, w: 10, h: 5 }, { w: 4, h: 4 }).clip).toEqual({ x: 6, y: 9, w: 30, h: 15 }));
});

describe('zoom, pan and rotate', () => {
  const box = { x: 2, y: 3, w: 10, h: 5 };
  const sq = { w: 4, h: 4 };
  it('zoom multiplies the fitted size about the middle', () => {
    const one = placePicture(box, sq), two = placePicture(box, sq, { zoom: 2 }), four = placePicture(box, sq, { zoom: 4 });
    near(two.w, one.w * 2); near(four.h, one.h * 4);
    near(two.cx, one.cx); near(two.cy, one.cy);
  });
  it('pan moves it by cells, right and down', () => {
    const p = placePicture(box, sq, { pan_x: 1.5, pan_y: -1 }), c = placePicture(box, sq);
    near(p.cx - c.cx, 1.5 * P); near(p.cy - c.cy, -1 * P);
  });
  it('a quarter turn fits the turned picture to the box', () => {
    const wide = { w: 200, h: 100 };
    const flat = placePicture({ x: 0, y: 0, w: 10, h: 10 }, wide), turned = placePicture({ x: 0, y: 0, w: 10, h: 10 }, wide, { rotate: 90 });
    near(flat.w, 30); near(flat.h, 15);
    near(turned.w, 15); near(turned.h, 30); // 100 across and 200 down now fill the box
    expect(placePicture({ x: 0, y: 0, w: 10, h: 10 }, wide, { rotate: 180 }).w).toBeCloseTo(30, 6);
  });
  it('the unit square lands on the rectangle, turned clockwise', () => {
    const r = { x: 10, y: 20, w: 30, h: 15 };
    const at = (rot: 0 | 90 | 180 | 270, u: number, v: number) => { const m = imageMatrix(r, rot); return [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]; };
    // the picture's top-left corner goes to: top-left, top-right, bottom-right, bottom-left
    expect(at(0, 0, 0)).toEqual([10, 20]);
    expect(at(90, 0, 0)).toEqual([40, 20]);
    expect(at(180, 0, 0)).toEqual([40, 35]);
    expect(at(270, 0, 0)).toEqual([10, 35]);
    for (const rot of [0, 90, 180, 270] as const) {
      const [a, b, c, d] = imageMatrix(r, rot);
      expect(a * d - b * c).toBeGreaterThan(0); // a turn, never a flip
    }
  });
  it('the pan stays inside what leaves part of the picture in the box', () => {
    const lim = panLimit(box, sq, { zoom: 1 });
    expect(lim.x).toBeGreaterThan(0);
    expect(clampPan(box, sq, {}, { x: 99, y: -99 }).x).toBeLessThanOrEqual(lim.x);
    expect(clampPan(box, sq, { zoom: 4 }, { x: 1.04, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(clampPan(box, sq, {}, { x: -0.04, y: 0.04 })).toEqual({ x: 0, y: 0 });
  });
  it('a plain picture stays plain', () => {
    expect(hasView(image())).toBe(false);
    expect(hasView(withView(image(), { zoom: 1, pan_x: 0, rotate: 0 }))).toBe(false);
    expect(Object.keys(withView(image({ zoom: 2 }), { zoom: 1 }))).not.toContain('zoom');
    expect(tidyView(image({ pan_x: 50 })).pan_x).toBeLessThan(50);
  });
});

describe('the 2400 px rule', () => {
  it('leaves a picture that is small enough, and scales the longer side down to 2400', () => {
    expect(storedSize(2400, 1200)).toEqual({ w: 2400, h: 1200 });
    expect(storedSize(1000, 3000)).toEqual({ w: 800, h: 2400 });
    expect(storedSize(4800, 2400)).toEqual({ w: 2400, h: 1200 });
    expect(storedSize(2401, 2401)).toEqual({ w: 2400, h: 2400 });
    expect(storedSize(5000, 1)).toEqual({ w: 2400, h: 1 });
  });
  it('reads a PNG and a JPG for their type and size', () => {
    expect(imageInfo(makePng(7, 3))).toEqual({ type: 'png', w: 7, h: 3 });
    expect(imageInfo(makeJpgHeader(640, 480))).toEqual({ type: 'jpeg', w: 640, h: 480 });
    expect(imageInfo(new TextEncoder().encode('<svg/>'))).toBeNull();
  });
  it('reads a JPG\'s orientation note', () => {
    expect(jpegOrientation(makeJpgHeader(640, 480))).toBe(1);
    expect(jpegOrientation(makeJpgHeader(640, 480, 6))).toBe(6);
    expect(imageInfo(makeJpgHeader(640, 480, 6))).toEqual({ type: 'jpeg', w: 640, h: 480 });
  });
  it('keeps the bytes through a data: URL', () => {
    const back = fromDataUrl(toDataUrl(png, 'png'));
    expect(back.type).toBe('png');
    expect([...back.bytes]).toEqual([...png]);
  });
});

describe('a mirrored page moves the picture but never flips it', () => {
  const placed = image({ x: 2, y: 3, w: 6, h: 4, zoom: 2, pan_x: 1, pan_y: 0.5, rotate: 90 });
  it('an image\'s box moves across, its pan and turn mirror, its pixels are untouched', () => {
    const m = mirrorElement(placed) as Image;
    expect(m).toMatchObject({ x: COLS - 2 - 6, y: 3, w: 6, h: 4, zoom: 2, pan_x: -1, pan_y: 0.5, rotate: 270, src: placed.src, width_px: 4, height_px: 4 });
    for (const rotate of [0, 90, 180, 270] as const) {
      const mirrored = mirrorElement(image({ rotate })) as Image, p = placePicture(mirrored, { w: 4, h: 4 }, mirrored);
      const [a, b, c, d] = imageMatrix(pictureRect(p), p.rotate);
      expect(a * d - b * c).toBeGreaterThan(0); // still a turn of the same pixels, never a flip
    }
  });
  it('the mirror of the view is its own inverse', () => expect(mirrorView(mirrorView({ zoom: 3, pan_x: 2, pan_y: -1, rotate: 90 }))).toEqual({ zoom: 3, pan_x: 2, pan_y: -1, rotate: 90 }));
  it('art, which is flipped as a whole, lands exactly where the mirror of its unmirrored drawing does', () => {
    const art: Art = {
      type: 'art', x: 3, y: 5, w: 8, h: 6, view_box: [0, 0, 20, 10], zoom: 2, pan_x: 1.5, pan_y: -0.5, rotate: 90,
      paths: [{ d: 'M2 1L18 3L9 9Z', fill: 'dark', stroke: 'black', stroke_mm: 0.3 }],
    };
    const points = (a: Art) => artPaths(a)[0].d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const plain = points(art), flipped = points(mirrorElement(art) as Art);
    plain.forEach((v, i) => { if (i % 2 === 0) near(flipped[i], COLS * P - v); else near(flipped[i], v); });
  });
  it('a mirrored page lays its image out upright', () => {
    const page = pageOf([image({ rotate: 90 })], { side: 'left', mirror_left: true });
    const items: Item[] = [];
    layoutPage(page, { x: 0, y: 0, pageNumber: null, expand: (t) => t }, items);
    const img = items.find((i) => i.k === 'image') as Extract<Item, { k: 'image' }>;
    expect(img.rot).toBe(270);
    expect(img.w).toBeGreaterThan(0);
    expect(img.h).toBeGreaterThan(0);
  });
});

describe('screen and PDF layout agree', () => {
  const page = pageOf([image({ zoom: 2, pan_x: 1, rotate: 90 })]);
  it('both cut the picture off at the box and place it at the same rectangle', () => {
    const items: Item[] = [];
    layoutPage(page, { x: -GRID_X_MM, y: -GRID_Y_MM, pageNumber: null, expand: (t) => t }, items);
    const k = items.findIndex((i) => i.k === 'image');
    expect(items[k - 1].k).toBe('clip');
    expect(items[k + 1].k).toBe('unclip');
    const clip = (items[k - 1] as Extract<Item, { k: 'clip' }>).pts;
    const box = placePicture(page.elements[0] as Image, { w: 4, h: 4 }).clip;
    near(clip[0].x, box.x); near(clip[2].x, box.x + box.w); near(clip[2].y, box.y + box.h);
    const svg = pageContent(page, { mode: 'export', pageNumber: null });
    const m = /matrix\(([^)]*)\)/.exec(svg)![1].split(' ').map(Number);
    const p = placePicture(page.elements[0] as Image, { w: 4, h: 4 }, page.elements[0] as Image);
    imageMatrix(pictureRect(p), 90).forEach((v, i) => near(m[i], v));
    const img = items[k] as Extract<Item, { k: 'image' }>;
    near(img.x, pictureRect(p).x); near(img.w, pictureRect(p).w);
    expect(svg).toContain('overflow="hidden"');
  });
  it('a plain image still has no art markup, and art that was not zoomed has no clip', () => {
    const art: Art = { type: 'art', x: 1, y: 1, w: 4, h: 4, view_box: [0, 0, 10, 10], paths: [{ d: 'M0 0L10 0L10 10Z', fill: 'dark', stroke: 'none', stroke_mm: 0 }] };
    expect(pageContent(pageOf([art]), { mode: 'export', pageNumber: null })).not.toContain('<svg x=');
    expect(pageContent(pageOf([{ ...art, zoom: 2 }]), { mode: 'export', pageNumber: null })).toContain('<svg x=');
  });
  it('art without the new fields lands as before', () => {
    const art = { x: 1, y: 1, w: 4, h: 2, view_box: [10, 20, 100, 50] as [number, number, number, number] };
    const [vx, vy, vw, vh] = art.view_box, s = Math.min(4 * P / vw, 2 * P / vh);
    const m = contentMatrix(artPlacement(art), { x: vx + vw / 2, y: vy + vh / 2 });
    near(m[0], s); near(m[3], s); near(m[4], 1 * P + (4 * P - vw * s) / 2 - vx * s); near(m[5], 1 * P + (2 * P - vh * s) / 2 - vy * s);
  });
});

describe('the printer correction moves an image like a rectangle', () => {
  it('scales and offsets its place, never its pixels or its turn', () => {
    const src = image().src;
    const items: Item[] = [{ k: 'image', src, x: 20, y: 30, w: 40, h: 20, rot: 90 }];
    const t = { ...transformOf({ ...DEFAULT_PRINT, sheet_layout: 'half_letter' }, 'front'), sx: 1.01, sy: 0.99 };
    const [out] = correct(items, t, 215.9, 139.7) as Extract<Item, { k: 'image' }>[];
    expect(out.rot).toBe(90);
    near(out.w, 40 * 1.01); near(out.h, 20 * 0.99);
    expect(out.src).toBe(src);
  });
});

describe('images in the PDF', () => {
  it('embeds a PNG and a JPG once each, however many times they are placed, and draws them', async () => {
    const doc = await PDFDocument.create();
    const items: Item[] = [];
    for (const [src, rot] of [[dataUrl(png), 0], [dataUrl(png), 90], [dataUrl(makeJpgHeader(30, 20), 'jpeg'), 270]] as const) items.push({ k: 'image', src, x: 10, y: 10, w: 30, h: 20, rot });
    await embedImages(doc, items);
    drawItems(doc.addPage([252, 396]), items, {} as never, 139.7);
    const bytes = await doc.save();
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(text.match(/\/DCTDecode/g)).toHaveLength(1);
  });
  it('says so when an image was not embedded first', async () => {
    const doc = await PDFDocument.create();
    expect(() => drawItems(doc.addPage([252, 396]), [{ k: 'image', src: dataUrl(png), x: 1, y: 1, w: 5, h: 5, rot: 0 }], {} as never, 139.7)).toThrow(/embed/);
  });
});

describe('images and views in a page file', () => {
  const rules = (page: unknown) => validatePage(page).map((i) => i.rule);
  it('accepts an image with and without the view fields', () => {
    expect(validatePage(pageOf([image()]))).toEqual([]);
    expect(validatePage(pageOf([image({ zoom: 4, pan_x: -3.5, pan_y: 2, rotate: 270 })]))).toEqual([]);
    const art = { type: 'art', x: 1, y: 1, w: 4, h: 4, view_box: [0, 0, 10, 10], paths: [{ d: 'M0 0L10 0L10 10Z', fill: 'dark', stroke: 'none', stroke_mm: 0 }] };
    expect(validatePage(pageOf([art as never]))).toEqual([]);
    expect(validatePage(pageOf([{ ...art, zoom: 2, pan_x: 1, rotate: 180 } as never]))).toEqual([]);
  });
  it('refuses a bad data URL, size, zoom, pan or turn', () => {
    expect(rules(pageOf([image({ src: 'http://example.com/a.png' })]))).toEqual(['image']);
    expect(rules(pageOf([image({ src: 'data:image/gif;base64,AAAA' })]))).toEqual(['image']);
    expect(rules(pageOf([image({ width_px: 0 })]))).toEqual(['image']);
    expect(rules(pageOf([image({ height_px: 2401 })]))).toEqual(['image']);
    expect(rules(pageOf([image({ zoom: 0.5 })]))).toEqual(['image']);
    expect(rules(pageOf([image({ zoom: 4.5 })]))).toEqual(['image']);
    expect(rules(pageOf([image({ pan_x: Infinity })]))).toEqual(['image']);
    expect(rules(pageOf([image({ rotate: 45 as never })]))).toEqual(['image']);
    expect(validatePage(pageOf([image({ rotate: 45 as never })])).map(formatIssue)[0]).toMatch(/rotate/);
  });
  it('an image sits on the grid like any box', () => {
    expect(rules(pageOf([image({ x: 20, w: 10 })]))).toEqual(['bounds']);
  });
});

describe('cover pages', () => {
  it('have no header: row 0 is free, with or without an identity or a page number', () => {
    expect(headerOf({ cover: true })).toEqual({ top: 0, corner: null });
    expect(headerOf({ cover: true, identity: 'MON', side: 'left' })).toEqual({ top: 0, corner: null });
    expect(headerOf({})).toEqual({ top: 0, corner: { x: 25, y: 0, w: 2, h: 1 } });
    expect(headerOf({ identity: 'X' }).top).toBe(1);
  });
  it('print and show no page number or identity', () => {
    const page = pageOf([], { cover: true, identity: 'MON OCT 26' });
    expect(headerItems(page, '12')).toEqual([]);
    expect(headerItems({ ...page, cover: undefined }, '12').map((i) => i.text)).toEqual(['MON OCT 26', '12']);
  });
  it('can be drawn on in row 0, over the page number\'s corner too', () => {
    const el = { type: 'box', x: 0, y: 0, w: 27, h: 1 };
    expect(validatePage(pageOf([el as never], { cover: true }))).toEqual([]);
    expect(validatePage(pageOf([el as never], { identity: 'X' })).map((i) => i.rule)).toEqual(['header-row']);
    expect(validatePage(pageOf([el as never])).map((i) => i.rule)).toEqual(['header-corner']);
  });
  it('are read with or without the field, and only `true` is allowed', () => {
    expect(readPage(pageOf([])).ok).toBe(true);
    expect(readPage(pageOf([], { cover: true })).ok).toBe(true);
    expect(readPage({ ...pageOf([]), cover: false }).ok).toBe(false);
    expect(readPage({ ...pageOf([]), cover: 'yes' }).ok).toBe(false);
  });
  it('asCover clears the identity and the page number', () => {
    expect(asCover({ identity: 'X', page_number: undefined })).toEqual({ cover: true, page_number: false });
  });
});
