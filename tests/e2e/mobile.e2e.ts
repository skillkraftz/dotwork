import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bar, box, cellToClient, choose, doubleTap, draft, drag, open, pinch, press, shot, stagger, start, stop, tap, twoFingerDrag, viewBoxOf, type App, type Env, tool,
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
    const ids = ['#menu-page', '#menu-edit', '#export', '#undo', '#redo', '#help'];
    const tops = await Promise.all(ids.map(async (id) => (await box(app, id))!.y));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
    expect((await box(app, '.topbar'))!.height).toBeLessThan(64);
    const tools = (await box(app, '#tools'))!;
    expect(tools.y + tools.height).toBeCloseTo(844, 0);
    const labels = await page.locator('#tools button .label').allInnerTexts();
    expect(labels.map((l) => l.trim())).toEqual(['Select', 'Draw', 'Advanced', 'Select all', 'Half']);
    const wrap = (await box(app, '#canvas-wrap'))!;
    expect(wrap.height / 844).toBeGreaterThan(0.8);
    const pageRect = (await page.locator('#content > rect').first().boundingBox())!;
    expect(pageRect.width / 390).toBeGreaterThan(0.9);
    expect(await page.locator('#status').count()).toBe(0); // help is not a permanent footer any more
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-page');
    noErrors(app);
  });

  it('keeps the rest in two menus, with big targets', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    expect(await page.locator('#library').isVisible()).toBe(false);
    await page.tap('#menu-edit');
    for (const id of ['#mode-edit', '#mode-preview', '#library', '#new']) expect(await page.locator(id).isVisible(), id).toBe(true);
    expect(await smallControls(app)).toEqual([]);
    await page.tap('#help');
    expect(await page.locator('#help-card').isVisible()).toBe(true); // help mode, not a window
    expect(await page.locator('#list-edit').isVisible()).toBe(false); // choosing something closes the menu
    await shot(app, 'phone-help');
    noErrors(app);
  });

  it('draws a box with a finger', async () => {
    const app = await open(env, 'phone');
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 10, 9));
    const els = await elements(app);
    expect(els).toMatchObject([{ type: 'box', x: 3, y: 4, w: 7, h: 5 }]);
    // drawing selects it and the bar goes back to Select with the selection's buttons; nothing opens by itself
    expect(await app.page.locator('#sheet').getAttribute('data-state')).toBe('closed');
    expect(await app.page.locator('#bar-select').getAttribute('aria-pressed')).toBe('true');
    expect(await app.page.locator('#bar-context [data-action="properties"]').isVisible()).toBe(true);
    expect(await app.page.locator('#action-bar').count()).toBe(0); // nothing floats over the page
    noErrors(app);
  });

  it('draws a pattern, changes its line weight, moves it by nudging and dragging, undoes, and saves it to the library', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 5, 8), await cellToClient(app, 12, 14));
    expect(await elements(app)).toMatchObject([{ type: 'pattern', x: 5, y: 8, w: 7, h: 6 }]);
    await shot(app, 'phone-selected');

    // change the fill, in the properties window
    await bar(app, 'properties');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    await shot(app, 'phone-properties');
    await page.locator('#panel select[data-key="prop-weight"]').selectOption('thick');
    expect(await elements(app)).toMatchObject([{ type: 'pattern', weight: 'thick' }]);

    // move it with the nudge buttons
    await page.tap('[data-key="nudge-right"]');
    await page.tap('[data-key="nudge-down"]');
    expect(await elements(app)).toMatchObject([{ x: 6, y: 9 }]);

    // and with a finger (the selected element moves)
    await page.tap('#sheet .sheet-close');
    const from = await cellToClient(app, 8, 11), to = await cellToClient(app, 10, 12);
    await drag(app, from, to);
    expect(await elements(app)).toMatchObject([{ x: 8, y: 10 }]);

    // undo the drag, then the two quick nudges (one undo step), keeping the background
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: 6, y: 9 }]);
    await page.tap('#undo');
    expect(await elements(app)).toMatchObject([{ x: 5, y: 8, weight: 'thick' }]);

    // save it
    await choose(app, 'edit', '#library');
    await page.waitForSelector('dialog[aria-label="Library"][open]');
    const dialog = (await box(app, 'dialog[aria-label="Library"]'))!;
    expect([dialog.width, dialog.height]).toEqual([390, 844]); // a full-screen sheet
    await page.tap('dialog[aria-label="Library"] .lib-save .primary');
    await page.waitForSelector('.lib-msg:not([hidden])');
    await page.waitForSelector('.lib-card[data-name="Untitled"]');
    expect(await page.locator('.lib-card .lib-name', { hasText: /^Untitled$/ }).count()).toBe(1);
    expect((await box(app, '.lib-card[data-name="Untitled"] .thumb svg'))!.height).toBeGreaterThan(90); // a thumbnail you can read
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-library');
    noErrors(app);
  });

  it('has three modes and five buttons that follow the mode and the selection, all finger-sized', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    const labels = async () => (await page.locator('#bar-context button .label').allInnerTexts()).map((l) => l.trim());
    const modes = async () => (await page.locator('#bar-modes button .label').allInnerTexts()).map((l) => l.trim());
    expect(await modes()).toEqual(['Select', 'Draw', 'Advanced']);
    expect(await labels()).toEqual(['Select all', 'Half']); // Select, nothing selected
    await page.tap('#bar-draw');
    expect(await labels()).toEqual(['Pattern', 'Shade', 'Box', 'Rule', 'Text']);
    await page.tap('#advanced');
    expect(await labels()).toEqual(['Sequence', 'Icon', 'Checks', 'Widgets']);
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 4, 34), await cellToClient(app, 14, 40)); // low on the page
    expect(await labels()).toEqual(['Props', 'Copy', 'Delete', 'Group', 'More']); // Select, something selected
    const names = await page.locator('#bar-context button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    expect(names).toEqual(['Properties', 'Duplicate', 'Delete', 'Group', 'More']);
    expect(await page.locator('#bar-context [data-action="group"]').isDisabled()).toBe(true); // one element has nothing to group
    // five buttons, the same width, all inside the screen: the bar never grows or shifts as the buttons change
    const boxes = await page.locator('#bar-context button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().toJSON()));
    expect(boxes.every((r) => r.width >= 44 && r.x + r.width <= 390)).toBe(true);
    expect(await smallControls(app)).toEqual([]);
    noErrors(app);
  });

  it('opens from the Layers button, reorders layers with the arrows, and closes with its Close button', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 8, 8));
    await tool(app, 'rule');
    await drag(app, await cellToClient(app, 3, 12), await cellToClient(app, 12, 12));
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('closed'); // nothing slid up unasked
    await page.tap('#layers-button');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    expect(await page.locator('#panel .layer').count()).toBe(2);
    await shot(app, 'phone-layers');
    // the rule is on top; send it down with its arrow
    await page.locator('#panel .layer').first().locator('button[aria-label^="Move down"]').tap();
    expect((await elements(app)).map((e) => e.type)).toEqual(['rule', 'box']);
    expect(await smallControls(app)).toEqual([]);
    expect((await page.locator('#sheet .sheet-close').innerText()).trim()).toBe('Close');
    await page.tap('#sheet .sheet-close');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('closed');
    noErrors(app);
  });
});

