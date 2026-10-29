import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellToClient, choose, drag, hit, libraryItems, open, openDoc, openSettings, shot, start, stop, tool, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const pageCount = async (app: App) => (await libraryItems(app)).filter((i) => i.kind === 'page').length;

/** The Monthly log for November 2026: the weekly page, daily logs and a reflection for each of its five weeks. */
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

/** November 2026 starts on a Sunday, so the weeks start on the 1st, 8th, 15th, 22nd and 29th. */
const thirdWeekFirstDay = 15;
/** The page number of each week planner: a planner, its days' logs inside the month, and the week's reflection make a week. */
const weekPlannerSlots = (): number[] => {
  const slots: number[] = [];
  const days = [7, 7, 7, 7, 2]; // daily logs in each week, all inside November
  let at = 1;
  for (const d of days) { slots.push(at); at += 1 + d + 1; }
  return slots;
};
async function goToPage(app: App, n: number) {
  for (let guard = 0; guard < 80; guard++) {
    const label = await app.page.innerText('.book-nav .where strong');
    const now = Number(label.replace('Page ', ''));
    if (now === n) return;
    await hit(app, now < n ? '.nav-step[aria-label="Next page"]' : '.nav-step[aria-label="Previous page"]');
    await app.page.waitForFunction((was) => document.querySelector('.book-nav .where strong')?.textContent !== was, label);
  }
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
      expect(start.outline[0].repeat).toEqual({ times: 5 });
      const planned = rules(weekPlanner(start));

      // The Edit page button by the page being looked at: page 1 is the first week planner. Back returns to the same page.
      await shot(app, `edit-here-${device}-button`);
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      expect(await page.innerText('#edit-text')).toBe('Editing p.1 in NOVEMBER 2026 log · Year journal weekly page (dated), ×1: changes all 5');
      expect(await page.locator('#docbar').isHidden()).toBe(true);
      await hit(app, '#edit-back');
      await page.waitForSelector('#edit-bar', { state: 'hidden' });
      expect(await page.innerText('.book-nav .where strong')).toBe('Page 1');

      // From the third week planner (a week is 9 pages: planner, seven daily logs, reflection): the bar, Preview and Back use that page.
      const third = weekPlannerSlots()[2];
      await goToPage(app, third);
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      expect(await page.innerText('#edit-text')).toBe(`Editing p.${third} in NOVEMBER 2026 log · Year journal weekly page (dated), ×1: changes all 5`);
      await choose(app, 'edit', '#mode-preview');
      const texts = await page.locator('#canvas text').evaluateAll((els) => els.map((e) => e.textContent));
      expect(texts).toContain(String(thirdWeekFirstDay)); // Nov 15: the third week starts on a Sunday, 15
      expect(texts).toContain(String(third));
      await choose(app, 'edit', '#mode-edit');
      await hit(app, '#edit-back');
      await page.waitForSelector('#edit-bar', { state: 'hidden' });
      expect(await page.innerText('.book-nav .where strong')).toBe(`Page ${third}`);
      await goToPage(app, 1);

      // Edit here from the block's settings: add a rule with the normal tools.
      await openSettings(app, '0.0');
      await shot(app, `edit-here-${device}-settings`);
      await hit(app, '.outline-settings [data-key="outline-edit-here"]');
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
      await openSettings(app, '0.0');
      await hit(app, '.outline-settings [data-key="outline-replace"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await shot(app, `edit-here-${device}-replace`);
      await hit(app, 'dialog.picker[open] .design[data-name="Lined page"]');
      await waitSaved(app);
      const book = await openDoc(app, 'book');
      expect(book.outline[0].children[0]).toMatchObject({ type: 'page', page: { name: 'Lined page' }, repeat: { times: 1 } });
      expect(book.outline[0]).toMatchObject({ type: 'group', repeat: { times: 5 } });
      if (await page.locator('.contents-toggle').isVisible()) await hit(app, '.contents-close');
      await hit(app, '[data-key="book-undo"]');
      await waitSaved(app);
      expect((await openDoc(app, 'book')).outline[0].children[0].page.name).toBe('Year journal weekly page (dated)');
      noErrors(app);
    });
  });
}
