import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellToClient, choose, drag, hit, missingHelp, open, openDoc, seedDoc, settle, shot, start, stop, tap, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const page = (side: 'left' | 'right', elements: object[] = [], more: object = {}) =>
  ({ format: 'dotwork-page', version: 2, name: side === 'left' ? 'Left page' : 'Right page', side, grid: { cols: 27, rows: 44, pitch_mm: 3 }, elements, ...more });
const spread = (left: object[], right: object[] = []) => ({ format: 'dotwork-spread', version: 2, name: 'Mirror spread', left: page('left', left), right: page('right', right) });
const BOX = { type: 'box', x: 1, y: 10, w: 10, h: 8 };

/** The drawn outline of the first box on a canvas: its path data and where it sits (mm from the grid's corner, via the SVG's own box). */
const drawnBox = (app: App, canvas: string) => app.page.evaluate((sel) => {
  const path = [...document.querySelectorAll(`${sel} path`)].find((p) => p.getAttribute('stroke') === '#000' && p.getAttribute('stroke-linecap') === 'square') as SVGGraphicsElement | undefined;
  return path ? { d: path.getAttribute('d'), x: path.getBBox().x } : null;
}, canvas);

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`mirroring in a spread on a ${device}`, () => {
    it('shows the mirrored left half in the editor itself, edits it as drawn, and Preview matches it exactly', async () => {
      const app = await open(env, device);
      await seedDoc(app, 'spread', spread([BOX]), 'Mirror spread');
      await choose(app, 'page', '#view-spread');
      await app.page.waitForSelector('#canvas-left');
      await app.page.waitForFunction(() => document.querySelector('#canvas-left path[stroke-linecap="square"]'));

      // as designed: the box is near the left edge
      expect((await drawnBox(app, '#canvas-left'))!.x).toBeCloseTo(3 * 1, 1);

      // Mirror on left pages for the left half: the drawing flips at once, with no trip to Preview
      await choose(app, 'page', '#settings');
      await app.page.check('[data-key="settings-mirror-left"]');
      await hit(app, '[data-help="settings-close"]');
      expect((await drawnBox(app, '#canvas-left'))!.x).toBeCloseTo(3 * 16, 1); // 27 - 1 - 10 = 16: near the right edge
      await shot(app, `mirror-${device}-left-half`);

      // select it and drag it three cells to the left of the screen; the editor works on what is drawn
      const top = await cellToClient(app, 18.5, 10, '#canvas-left'); // on the top edge, away from the handles
      await tap(app, top);
      await drag(app, top, await cellToClient(app, 15.5, 10, '#canvas-left'));
      const edited = await drawnBox(app, '#canvas-left');
      expect(edited!.x).toBeCloseTo(3 * 13, 1);

      // the design keeps the box where it was made, moved the other way: 1 + 3
      const saved = await openDoc(app, 'spread');
      expect(saved.left.elements[0]).toMatchObject({ x: 4, w: 10 });
      expect(saved.left.mirror_left).toBe(true);

      // Preview draws it exactly as the editor did
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await choose(app, 'edit', '#mode-preview');
      expect((await drawnBox(app, '#canvas-left'))!.d).toBe(edited!.d);
      await choose(app, 'edit', '#mode-edit');
      expect(await app.page.locator('#canvas-left').isVisible()).toBe(true);
    });

    it('copies the left half mirrored to the right page, after asking when that page has something on it', async () => {
      const app = await open(env, device);
      await seedDoc(app, 'spread', spread([BOX, { type: 'box', x: 12, y: 20, w: 4, h: 3, sides: ['left', 'top'] }, { type: 'text', x: 2, y: 25, text: 'HELLO' }], [{ type: 'rule', x1: 1, y1: 5, x2: 9, y2: 5 }]), 'Mirror spread');
      await choose(app, 'page', '#view-spread');
      await app.page.waitForSelector('#canvas-left');
      expect(await missingHelp(app)).toEqual([]);
      const button = app.page.locator('.copy-mirrored[data-from="left"]');
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      await shot(app, `mirror-${device}-copy`);

      // the right page has a rule: asked first; saying no changes nothing
      const asked: string[] = [];
      app.page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
      await button.click();
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('Replace the right page’s 1 element');
      expect((await openDoc(app, 'spread')).right.elements).toHaveLength(1);

      app.page.once('dialog', (d) => { void d.accept(); });
      await button.click();
      await app.page.waitForSelector('#canvas-right', { state: 'visible' }); // the other page is now the one worked on
      const right = (await openDoc(app, 'spread')).right;
      expect(right.mirror_left).toBeUndefined();
      expect(right.elements).toEqual([
        { type: 'box', x: 16, y: 10, w: 10, h: 8 },
        { type: 'box', x: 11, y: 20, w: 4, h: 3, sides: ['right', 'top'] },
        { type: 'text', x: 25, y: 25, text: 'HELLO', align: 'right' },
      ]);
      await shot(app, `mirror-${device}-copied`);
      // Undo, on the page that changed, brings back the rule
      await hit(app, '#undo');
      expect((await openDoc(app, 'spread')).right.elements).toEqual([{ type: 'rule', x1: 1, y1: 5, x2: 9, y2: 5 }]);
    });
  });

  describe(`selecting several layers on a ${device}`, () => {
    it('selects with Ctrl and Shift on a desktop, or in Select mode on a phone or tablet, and moves them together', async () => {
      const app = await open(env, device);
      const els = [0, 1, 2, 3].map((i) => ({ type: 'box', x: 2 + i * 6, y: 8, w: 4, h: 4 }));
      await seedDoc(app, 'page', page('right', els), 'Four boxes');
      const names = app.page.locator('[data-key^="layer-"][data-key$="-name"]');
      if (app.touch) await hit(app, '#layers-button');
      await app.page.waitForSelector('[data-key="layer-0-name"]', { state: 'visible' });
      const selected = () => app.page.locator('.layer.selected').count();

      if (!app.touch) {
        await app.page.click('[data-key="layer-0-name"]');
        expect(await selected()).toBe(1);
        await app.page.click('[data-key="layer-2-name"]', { modifiers: ['Control'] });
        expect(await selected()).toBe(2);
        await app.page.click('[data-key="layer-2-name"]', { modifiers: ['Control'] });
        expect(await selected()).toBe(1);
        await app.page.click('[data-key="layer-3-name"]', { modifiers: ['Shift'] }); // from the last one clicked (2) to 3
        expect(await selected()).toBe(2);
        await app.page.click('[data-key="layer-0-name"]');
        await app.page.click('[data-key="layer-3-name"]', { modifiers: ['Shift'] });
      } else {
        await hit(app, '[data-key="layers-select"]');
        await shot(app, `layers-${device}-select-mode`);
        expect(await missingHelp(app)).toEqual([]);
        for (const i of [0, 1, 2, 3]) {
          expect((await app.page.locator(`[data-key="layer-${i}-check"]`).locator('xpath=..').boundingBox())!.width).toBeGreaterThanOrEqual(43.5);
        }
        await hit(app, '[data-key="layer-0-name"]');
        await hit(app, '[data-key="layer-1-check"]');
        await hit(app, '[data-key="layer-2-name"]');
        await hit(app, '[data-key="layer-2-check"]'); // ticked and unticked again
        await hit(app, '[data-key="layer-3-check"]');
        expect(await selected()).toBe(3);
        await hit(app, '[data-key="layers-select"]'); // Done
      }
      const count = await selected();
      expect(count).toBeGreaterThanOrEqual(2);
      if (!app.touch) { // Select mode works with a mouse too: the checkboxes show the same selection
        await hit(app, '[data-key="layers-select"]');
        expect(await app.page.locator('.layer-check input:checked').count()).toBe(count);
        await shot(app, `layers-${device}-select-mode`);
        await hit(app, '[data-key="layers-select"]');
      }
      expect(await names.count()).toBe(4);
      await shot(app, `layers-${device}-several`);

      // the page shows the same selection, and moving works on all of it
      const before = (await openDoc(app, 'page')).elements.map((e: { x: number }) => e.x);
      if (await app.page.locator('[data-tab-button="properties"]').isVisible()) await hit(app, '[data-tab-button="properties"]'); // a wide screen shows both at once
      await app.page.waitForSelector('[data-key="nudge-right"]', { state: 'visible' });
      await hit(app, '[data-key="nudge-right"]');
      await settle(app);
      const after = (await openDoc(app, 'page')).elements.map((e: { x: number }) => e.x);
      const moved = after.map((x: number, i: number) => x - before[i]);
      expect(moved.filter((d: number) => d === 1)).toHaveLength(count);
      expect(moved.filter((d: number) => d !== 0 && d !== 1)).toEqual([]);
      expect(await app.page.locator('#canvas rect[stroke-dasharray]').count()).toBeGreaterThan(0); // the page frames the selection too
    });
  });
}