describe('touch replacements', () => {
  it('long-press opens a menu: duplicate, forward, backward, underneath, delete', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    // two shades stacked
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 14, 14));
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 6, 8), await cellToClient(app, 12, 16));
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
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 2.5, 2.5), await cellToClient(app, 6.5, 6.5));
    expect(await elements(app)).toMatchObject([{ type: 'box', x: 2.5, y: 2.5, w: 4, h: 4 }]);
    await bar(app, 'properties');
    await page.tap('[data-key="nudge-right"]');
    expect(await elements(app)).toMatchObject([{ x: 3 }]);
    await page.tap('[data-key="nudge-half"]');
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
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 10, 12));
    // a few px off the bottom-right handle, as a fingertip would land
    const h = await cellToClient(app, 10, 12);
    await drag(app, { x: h.x + 9, y: h.y + 8 }, await cellToClient(app, 14, 16));
    expect(await elements(app)).toMatchObject([{ x: 4, y: 6, w: 10, h: 10 }]);
    noErrors(app);
  });

  it('text is placed where the finger lifts, not where a pinch starts', async () => {
    const app = await open(env, 'phone');
    await tool(app, 'text');
    await pinch(app, await cellToClient(app, 13, 20), 80, 160);
    expect(await elements(app)).toHaveLength(0);
    await tap(app, await cellToClient(app, 6, 10));
    expect(await elements(app)).toMatchObject([{ type: 'text', x: 6, y: 10 }]);
    noErrors(app);
  });
});

