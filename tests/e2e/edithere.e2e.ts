import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellToClient, choose, drag, hit, libraryItems, open, openDoc, shot, start, stop, tool, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const pageCount = async (app: App) => (await libraryItems(app)).filter((i) => i.kind === 'page').length;

/** The Monthly log for November 2026: week planner, daily logs and a reflection for each of its five weeks. */
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

/** The settings of a block row in the outline (the outline is a drawer on a phone). */
async function blockSettings(app: App, row: string) {
  if (await app.page.locator('.contents-toggle').isVisible()) await hit(app, '.contents-toggle');
  await hit(app, `[data-block-row="${row}"] [data-key="outline-more"]`);
}

const weekPlanner = (book: any) => book.outline[0].children[0].page;
const rules = (page: any) => page.elements.filter((e: { type: string }) => e.type === 'rule').length;

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`editing a page where it sits in the book on a ${device}`, () => {
    it('writes the change into every repeat, adds nothing to the Library, and Undo takes it back', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      const before = await pageCount(app);
      const start = await openDoc(app, 'book');
      expect(start.outline[0].children[0].repeat).toEqual({ times: 1 });
      expect(start.outline[0].repeat).toEqual({ each: 'week' });
      const planned = rules(weekPlanner(start));

      // The Edit page button by the page being looked at: page 1 is the first week planner. Back returns to the same page.
      await shot(app, `edit-here-${device}-button`);
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      expect(await page.innerText('#edit-text')).toBe('Editing p.1 in NOVEMBER 2026 log · Week planner, ×1: changes all 5');
      expect(await page.locator('#docbar').isHidden()).toBe(true);
      await hit(app, '#edit-back');
      await page.waitForSelector('#edit-bar', { state: 'hidden' });
      expect(await page.innerText('.book-nav .where strong')).toBe('Page 1');

      // Edit here from the block's settings: add a rule with the normal tools.
      await blockSettings(app, '0.0');
      await shot(app, `edit-here-${device}-settings`);
      await hit(app, '[data-block-row="0.0"] [data-key="outline-edit-here"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      await page.waitForSelector('#canvas:not([hidden])');
      await tool(app, 'rule');
      await drag(app, await cellToClient(app, 3, 40), await cellToClient(app, 12, 40));
      await page.waitForFunction(() => document.querySelector('#edit-status')?.textContent === 'Saving…'); // the book is being written, not a Library page
      await page.waitForFunction(() => document.querySelector('#edit-status')?.textContent === 'Saved');
      await shot(app, `edit-here-${device}-bar`);
      await hit(app, '#edit-back');
      await page.waitForSelector('#edit-bar', { state: 'hidden' });
      await page.waitForSelector('.book-bar [data-key="book-undo"]');

      // The rule is in the block, so on every week planner page; the Library has no new page.
      await waitSaved(app);
      const edited = await openDoc(app, 'book');
      expect(rules(weekPlanner(edited))).toBe(planned + 1);
      expect(edited.outline[0].children[0].from).toEqual(start.outline[0].children[0].from);
      expect(await pageCount(app)).toBe(before);
      expect((await libraryItems(app)).filter((i) => i.kind === 'book')).toHaveLength(1);

      // One Undo in the Book view takes the whole edit back.
      await hit(app, '[data-key="book-undo"]');
      await waitSaved(app);
      expect(rules(weekPlanner(await openDoc(app, 'book')))).toBe(planned);
      noErrors(app);
    });

    it('replaces a block’s design and keeps how it repeats', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      await blockSettings(app, '0.0');
      await hit(app, '[data-block-row="0.0"] [data-key="outline-replace"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await shot(app, `edit-here-${device}-replace`);
      await hit(app, 'dialog.picker[open] .design[data-name="Lined page"]');
      await waitSaved(app);
      const book = await openDoc(app, 'book');
      expect(book.outline[0].children[0]).toMatchObject({ type: 'page', page: { name: 'Lined page' }, repeat: { times: 1 } });
      expect(book.outline[0]).toMatchObject({ type: 'group', repeat: { each: 'week' } });
      if (await page.locator('.contents-toggle').isVisible()) await hit(app, '.contents-close');
      await hit(app, '[data-key="book-undo"]');
      await waitSaved(app);
      expect((await openDoc(app, 'book')).outline[0].children[0].page.name).toBe('Week planner');
      noErrors(app);
    });
  });
}
