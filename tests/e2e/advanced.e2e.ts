import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ICONS, ICON_NAMES } from '../../src/icons/icons';
import { bar, box, cellToClient, draft, drag, missingHelp, open, shot, start, stop, tap, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: App) => (await draft(app)).elements;
/** Tap on a touch screen, click with a mouse. */
const go = (app: App, selector: string) => (app.touch ? app.page.tap(selector) : app.page.click(selector));
/** The middle of a cell. */
const centre = (app: App, x: number, y: number) => cellToClient(app, x + 0.5, y + 0.5);

/** Controls inside a window that are smaller than a fingertip. */
async function smallInside(app: App, selector: string) {
  return app.page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} input, ${sel} select`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 12)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, selector);
}

/** A page with a box, a label and a checkbox strip to select, move and save. */
const SEED = {
  format: 'dotwork-page', version: 2, name: 'Seed', grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [
    { type: 'box', x: 3, y: 6, w: 8, h: 4 },
    { type: 'text', x: 4, y: 7, text: 'Notes', tone: 'black' },
    { type: 'checkboxes', x: 13, y: 6, count: 4 },
  ],
};
async function seed(app: App) {
  await app.page.evaluate((p) => localStorage.setItem('dotwork.page', JSON.stringify(p)), SEED);
  await app.page.reload();
  await app.page.waitForSelector('#canvas');
  await app.page.evaluate(() => document.fonts.ready);
}

describe('Advanced on a phone (390 x 844, touch)', () => {
  it('opens a picker with Sequence, Icon and the saved widgets', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#advanced');
    await page.waitForSelector('dialog.advanced[open]');
    expect(await page.locator('dialog.advanced .tile').allInnerTexts()).toEqual([expect.stringContaining('Sequence'), expect.stringContaining('Icon')]);
    expect(await page.locator('dialog.advanced').innerText()).toContain('Nothing saved yet');
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    expect(await missingHelp(app)).toEqual([]);
    await shot(app, 'phone-advanced-picker');
    expect(app.errors).toEqual([]);
  });

  it('shows the icons as a big tappable grid, and an icon tap places one icon, sized and colored as chosen', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#advanced');
    await page.tap('[data-key="advanced-icon"]');
    await page.waitForSelector('.icon-grid');
    expect(await page.locator('.icon-cell').count()).toBe(ICON_NAMES.length);
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    expect(await missingHelp(app)).toEqual([]);
    const cell = (await box(app, '.icon-cell[data-icon="task"]'))!;
    expect(Math.min(cell.width, cell.height)).toBeGreaterThanOrEqual(60); // large
    await shot(app, 'phone-icon-grid');

    await page.tap('[data-key="icon-size-2"]');
    await page.tap('[data-key="icon-tone-gray"]');
    await page.tap('.icon-cell[data-icon="sun"]');
    await page.waitForSelector('dialog.advanced', { state: 'hidden' });
    expect(await page.locator('#advanced').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('#notice').innerText()).toContain('place the icon');
    await tap(app, await centre(app, 6, 10));
    expect(await elements(app)).toEqual([{ type: 'sequence', x: 6, y: 10, count: 1, values: 'icons', icons: ['sun'], size: 2, every: 2, tone: 'gray' }]);
    expect(await page.locator(`#canvas path[d="${ICONS.sun.stroke}"]`).count()).toBe(1); // the sun's own line art is on the page
    expect(await page.locator('#advanced').getAttribute('aria-pressed')).toBe('false'); // back to Select
    await shot(app, 'phone-icon-placed');

    // a plain 1-cell icon, repeated by dragging along a row
    await page.tap('#advanced');
    await page.tap('[data-key="advanced-icon"]');
    await page.tap('[data-key="icon-size-1"]');
    await page.tap('[data-key="icon-tone-black"]');
    await page.tap('.icon-cell[data-icon="heart"]');
    await drag(app, await centre(app, 2, 20), await centre(app, 6, 20));
    expect((await elements(app))[1]).toEqual({ type: 'sequence', x: 2, y: 20, count: 5, direction: 'across', values: 'icons', icons: ['heart'] });
    expect(app.errors).toEqual([]);
  });

  it('draws a sequence along a run of cells, then edits its values in Properties', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#advanced');
    await page.tap('[data-key="advanced-sequence"]');
    await page.waitForSelector('dialog.advanced', { state: 'hidden' });
    await drag(app, await centre(app, 2, 8), await centre(app, 2, 17));
    expect(await elements(app)).toEqual([{ type: 'sequence', x: 2, y: 8, count: 10 }]); // numbers from 1
    // the two-digit number sits inside its cell
    const text = page.locator('#canvas g[text-anchor="middle"] text', { hasText: /^10$/ });
    const t = (await text.boundingBox())!;
    const cellLeft = (await cellToClient(app, 2, 17)).x, cellRight = (await cellToClient(app, 3, 17)).x;
    expect(t.x).toBeGreaterThanOrEqual(cellLeft - 0.5);
    expect(t.x + t.width).toBeLessThanOrEqual(cellRight + 0.5);
    await shot(app, 'phone-sequence');

    await bar(app, 'properties');
    await page.waitForSelector('#sheet[data-state="open"]');
    await page.locator('#panel select[data-key="prop-values"]').selectOption('list');
    expect(await elements(app)).toMatchObject([{ values: 'list', list: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] }]);
    await shot(app, 'phone-sequence-properties');
    const field = page.locator('#panel [data-key="prop-list"]');
    await field.fill('A B C');
    expect(await elements(app)).toMatchObject([{ list: ['A', 'B', 'C'] }]);
    await field.fill('A BCD'); // an item of three characters is refused and not saved
    expect(await elements(app)).toMatchObject([{ list: ['A', 'B', 'C'] }]);
    await page.locator('#panel select[data-key="prop-values"]').selectOption('icons');
    expect(await elements(app)).toMatchObject([{ values: 'icons', icons: ['star'] }]);
    await page.tap('[data-key="prop-icon-add"]');
    await page.waitForSelector('dialog.advanced .icon-grid');
    expect(await missingHelp(app)).toEqual([]);
    await page.tap('.icon-cell[data-icon="water"]');
    expect(await elements(app)).toMatchObject([{ icons: ['star', 'water'] }]);
    expect(await smallInside(app, '#panel')).toEqual([]);
    expect(app.errors).toEqual([]);
  });

  it('selects more elements by tapping, moves them together, and saves them as a widget to place on another page', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app);
    const before = await elements(app);

    await tap(app, await cellToClient(app, 3, 8)); // the box, on its left side
    await bar(app, 'selectMore');
    expect(await page.locator('#action-bar [data-action="selectMore"]').getAttribute('aria-pressed')).toBe('true');
    await tap(app, await centre(app, 13, 7)); // the checkboxes
    expect(await page.locator('#panel .layer.selected').count()).toBe(2);
    await tap(app, await cellToClient(app, 20, 30)); // empty space does not clear it while Select more is on
    expect(await page.locator('#panel .layer.selected').count()).toBe(2);
    expect(await page.locator('#action-bar').isVisible()).toBe(true);
    await shot(app, 'phone-select-more');

    // dragging one of them moves both
    await drag(app, await cellToClient(app, 3, 8), await cellToClient(app, 5, 11));
    expect(await elements(app)).toMatchObject([{ x: 5, y: 9 }, { x: 4, y: 7 }, { x: 15, y: 9 }]);
    await page.tap('#undo');
    expect(await elements(app)).toEqual(before); // one undo step for the whole move

    // add the label too, then save all three
    await tap(app, await centre(app, 4, 7));
    expect(await page.locator('#panel .layer.selected').count()).toBe(3);
    await bar(app, 'widget');
    await page.waitForSelector('dialog.ask[open]');
    expect(await missingHelp(app)).toEqual([]);
    await page.locator('dialog.ask input').fill('Notes box');
    await shot(app, 'phone-save-widget');
    await page.tap('dialog.ask .primary');
    await page.waitForSelector('dialog.ask', { state: 'hidden' });
    expect(await page.locator('#notice').innerText()).toContain('Notes box');

    // another page: a new, blank one
    await page.tap('#menu-button');
    await page.tap('#new');
    expect(await elements(app)).toEqual([]);
    await page.tap('#advanced');
    await page.waitForSelector('.widget-row');
    expect(await page.locator('.widget-row').innerText()).toContain('Notes box');
    expect(await missingHelp(app)).toEqual([]);
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    await shot(app, 'phone-advanced-widgets');
    await page.tap('[data-key="widget-use"]');
    await page.waitForSelector('dialog.advanced', { state: 'hidden' });
    await tap(app, await cellToClient(app, 6, 20));
    const placed = await elements(app);
    expect(placed).toEqual(before.map((e) => ({ ...e, x: (e as { x: number }).x + 3, y: (e as { y: number }).y + 14 }))); // the same, with the corner at (6, 20)
    expect(await page.locator('#panel .layer.selected').count()).toBe(3); // the copies are selected, ready to nudge
    await shot(app, 'phone-widget-placed');

    // ordinary elements: editing one changes only this page
    await tap(app, await cellToClient(app, 15, 20)); // empty space: clear
    await tap(app, await centre(app, 7, 21));
    await bar(app, 'remove');
    expect((await elements(app)).length).toBe(2);
    await page.tap('#advanced');
    expect(await page.locator('.widget-use small').innerText()).toBe('3 elements'); // the widget is untouched
    expect(app.errors).toEqual([]);
  });

  it('renames and deletes widgets in the picker, and keeps them after a reload', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app);
    await tap(app, await cellToClient(app, 3, 8));
    await bar(app, 'widget');
    await page.locator('dialog.ask input').fill('Box');
    await page.tap('dialog.ask .primary');
    await page.reload();
    await page.waitForSelector('#canvas');
    await page.tap('#advanced');
    expect(await page.locator('.widget-use strong').allInnerTexts()).toEqual(['Box']);
    await page.tap('[data-key="widget-rename"]');
    await page.locator('dialog.ask input').fill('Frame');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog.ask', { state: 'hidden' });
    expect(await page.locator('.widget-use strong').allInnerTexts()).toEqual(['Frame']);
    page.once('dialog', (d) => void d.accept());
    await page.tap('[data-key="widget-delete"]');
    await page.waitForSelector('.widget-row', { state: 'detached' });
    expect(await page.locator('dialog.advanced').innerText()).toContain('Nothing saved yet');
    expect(app.errors).toEqual([]);
  });
});

