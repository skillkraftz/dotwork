import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, cellToClient, choose, draft, hit, missingHelp, open, shot, start, stop, tap, tool, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const gauge = readFileSync('tests/fixtures/half-donut-gauge.svg');
const goodTime = readFileSync('examples/good-time-gauges.json', 'utf8');
const noisy = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">
  <defs><linearGradient id="g"/></defs><text x="1" y="5">Hi</text><image href="photo.png"/>
  <circle cx="10" cy="10" r="8" fill="#dcdcdc" stroke="#000"/><rect x="22" y="2" width="16" height="16" fill="url(#g)"/></svg>`);
const empty = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>only words</text></svg>');

const artElements = async (app: App) => (await draft(app)).elements.filter((e) => e.type === 'art') as Record<string, any>[];

/** Controls inside a window that are smaller than a fingertip. */
async function small(app: App, scope: string) {
  return app.page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.textContent?.trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

for (const device of ['phone', 'tablet', 'desktop'] as Device[]) {
  describe(`art on a ${device}`, () => {
    it('imports an SVG from Advanced, reports what was left out, and places and resizes it', async () => {
      const app = await open(env, device);
      const { page } = app;
      await tool(app, 'sequence');
      await tool(app, 'select');
      await hit(app, '#advanced');
      expect(await page.locator('#bar-context button[data-action="art"]').isVisible()).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-advanced-art-button`);

      // a file with things we leave out: the notice lists them
      await page.setInputFiles('input[data-key="art-file"]', { name: 'noisy.svg', mimeType: 'image/svg+xml', buffer: noisy });
      await page.waitForSelector('#notice .problem');
      const notice = await page.locator('#notice').innerText();
      expect(notice).toContain('Imported “noisy”');
      for (const word of ['text', 'images', 'gradients']) expect(notice).toContain(word);
      expect(notice).toContain('Copy details');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-art-import-report`);

      // nothing to draw: refused with the reason, nothing placed
      await page.setInputFiles('input[data-key="art-file"]', { name: 'words.svg', mimeType: 'image/svg+xml', buffer: empty });
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('Not imported'));
      expect(await page.locator('#notice').innerText()).toContain('Nothing in this file can be drawn');

      // the gauge: imported, armed, placed with a tap
      await page.setInputFiles('input[data-key="art-file"]', { name: 'half-donut-gauge.svg', mimeType: 'image/svg+xml', buffer: gauge });
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('Imported “half-donut-gauge”'));
      expect(await page.locator('#notice .problem').count()).toBe(0);
      await shot(app, `${device}-art-import`);
      await tap(app, await cellToClient(app, 4, 6));
      const placed = await artElements(app);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ type: 'art', x: 4, y: 6, w: 10, h: 5.5, view_box: [0, 0, 100, 54] });
      expect(placed[0].paths).toHaveLength(5);
      expect(await page.locator('#canvas path[fill="#bdbdbd"]').count()).toBeGreaterThan(0);

      // select it: its properties offer Scaling, and stretching it keeps the line widths
      await tool(app, 'select');
      await tap(app, await cellToClient(app, 9, 8));
      await bar(app, 'properties');
      await page.waitForSelector('[data-key="prop-scaling"], #panel [data-help="prop-scaling"]');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-art-properties`);
      expect(app.errors).toEqual([]);
    });

    it('lists art in the Library and imports there too', async () => {
      const app = await open(env, device);
      const { page } = app;
      await choose(app, 'edit', '#library');
      await page.waitForSelector('dialog.library.browser[open] .lib-card');
      await hit(app, '[data-tab="art"]');
      await page.waitForSelector('.lib-card[data-name="Half-donut gauge"]');
      expect(await page.locator('dialog.library.browser').innerText()).toContain('Import SVG art');
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app, 'dialog.library.browser')).toEqual([]);

      await page.setInputFiles('dialog.library.browser input[data-key="art-file"]', { name: 'noisy.svg', mimeType: 'image/svg+xml', buffer: noisy });
      await page.waitForSelector('.lib-card[data-name="noisy"]');
      const msg = await page.locator('dialog.library.browser .lib-msg').innerText();
      expect(msg).toContain('Imported “noisy”');
      expect(msg).toContain('images');
      await shot(app, `${device}-library-art`);
      // it is not listed under Widgets
      await hit(app, '[data-tab="widgets"]');
      await page.waitForSelector('.lib-card[data-name="Mood scale"]');
      expect(await page.locator('.lib-card[data-name="noisy"]').count()).toBe(0);
      await hit(app, '[data-tab="art"]');

      // tapping it arms it, and a tap on the page copies it into the page
      await hit(app, '.lib-card[data-name="noisy"] .lib-open');
      await page.waitForSelector('dialog.library.browser', { state: 'hidden' });
      await tap(app, await cellToClient(app, 3, 10));
      const placed = await artElements(app);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ x: 3, y: 10, view_box: [0, 0, 40, 20] });
      expect(app.errors).toEqual([]);
    });

    it('draws the Good Time page with two half-donut gauges', async () => {
      const app = await open(env, device);
      const { page } = app;
      await page.evaluate((p) => localStorage.setItem('dotwork.page', p), goodTime);
      await page.reload();
      await page.waitForSelector('#canvas');
      await page.evaluate(() => document.fonts.ready);
      expect(await artElements(app)).toHaveLength(2);
      expect(await page.locator('#canvas path[fill="#dcdcdc"]').count()).toBe(2);
      await shot(app, `${device}-good-time-gauges`);
      await choose(app, 'edit', '#mode-preview');
      await shot(app, `${device}-good-time-gauges-preview`);
      expect(app.errors).toEqual([]);
    });
  });
}
