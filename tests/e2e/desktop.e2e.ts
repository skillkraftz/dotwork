import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { box, cellToClient, choose, draft, drag, open, seedPage, shot, start, stop, tap, viewBoxOf, type Env, openDoc} from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: Awaited<ReturnType<typeof open>>) => (await draft(app)).elements;

describe('desktop (1280 x 800, mouse and keyboard)', () => {
  it('double-click focuses the element’s properties and shows no action bar', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.keyboard.press('p');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 9, 8));
    expect(await page.locator('#action-bar').isVisible()).toBe(false);
    const at = await cellToClient(app, 6, 6);
    await page.mouse.dblclick(at.x, at.y);
    expect(await page.evaluate(() => document.activeElement?.closest('section')?.getAttribute('data-tab'))).toBe('properties');
    expect(app.errors).toEqual([]);
  });

  it('keeps the side panel and the three menus, with undo, redo and help beside them', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    for (const id of ['#menu-page', '#menu-edit', '#export', '#help', '#undo', '#redo']) expect(await page.locator(id).isVisible(), id).toBe(true);
    for (const id of ['#view-page', '#library', '#mode-preview']) expect(await page.locator(id).isVisible(), `${id} waits in its menu`).toBe(false);
    expect((await box(app, '#sheet'))!.width).toBeCloseTo(320, 0);
    expect(await page.locator('.sheet-head').isVisible()).toBe(false);
    expect(await page.locator('#panel .tabs').isVisible()).toBe(false);
    for (const h of ['Layers', 'Properties']) expect(await page.locator('#panel h2', { hasText: h }).first().isVisible()).toBe(true);
    await shot(app, 'desktop-page');
    expect(app.errors).toEqual([]);
  });

  it('draws with the mouse, snaps to half cells with Shift, and uses the keyboard shortcuts', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.keyboard.press('b');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 9, 8));
    expect(await elements(app)).toMatchObject([{ type: 'box', x: 3, y: 4, w: 6, h: 4 }]);
    // the sheet logic must not take over the desktop panel
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('closed');
    expect(await page.locator('#sheet').isVisible()).toBe(true);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await elements(app)).toMatchObject([{ x: 4, y: 4.5 }]);
    await page.keyboard.press('Control+d');
    expect(await elements(app)).toHaveLength(2);
    await page.keyboard.press('Delete');
    expect(await elements(app)).toHaveLength(1);
    await page.keyboard.press('Control+z');
    expect(await elements(app)).toHaveLength(2);
    await page.keyboard.press('Control+Shift+z');
    expect(await elements(app)).toHaveLength(1);

    await page.keyboard.press('r');
    await page.keyboard.down('Shift');
    await drag(app, await cellToClient(app, 2.5, 12), await cellToClient(app, 8.5, 12));
    await page.keyboard.up('Shift');
    expect(await elements(app)).toMatchObject([{}, { type: 'rule', x1: 2.5, x2: 8.5 }]);
    expect(app.errors).toEqual([]);
  });

  it('Alt-click steps to the element underneath; right-click opens the same menu as a long press', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.keyboard.press('p');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 14, 14));
    await page.keyboard.press('p');
    await drag(app, await cellToClient(app, 6, 8), await cellToClient(app, 12, 16));
    const p = await cellToClient(app, 9, 11);
    await page.keyboard.down('Alt');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Alt');
    expect(await page.locator('#panel input[data-key="prop-x"]').inputValue()).toBe('4');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.waitForSelector('.ctx-menu');
    expect(await page.locator('.ctx-menu button').count()).toBe(5);
    await page.keyboard.press('Escape');
    expect(await page.locator('.ctx-menu').count()).toBe(0);
    expect(app.errors).toEqual([]);
  });

  it('zooms with ctrl+wheel and Fit restores the view', async () => {
    const app = await open(env, 'desktop');
    const before = await viewBoxOf(app);
    const c = await cellToClient(app, 13, 20);
    await app.page.mouse.move(c.x, c.y);
    await app.page.keyboard.down('Control');
    await app.page.mouse.wheel(0, -300);
    await app.page.keyboard.up('Control');
    expect((await viewBoxOf(app))[2]).toBeLessThan(before[2]);
    await app.page.click('#fit');
    expect((await viewBoxOf(app))[2]).toBeCloseTo(before[2], 1);
  });

  it('shows both pages of a spread side by side, and edits either', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'page', '#view-spread');
    expect(await page.locator('#spread-bar').isVisible()).toBe(false);
    const l = (await box(app, '#canvas-left'))!, r = (await box(app, '#canvas-right'))!;
    expect(l.width).toBeGreaterThan(300);
    expect(l.x + l.width).toBeLessThanOrEqual(r.x + 1);
    expect(await page.locator('#canvas').isVisible()).toBe(false);
    await page.keyboard.press('b');
    await drag(app, await cellToClient(app, 3, 4, '#canvas-right'), await cellToClient(app, 8, 9, '#canvas-right'));
    expect((await openDoc(app, 'spread')).right.elements).toHaveLength(1);
    await shot(app, 'desktop-spread');
    await tap(app, { x: 5, y: 5 });
    expect(app.errors).toEqual([]);
  });

  it('opens the library as a window, not a full-screen sheet', async () => {
    const app = await open(env, 'desktop');
    await choose(app, 'edit', '#library');
    await app.page.waitForSelector('dialog[aria-label="Library"][open]');
    const d = (await box(app, 'dialog[aria-label="Library"]'))!;
    expect(d.width).toBeLessThan(1280);
    expect(d.height).toBeLessThanOrEqual(800);
    await shot(app, 'desktop-library');
  });

  it('grabbing a selected box anywhere but a handle moves it; a corner handle resizes it', async () => {
    const app = await open(env, 'desktop');
    await seedPage(app, {
      format: 'dotwork-page', version: 2, name: 'Seed', grid: { cols: 27, rows: 44, pitch_mm: 3 },
      elements: [{ type: 'box', x: 4, y: 4, w: 10, h: 8, weight: 'thick' }],
    });
    const at = (x: number, y: number) => cellToClient(app, x, y);
    await tap(app, await at(6.5, 4)); // selects the box by its top side
    const s = await at(6.5, 4);
    await drag(app, s, { x: s.x, y: s.y + 3 * ((await at(0, 1)).y - (await at(0, 0)).y) }); // a quarter along the top side, three cells down
    expect((await elements(app))[0]).toMatchObject({ x: 4, y: 7, w: 10, h: 8 });
    const corner = await at(14, 15);
    const cell = (await at(1, 0)).x - (await at(0, 0)).x;
    await drag(app, corner, { x: corner.x + 2 * cell, y: corner.y + 2 * cell });
    expect((await elements(app))[0]).toMatchObject({ x: 4, y: 7, w: 12, h: 10 });
    expect(app.errors).toEqual([]);
  });
});