describe('Advanced on a tablet (820 x 1180, touch)', () => {
  it('shows the picker and the icon grid, and places an icon', async () => {
    const app = await open(env, 'tablet');
    const { page } = app;
    await page.tap('#advanced');
    await page.tap('[data-key="advanced-icon"]');
    await page.waitForSelector('.icon-grid');
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    await shot(app, 'tablet-icon-grid');
    await page.tap('.icon-cell[data-icon="coffee"]');
    await tap(app, await centre(app, 4, 4));
    expect(await elements(app)).toMatchObject([{ values: 'icons', icons: ['coffee'], x: 4, y: 4 }]);
    expect(app.errors).toEqual([]);
  });
});

describe('Advanced on a desktop (1280 x 800, mouse)', () => {
  it('opens with A, and picks several elements with Shift-click or by dragging a box', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await seed(app);
    await page.keyboard.press('a');
    await page.waitForSelector('dialog.advanced[open]');
    await shot(app, 'desktop-advanced-picker');
    await page.keyboard.press('Escape');

    await page.mouse.click((await cellToClient(app, 3, 8)).x, (await cellToClient(app, 3, 8)).y); // the box
    const text = await centre(app, 4, 7);
    await page.keyboard.down('Shift');
    await page.mouse.click(text.x, text.y); // the label
    await page.keyboard.up('Shift');
    expect(await page.locator('#panel .layer.selected').count()).toBe(2);
    expect(await page.locator('#panel h2', { hasText: '2 elements' }).count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(await elements(app)).toMatchObject([{ x: 4 }, { x: 5 }, { x: 13 }]);
    const moved = await centre(app, 6, 7); // the label has moved one cell right
    await page.keyboard.down('Shift');
    await page.mouse.click(moved.x, moved.y); // shift-click again takes it out
    await page.keyboard.up('Shift');
    expect(await page.locator('#panel .layer.selected').count()).toBe(1);

    // a box dragged on empty space selects what it holds whole
    await drag(app, await cellToClient(app, 1, 4), await cellToClient(app, 12, 12));
    expect(await page.locator('#panel .layer.selected').count()).toBe(2);
    await shot(app, 'desktop-box-select');
    await page.keyboard.press('Delete');
    expect(await elements(app)).toMatchObject([{ type: 'checkboxes' }]);
    // empty space still clears the selection
    expect(await missingHelp(app)).toEqual([]);
    expect(app.errors).toEqual([]);
  });
});

