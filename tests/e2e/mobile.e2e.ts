import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  box, cellToClient, draft, drag, open, pinch, press, shot, start, stop, tap, twoFingerDrag, viewBoxOf, type App, type Env,
} from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const elements = async (app: App) => (await draft(app)).elements;

/** Every visible control is at least this big in both directions (a hair of slack for rounding). */
async function smallControls(app: App) {
  return app.page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, select, input:not([type="file"]):not([type="hidden"]), summary, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || (el as HTMLInputElement).type === 'checkbox') continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()}#${el.id || el.className || el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

describe('phone layout (390 x 844, touch)', () => {
  it('gives the page the screen, with a one-row top bar and a bottom tool bar', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const ids = ['#view-page', '#view-spread', '#view-book', '#undo', '#redo', '#menu-button'];
    const tops = await Promise.all(ids.map(async (id) => (await box(app, id))!.y));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
    expect((await box(app, '.topbar'))!.height).toBeLessThan(64);
    const tools = (await box(app, '#tools'))!;
    expect(tools.y + tools.height).toBeCloseTo(844, 0);
    const labels = await page.locator('#tools button .label').allInnerTexts();
    expect(labels.map((l) => l.trim())).toEqual(['Select', 'Shade', 'Pattern', 'Box', 'Rule', 'Checks', 'Text', 'Half']);
    const wrap = (await box(app, '#canvas-wrap'))!;
    expect(wrap.height / 844).toBeGreaterThan(0.8);
    const pageRect = (await page.locator('#content > rect').first().boundingBox())!;
    expect(pageRect.width / 390).toBeGreaterThan(0.9);
    expect(await page.locator('#status').count()).toBe(0); // help is not a permanent footer any more
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-page');
    noErrors(app);
  });

  it('keeps everything else in the menu, with big targets', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    expect(await page.locator('#library').isVisible()).toBe(false);
    await page.tap('#menu-button');
    for (const id of ['#library', '#new', '#examples', '#import', '#export-json', '#export-png', '#mode-preview', '#help']) {
      expect(await page.locator(id).isVisible(), id).toBe(true);
    }
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-menu');
    await page.tap('#help');
    expect(await page.locator('dialog.help').isVisible()).toBe(true);
    expect(await page.locator('#menu').isVisible()).toBe(false); // choosing something closes the menu
    await shot(app, 'phone-help');
    noErrors(app);
  });

  it('draws a box with a finger', async () => {
    const app = await open(env, 'phone');
    await app.page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 10, 9));
    const els = await elements(app);
    expect(els).toMatchObject([{ type: 'box', x: 3, y: 4, w: 7, h: 5 }]);
    expect(await app.page.locator('#sheet').getAttribute('data-state')).toBe('peek');
    noErrors(app);
  });

  it('draws a shade, changes its tone, moves it by nudging and dragging, undoes, and saves it to the library', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('[data-tool="shade"]');
    await drag(app, await cellToClient(app, 5, 8), await cellToClient(app, 12, 14));
    expect(await elements(app)).toMatchObject([{ type: 'shade', x: 5, y: 8, w: 7, h: 6 }]);
    await shot(app, 'phone-selected');

    // change the fill
    await page.locator('#panel select[data-key="prop-tone"]').selectOption('dark');
    expect(await elements(app)).toMatchObject([{ type: 'shade', tone: 'dark' }]);

    // move it with the nudge buttons
    await page.tap('[data-key="nudge-right"]');
    await page.tap('[data-key="nudge-down"]');
    expect(await elements(app)).toMatchObject([{ x: 6, y: 9 }]);

    // and with a finger
    const from = await cellToClient(app, 8, 11), to = await cellToClient(app, 10, 12);
    await drag(app, from, to);
    expect(await elements(app)).toMatchObject([{ x: 8, y: 10 }]);

    // undo the drag, then the two quick nudges (one undo step), keeping the tone
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: 6, y: 9 }]);
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: 5, y: 8, tone: 'dark' }]);

    // save it
    await page.tap('#menu-button');
    await page.tap('#library');
    await page.waitForSelector('dialog[aria-label="Library"][open]');
    const dialog = (await box(app, 'dialog[aria-label="Library"]'))!;
    expect([dialog.width, dialog.height]).toEqual([390, 844]); // a full-screen sheet
    await page.locator('dialog[aria-label="Library"] input[aria-label="Name"]').fill('Phone test');
    await page.tap('dialog[aria-label="Library"] .lib-save .primary');
    await page.waitForSelector('.lib-card');
    expect(await page.locator('.lib-card').count()).toBe(1);
    expect(await page.locator('.lib-card .lib-name').innerText()).toBe('Phone test');
    expect((await box(app, '.lib-card .thumb svg'))!.height).toBeGreaterThan(200); // large thumbnails
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-library');
    noErrors(app);
  });

  it('never hides the selection under the sheet', async () => {
    const app = await open(env, 'phone');
    await app.page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 4, 34), await cellToClient(app, 14, 42)); // low on the page
    await app.page.waitForTimeout(300);
    const sheet = (await box(app, '#sheet'))!;
    const sel = (await app.page.locator('#content rect[stroke-dasharray]').boundingBox())!;
    expect(sel.y + sel.height).toBeLessThanOrEqual(sheet.y);
    expect(sel.y).toBeGreaterThanOrEqual((await box(app, '#canvas-wrap'))!.y);
    await shot(app, 'phone-selection-above-sheet');
    // pulled up the sheet still doesn't cover it
    await app.page.tap('.grip');
    await app.page.waitForTimeout(400);
    expect(await app.page.locator('#sheet').getAttribute('data-state')).toBe('full');
    const bigger = (await box(app, '#sheet'))!;
    expect(bigger.height).toBeGreaterThan(sheet.height);
    const sel2 = (await app.page.locator('#content rect[stroke-dasharray]').boundingBox())!;
    expect(sel2.y + sel2.height).toBeLessThanOrEqual(bigger.y + 1);
    noErrors(app);
  });

  it('opens from the Layers button, reorders layers with the arrows, and is swiped down to dismiss', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 8, 8));
    await page.tap('[data-tool="rule"]');
    await drag(app, await cellToClient(app, 3, 12), await cellToClient(app, 12, 12));
    // dismiss with a swipe down on the grip
    const grip = (await box(app, '.grip'))!;
    await drag(app, { x: grip.x + 100, y: grip.y + 20 }, { x: grip.x + 100, y: grip.y + 240 });
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('closed');
    await page.tap('#layers-button');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('peek');
    expect(await page.locator('#panel .layer').count()).toBe(2);
    await shot(app, 'phone-layers');
    // the rule is on top; send it down with its arrow
    await page.locator('#panel .layer').first().locator('button[aria-label^="Move down"]').tap();
    expect((await elements(app)).map((e) => e.type)).toEqual(['rule', 'box']);
    expect(await smallControls(app)).toEqual([]);
    noErrors(app);
  });
});

