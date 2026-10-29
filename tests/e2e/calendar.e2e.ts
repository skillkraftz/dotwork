import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { confirmAdd, hit, missingHelp, nameOpen, open, openDoc, openSettings, shot, showOutline, start, stop, choose, togglePick, unzip, type App, type Device, type Env } from './harness';
import { readPdf } from '../pdf-text';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Add a block: Add…, the tab it is on, and its card (from the group's own button when `from` is given). */
async function add(app: App, tab: 'pages' | 'spreads' | 'blocks', name: string, from = '[data-key="book-add"]') {
  if (app.touch && (await app.page.locator('.book-contents').isVisible()) && from === '[data-key="book-add"]') await hit(app, '.contents-close');
  await hit(app, from);
  await app.page.waitForSelector('dialog.picker[open] .design');
  await hit(app, `dialog.picker [data-tab="${tab}"]`);
  await hit(app, `dialog.picker .design[data-name="${name}"]`);
  await confirmAdd(app);
  await app.page.waitForSelector('dialog.picker', { state: 'hidden' });
}

const row = (app: App, key: string) => app.page.locator(`[data-block-row="${key}"]`);
const settings = openSettings;
const panel = (app: App, field: string) => app.page.locator(`.outline-settings [data-key="${field}"]`);
const used = (app: App) => app.page.locator('.book-total [data-key="book-used"]').innerText();

/** Everything one PDF page printed, as one string. */
const text = (strings: string[]) => strings.join(' ');

async function build(app: App, device: Device) {
  const { page } = app;
  await hit(app, '#menu-page');
  await hit(app, '#view-book');
  await page.waitForSelector('.stage-page');

  // a November 2026 calendar, from the book's settings
  await choose(app, 'page', '#settings');
  await page.waitForSelector('dialog.settings[open]');
  expect(await page.locator('dialog.settings [data-key="calendar-summary"]').innerText()).toMatch(/Undated/);
  await page.locator('[data-key="calendar-month"]').selectOption('11');
  await page.locator('[data-key="calendar-year"]').fill('2026');
  await page.locator('[data-key="calendar-year"]').dispatchEvent('change');
  await hit(app, '[data-key="calendar-set"]');
  await page.waitForSelector('[data-key="calendar-remove"]');
  expect((await openDoc(app, 'book')).calendar).toEqual({ start: '2026-11-01', end: '2026-11-30', week_starts: 0 });
  expect(await page.locator('[data-key="calendar-summary"]').innerText()).toContain('2026-11-30');
  expect(await missingHelp(app)).toEqual([]);
  await shot(app, `${device}-calendar-settings`);
  await hit(app, 'dialog.settings header button');
  await page.waitForSelector('dialog.settings', { state: 'hidden' });

  // a group that repeats each week, with a tracker, a daily log for each day of the week, and the weekly reflection
  await add(app, 'blocks', 'New group');
  await settings(app, '0');
  expect(await panel(app, 'outline-each').locator('option').allInnerTexts()).toEqual(['Once', 'A number of times', 'Every day (dated)', 'Every week (dated)', 'Every month (dated)']);
  await panel(app, 'outline-each').selectOption('week');
  await page.waitForFunction(() => (document.querySelector('.outline-settings [data-key="outline-each"]') as HTMLSelectElement | null)?.value === 'week');
  const openAdd = '.outline-settings [data-key="outline-add-to-group"]';
  await add(app, 'pages', 'week tracker checklist', openAdd);
  await settings(app, '0');
  await add(app, 'pages', 'Daily Log', openAdd);
  await settings(app, '0');
  await add(app, 'pages', 'Weekly reflection', openAdd);
  await showOutline(app);
  expect(await row(app, '0').locator('.crow-name').first().innerText()).toContain('each week');
  expect(await row(app, '0.0').locator('.crow-name').innerText()).toContain('×1'); // the tracker reads the week
  expect(await row(app, '0.1').locator('.crow-name').innerText()).toContain('each day of the week'); // suggested from {weekday} {day}
  expect(await row(app, '0.2').locator('.crow-name').innerText()).toContain('×1');
  expect(await row(app, '0.0').locator('[data-key="row-reads"]').innerText()).toBe('reads: NOV 1 – NOV 7');
  expect(await row(app, '0.1').locator('[data-key="row-reads"]').innerText()).toBe('reads: SUN NOV 1');
  expect(await row(app, '0.2').locator('[data-key="row-reads"]').innerText()).toBe('reads: WEEK 45 NOV 1-NOV 7');
  expect(await used(app)).toBe('40 of 52 pages'); // 5 weeks × 2 + 30 days
  await shot(app, `${device}-calendar-outline-reads`);

  // free pages take the rest (nothing picked: the end); a closing page is pinned to 52
  await togglePick(app, ['0.2']);
  await add(app, 'blocks', 'Free pages');
  expect(await used(app)).toBe('52 of 52 pages');
  await add(app, 'pages', 'Patterns & takeaways');
  await settings(app, '2');
  await panel(app, 'outline-each').selectOption('month');
  await hit(app, '.outline-settings [data-key="outline-pin-page"]');
  const pin = panel(app, 'outline-pin-number');
  await pin.fill('52');
  await pin.dispatchEvent('change');
  await app.page.waitForFunction(() => document.querySelector('[data-block-row="2"] .crow-name')?.textContent?.includes('pinned: p.52'));
  expect(await used(app)).toBe('52 of 52 pages');
  expect(await row(app, '1').locator('.crow-name').innerText()).toContain('11 pages'); // 41 to 51
  expect(await row(app, '2').locator('[data-key="row-reads"]').innerText()).toBe('reads: NOVEMBER REVIEW');

  // a design on the first free page: tap the row to go to it, then Choose design
  await hit(app, '[data-block-row="1"] .orow-main');
  expect(await page.locator('.where strong').innerText()).toBe('Page 41');
  if (app.touch) await hit(app, '.contents-close');
  await hit(app, '[data-key="free-design"]');
  await page.waitForSelector('dialog.picker[open] .design');
  await hit(app, 'dialog.picker .design[data-name="Book notes"]');
  await page.waitForSelector('dialog.picker', { state: 'hidden' });
  expect(await page.locator('.design-name strong').innerText()).toBe('Book notes');
  const book = await openDoc(app, 'book');
  expect(book.outline[1]).toMatchObject({ type: 'free', pages: [{ name: 'Book notes' }] });
  expect(book.outline[2]).toMatchObject({ pin: 52, repeat: { each: 'month' } });
  expect(book.outline[0]).toMatchObject({ repeat: { each: 'week' } });
  expect(book.outline[0].children.map((c: { repeat: unknown }) => c.repeat)).toEqual([{ times: 1 }, { each: 'day', of: 'span' }, { times: 1 }]);
  await shot(app, `${device}-calendar-free-design`);
  // the last week's tracker (page 37): SUN 29 and MON 30, the other days blank
  for (let n = 41; n > 37; n--) { await page.focus('.stage-page'); await page.keyboard.press('ArrowLeft'); } // the stage is redrawn on every step
  await page.waitForFunction(() => document.querySelector('.where strong')?.textContent === 'Page 37');
  await shot(app, `${device}-november-last-week-tracker`);
  await showOutline(app);
  expect(await missingHelp(app)).toEqual([]);
  expect(await noOverflow(app)).toBe(true);
  if (app.touch) await hit(app, '.contents-close');

  // print: the dates reach the PDFs
  await nameOpen(app, 'November 2026');
  await hit(app, '.book-bar [data-key="book-export"]');
  await page.waitForSelector('dialog.export[open] [data-key="export-pdf"]');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 50_000 }), hit(app, '[data-key="export-pdf"]')]);
  const files = unzip(readFileSync((await download.path())!));
  const pages = await readPdf(files.get('pages.pdf')!);
  expect(pages).toHaveLength(52);
  expect(text(pages[1].strings)).toContain('SUN NOV 1'); // the first Daily Log
  expect(text(pages[2].strings)).toContain('MON NOV 2');
  expect(text(pages[37].strings)).toContain('SUN NOV 29'); // the last week's daily logs
  expect(text(pages[38].strings)).toContain('MON NOV 30');
  expect(text(pages[39].strings)).toContain('WEEK 49'); // and its reflection
  expect(text(pages[39].strings)).toContain('NOV 29-NOV 30');
  const tracker = pages[36].strings; // the last week's tracker: SUN 29, MON 30, and the days after the month blank
  expect(tracker).toEqual(expect.arrayContaining(['SUN', 'MON', 'TUE', 'SAT', '29', '30']));
  expect(tracker).not.toEqual(expect.arrayContaining(['5']));
  expect(tracker).not.toEqual(expect.arrayContaining(['2']));
  expect(pages[0].strings).toEqual(expect.arrayContaining(['SUN', '1', '2', '7'])); // the first week's
  expect(text(pages[51].strings)).toContain('NOVEMBER REVIEW'); // pinned to page 52
  expect(text(pages[40].strings)).toContain('BOOK NOTES'); // the design on the first free page
  expect(app.errors).toEqual([]);
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`the calendar on a ${device}`, () => {
    it('dates a week-by-week book from a November 2026 calendar, with a design on a free page, and prints the dates', async () => {
      await build(await open(env, device), device);
    });
  });
}
