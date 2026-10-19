import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HELP } from '../../src/help';
import { bar, box, cellToClient, draft, drag, open, press, shot, start, stop, tap, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

/** Tap or click the middle of a control by position, which works on a disabled one too. */
async function poke(app: App, selector: string, mouse = !app.touch) {
  const b = (await box(app, selector))!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (mouse) await app.page.mouse.click(at.x, at.y); else await tap(app, at);
}

const popup = (app: App) => app.page.locator('#help-pop');
const popupText = async (app: App) => (await popup(app).isVisible()) ? (await popup(app).innerText()) : '';

/** A page with one of every kind of element, so that every kind of properties panel can be shown. */
const EVERYTHING = {
  format: 'dotwork-page', version: 2, name: 'Everything', grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [
    { type: 'shade', x: 1, y: 2, w: 5, h: 3 },
    { type: 'pattern', pattern: 'dots', x: 8, y: 2, w: 6, h: 4, every: 1 },
    { type: 'box', x: 1, y: 7, w: 8, h: 4 },
    { type: 'rule', x1: 1, y1: 13, x2: 20, y2: 13 },
    { type: 'checkboxes', x: 1, y: 15, count: 4 },
    { type: 'text', x: 8, y: 16, text: 'Hello' },
  ],
};

/** Every visible control (button, menu item, input, select, summary, link) that has no entry in the help registry. */
async function missingHelp(app: App): Promise<string[]> {
  return app.page.evaluate((known) => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="tab"], input, select, textarea, summary, a[href]');
    for (const el of controls) {
      if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'file')) continue;
      const style = getComputedStyle(el);
      if (el.getClientRects().length === 0 || style.visibility === 'hidden') continue;
      const key = el.dataset.help;
      const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} “${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}”`;
      if (!key) out.push(`${name}: no data-help`);
      else if (!known.includes(key)) out.push(`${name}: no help entry for “${key}”`);
    }
    return out;
  }, Object.keys(HELP));
}

describe('the help registry', () => {
  it('says what each control is, and how to use it by touch and with a mouse', () => {
    for (const [key, entry] of Object.entries(HELP)) {
      for (const field of ['name', 'what', 'touch', 'desktop'] as const) {
        expect(entry[field].trim().length, `${key}.${field}`).toBeGreaterThan(field === 'name' ? 0 : 2);
      }
      expect(entry.what.length, `${key} is short`).toBeLessThan(260);
    }
  });
});

describe('help mode', () => {
  it('on a phone: shows a card, explains controls instead of using them, and ends when the card is closed', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#menu-button');
    await page.tap('#help');
    const card = page.locator('#help-card');
    expect(await card.isVisible()).toBe(true);
    expect(await card.innerText()).toContain('Help mode: tap anything to see what it does.');
    expect(await page.locator('#menu').isVisible()).toBe(false);
    await shot(app, 'phone-help-card');

    // a tool does not switch; its popover says what it does, with touch text
    await page.tap('[data-tool="box"]');
    expect(await page.locator('[data-tool="select"]').getAttribute('aria-pressed')).toBe('true');
    const box = await popupText(app);
    expect(box).toContain('BOX');
    expect(box).toContain('drag from one corner');
    expect(box).not.toMatch(/\bclick\b/i);
    await shot(app, 'phone-help-popover');

    // a disabled control can be asked about too
    await poke(app, '#undo');
    expect(await popupText(app)).toContain('UNDO');

    // the page explains its gestures for the current tool, and drawing does nothing
    await page.tap('[data-tool="shade"]');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 8, 9));
    expect((await draft(app)).elements).toEqual([]);
    await tap(app, await cellToClient(app, 12, 20));
    const pageHelp = await popupText(app);
    expect(pageHelp).toContain('THE PAGE: SHADE TOOL');
    expect(pageHelp).toContain('Pinch');
    await page.tap('[data-tool="select"]');
    await tap(app, await cellToClient(app, 10, 10));
    for (const g of ['Tap', 'Double-tap', 'Drag', 'Pinch', 'Long-press']) expect(await popupText(app), g).toContain(g);
    await shot(app, 'phone-help-page');

    // the menu opens, so that its items can be asked about; nothing in it acts
    await page.tap('#menu-button');
    expect(await page.locator('#menu').isVisible()).toBe(true);
    await page.tap('#library');
    expect(await popupText(app)).toContain('LIBRARY');
    expect(await page.locator('dialog[open]').count()).toBe(0);
    expect(await page.locator('#menu').isVisible()).toBe(true);
    await page.tap('#examples'); // a list does not open or take focus
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('examples');
    await page.tap('#new');
    await page.tap('#menu-button');

    // closing the card ends it
    await page.tap('#help-card button');
    expect(await card.isVisible()).toBe(false);
    expect(await popup(app).isVisible()).toBe(false);
    await page.tap('[data-tool="box"]');
    expect(await page.locator('[data-tool="box"]').getAttribute('aria-pressed')).toBe('true');
    expect(app.errors).toEqual([]);
  });

  it('on a desktop: says click, and gives mouse and keyboard text', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.click('#help');
    expect(await page.locator('#help-card').innerText()).toContain('Help mode: click anything to see what it does.');
    await poke(app, '#undo');
    const text = await popupText(app);
    expect(text).toContain('Ctrl/Cmd+Z');
    expect(text).not.toMatch(/\btap\b/i);
    await page.click('[data-tool="box"]');
    expect(await page.locator('[data-tool="select"]').getAttribute('aria-pressed')).toBe('true');
    await page.mouse.click(400, 400); // the page
    expect(await popupText(app)).toContain('Double-click');
    await shot(app, 'desktop-help-popover');
    // keys do nothing but Escape: first the popover, then help mode
    await page.keyboard.press('b');
    expect(await page.locator('[data-tool="select"]').getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('Escape');
    expect(await popup(app).isVisible()).toBe(false);
    expect(await page.locator('#help-card').isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.locator('#help-card').isVisible()).toBe(false);
    expect(app.errors).toEqual([]);
  });

  it('follows the pointer in use: a mouse on a touch screen gets mouse text, then a finger gets touch text', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#menu-button');
    await page.tap('#help');
    await poke(app, '[data-tool="select"]', true); // by mouse
    expect(await popupText(app)).toContain('Press V');
    expect(await page.locator('#help-card').innerText()).toContain('click');
    await page.tap('[data-tool="select"]');
    expect(await popupText(app)).toContain('Tap an element');
    expect(await page.locator('#help-card').innerText()).toContain('tap');
  });

  it('explains the properties window and its steppers without changing anything', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 9, 10));
    await bar(app, 'properties');
    await page.tap('#menu-button');
    await page.tap('#help'); // the window stays open under help mode
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    await page.tap('[data-key="step-inc-x"]');
    const text = await popupText(app);
    expect(text).toContain('INCREASE');
    expect(text).toContain('Tap for one step; hold to keep going');
    expect((await draft(app)).elements).toMatchObject([{ x: 4 }]);
    await page.tap('[data-key="prop-w"]');
    expect(await popupText(app)).toContain('W (WIDTH)');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
    await shot(app, 'phone-help-stepper');
  });
});

describe('every control has a help entry', () => {
  it('on a phone: the page view, menu, selection bar, properties window and its menus', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    expect(await missingHelp(app)).toEqual([]);
    await page.tap('#menu-button');
    expect(await missingHelp(app)).toEqual([]);
    await page.tap('#menu-button');

    // draw something: the bar beside it, then the properties window and every tab
    await page.tap('[data-tool="box"]');
    await drag(app, await cellToClient(app, 4, 6), await cellToClient(app, 10, 10));
    expect(await missingHelp(app)).toEqual([]);
    await bar(app, 'properties');
    for (const tab of ['properties', 'layers', 'page']) {
      await page.tap(`[data-tab-button="${tab}"]`);
      expect(await missingHelp(app), tab).toEqual([]);
    }
    await page.tap('#sheet .sheet-close');

    // the menu on an element (long-press), and a message with its Dismiss button
    await press(app, await cellToClient(app, 4, 8));
    await page.waitForSelector('.ctx-menu');
    expect(await missingHelp(app)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') }); // refused with a message
    await page.waitForSelector('#notice:not([hidden])');
    expect(await missingHelp(app)).toEqual([]);

    // the spread
    await page.tap('#view-spread');
    expect(await missingHelp(app)).toEqual([]);
    await page.tap('#side-both');
    expect(await missingHelp(app)).toEqual([]);
    expect(app.errors).toEqual([]);
  });

  it('on a desktop: every kind of element in the side panel, locked, and the layers', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate((p) => localStorage.setItem('dotwork.page', JSON.stringify(p)), EVERYTHING);
    await page.reload();
    await page.waitForSelector('#canvas');
    expect(await missingHelp(app)).toEqual([]);
    const rows = await page.locator('#panel .layer-name').count();
    expect(rows).toBe(EVERYTHING.elements.length);
    for (let i = 0; i < rows; i++) {
      await page.locator('#panel .layer-name').nth(i).click();
      const missing = await missingHelp(app);
      expect(missing, `element ${i}`).toEqual([]);
    }
    await page.locator('#panel [data-help="layer-lock"]').first().click(); // a locked element's panel
    expect(await missingHelp(app)).toEqual([]);
    await page.click('#mode-preview');
    expect(await missingHelp(app)).toEqual([]);
    expect(app.errors).toEqual([]);
  });

  it('in the library: saving, saved items, renaming', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.click('#library');
    await page.waitForSelector('dialog[aria-label="Library"][open]');
    expect(await missingHelp(app)).toEqual([]);
    await page.locator('dialog[aria-label="Library"] input[aria-label="Name"]').fill('Test page');
    await page.click('dialog[aria-label="Library"] .primary');
    await page.waitForSelector('.lib-card');
    expect(await missingHelp(app)).toEqual([]);
    await page.click('.lib-card button[data-help="library-rename"]');
    await page.waitForSelector('.lib-card input');
    expect(await missingHelp(app)).toEqual([]);
    await page.keyboard.press('Enter');
    await page.click('dialog[aria-label="Library"] header button');
    // as a spread, where saved pages can go to either side
    await page.click('#view-spread');
    await page.click('#library');
    await page.waitForSelector('dialog[aria-label="Library"][open]');
    expect(await missingHelp(app)).toEqual([]);
    expect(app.errors).toEqual([]);
  });

  it('in the book: the arranger, contents, design list, apply window and print files', async () => {
    for (const device of ['phone', 'desktop'] as const) {
      const app = await open(env, device);
      const { page } = app;
      const go = (sel: string) => (app.touch ? page.tap(sel) : page.click(sel));
      await go('#view-book');
      await page.waitForSelector('.book-bar');
      expect(await missingHelp(app), `${device} book`).toEqual([]);
      await page.evaluate(() => { document.querySelector<HTMLDetailsElement>('.print-settings')!.open = true; });
      expect(await missingHelp(app), `${device} settings`).toEqual([]);
      await page.evaluate(() => { document.querySelector<HTMLDetailsElement>('.print-settings')!.open = false; });
      await go('.view-toggle'); // spreads
      expect(await missingHelp(app), `${device} spreads`).toEqual([]);
      if (app.touch) await go('.contents-toggle');
      if (app.touch) expect(await missingHelp(app), `${device} contents`).toEqual([]);
      if (app.touch) await go('.contents-close');
      await go('button[data-help="book-choose"]');
      await page.waitForSelector('dialog.picker[open]');
      expect(await missingHelp(app), `${device} picker`).toEqual([]);
      await go('dialog.picker .design:nth-of-type(1)');
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await go('button[data-help="book-apply"]');
      await page.waitForSelector('dialog.apply[open]');
      expect(await missingHelp(app), `${device} apply`).toEqual([]);
      await go('dialog.apply button[data-help="apply-cancel"]');
      await go('button[data-help="book-export"]');
      await page.waitForSelector('dialog.export[open] .export-files, dialog.export[open] .export-individual', { timeout: 40_000 });
      if (app.touch) await page.evaluate(() => { document.querySelector<HTMLDetailsElement>('.export-individual')!.open = true; });
      expect(await missingHelp(app), `${device} export`).toEqual([]);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    }
  });
});
