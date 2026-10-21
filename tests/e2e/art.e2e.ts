import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, cellToClient, choose, draft, drag, hit, missingHelp, open, shot, start, stop, tap, tool, touch, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const goodTime = readFileSync('examples/pages/daily-good-time.json', 'utf8');
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

/** Open the Art window from Advanced. */
async function openArt(app: App) {
  await tool(app, 'select');
  await hit(app, '#advanced');
  await hit(app, '#bar-context [data-action="art"]');
  await app.page.waitForSelector('dialog.advanced[open] .widget-row');
}

/** Pick art in the Art window by its name. */
async function pickArt(app: App, name: string) {
  await openArt(app);
  await hit(app, `dialog.advanced .widget-row[data-name="${name}"] .widget-use`);
  await app.page.waitForSelector('dialog.advanced', { state: 'hidden' });
}

/** Press, drag and (unless `hold`) let go, with a picture taken in the middle of the drag when asked. */
async function dragArt(app: App, a: [number, number], b: [number, number], midShot?: string) {
  const from = await cellToClient(app, ...a), to = await cellToClient(app, ...b);
  if (!midShot) { await drag(app, from, to); return; }
  if (app.touch) {
    await touch(app, 'touchStart', [from]);
    for (let i = 1; i <= 8; i++) await touch(app, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }]);
    await shot(app, midShot);
    await touch(app, 'touchEnd', []);
  } else {
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    for (let i = 1; i <= 8; i++) await app.page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await shot(app, midShot);
    await app.page.mouse.up();
  }
}

