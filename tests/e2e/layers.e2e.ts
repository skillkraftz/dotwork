import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, dragRow, hit, missingHelp, open, openDoc, pickRow, shot, showOutline, start, stop, togglePick, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

/** The Monthly log for November 2026: the Weeks group (a planner, a daily log for each day of the week, a reflection), free pages, and the month review pinned last. */
async function monthlyLog(app: App) {
  await choose(app, 'edit', '#library');
  await app.page.waitForSelector('dialog.library.browser[open] .lib-card');
  await hit(app, '[data-tab="books"]');
  await hit(app, '.lib-card[data-name="Monthly log"] .lib-open');
  await app.page.waitForSelector('dialog.template[open]');
  await app.page.fill('[data-key="template-year"]', '2026');
  await app.page.fill('[data-key="template-month"]', '11');
  await hit(app, '[data-key="template-build"]');
  await app.page.waitForSelector('.stage-page');
  await waitSaved(app);
}

const kinds = async (app: App) => (await openDoc(app, 'book')).outline.map((b: { type: string }) => b.type);
const reads = (app: App, key: string) => app.page.locator(`[data-block-row="${key}"] [data-key="row-reads"]`).innerText();
const panel = (app: App, field: string) => app.page.locator(`.outline-settings [data-key="${field}"]`);
const optionsOf = (app: App, field: string) => panel(app, field).locator('option').allInnerTexts();

