import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bar, cellToClient, choose, draft, hit, missingHelp, open, openDoc, openDrawer, shot, start, stop, tap, tool, unzip, waitSaved, type App, type Device, type Env } from './harness';
import { readPdf, segments } from '../pdf-text';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const GRID_Y = 3.85, PITCH = 3; // mm: where the grid starts on the page, and one cell

async function showOutline(app: App) {
  if (app.touch && !(await app.page.locator('.book-contents').isVisible())) await hit(app, '.contents-toggle');
  await app.page.waitForSelector('.book-contents', { state: 'visible' });
}

/** Build the Monthly log from the library's Books tab, for a month. */
async function buildLog(app: App, year: string, month: string) {
  await choose(app, 'edit', '#library');
  await app.page.waitForSelector('dialog.library.browser[open] .lib-card');
  await hit(app, '[data-tab="books"]');
  await hit(app, '.lib-card[data-name="Monthly log"] .lib-open');
  await app.page.waitForSelector('dialog.template[open]');
  await app.page.fill('[data-key="template-year"]', year);
  await app.page.selectOption('[data-key="template-month"]', month).catch(async () => app.page.fill('[data-key="template-month"]', month));
  await hit(app, '[data-key="template-build"]');
  await app.page.waitForSelector('.stage-page');
  await waitSaved(app);
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`the week block on a ${device}`, () => {
    it('builds the Monthly log for November 2026 and prints a last-week page of only SUN 29 and MON 30, with lined space below', async () => {
      const app = await open(env, device);
      const { page } = app;
      await buildLog(app, '2026', '11');
      const book = await openDoc(app, 'book');
      expect(book.name).toBe('NOVEMBER 2026 log');
      expect(book.calendar).toEqual({ start: '2026-11-01', end: '2026-11-30', week_starts: 0 });
      expect(book.outline.map((b: { type: string }) => b.type)).toEqual(['group', 'free', 'page']);

      // page 37: the free pages start at 41; walk back from there to the last week's planner
      await showOutline(app);
      await hit(app, '[data-block-row="1"] .orow-main');
      expect(await page.locator('.where strong').innerText()).toBe('Page 41');
      for (let n = 41; n > 37; n--) { await page.focus('.stage-page'); await page.keyboard.press('ArrowLeft'); }
      await page.waitForFunction(() => document.querySelector('.where strong')?.textContent === 'Page 37');
      const shown = await page.locator('.stage-page text').allTextContents();
      expect(shown).toEqual(expect.arrayContaining(['SUN', '29', 'MON', '30']));
      for (const gone of ['TUE', 'WED', 'THU', 'FRI', 'SAT']) expect(shown).not.toContain(gone);
      await shot(app, `${device}-week-planner-last-week`);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch && (await page.locator('.contents-close').isVisible())) await hit(app, '.contents-close');

      // print: page 37's block has Sunday 29 and Monday 30 on their usual rows, and ruled space where the other five days would be
      await hit(app, '.book-bar [data-key="book-export"]');
      await page.waitForSelector('dialog.export[open] [data-key="export-pdf"]');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 50_000 }), hit(app, '[data-key="export-pdf"]')]);
      const pages = await readPdf(unzip(readFileSync((await download.path())!)).get('pages.pdf')!);
      expect(pages).toHaveLength(52);
      const last = pages[36];
      expect(last.strings.filter((s) => /^[A-Z]{3}$/.test(s))).toEqual(['SUN', 'MON']);
      expect(last.strings.filter((s) => /^\d{1,2}$/.test(s))).toEqual(['29', '30', '37']); // the days, then the page number
      expect(last.strings).toEqual(expect.arrayContaining(['GOAL', 'OUTCOME']));
      const full = pages[0]; // Nov 1-7 is a full week
      expect(full.strings.filter((s) => /^[A-Z]{3}$/.test(s))).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
      // ruled lines: the last week has the writing lines of 20 more rows below its outcomes (cells 24 to 44)
      const rows = (info: typeof last) => segments(info.content, info.height / (72 / 25.4))
        .filter((s) => Math.abs(s.y1 - s.y2) < 0.01 && s.x2 - s.x1 > 60)
        .map((s) => Math.round((s.y1 - GRID_Y) / PITCH));
      const below = (info: typeof last) => new Set(rows(info).filter((r) => r > 24));
      expect(below(last).size).toBe(20); // rows 25 to 44, one line each
      expect(Math.max(...rows(full))).toBe(44); // a full week ends at the same bottom edge
      expect(app.errors).toEqual([]);
    });

    it('lets a week block be placed from the widget picker, rebuilt from other widgets in its properties, and previewed as a first or last week', async () => {
      const app = await open(env, device);
      const { page } = app;
      await tool(app, 'widget');
      await page.waitForSelector('dialog.advanced .generated-row');
      expect(await page.locator('dialog.advanced h3').allTextContents()).toEqual(['Generated', 'Saved']);
      expect(await missingHelp(app)).toEqual([]);
      await hit(app, '[data-key="generated-use"]');
      await page.waitForSelector('dialog.advanced', { state: 'hidden' });
      await tap(app, await cellToClient(app, 3, 3)); // the block fills the grid, so it lands at its corner
      await waitSaved(app);
      const placed = (await draft(app)).elements;
      expect(placed).toHaveLength(1);
      expect(placed[0]).toMatchObject({ type: 'generated', kind: 'week', x: 0, y: 1, w: 27, h: 43, goals: { name: 'Week goals' }, day: { name: 'Week day' }, outcomes: { name: 'Week outcomes' } });
      const labels = () => page.locator('#canvas text').allTextContents().then((all) => all.filter((t) => /^[A-Z]{3}$/.test(t)));
      expect(await labels()).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']); // the sample week

      // the properties: three widgets to choose from, and the sample week to preview
      if (device !== 'desktop') { await openDrawer(app); await page.waitForTimeout(350); } else await bar(app, 'properties');
      await page.waitForSelector('#panel [data-key="prop-week-goals"]');
      expect(await page.locator('#panel [data-key="prop-week-goals"] option').allInnerTexts()).toEqual(expect.arrayContaining(['Week goals', 'Week day', 'Week outcomes', 'Day block']));
      expect(await missingHelp(app)).toEqual([]);
      await page.locator('#panel [data-key="prop-week-goals"]').selectOption('Day block');
      expect((await draft(app)).elements[0]).toMatchObject({ goals: { name: 'Day block' }, day: { name: 'Week day' } });
      await page.locator('#panel [data-key="prop-week-goals"]').selectOption('Week goals');

      await hit(app, '#panel [data-key="week-preview-first"]');
      expect(await labels()).toEqual(['FRI', 'SAT']); // Friday and Saturday on their usual rows, lined space above
      await shot(app, `${device}-week-block-first-week`);
      await hit(app, '#panel [data-key="week-preview-last"]');
      expect(await labels()).toEqual(['SUN', 'MON']);
      await shot(app, `${device}-week-block-last-week`);
      await hit(app, '#panel [data-key="week-preview-full"]');
      expect(await labels()).toHaveLength(7);
      expect(((await draft(app)).elements[0] as { goals: { name: string } }).goals.name).toBe('Week goals'); // the preview is not part of the file
      expect(JSON.stringify((await draft(app)).elements)).not.toContain('preview');
      expect(app.errors).toEqual([]);
    });
  });
}