describe('shading lives in Pattern', () => {
  for (const device of ['phone', 'tablet', 'desktop'] as const) {
    it(`gives a pattern a background and stripes (${device})`, async () => {
      const app = await open(env, device);
      const { page } = app;
      expect(await page.locator('[data-tool="shade"]').count()).toBe(0);
      await go(app, '[data-tool="pattern"]');
      await drag(app, await cellToClient(app, 3, 6), await cellToClient(app, 22, 16));
      expect(await elements(app)).toMatchObject([{ type: 'pattern', pattern: 'lines', x: 3, y: 6, w: 19, h: 10 }]);
      if (device !== 'desktop') { await page.waitForTimeout(600); await bar(app, 'properties'); await page.waitForSelector('#sheet[data-state="open"]'); }
      await page.locator('#panel select[data-key="prop-background"]').selectOption('light');
      await page.locator('#panel select[data-key="prop-stripes"]').selectOption('rows');
      expect(await elements(app)).toMatchObject([{ pattern: 'lines', background: 'light', stripes: 'rows' }]);
      await page.locator('#panel select[data-key="prop-pattern"]').selectOption('none'); // plain shading
      expect(await elements(app)).toMatchObject([{ pattern: 'none', background: 'light', stripes: 'rows' }]);
      await page.locator('#panel select[data-key="prop-pattern"]').selectOption('lines');
      await shot(app, `${device}-pattern-background`);
      if (device !== 'desktop') await page.tap('#sheet .sheet-close');
      // the shading is under the lines in the picture
      const order = await page.locator('#canvas #content').evaluate((g) => {
        const rect = g.querySelector('rect[fill="#efefef"]'), line = g.querySelector('path[stroke="#c4c4c4"]');
        return !!rect && !!line && !!(rect.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  }
});
