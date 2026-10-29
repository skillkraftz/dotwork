import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bar, cellToClient, choose, draft, drag, hit, missingHelp, open, openDoc, openDrawer, openSettings, shot, start, stop, tap, tool, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

async function setCalendar(app: App, year: string, month: string) {
  const { page } = app;
  await choose(app, 'page', '#settings');
  await page.waitForSelector('dialog.settings[open]');
  await page.locator('[data-key="calendar-month"]').selectOption(month);
  await page.locator('[data-key="calendar-year"]').fill(year);
  await page.locator('[data-key="calendar-year"]').dispatchEvent('change');
}
const closeSettings = async (app: App) => {
  await hit(app, 'dialog.settings header button');
  await app.page.waitForSelector('dialog.settings', { state: 'hidden' });
};

/** The Monthly log for November 2026: a group of five weeks, each with a weekly page, daily logs and a reflection. */
async function monthlyLog(app: App, book = 'Monthly log') {
  await choose(app, 'edit', '#library');
  await app.page.waitForSelector('dialog.library.browser[open] .lib-card');
  await hit(app, '[data-tab="books"]');
  await hit(app, `.lib-card[data-name="${book}"] .lib-open`);
  await app.page.waitForSelector('dialog.template[open]');
  await app.page.fill('[data-key="template-year"]', '2026');
  await app.page.fill('[data-key="template-month"]', '11');
  await hit(app, '[data-key="template-build"]');
  await app.page.waitForSelector('.stage-page');
  await waitSaved(app);
}

