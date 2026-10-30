import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, cellToClient, draft, drag, hit, open, openDrawer, seedPage, shot, start, stop, tap, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: App) => (await draft(app)).elements as Record<string, any>[];

const SEED = {
  format: 'dotwork-page', version: 2, name: 'Seed', grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [
    { type: 'box', x: 6, y: 10, w: 13, h: 6 },
    { type: 'text', x: 2, y: 25, text: 'GOALS', tone: 'black' },
  ],
};

/** Where the middle of the text's capitals and of the box are, on screen. */
async function centres(app: App) {
  return app.page.evaluate(() => {
    const t = [...document.querySelectorAll('#canvas #content text')].find((n) => n.textContent === 'GOALS') as SVGTextElement;
    const r = t.getBoundingClientRect();
    const size = Number(t.getAttribute('font-size'));
    // in the text's own frame (its CTM has the page offset and its transform) the baseline is at y and the capitals are 0.58 em tall
    const pt = new DOMPoint(0, Number(t.getAttribute('y')) - 0.5796 * size / 2).matrixTransform(t.getScreenCTM()!);
    return { x: (r.left + r.right) / 2, y: pt.y };
  });
}
const boxCentre = (app: App, x: number, y: number, w: number, h: number) => cellToClient(app, x + w / 2, y + h / 2);

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`Center in… (${device})`, () => {
    it('centers a text in a box, keeps it centered with a group, and snaps it back when moved alone', async () => {
      const app = await open(env, device);
      await seedPage(app, SEED);
      await tap(app, await cellToClient(app, 3, 25.5)); // select the text
      if (device === 'phone') await openDrawer(app);
      await hit(app, '#panel [data-key="prop-center-in"]');
      const note = app.page.locator('#notice');
      expect(await note.innerText()).toContain('Tap the element to center this text in');
      await shot(app, `${device}-center-in-message`);

      await tap(app, await cellToClient(app, 6, 13)); // the box's left side
      expect(await note.isVisible()).toBe(false);
      const [box, text] = await elements(app);
      expect(text.center_in).toEqual({ x: box.x, y: box.y, w: box.w, h: box.h });
      const c = await centres(app), b = await boxCentre(app, 6, 10, 13, 6);
      expect(Math.abs(c.x - b.x)).toBeLessThan(0.6);
      expect(Math.abs(c.y - b.y)).toBeLessThan(0.6);
      await shot(app, `${device}-center-in-done`);

      // grouped, then moved: still centered
      await tap(app, await cellToClient(app, 2, 40)); // clear the selection
      await bar(app, 'selectAll');
      await bar(app, 'group');
      const from = await cellToClient(app, 6, 13), cell = (await cellToClient(app, 1, 0)).x - (await cellToClient(app, 0, 0)).x;
      await drag(app, from, { x: from.x + 2 * cell, y: from.y + 3 * cell });
      const moved = await elements(app);
      expect(moved[0]).toMatchObject({ x: 8, y: 13 });
      const mc = await centres(app), mb = await boxCentre(app, 8, 13, 13, 6);
      expect(Math.abs(mc.x - mb.x)).toBeLessThan(0.6);
      expect(Math.abs(mc.y - mb.y)).toBeLessThan(0.6);
      expect(moved[1].center_in).toEqual({ x: 8, y: 13, w: 13, h: 6 });

      // ungrouped and moved alone: free, on the grid
      await bar(app, 'group'); // Ungroup
      await tap(app, await cellToClient(app, 2, 40));
      const t = await centres(app);
      await tap(app, t);
      await drag(app, t, { x: t.x + cell, y: t.y + cell });
      const free = (await elements(app))[1];
      expect(free.center_in).toBeUndefined();
      expect(Number.isInteger(free.x) && Number.isInteger(free.y)).toBe(true);
      expect(app.errors).toEqual([]);
    });
  });
}

// The tablet pictures for the docs and the PR (not a test of its own; it runs only when SHOTS names a directory).
describe.runIf(process.env.SHOTS)('Center in… (tablet pictures)', () => {
  it('shows the message and the centered text', async () => {
    const app = await open(env, 'tablet');
    await seedPage(app, SEED);
    await tap(app, await cellToClient(app, 3, 25.5));
    await openDrawer(app);
    await hit(app, '#panel [data-key="prop-center-in"]');
    await shot(app, 'tablet-center-in-message');
    await tap(app, await cellToClient(app, 6, 13));
    await shot(app, 'tablet-center-in-done');
  });
});