/** Controls in the outline under 44 px, other than checkboxes. */
const smallControls = (app: App) => app.page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.book-contents button, .book-contents select, .book-contents input')) {
    const r = el.getBoundingClientRect();
    if ((r.width === 0 && r.height === 0) || (el as HTMLInputElement).type === 'checkbox') continue;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`the outline as a layers panel on a ${device}`, () => {
    it('drags rows, groups and ungroups them, and changes a group’s How often, with the days still reading their dates', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      expect(await kinds(app)).toEqual(['group', 'free', 'page']);
      await showOutline(app);
      expect(await page.locator('[data-key="outline-up"], [data-key="outline-down"], [data-key="outline-more"], [data-key="outline-into"], [data-key="outline-out"]').count()).toBe(0);
      expect(await page.locator('.orow-handle').count()).toBe(6); // the group, its three blocks, the free pages and the review
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');

      // A selection and the settings under the list: one row's settings are always in the same place.
      await pickRow(app, '1');
      expect(await page.locator('.outline-list + .outline-settings').count()).toBe(1);
      await shot(app, `layers-${device}-selection`);
      await pickRow(app, '0');
      expect(await panel(app, 'outline-group-name').inputValue()).toBe('Weeks');
      await shot(app, `layers-${device}-settings`);
      await togglePick(app, ['0']); // nothing picked: the list gets the room

      // Drag the free pages above the Weeks group, then back.
      await dragRow(app, '1', { before: '0' }, async () => {
        expect(await page.locator('.orow-drop').getAttribute('data-target')).toBe('{"index":0}');
        expect(await page.locator('.orow-drop').isVisible()).toBe(true);
        expect(await page.locator('[data-block-row="1"].dragging').count()).toBe(1);
        await shot(app, `layers-${device}-drag`);
      });
      expect(await kinds(app)).toEqual(['free', 'group', 'page']);
      expect(await page.locator('.orow-drop').count()).toBe(0);
      expect(await reads(app, '1.1')).toBe('reads: SUN NOV 1'); // the day pages still read their dates in the group, now row 1
      await togglePick(app, ['0']);
      await dragRow(app, '0', { after: '1' });
      expect(await kinds(app)).toEqual(['group', 'free', 'page']);
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');

      // Pick the free pages and the month review, and group them: a group named Group, repeating once, where the first one was.
      await togglePick(app, ['1']); // the dropped row is still picked: take it off, then pick the two
      await togglePick(app, ['1', '2']);
      expect(await page.locator('.orow.selected').count()).toBe(2);
      expect(await page.locator('.outline-settings button').allInnerTexts()).toEqual(['Group', 'Duplicate', 'Delete']); // all that several rows share
      await shot(app, `layers-${device}-several`);
      await hit(app, '[data-key="outline-group"]');
      await page.waitForSelector('[data-block-row="1.1"]');
      let book = await openDoc(app, 'book');
      expect(book.outline.map((b: { type: string }) => b.type)).toEqual(['group', 'group']);
      expect(book.outline[1]).toMatchObject({ name: 'Group', repeat: { times: 1 } });
      expect(book.outline[1].children.map((c: { type: string }) => c.type)).toEqual(['free', 'page']);
      expect(book.outline[1].children[1]).toMatchObject({ repeat: { times: 1 } });
      expect('pin' in book.outline[1].children[1]).toBe(false);
      expect(await page.locator('[data-block-row="1"].selected').count()).toBe(1); // the new group is picked, so Ungroup is ready
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');

      // Ungroup: its blocks take its place.
      await hit(app, '[data-key="outline-ungroup"]');
      await page.waitForSelector('[data-block-row="2"]');
      book = await openDoc(app, 'book');
      expect(book.outline.map((b: { type: string }) => b.type)).toEqual(['group', 'free', 'page']);
      expect(await page.locator('.orow.selected').count()).toBe(2);
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');

      // Change the Weeks group's How often: every month, and the plain words inside it.
      await showOutline(app);
      await pickRow(app, '0');
      expect(await optionsOf(app, 'outline-each')).toEqual(['Once', 'A number of times', 'Every day (dated)', 'Every week (dated)', 'Every month (dated)']);
      expect(await panel(app, 'outline-each').inputValue()).toBe('week');
      await panel(app, 'outline-each').selectOption('month');
      await page.waitForFunction(() => (document.querySelector('.outline-settings [data-key="outline-each"]') as HTMLSelectElement).value === 'month');
      expect((await openDoc(app, 'book')).outline[0].repeat).toEqual({ each: 'month' });
      await pickRow(app, '0.1');
      expect(await optionsOf(app, 'outline-each')).toEqual(['Once each month', 'A number of times each month', 'Every day of the month (dated)', 'Every week of the month (dated)']);
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');
      await pickRow(app, '0');
      await panel(app, 'outline-each').selectOption('week');
      await page.waitForFunction(() => (document.querySelector('.outline-settings [data-key="outline-each"]') as HTMLSelectElement).value === 'week');
      await pickRow(app, '0.1');
      expect(await optionsOf(app, 'outline-each')).toEqual(['Once each week', 'A number of times each week', 'Every day of the week (dated)']);
      expect(await panel(app, 'outline-each-hint').count()).toBe(0);
      // By a number the group prints no dates, and the panel says so.
      await pickRow(app, '0');
      await panel(app, 'outline-each').selectOption('once');
      await page.waitForSelector('.outline-settings [data-key="outline-each-hint"]');
      expect(await panel(app, 'outline-each-hint').innerText()).toBe('Repeats by number print no dates.');
      await panel(app, 'outline-each').selectOption('week');
      await page.waitForFunction(() => document.querySelector('.outline-settings [data-key="outline-each-hint"]') === null);
      expect(await reads(app, '0.1')).toBe('reads: SUN NOV 1');
      expect((await openDoc(app, 'book')).outline[0].repeat).toEqual({ each: 'week' });
      expect(await kinds(app)).toEqual(['group', 'free', 'page']);

      if (!app.touch) {
        // Delete removes the picked rows in one step; Undo brings them back.
        await pickRow(app, '2');
        await page.keyboard.press('Delete');
        await page.waitForFunction(() => document.querySelectorAll('[data-block-row]:not([data-block-row*="."])').length === 2);
        expect(await kinds(app)).toEqual(['group', 'free']);
        await hit(app, '.book-bar [data-key="book-undo"]');
        expect(await kinds(app)).toEqual(['group', 'free', 'page']);
      }

      if (app.touch) {
        await hit(app, '[data-key="outline-select"]');
        await page.waitForSelector('.orow-check input');
        await shot(app, `layers-${device}-select-mode`);
        expect(await smallControls(app)).toEqual([]);
        await hit(app, '[data-key="outline-select"]');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  });
}