describe('touch replacements', () => {
  it('long-press opens a menu: duplicate, forward, backward, underneath, delete', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    // two shades stacked
    await page.tap('[data-tool="shade"]');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 14, 14));
    await page.tap('[data-tool="shade"]');
    await drag(app, await cellToClient(app, 6, 8), await cellToClient(app, 12, 16));
    await page.tap('#layers-button'); // close the sheet that opened
    await page.waitForTimeout(250);
    expect(await elements(app)).toHaveLength(2);

    await press(app, await cellToClient(app, 8, 10));
    await page.waitForSelector('.ctx-menu');
    await shot(app, 'phone-long-press');
    const items = await page.locator('.ctx-menu button').evaluateAll((bs) => bs.map((b) => ({ id: (b as HTMLElement).dataset.action, off: (b as HTMLButtonElement).disabled, h: b.getBoundingClientRect().height })));
    expect(items.map((i) => i.id)).toEqual(['duplicate', 'delete', 'forward', 'backward', 'beneath']);
    expect(items.every((i) => i.h >= 44)).toBe(true);
    expect(items.find((i) => i.id === 'forward')!.off).toBe(true); // already on top
    expect(items.find((i) => i.id === 'beneath')!.off).toBe(false);

    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="beneath"]').tap();
    expect(await page.locator('.ctx-menu').count()).toBe(0);
    // the one underneath is selected: it is the first (x = 4)
    const sel = (await page.locator('#panel input[data-key="prop-x"]').inputValue());
    expect(sel).toBe('4');

    await press(app, await cellToClient(app, 5, 12));
    await page.waitForSelector('.ctx-menu');
    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="forward"]').tap();
    expect((await elements(app)).map((e) => e.x)).toEqual([6, 4]);

    await press(app, await cellToClient(app, 5, 12));
    await page.waitForSelector('.ctx-menu');
    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="duplicate"]').tap();
    expect(await elements(app)).toHaveLength(3);

    await press(app, await cellToClient(app, 10, 12));
    await page.waitForSelector('.ctx-menu');
    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="delete"]').tap();
    expect(await elements(app)).toHaveLength(2);
    noErrors(app);
  });

  it('half-cell toggle: drawing and nudging go by half cells', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    expect(await page.locator('#half-cells').getAttribute('aria-pressed')).toBe('false');
    await page.tap('#half-cells');
    expect(await page.locator('#half-cells').getAttribute('aria-pressed')).toBe('true');
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 2.5, 2.5), await cellToClient(app, 6.5, 6.5));
    expect(await elements(app)).toMatchObject([{ type: 'box', x: 2.5, y: 2.5, w: 4, h: 4 }]);
    await page.tap('[data-key="nudge-right"]');
    expect(await elements(app)).toMatchObject([{ x: 3 }]);
    await page.tap('#half-cells');
    await page.tap('[data-key="nudge-down"]');
    expect(await elements(app)).toMatchObject([{ x: 3, y: 3.5 }]);
    noErrors(app);
  });

  it('pinch zooms, two fingers pan, and Fit brings the page back', async () => {
    const app = await open(env, 'phone');
    const start = await viewBoxOf(app);
    const centre = await cellToClient(app, 13, 20);
    await pinch(app, centre, 80, 240);
    const zoomed = await viewBoxOf(app);
    expect(zoomed[2]).toBeLessThan(start[2] * 0.6);
    await twoFingerDrag(app, centre, 60, 80);
    const panned = await viewBoxOf(app);
    expect(panned[0]).toBeLessThan(zoomed[0]); // the page followed the fingers right
    expect(panned[2]).toBeCloseTo(zoomed[2], 3);
    expect(await elements(app)).toHaveLength(0); // no stray drawing
    await shot(app, 'phone-zoomed');
    await app.page.tap('#fit');
    const fitted = await viewBoxOf(app);
    expect(fitted[2]).toBeCloseTo(start[2], 1);
    noErrors(app);
  });

  it('resize handles can be grabbed with a finger', async () => {
    const app = await open(env, 'phone');
    await app.page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 10, 12));
    // a few px off the bottom-right handle, as a fingertip would land
    const h = await cellToClient(app, 10, 12);
    await drag(app, { x: h.x + 9, y: h.y + 8 }, await cellToClient(app, 14, 16));
    expect(await elements(app)).toMatchObject([{ x: 4, y: 6, w: 10, h: 10 }]);
    noErrors(app);
  });

  it('text is placed where the finger lifts, not where a pinch starts', async () => {
    const app = await open(env, 'phone');
    await app.page.tap('[data-tool="text"]');
    await pinch(app, await cellToClient(app, 13, 20), 80, 160);
    expect(await elements(app)).toHaveLength(0);
    await tap(app, await cellToClient(app, 6, 10));
    expect(await elements(app)).toMatchObject([{ type: 'text', x: 6, y: 10 }]);
    noErrors(app);
  });
});

