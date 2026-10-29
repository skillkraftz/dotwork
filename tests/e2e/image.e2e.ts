import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { bar, cellToClient, choose, draft, drag, hit, missingHelp, nameOpen, open, openDrawer, shot, start, stop, tool, unzip, type App, type Device, type Env } from './harness';
import { makePng } from '../png';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];

/** A QR-like square: 21 x 21 pixels of black and white. */
const qr = makePng(21, 21, (x, y) => ((x * 7 + y * 13 + x * y) % 3 === 0 ? [0, 0, 0] : [255, 255, 255]));

/** Controls inside a window or the properties that are smaller than a fingertip. */
async function small(app: App, scope: string) {
  return app.page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

/** Import a PNG from the Art window in Advanced, which arms the art tool with it. */
async function importPng(app: App, name: string, buffer: Buffer) {
  await tool(app, 'select');
  await hit(app, '#advanced');
  await hit(app, '#bar-context [data-action="art"]');
  await app.page.waitForSelector('dialog.advanced[open] .widget-row');
  await app.page.setInputFiles('dialog.advanced [data-key="art-file"]', { name, mimeType: 'image/png', buffer });
  await app.page.waitForSelector('dialog.advanced', { state: 'hidden' });
}

/** Drag a rectangle with the armed tool, in cells. */
async function box(app: App, a: [number, number], b: [number, number]) {
  await drag(app, await cellToClient(app, ...a), await cellToClient(app, ...b));
}

/** The picture on the editor's page, as it is drawn: its rectangle's size and middle, and the box that cuts it off, all in mm from the grid's corner. */
const drawn = (app: App) => app.page.evaluate(() => {
  const img = document.querySelector<SVGImageElement>('#canvas image.picture')!;
  const [a, b, c, d, e, f] = img.getAttribute('transform')!.replace(/^matrix\(|\)$/g, '').split(' ').map(Number);
  const clip = img.parentElement!;
  const turned = a === 0;
  const w = turned ? Math.abs(c) : Math.abs(a), h = turned ? Math.abs(b) : Math.abs(d);
  // the rectangle's top-left corner is where the matrix puts the corner of the unit square that lands there
  const left = Math.min(e, e + a + c), top = Math.min(f, f + b + d);
  return { w, h, cx: left + w / 2, cy: top + h / 2, rot: a === 0 ? (b > 0 ? 90 : 270) : a > 0 ? 0 : 180, clip: ['x', 'y', 'width', 'height'].map((k) => Number(clip.getAttribute(k))) };
});

for (const device of devices) {
  describe(`images and cover pages on a ${device}`, () => {
    it('imports a PNG, places it in a wide box, keeps it square and centred, zooms, resets and rotates', async () => {
      const app = await open(env, device);
      await importPng(app, 'qr code.png', qr);
      await box(app, [2, 3], [22, 9]); // 20 x 6 cells: wide
      let el = (await draft(app)).elements[0];
      expect(el).toMatchObject({ type: 'image', x: 2, y: 3, w: 20, h: 6, width_px: 21, height_px: 21 });
      expect(el.src).toMatch(/^data:image\/png;base64,/);
      expect(el.zoom).toBeUndefined();

      // the box is wide, the picture is square and in the middle of it, cut off at the box
      let r = await drawn(app);
      expect(r.w).toBeCloseTo(r.h, 3);
      expect(r.h).toBeCloseTo(6 * 3, 3);
      expect(r.cx).toBeCloseTo((2 + 10) * 3, 3);
      expect(r.cy).toBeCloseTo((3 + 3) * 3, 3);
      expect(r.clip).toEqual([6, 9, 60, 18]);

      // properties: zoom to 200% (a number), then Reset
      if (app.touch) await openDrawer(app);
      await app.page.waitForSelector('[data-key="prop-zoom"]');
      await app.page.fill('[data-key="prop-zoom"]', '200');
      await app.page.press('[data-key="prop-zoom"]', 'Enter');
      el = (await draft(app)).elements[0];
      expect(el.zoom).toBe(2);
      const big = await drawn(app);
      expect(big.w).toBeCloseTo(r.w * 2, 3);
      expect(big.cx).toBeCloseTo(r.cx, 3);
      expect(big.clip).toEqual(r.clip); // what is zoomed past the box is cut off at it
      await app.page.locator('[data-key="prop-move-picture"]').scrollIntoViewIfNeeded(); // the picture controls, not the box fields, in the picture
      await shot(app, `image-${device}-selected`);
      await app.page.click('[data-key="prop-picture-reset"]');
      el = (await draft(app)).elements[0];
      expect(el.zoom).toBeUndefined();
      expect((await drawn(app)).w).toBeCloseTo(r.w, 3);

      // the slider zooms too, and rotate turns it a quarter, still square and in the box
      await app.page.locator('[data-key="prop-zoom-slider"]').fill('300');
      expect((await draft(app)).elements[0].zoom).toBe(3);
      await app.page.selectOption('[data-key="prop-rotate"]', '90');
      el = (await draft(app)).elements[0];
      expect(el).toMatchObject({ zoom: 3, rotate: 90 });
      r = await drawn(app);
      expect(r.rot).toBe(90);
      expect(r.w).toBeCloseTo(r.h, 3);
      await app.page.click('[data-key="prop-picture-reset"]');
      expect(Object.keys((await draft(app)).elements[0])).not.toEqual(expect.arrayContaining(['zoom', 'rotate']));

      // nudging with the arrows slides the picture by half a cell
      await app.page.click('[data-key="picture-right"]');
      expect((await draft(app)).elements[0].pan_x).toBe(0.5);
      expect((await drawn(app)).cx).toBeCloseTo(r.cx + 1.5, 3);
      if (app.touch) expect(await small(app, '#sheet')).toEqual([]);
      expect(await missingHelp(app)).toEqual([]);
      expect(app.errors).toEqual([]);
    });

    it('slides the picture inside its box while Move picture is on, and moves the box when it is off', async () => {
      const app = await open(env, device);
      await importPng(app, 'qr.png', qr);
      await box(app, [2, 3], [22, 9]);
      await draft(app);
      const home = await drawn(app);
      // a zoomed picture has room to move
      if (app.touch) await openDrawer(app);
      await app.page.fill('[data-key="prop-zoom"]', '200');
      await app.page.press('[data-key="prop-zoom"]', 'Enter');
      await hit(app, '[data-key="prop-move-picture"]');
      expect(await app.page.locator('[data-key="prop-move-picture"]').getAttribute('aria-pressed')).toBe('true');
      if (app.touch) await hit(app, '#sheet .sheet-close');
      expect(await app.page.locator('#bar-context [data-action="picture"]').getAttribute('aria-pressed')).toBe('true');
      await box(app, [10, 6], [14, 6]);
      let el = (await draft(app)).elements[0];
      expect(el).toMatchObject({ x: 2, y: 3, w: 20, h: 6, zoom: 2 });
      expect(el.pan_x).toBeCloseTo(4, 0);
      expect((await drawn(app)).cx).toBeCloseTo(home.cx + (el.pan_x as number) * 3, 2);
      // off: the same drag moves the box
      await bar(app, 'picture');
      expect(await app.page.locator('#bar-context [data-action="picture"]').getAttribute('aria-pressed')).toBe('false');
      await box(app, [10, 6], [12, 6]);
      el = (await draft(app)).elements[0];
      expect(el.x).toBe(4);
      expect(el.pan_x).toBeCloseTo(4, 0);
      expect(app.errors).toEqual([]);
    });

    it('makes a cover page, draws in row 0, and prints it as a cover of the book', async () => {
      const app = await open(env, device);
      const { page } = app;
      await importPng(app, 'qr.png', qr);
      await box(app, [14, 1], [24, 7]);
      // Page settings: Cover page clears the identity and the number, and row 0 opens
      await page.evaluate(() => (document.querySelector('#canvas') as SVGElement).scrollIntoView());
      await choose(app, 'page', '#settings');
      const toggle = page.locator('[data-key="settings-cover-page"]');
      expect(await toggle.isChecked()).toBe(false);
      await page.fill('[data-key="settings-identity-page"]', 'MON OCT 26');
      await toggle.click();
      expect(await page.locator('[data-key="settings-identity-page"]').inputValue()).toBe('');
      expect(await page.locator('[data-key="settings-number-page"]').isDisabled()).toBe(true);
      await shot(app, `cover-${device}-settings`);
      await hit(app, 'dialog.settings header button');
      await page.waitForSelector('dialog.settings', { state: 'hidden' });
      let doc = await draft(app);
      expect(doc).toMatchObject({ cover: true, page_number: false });
      expect(doc.identity).toBeUndefined();
      // a box in row 0, which an ordinary page would refuse
      await tool(app, 'box');
      await box(app, [1, 0], [12, 1]);
      doc = await draft(app);
      expect(doc.elements.map((e) => e.type)).toEqual(['image', 'box']);
      expect(doc.elements[1]).toMatchObject({ y: 0, h: 1 });
      expect(await page.locator('#canvas text').allInnerTexts()).not.toContain('47'); // no page number
      await shot(app, `cover-${device}-row0`);
      await nameOpen(app, 'Cover test');

      // in the book, Choose design lists the cover page first; the cover prints it
      await choose(app, 'page', '#view-book');
      await page.waitForSelector('.stage-page');
      if (app.touch) await hit(app, '.contents-toggle');
      await hit(app, '.orow.cover [data-slot="-1"]');
      await hit(app, '[data-help="book-choose"]');
      await page.waitForSelector('dialog.picker[open] .design');
      const firstDesign = await page.locator('dialog.picker .design').nth(1).getAttribute('data-name'); // the first is Blank
      expect(firstDesign).toBe('Cover test');
      expect(await page.locator('dialog.picker .design[data-name="Cover test"] .hint').innerText()).toBe('Cover page');
      // a cover slot is always a cover page, whether or not its design has the flag: Edit page opens it with no header
      await hit(app, 'dialog.picker .design:not([data-kind="blank"]):not([data-name="Cover test"])');
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      await choose(app, 'page', '#settings');
      expect(await page.locator('[data-key="settings-cover-page"]').isChecked()).toBe(true);
      expect(await page.locator('[data-key="settings-cover-page"]').isDisabled()).toBe(true);
      await hit(app, 'dialog.settings header button');
      await page.waitForSelector('dialog.settings', { state: 'hidden' });
      await tool(app, 'box');
      await box(app, [1, 0], [6, 1]);
      expect(await page.locator('.layers .layer-name').allInnerTexts()).toContain('box · 1,0 5×1'); // row 0 took it
      await hit(app, '#edit-back');
      await page.waitForSelector('.stage-page');
      await hit(app, '[data-help="book-choose"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await hit(app, 'dialog.picker .design[data-name="Cover test"]');
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await nameOpen(app, 'Cover book'); // an Untitled book is named before it is exported
      await hit(app, '.book-bar [data-key="book-export"]');
      await page.waitForSelector('dialog.export[open] [data-key="export-pdf"]');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 50_000 }), hit(app, '[data-key="export-pdf"]')]);
      const files = unzip(readFileSync((await download.path())!));
      expect(files.has('error.txt')).toBe(false);
      for (const name of ['pages.pdf', 'cover-outside.pdf', 'cover-inside.pdf', 'print-first.pdf', 'print-second.pdf']) {
        expect((await PDFDocument.load(files.get(name)!)).getPageCount(), name).toBeGreaterThan(0);
      }
      expect(files.get('cover-outside.pdf')!.toString('latin1')).toContain('/Subtype /Image');
      expect(app.errors).toEqual([]);
    });
  });
}