describe('touch gestures', () => {
  /** Two shades side by side; leaves nothing selected. Returns where each is. */
  async function twoShades(app: App) {
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 4, 14), await cellToClient(app, 12, 24));
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 15, 14), await cellToClient(app, 23, 24));
    await tap(app, await cellToClient(app, 2, 40)); // empty space clears the selection
    return { a: await cellToClient(app, 8, 19), b: await cellToClient(app, 19, 19) };
  }
  const state = async (app: App) => ({
    elements: await elements(app),
    sheet: await app.page.locator('#sheet').getAttribute('data-state'),
    selected: await app.page.locator('#panel .layer.selected').allInnerTexts(),
    bar: await app.page.locator('#bar-context [data-action="properties"]').isVisible(),
  });

  it('a pinch that starts on an element changes nothing but the view', async () => {
    const app = await open(env, 'phone');
    const { a, b } = await twoShades(app);
    const before = await state(app);
    expect(before.selected).toEqual([]);
    const view = await viewBoxOf(app);
    // first finger on the unselected shade, second finger lands a moment later
    await stagger(app, a, { x: a.x + 60, y: a.y }, 120);
    expect(await state(app)).toEqual(before);
    expect((await viewBoxOf(app))[2]).toBeLessThan(view[2]);

    // and the same with another element selected
    await app.page.tap('#fit');
    await tap(app, b);
    const selected = await state(app);
    expect(selected.selected).toHaveLength(1);
    expect(selected.bar).toBe(true);
    await stagger(app, a, { x: a.x + 60, y: a.y }, 120);
    expect(await state(app)).toEqual(selected);
    // no undo entry was added: one undo removes the second shade, nothing else
    await app.page.tap('#undo');
    expect(await elements(app)).toHaveLength(1);
    noErrors(app);
  });

  it('tap selects on release; tapping empty space clears', async () => {
    const app = await open(env, 'phone');
    const { a } = await twoShades(app);
    await tap(app, a);
    expect(await app.page.locator('#panel .layer.selected').count()).toBe(1);
    expect(await app.page.locator('#bar-context [data-action="properties"]').isVisible()).toBe(true);
    expect(await app.page.locator('#sheet').getAttribute('data-state')).toBe('closed');
    await tap(app, await cellToClient(app, 2, 40));
    expect(await app.page.locator('#panel .layer.selected').count()).toBe(0);
    expect(await app.page.locator('#bar-context [data-action="properties"]').count()).toBe(0);
    expect(await app.page.locator('#bar-context [data-action="selectAll"]').isVisible()).toBe(true);
    noErrors(app);
  });

  it('dragging an unselected element draws a selection box; dragging the selected one moves it; two fingers pan', async () => {
    const app = await open(env, 'phone');
    const { a } = await twoShades(app);
    await pinch(app, await cellToClient(app, 13, 19), 80, 160);
    const zoomed = await viewBoxOf(app);
    const before = await elements(app);
    // one finger on an unselected shade and a drag: a box that selects what it touches, and nothing moves or pans
    await drag(app, a, { x: a.x - 40, y: a.y + 30 });
    expect(await elements(app)).toEqual(before);
    expect(await viewBoxOf(app)).toEqual(zoomed);
    expect(await app.page.locator('#panel .layer.selected').count()).toBe(1);

    // two fingers pan
    await twoFingerDrag(app, a, -50, 30);
    const panned = await viewBoxOf(app);
    expect(panned[0]).toBeGreaterThan(zoomed[0]);
    expect(panned[2]).toBeCloseTo(zoomed[2], 3);
    expect(await elements(app)).toEqual(before);

    const at = await cellToClient(app, 8, 19);
    await tap(app, at);
    expect(await app.page.locator('#panel .layer.selected').count()).toBe(1);
    await drag(app, at, { x: at.x + 40, y: at.y });
    const moved = await elements(app);
    expect(moved[0].x as number).toBeGreaterThan(before[0].x as number);
    expect(await viewBoxOf(app)).toEqual(panned); // and the view stayed put
    noErrors(app);
  });

  it('double-tap opens properties; the bar buttons work', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    const { a } = await twoShades(app);
    await tap(app, a);
    await bar(app, 'duplicate');
    expect(await elements(app)).toHaveLength(3);
    await bar(app, 'remove');
    expect(await elements(app)).toHaveLength(2);
    expect(await page.locator('#bar-context [data-action="selectAll"]').isVisible()).toBe(true);

    await tap(app, a);
    await bar(app, 'more');
    await page.waitForSelector('.ctx-menu');
    expect((await page.locator('.ctx-menu button').allInnerTexts()).map((t) => t.trim())).toEqual(['Bring forward', 'Send backward', 'Select underneath', 'Save as widget', 'Half cells: off']);
    await page.keyboard.press('Escape');
    expect(await page.locator('.ctx-menu').count()).toBe(0);

    await bar(app, 'properties');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    expect(await page.locator('#panel[data-tab="properties"]').count()).toBe(1);
    await page.tap('#sheet .sheet-close');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('closed');

    await tap(app, await cellToClient(app, 2, 40));
    await doubleTap(app, a);
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    expect(await page.locator('#panel .layer.selected').count()).toBe(1);
    expect(await page.locator('#panel[data-tab="properties"]').count()).toBe(1);
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'phone-properties-modal');
    noErrors(app);
  });

  it('a second finger cancels a drawing', async () => {
    const app = await open(env, 'phone');
    await tool(app, 'box');
    const from = await cellToClient(app, 4, 6);
    await stagger(app, from, { x: from.x + 80, y: from.y }, 100);
    expect(await elements(app)).toHaveLength(0);
    noErrors(app);
  });
});