describe('spreads on a phone', () => {
  it('edits one page at a time with Left and Right (or a swipe), and shows both with View spread', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#view-spread');
    expect(await page.locator('#canvas-left').isVisible()).toBe(true);
    expect(await page.locator('#canvas-right').isVisible()).toBe(false);
    const left = (await box(app, '#canvas-left'))!;
    expect(left.width).toBeGreaterThan(380); // full screen
    await shot(app, 'phone-spread-left');
    await page.tap('#side-right');
    expect(await page.locator('#canvas-right').isVisible()).toBe(true);
    expect(await page.locator('#canvas-left').isVisible()).toBe(false);

    // swipe across the empty page: back to the left page, then forward again
    const y = (await cellToClient(app, 13, 20, '#canvas-right')).y;
    await drag(app, { x: 80, y }, { x: 320, y });
    expect(await page.locator('#canvas-left').isVisible()).toBe(true);
    await drag(app, { x: 320, y }, { x: 80, y });
    expect(await page.locator('#canvas-right').isVisible()).toBe(true);

    await page.tap('#side-both');
    const l = (await box(app, '#canvas-left'))!, r = (await box(app, '#canvas-right'))!;
    expect(l.x + l.width).toBeLessThanOrEqual(r.x + 1);
    expect(l.width).toBeGreaterThan(150);
    await shot(app, 'phone-spread-both');
    await page.tap('#side-left');
    expect(await page.locator('#canvas-right').isVisible()).toBe(false);

    // drawing on a page of the spread
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 3, 4, '#canvas-left'), await cellToClient(app, 8, 9, '#canvas-left'));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.spread.left')!).elements.length)).toBe(1);
    noErrors(app);
  });
});