for (const device of ['phone', 'tablet', 'desktop'] as Device[]) {
  describe(`art on a ${device}`, () => {
    it('opens a window of art from Advanced, with the built-in pieces and an import button', async () => {
      const app = await open(env, device);
      const { page } = app;
      await tool(app, 'sequence');
      await openArt(app);
      const names = await page.locator('dialog.advanced .widget-row .art-text strong').allInnerTexts();
      expect(names).toEqual(['Gauge', 'Engagement gauge', 'Energy gauge']);
      expect(await page.locator('dialog.advanced').innerText()).toContain('Import SVG art');
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app, 'dialog.advanced')).toEqual([]);
      await shot(app, `${device}-art-window`);
      // Art is not under Widgets
      await page.click('dialog.advanced header button');
      await hit(app, '#bar-context [data-action="widget"]');
      await page.waitForSelector('dialog.advanced[open] .hint');
      expect(await page.locator('dialog.advanced').innerText()).not.toContain('gauge');
      expect(app.errors).toEqual([]);
    });

    it('imports an SVG there, reports what was left out, and draws it into a rectangle', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openArt(app);
      // a file with things we leave out: the notice lists them
      await page.setInputFiles('dialog.advanced input[data-key="art-file"]', { name: 'noisy.svg', mimeType: 'image/svg+xml', buffer: noisy });
      await page.waitForSelector('#notice .problem');
      const notice = await page.locator('#notice').innerText();
      expect(notice).toContain('Imported “noisy”');
      for (const word of ['text', 'images', 'gradients']) expect(notice).toContain(word);
      expect(notice).toContain('Copy details');
      expect(notice).toContain('Drag a rectangle');
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-art-import-report`);
      expect(await page.locator('#bar-context [data-tool="art"]').getAttribute('aria-pressed')).toBe('true');

      // press and drag: the art fits into the rectangle
      await dragArt(app, [3, 8], [13, 14], `${device}-art-drawing`);
      const placed = await artElements(app);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ type: 'art', x: 3, y: 8, w: 10, h: 6, view_box: [0, 0, 40, 20] });
      expect(placed[0].scaling).toBeUndefined();
      await shot(app, `${device}-art-drawn`);
      expect(await page.locator('#bar-context [data-tool="art"]').count()).toBe(0); // the tool is spent: the bar is back to Select
      expect(app.errors).toEqual([]);
    });

    it('refuses a file with nothing to draw, in the window', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openArt(app);
      await page.setInputFiles('dialog.advanced input[data-key="art-file"]', { name: 'words.svg', mimeType: 'image/svg+xml', buffer: empty });
      await page.waitForFunction(() => document.querySelector('dialog.advanced .problem')?.textContent?.includes('Nothing in this file can be drawn'));
      expect(await page.locator('dialog.advanced').innerText()).toContain('Not imported');
      expect((await artElements(app))).toHaveLength(0);
      expect(await missingHelp(app)).toEqual([]);
    });

    it('a tap puts art down at its first size, and the two gauge presets draw as the two dials', async () => {
      const app = await open(env, device);
      const { page } = app;
      await pickArt(app, 'Energy gauge');
      expect(await page.locator('#notice').innerText()).toContain('Drag a rectangle');
      await tap(app, await cellToClient(app, 2, 20));
      let placed = await artElements(app);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ x: 2, y: 20, w: 10, h: 5.5, view_box: [0, 0, 30, 16], fills: { 'left-half': 'medium' }, strokes: { 'centre-line': 'black' } });

      await pickArt(app, 'Engagement gauge');
      await dragArt(app, [14, 20], [24, 26]);
      placed = await artElements(app);
      expect(placed).toHaveLength(2);
      expect(placed[1]).toMatchObject({ x: 14, y: 20, w: 10, h: 6, fills: { 'left-half': 'none' }, strokes: { 'centre-line': 'none' } });
      // Energy draws the filled left half and the centre line; Engagement draws neither
      expect(await page.locator('#canvas path.art[stroke-linecap="round"]').count()).toBe(5 + 4);
      await shot(app, `${device}-gauge-presets`);
      await choose(app, 'edit', '#mode-preview');
      await shot(app, `${device}-gauge-presets-preview`);
      expect(app.errors).toEqual([]);
    });

    it('lists only the controls that can change a named path, and stores the choice on the placement', async () => {
      const app = await open(env, device);
      const { page } = app;
      await pickArt(app, 'Gauge');
      await dragArt(app, [4, 6], [14, 12]);
      await tool(app, 'select');
      await tap(app, await cellToClient(app, 9, 9));
      await bar(app, 'properties');
      await page.waitForSelector('[data-key="prop-path-left-half-fill"]');
      const keys = await page.locator('[data-key^="prop-path-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
      expect(keys).toEqual(['prop-path-left-half-fill', 'prop-path-right-half-fill', 'prop-path-top-tick-line', 'prop-path-centre-line-line']);
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-art-path-controls`);

      const roundLines = () => page.locator('#canvas path.art[stroke-linecap="round"]').count();
      expect(await roundLines()).toBe(5);
      await page.selectOption('[data-key="prop-path-centre-line-line"]', 'none');
      expect((await artElements(app))[0].strokes).toEqual({ 'centre-line': 'none' });
      expect(await roundLines()).toBe(4);
      await page.selectOption('[data-key="prop-path-left-half-fill"]', 'none');
      await page.selectOption('[data-key="prop-path-right-half-fill"]', 'dark');
      expect((await artElements(app))[0].fills).toEqual({ 'left-half': 'none', 'right-half': 'dark' });
      await page.selectOption('[data-key="prop-path-centre-line-line"]', 'as imported');
      expect((await artElements(app))[0].strokes).toBeUndefined();
      expect(await roundLines()).toBe(5);
      expect(app.errors).toEqual([]);
    });

    it('lists art in the Library, imports there too, and arms the same tool', async () => {
      const app = await open(env, device);
      const { page } = app;
      await choose(app, 'edit', '#library');
      await page.waitForSelector('dialog.library.browser[open] .lib-card');
      await hit(app, '[data-tab="art"]');
      for (const name of ['Gauge', 'Engagement gauge', 'Energy gauge']) await page.waitForSelector(`.lib-card[data-name="${name}"]`);
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

      // tapping it arms the art tool, and a drag on the page draws it into a rectangle
      await hit(app, '.lib-card[data-name="noisy"] .lib-open');
      await page.waitForSelector('dialog.library.browser', { state: 'hidden' });
      await dragArt(app, [3, 10], [9, 14]);
      const placed = await artElements(app);
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ x: 3, y: 10, w: 6, h: 4, view_box: [0, 0, 40, 20] });
      expect(app.errors).toEqual([]);
    });

    it('draws the Good Time page with its six gauges, Engagement and Energy in each row', async () => {
      const app = await open(env, device);
      const { page } = app;
      await page.evaluate((p) => localStorage.setItem('dotwork.page', p), goodTime);
      await page.reload();
      await page.waitForSelector('#canvas');
      await page.evaluate(() => document.fonts.ready);
      expect(await artElements(app)).toHaveLength(6);
      expect(await page.locator('#canvas path.art[stroke-linecap="round"]').count()).toBe(3 * 5 + 3 * 4);
      await shot(app, `${device}-good-time-gauges`);
      await choose(app, 'edit', '#mode-preview');
      await shot(app, `${device}-good-time-gauges-preview`);
      expect(app.errors).toEqual([]);
    });
  });
}
