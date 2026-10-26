import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ICONS, ICON_NAMES } from '../../src/icons/icons';
import { bar, box, cellToClient, draft, drag, missingHelp, open, shot, start, stop, tap, type App, type Env, tool, newDoc, seedPage, reload,
} from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: App) => (await draft(app)).elements;
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
  await seedPage(app, SEED);
}

describe('Advanced on a phone (390 x 844, touch)', () => {
  it('shows Sequence, Icon, Checks and Widgets in Advanced mode; Widgets lists the saved widgets', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await page.tap('#advanced');
    expect((await page.locator('#bar-context button .label').allInnerTexts()).map((t) => t.trim())).toEqual(['Sequence', 'Icon', 'Checks', 'Widgets', 'Art']);
    await shot(app, 'phone-advanced-mode');
    await page.tap('#bar-context [data-action="widget"]');
    await page.waitForSelector('dialog.advanced[open]');
    expect((await page.locator('dialog.advanced h2').innerText()).toLowerCase()).toBe('widgets');
    expect(await page.locator('dialog.advanced').innerText()).toContain('Nothing saved yet');
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    expect(await missingHelp(app)).toEqual([]);
    await shot(app, 'phone-widgets-empty');
    expect(app.errors).toEqual([]);
  });

  it('shows the icons as a big tappable grid, and an icon tap places one icon, sized and colored as chosen', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await tool(app, 'icon');
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
    expect(await page.locator('#bar-context [data-tool="icon"]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('#notice').innerText()).toContain('place the icon');
    await tap(app, await centre(app, 6, 10));
    expect(await elements(app)).toEqual([{ type: 'sequence', x: 6, y: 10, count: 1, values: 'icons', icons: ['sun'], size: 2, every: 2, tone: 'gray' }]);
    expect(await page.locator(`#canvas path[d="${ICONS.sun.stroke}"]`).count()).toBe(1); // the sun's own line art is on the page
    expect(await page.locator('#advanced').getAttribute('aria-pressed')).toBe('false'); // back to Select
    await shot(app, 'phone-icon-placed');

    // a plain 1-cell icon, repeated by dragging along a row
    await tool(app, 'icon');
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
    await tool(app, 'sequence');
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
    // Rotate items: each number turns about its own cell, and the run stays where it is
    await page.locator('#panel select[data-key="prop-rotate"]').selectOption('90');
    expect(await elements(app)).toMatchObject([{ x: 2, y: 8, count: 10, rotate: 90 }]);
    expect(await page.locator('#canvas g[text-anchor="middle"] text[transform^="rotate(-90"]').count()).toBe(10);
    await page.locator('#panel select[data-key="prop-rotate"]').selectOption('0');
    expect(await page.locator('#canvas g[text-anchor="middle"] text[transform]').count()).toBe(0);
    await page.locator('#panel select[data-key="prop-values"]').selectOption('list');
    // the example is a gray placeholder, not a value to delete
    expect(await elements(app)).toMatchObject([{ values: 'list', list: [] }]);
    expect(await page.locator('#panel [data-key="prop-list"]').inputValue()).toBe('');
    expect(await page.locator('#panel [data-key="prop-list"]').getAttribute('placeholder')).toBe('S M T W T F S');
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

  it('drag-selects several elements, moves them together, and saves them as a widget that is placed as a group on another page', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app);
    const before = await elements(app);

    // a box dragged across empty space selects everything it touches
    await drag(app, await cellToClient(app, 1, 3), await cellToClient(app, 16, 11));
    expect(await page.locator('#panel .layer.selected').count()).toBe(3);
    await shot(app, 'phone-drag-select-all');

    // dragging one of them moves all three
    await drag(app, await cellToClient(app, 3, 8), await cellToClient(app, 5, 11));
    expect(await elements(app)).toMatchObject([{ x: 5, y: 9 }, { x: 6, y: 10 }, { x: 15, y: 9 }]);
    await page.tap('#undo');
    expect(await elements(app)).toEqual(before); // one undo step for the whole move

    // save all three from More
    await bar(app, 'more');
    await page.waitForSelector('.ctx-menu');
    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="widget"]').tap();
    await page.waitForSelector('dialog.ask[open]');
    expect(await missingHelp(app)).toEqual([]);
    await page.locator('dialog.ask input').fill('Notes box');
    await shot(app, 'phone-save-widget');
    await page.tap('dialog.ask .primary');
    await page.waitForSelector('dialog.ask', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('Notes box')); // saved to the Library, then said
    expect(await page.locator('#notice').innerText()).toContain('Notes box');

    // another page: a new, blank one
    await newDoc(app);
    expect(await elements(app)).toEqual([]);
    await tool(app, 'widget');
    await page.waitForSelector('.widget-row');
    expect(await page.locator('.widget-row').innerText()).toContain('Notes box');
    expect(await missingHelp(app)).toEqual([]);
    expect(await smallInside(app, 'dialog.advanced')).toEqual([]);
    await shot(app, 'phone-advanced-widgets');
    await page.tap('[data-key="widget-use"]');
    await page.waitForSelector('dialog.advanced', { state: 'hidden' });
    await tap(app, await cellToClient(app, 6, 20));
    const placed = await elements(app);
    // the same, with the corner at (6, 20), and tied together as one group
    expect(placed).toEqual(before.map((e) => ({ ...e, x: (e as { x: number }).x + 3, y: (e as { y: number }).y + 14, group: 'g1' })));
    expect(await page.locator('#panel .layer.selected').count()).toBe(3); // the group is selected, ready to move
    await shot(app, 'phone-widget-placed');

    // the widget is a group, not a link: editing the page leaves the saved widget alone
    await tap(app, await cellToClient(app, 15, 40)); // empty space: clear
    await tap(app, await centre(app, 7, 21)); // a tap on one piece takes the whole group
    expect(await page.locator('#panel .layer.selected').count()).toBe(3);
    await bar(app, 'remove');
    expect((await elements(app)).length).toBe(0);
    await tool(app, 'widget');
    expect(await page.locator('.widget-use small').innerText()).toBe('3 elements');
    expect(app.errors).toEqual([]);
  });

  it('renames and deletes widgets in the picker, and keeps them after a reload', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app);
    await tap(app, await cellToClient(app, 3, 8));
    await bar(app, 'more');
    await page.waitForSelector('.ctx-menu');
    await page.waitForTimeout(400);
    await page.locator('.ctx-menu [data-action="widget"]').tap();
    await page.locator('dialog.ask input').fill('Box');
    await page.tap('dialog.ask .primary');
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('Saved'));
    await reload(app);
    await tool(app, 'widget');
    expect(await page.locator('.widget-use strong').allInnerTexts()).toEqual(['Box']);
    await page.tap('[data-key="widget-rename"]');
    await page.locator('dialog.ask input').fill('Frame');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog.ask', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.widget-use strong')?.textContent === 'Frame'); // written to the Library, then listed
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
    await tool(app, 'icon');
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
  it('A shows Advanced mode, and picks several elements with Shift-click or by dragging a box', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await seed(app);
    await page.keyboard.press('a');
    expect(await page.locator('#advanced').getAttribute('aria-pressed')).toBe('true');
    expect((await page.locator('#bar-context button .label').allInnerTexts()).map((t) => t.trim())).toEqual(['Sequence', 'Icon', 'Checks', 'Widgets', 'Art']);
    await shot(app, 'desktop-advanced-mode');
    await page.keyboard.press('v');

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

    // a box dragged on empty space selects what it touches
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