/** The letters the Preview of the page being edited draws in the sequence's column (the only text on the page below its header). */
const previewLetters = (app: App) => app.page.locator('#canvas text').evaluateAll((els) => els.map((e) => e.textContent ?? ''));

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`the month tools on a ${device}`, () => {
    it('reads the calendar’s month on a cover: Weekdays of the month starts with S in November 2026 and T in December', async () => {
      const app = await open(env, device);
      const { page } = app;
      await hit(app, '#menu-page');
      await hit(app, '#view-book');
      await page.waitForSelector('.stage-page');
      await setCalendar(app, '2026', '11');
      await hit(app, '[data-key="calendar-set"]');
      await page.waitForSelector('[data-key="calendar-remove"]');
      await closeSettings(app);

      // the inside front cover is the page before page 1; Edit page opens it where it sits
      await hit(app, '.nav-step[aria-label="Previous page"]');
      await page.waitForFunction(() => /cover/i.test(document.querySelector('.book-nav .where strong')?.textContent ?? ''));
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');

      // a sequence, set to Weekdays of the month with 31 items
      await tool(app, 'sequence');
      await tap(app, await cellToClient(app, 5, 10));
      if (device !== 'desktop') { await openDrawer(app); await page.waitForTimeout(350); } else await bar(app, 'properties');
      await page.locator('#panel [data-key="prop-values"]').selectOption('month_weekdays');
      await page.locator('#panel [data-key="prop-count"]').fill('31');
      await page.locator('#panel [data-key="prop-count"]').dispatchEvent('change');
      await page.locator('#panel [data-key="prop-values"]').scrollIntoViewIfNeeded();
      await shot(app, `month-tools-${device}-sequence`);
      expect(await missingHelp(app)).toEqual([]);

      await choose(app, 'edit', '#mode-preview');
      const nov = (await previewLetters(app)).filter((t) => /^[SMTWF]$/.test(t));
      expect(nov).toHaveLength(30); // November has 30 days: the 31st item prints nothing
      expect(nov.slice(0, 8).join('')).toBe('SMTWTFSS');
      await shot(app, `month-tools-${device}-november`);
      await choose(app, 'edit', '#mode-edit');
      await hit(app, '#edit-back');
      await page.waitForSelector('#edit-bar', { state: 'hidden' });

      // the calendar moved to December 2026, which starts on a Tuesday
      await setCalendar(app, '2026', '12');
      await page.waitForFunction(() => document.querySelector('[data-key="calendar-summary"]')?.textContent?.includes('2026-12-31'));
      await closeSettings(app);
      await hit(app, '[data-key="book-edit-page"]');
      await page.waitForSelector('#edit-bar:not([hidden])');
      await choose(app, 'edit', '#mode-preview');
      const dec = (await previewLetters(app)).filter((t) => /^[SMTWF]$/.test(t));
      expect(dec).toHaveLength(31);
      expect(dec.slice(0, 3).join('')).toBe('TWT');
      await shot(app, `month-tools-${device}-december`);
      expect(app.errors).toEqual([]);
    });

    it('replaces a page block with a spread and back, keeping how often and the page type, in one undo step each', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app);
      const first = () => openDoc(app, 'book').then((b) => b.outline[0].children[0]);
      const before = await first();
      expect(before).toMatchObject({ type: 'page', repeat: { times: 1 } });

      await openSettings(app, '0.0');
      await hit(app, '.outline-settings [data-key="outline-replace"]');
      await page.waitForSelector('dialog.picker[open] .design');
      expect(await page.locator('dialog.picker [role="tab"]:visible').allInnerTexts()).toEqual(['Pages', 'Spreads']); // no Other tab: nothing is added
      await hit(app, 'dialog.picker [data-tab="spreads"]');
      await shot(app, `month-tools-${device}-replace`);
      await hit(app, 'dialog.picker[open] .design[data-name="Weekly spread"]');
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await waitSaved(app);
      const spread = await first();
      expect(spread).toMatchObject({ type: 'spread', name: 'Weekly spread', repeat: before.repeat, dates: before.dates });
      expect((await openDoc(app, 'book')).outline[0]).toMatchObject({ type: 'group', repeat: { times: 5 } });

      // and back to a page: the picker opens on Spreads for a spread block
      await openSettings(app, '0.0');
      await hit(app, '.outline-settings [data-key="outline-replace"]');
      await page.waitForSelector('dialog.picker[open] .design');
      await hit(app, 'dialog.picker [data-tab="pages"]');
      await hit(app, 'dialog.picker[open] .design[data-name="Lined page"]');
      await page.waitForSelector('dialog.picker', { state: 'hidden' });
      await waitSaved(app);
      expect(await first()).toMatchObject({ type: 'page', page: { name: 'Lined page' }, repeat: before.repeat, dates: before.dates });

      if (await page.locator('.contents-toggle').isVisible()) await hit(app, '.contents-close');
      await hit(app, '[data-key="book-undo"]');
      await waitSaved(app);
      expect(await first()).toMatchObject({ type: 'spread', name: 'Weekly spread' });
      await hit(app, '[data-key="book-undo"]');
      await waitSaved(app);
      expect(await first()).toMatchObject({ type: 'page', page: { name: before.page.name } });
      expect(app.errors).toEqual([]);
    });

    it('shades only the weekends of the month, with a line between weeks, from the shade’s properties', async () => {
      const app = await open(env, device);
      const { page } = app;
      await tool(app, 'shade');
      await drag(app, await cellToClient(app, 3, 6), await cellToClient(app, 22, 16));
      if (device !== 'desktop') { await openDrawer(app); await page.waitForTimeout(350); } else await bar(app, 'properties');
      await page.locator('#panel [data-key="prop-weekends"]').check();
      await page.locator('#panel [data-key="prop-week_lines"]').selectOption('thin');
      await page.waitForSelector('#panel [data-key="prop-week_lines"]');
      expect(await draft(app).then((d) => d.elements)).toMatchObject([{ type: 'shade', weekends: true, week_lines: 'thin' }]);
      // October 2026, the editor's month, starts on a Thursday: its first weekend is the 3rd and 4th, rows 2 and 3 of the box
      expect(await page.locator('#canvas rect[fill="#efefef"]').count()).toBeGreaterThan(0);
      expect(await missingHelp(app)).toEqual([]);
      await page.locator('#panel [data-key="prop-weekends"]').scrollIntoViewIfNeeded();
      await shot(app, `month-tools-${device}-shade`);
      await page.locator('#panel [data-key="prop-weekends"]').uncheck();
      expect((await draft(app)).elements[0]).toEqual({ type: 'shade', x: 3, y: 6, w: 19, h: 10, tones: 'L' });
      expect(app.errors).toEqual([]);
    });

    it('draws the monthly tracker from one design: November has 30 rows of days, December 31', async () => {
      const app = await open(env, device);
      const { page } = app;
      await monthlyLog(app, 'Monthly journal');
      await hit(app, '.nav-step[aria-label="Previous page"]');
      await page.waitForFunction(() => /cover/i.test(document.querySelector('.book-nav .where strong')?.textContent ?? ''));
      const stage = async () => (await page.locator('.stage-page text').allTextContents()).map((t) => t.trim());
      const nov = await stage();
      expect(nov).toContain('NOVEMBER 2026');
      expect(nov.filter((t) => /^\d+$/.test(t))).toHaveLength(30);
      await shot(app, `month-tools-${device}-tracker-november`);
      await setCalendar(app, '2026', '12');
      await page.waitForFunction(() => document.querySelector('[data-key="calendar-summary"]')?.textContent?.includes('2026-12-31'));
      await closeSettings(app);
      const dec = await stage();
      expect(dec).toContain('DECEMBER 2026');
      expect(dec.filter((t) => /^\d+$/.test(t))).toHaveLength(31);
      expect(dec.filter((t) => /^[SMTWF]$/.test(t)).slice(0, 3)).toEqual(['T', 'W', 'T']);
      await shot(app, `month-tools-${device}-tracker-december`);
      expect(app.errors).toEqual([]);
    });
  });
}