describe('spreads on a phone', () => {
  it('edits one page at a time with Left and Right (a swipe does not switch), and shows both with View spread', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await choose(app, 'page', '#view-spread');
    expect(await page.locator('#canvas-left').isVisible()).toBe(true);
    expect(await page.locator('#canvas-right').isVisible()).toBe(false);
    const left = (await box(app, '#canvas-left'))!;
    expect(left.width).toBeGreaterThan(380); // full screen
    await shot(app, 'phone-spread-left');
    await page.tap('#side-right');
    expect(await page.locator('#canvas-right').isVisible()).toBe(true);
    expect(await page.locator('#canvas-left').isVisible()).toBe(false);

    // swiping across the empty page no longer changes page (it pans, which is what a finger there means)
    const y = (await cellToClient(app, 13, 20, '#canvas-right')).y;
    await drag(app, { x: 80, y }, { x: 320, y });
    expect(await page.locator('#canvas-right').isVisible()).toBe(true);
    expect(await page.locator('#canvas-left').isVisible()).toBe(false);

    await page.waitForTimeout(1200); // Chromium ignores a tap soon after a fast synthetic swipe
    await page.tap('#side-both');
    const l = (await box(app, '#canvas-left'))!, r = (await box(app, '#canvas-right'))!;
    expect(l.x + l.width).toBeLessThanOrEqual(r.x + 1);
    expect(l.width).toBeGreaterThan(150);
    await shot(app, 'phone-spread-both');
    await page.tap('#side-left');
    expect(await page.locator('#canvas-right').isVisible()).toBe(false);

    // drawing on a page of the spread
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4, '#canvas-left'), await cellToClient(app, 8, 9, '#canvas-left'));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.spread.left')!).elements.length)).toBe(1);
    noErrors(app);
  });
});

describe('book and export on a phone', () => {
  it('downloads the single zip by default', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await choose(app, 'page', '#view-book');
    await page.waitForSelector('.stage-page');
    await shot(app, 'phone-book');
    expect(await smallControls(app)).toEqual([]);
    await page.getByRole('button', { name: /Print files/ }).tap();
    await page.waitForSelector('.export-actions .primary', { timeout: 40_000 });
    const dialog = (await box(app, 'dialog.export'))!;
    expect([dialog.width, dialog.height]).toEqual([390, 844]);
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
    expect(await page.locator('#menu-page').isVisible()).toBe(true);
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 12, 12));
    expect(await elements(app)).toHaveLength(1);
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'tablet-portrait');
    noErrors(app);
  });

  it('landscape keeps the side panel and has big targets for touch', async () => {
    const app = await open(env, 'tabletLandscape');
    expect((await box(app, '#sheet'))!.width).toBeGreaterThan(300);
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 12, 12));
    expect(await elements(app)).toHaveLength(1);
    expect(await smallControls(app)).toEqual([]);
    await shot(app, 'tablet-landscape');
    noErrors(app);
  });
});
