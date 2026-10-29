import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, confirmAdd, hit, open, openDoc, shot, showOutline, start, stop, waitSaved, type App, type Device, type Env } from './harness';

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

/** What a row says under its name, e.g. "takes what’s left · 7 pages · p.46–52". */
const summary = async (app: App, row: number) => app.page.locator(`[data-block-row="${row}"] > .orow-line .crow-name`).innerText();
const pagesOf = (text: string) => Number(/(\d+) pages?/.exec(text)![1]);

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`adding a block where you are on a ${device}`, () => {
    it('adds before the free pages with nothing picked, and after the picked row, inside its group', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      const start = await openDoc(app, 'book');
      const freeAt = start.outline.findIndex((b: { type: string }) => b.type === 'free');
      expect(start.outline[0].type).toBe('group');
      expect(freeAt).toBe(1);

      // Nothing is picked: Add… puts the block before the free pages, which give up two pages. There is no Where to choose.
      await showOutline(app);
      expect(await page.locator('.orow.selected').count()).toBe(0);
      const freeBefore = pagesOf(await summary(app, freeAt));
      if (app.touch) await hit(app, '.contents-close');
      await hit(app, '[data-key="book-add"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await shot(app, `add-where-${device}-picker`);
      expect(await page.locator('dialog.picker .design.open').count()).toBe(0); // nothing is added by tapping, and no card is open yet

      // The card opens in place: the others stay.
      const cards = await page.locator('dialog.picker .design').count();
      await hit(app, 'dialog.picker .design[data-name="Lined page"]');
      await page.waitForSelector('dialog.picker .design.open');
      expect(await page.locator('dialog.picker .design').count()).toBe(cards);
      expect(await page.locator('dialog.picker [data-key="add-where"]').count()).toBe(0);
      // Lined page prints a date, so it starts as a Day page to the end of the month; ask for a number of times instead.
      expect(await page.locator('dialog.picker [data-key="add-dates"]').inputValue()).toBe('day');
      expect(await page.locator('dialog.picker [data-key="add-each"]').inputValue()).toBe('to-month');
      expect(await page.locator('dialog.picker [data-key="add-each"] option').allInnerTexts()).toEqual(['Once', 'A number of times', 'To the end of the week', 'To the end of the month']);
      await page.selectOption('dialog.picker [data-key="add-each"]', 'times');
      await page.waitForSelector('dialog.picker .design.open [data-key="add-repeat"][value="2"]');
      const groupEnd = Number(/p\.\d+–(\d+)/.exec(await summary(app, 0))![1]);
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

      // A child is picked: the next block goes right after it, inside its group. A group takes it at its end.
      await hit(app, '[data-block-row="0.1"] .orow-main');
      await page.waitForSelector('[data-block-row="0.1"].selected');
      await hit(app, '.outline-add [data-key="outline-add"]');
      await page.waitForSelector('dialog.picker[open] .design');
      expect(await page.locator('dialog.picker h2').textContent()).toBe(`Add to ${start.outline[0].name}`);
      await hit(app, 'dialog.picker [data-tab="blocks"]');
      await hit(app, 'dialog.picker .design[data-name="Blank page"]');
      await confirmAdd(app);
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      const inGroup = await openDoc(app, 'book');
      expect(inGroup.outline[0].children).toHaveLength(start.outline[0].children.length + 1);
      expect(inGroup.outline[0].children[2]).toMatchObject({ type: 'page', page: null });
      await showOutline(app);
      expect(await page.locator('[data-block-row="0.2"].selected').count()).toBe(1);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  });
}