describe('book and export on a phone', () => {
  it('downloads the single zip by default', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#view-book');
    await page.waitForSelector('.stage-page');
    await shot(app, 'phone-book');
    expect(await smallControls(app)).toEqual([]);
    await page.getByRole('button', { name: /Export print files/ }).tap();
    await page.waitForSelector('.export-actions .primary', { timeout: 40_000 });
    const dialog = (await box(app, 'dialog.export'))!;
    expect([dialog.width, dialog.height]).toEqual([390, 844]);
    expect(await page.locator('.export-files').isVisible()).toBe(false); // the single files are tucked away
    await shot(app, 'phone-export');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.export-actions .primary').tap()]);
    expect(download.suggestedFilename()).toMatch(/-print\.zip$/);
    noErrors(app);
  });
});

describe('install on the home screen', () => {
  it('has a manifest and icons', async () => {
    const app = await open(env, 'phone');
    const info = await app.page.evaluate(async () => {
      const href = (document.querySelector('link[rel="manifest"]') as HTMLLinkElement).href;
      const manifest = await (await fetch(href)).json();
      const status: Record<string, number> = {};
      for (const icon of manifest.icons) status[icon.src] = (await fetch(new URL(icon.src, href))).status;
      const touchIcon = (document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement).href;
      return { manifest, status, touchIcon: (await fetch(touchIcon)).status };
    });
    expect(info.manifest).toMatchObject({ name: 'Dotwork', display: 'standalone', start_url: './' });
    expect(info.manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(info.manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    expect(Object.values(info.status).every((s) => s === 200)).toBe(true);
    expect(info.touchIcon).toBe(200);
  });
});

describe('tablet', () => {
  it('portrait uses the phone layout with the page filling the screen', async () => {
    const app = await open(env, 'tablet');
    const { page } = app;
    expect(await page.locator('#menu-button').isVisible()).toBe(true);
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 12, 12));
    expect(await elements(app)).toHaveLength(1);
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'tablet-portrait');
    noErrors(app);
  });

  it('landscape keeps the side panel and has big targets for touch', async () => {
    const app = await open(env, 'tabletLandscape');
    const { page } = app;
    expect(await page.locator('#menu-button').isVisible()).toBe(false);
    expect((await box(app, '#sheet'))!.width).toBeGreaterThan(300);
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 12, 12));
    expect(await elements(app)).toHaveLength(1);
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'tablet-landscape');
    noErrors(app);
  });
});
