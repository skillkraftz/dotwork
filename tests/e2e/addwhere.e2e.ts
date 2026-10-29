import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, confirmAdd, hit, open, openDoc, shot, start, stop, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

/** The Monthly log for November 2026: the weeks group, then free pages that take what is left. */
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

async function showOutline(app: App) {
  if (app.touch && !(await app.page.locator('.book-contents').isVisible())) await hit(app, '.contents-toggle');
  await app.page.waitForSelector('.book-contents', { state: 'visible' });
}

/** What a row says under its name, e.g. "takes what’s left · 7 pages · p.46–52". */
const summary = async (app: App, row: number) => app.page.locator(`[data-block-row="${row}"] > .orow-line .crow-name`).innerText();
const pagesOf = (text: string) => Number(/(\d+) pages?/.exec(text)![1]);

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`adding a block where you are on a ${device}`, () => {
    it('adds ×2 right after the selected group, and the free pages give up two pages', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      const start = await openDoc(app, 'book');
      const freeAt = start.outline.findIndex((b: { type: string }) => b.type === 'free');
      expect(start.outline[0].type).toBe('group');
      expect(freeAt).toBe(1);

      // Select the group's row, then Add…
      await showOutline(app);
      const groupEnd = Number(/p\.\d+–(\d+)/.exec(await summary(app, 0))![1]);
      const freeBefore = pagesOf(await summary(app, freeAt));
      await hit(app, '[data-block-row="0"] .orow-main');
      if (app.touch) await page.waitForSelector('.book-contents', { state: 'hidden' });
      await hit(app, '[data-key="book-add"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await shot(app, `add-where-${device}-picker`);
      expect(await page.locator('dialog.picker .design.open').count()).toBe(0); // nothing is added by tapping, and no card is open yet

      // The card opens in place: the others stay.
      const cards = await page.locator('dialog.picker .design').count();
      await hit(app, 'dialog.picker .design[data-name="Lined page"]');
      await page.waitForSelector('dialog.picker .design.open');
      expect(await page.locator('dialog.picker .design').count()).toBe(cards);
      // Lined page prints a date, so it starts as each day; ask for a number of times instead.
      expect(await page.locator('dialog.picker [data-key="add-each"]').inputValue()).toBe('day');
      await page.selectOption('dialog.picker [data-key="add-each"]', 'times');
      await page.waitForSelector('dialog.picker [data-key="add-repeat-inc"]');
      await hit(app, '[data-key="add-repeat-inc"]');
      await page.waitForSelector('dialog.picker .design.open [data-key="add-repeat"][value="2"]');
      const where = page.locator('dialog.picker [data-key="add-where"]');
      expect(await where.locator('option:checked').innerText()).toBe(`After ${start.outline[0].name}`);
      expect(await page.locator('dialog.picker [data-key="add-lands"]').innerText()).toBe(`Lands on p.${groupEnd + 1}–${groupEnd + 2}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(app, `add-where-${device}-card`);

      await confirmAdd(app);
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await waitSaved(app);
      const book = await openDoc(app, 'book');
      expect(book.outline.map((b: { type: string }) => b.type)).toEqual([start.outline[0].type, 'page', ...start.outline.slice(1).map((b: { type: string }) => b.type)]);
      expect(book.outline[1]).toMatchObject({ page: { name: 'Lined page' }, repeat: { times: 2 } });
      expect(await page.innerText('.book-nav .where strong')).toBe(`Page ${groupEnd + 1}`);
      await showOutline(app);
      expect(await page.locator('[data-block-row="1"].selected').count()).toBe(1);
      expect(pagesOf(await summary(app, 2))).toBe(freeBefore - 2);
      await shot(app, `add-where-${device}-outline`);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  });
}
