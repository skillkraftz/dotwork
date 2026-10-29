import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmAdd, hit, missingHelp, openDoc, openSettings, open, pickRow, shot, showOutline, start, stop, choose, togglePick, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const row = (app: App, key: string) => app.page.locator(`[data-block-row="${key}"]`);
const panel = (app: App, field: string) => app.page.locator(`.outline-settings [data-key="${field}"]`);
const used = (app: App) => app.page.locator('.book-total [data-key="book-used"]').innerText();

interface Card {
  tab: 'pages' | 'spreads' | 'blocks';
  name: string;
  /** The page type to choose on the card (its value), else the one suggested. */
  type?: string;
  /** How often to choose on the card (its value), else the one suggested. */
  often?: string;
  times?: number;
  /** The settings button that adds into a group, when the card goes there. */
  from?: string;
}

/** Add a block: Add…, the tab it is on, its card with the page type and how often set, and the card's Add. */
async function add(app: App, c: Card) {
  const { page } = app;
  const from = c.from ?? '[data-key="book-add"]';
  if (app.touch && (await page.locator('.book-contents').isVisible()) && !c.from) await hit(app, '.contents-close');
  await hit(app, from);
  await page.waitForSelector('dialog.picker[open] .design');
  await hit(app, `dialog.picker [data-tab="${c.tab}"]`);
  await hit(app, `dialog.picker .design[data-name="${c.name}"]`);
  const card = (field: string) => page.locator(`dialog.picker .design.open [data-key="${field}"]`);
  if (c.type !== undefined) { await card('add-dates').selectOption(c.type); await page.waitForTimeout(80); }
  if (c.often !== undefined) { await card('add-each').selectOption(c.often); await page.waitForTimeout(80); }
  if (c.times !== undefined) { await card('add-repeat').fill(String(c.times)); await card('add-repeat').dispatchEvent('change'); await page.waitForTimeout(80); }
  await confirmAdd(app);
  await page.waitForSelector('dialog.picker', { state: 'hidden' });
}

/** The text a page of the book shows: tap its row (a block's first page), then read the page on the stage. */
async function pageText(app: App, key: string, number: number) {
  await showOutline(app);
  await hit(app, `[data-block-row="${key}"] > .orow-line .orow-main`);
  await app.page.waitForFunction((n) => document.querySelector('.where strong')?.textContent === `Page ${n}`, number);
  if (app.touch) await hit(app, '.contents-close');
  const text = (await app.page.locator('.stage-page text').allTextContents()).join(' ').replace(/\s+/g, ' ');
  return text;
}

async function setCalendar(app: App, year: string, month: string) {
  const { page } = app;
  await choose(app, 'page', '#settings');
  await page.waitForSelector('dialog.settings[open]');
  await page.locator('[data-key="calendar-month"]').selectOption(month);
  await page.locator('[data-key="calendar-year"]').fill(year);
  await page.locator('[data-key="calendar-year"]').dispatchEvent('change');
}

async function build(app: App, device: Device) {
  const { page } = app;
  await hit(app, '#menu-page');
  await hit(app, '#view-book');
  await page.waitForSelector('.stage-page');

  // a November 2026 calendar, from the book's settings
  await setCalendar(app, '2026', '11');
  await hit(app, '[data-key="calendar-set"]');
  await page.waitForSelector('[data-key="calendar-remove"]');
  expect((await openDoc(app, 'book')).calendar).toEqual({ start: '2026-11-01', end: '2026-11-30', week_starts: 0 });
  await hit(app, 'dialog.settings header button');
  await page.waitForSelector('dialog.settings', { state: 'hidden' });

  // Lined (Plain), then a group twice of [week spread, week spread, daily logs to the end of the week, review, daily logs, review]
  await add(app, { tab: 'pages', name: 'Lined page', type: '' }); // it has a date in its header, so a Day page is suggested: make it Plain
  await add(app, { tab: 'blocks', name: 'New group', often: 'times', times: 2 });
  const into = '.outline-settings [data-key="outline-add-to-group"]';
  const inGroup = async (c: Card) => { await openSettings(app, '1'); await add(app, { ...c, from: into }); };
  await inGroup({ tab: 'spreads', name: 'Weekly spread' });
  await inGroup({ tab: 'spreads', name: 'Weekly spread' });
  await inGroup({ tab: 'pages', name: 'Daily Log' });
  await inGroup({ tab: 'pages', name: 'Weekly reflection', type: 'week-review' });
  await inGroup({ tab: 'pages', name: 'Daily Log' });
  await inGroup({ tab: 'pages', name: 'Weekly reflection', type: 'week-review' });

  // then a week spread, daily logs to the end of the week, a review, free pages and the month review pinned last
  await pickRow(app, '1');
  await togglePick(app, ['1']); // nothing picked: the next block goes at the end
  await add(app, { tab: 'spreads', name: 'Weekly spread', often: 'once' });
  await add(app, { tab: 'pages', name: 'Daily Log', often: 'to-week' });
  await add(app, { tab: 'pages', name: 'Weekly reflection', type: 'week-review' });
  await add(app, { tab: 'blocks', name: 'Free pages' });
  await add(app, { tab: 'pages', name: 'Patterns & takeaways', type: 'month-review' });
  await openSettings(app, '6');
  await hit(app, '.outline-settings [data-key="outline-pin-last"]');
  await page.waitForFunction(() => document.querySelector('[data-block-row="6"] .crow-name')?.textContent?.includes('pinned: last page'));

  const book = await openDoc(app, 'book');
  const kinds = (b: { dates?: string; repeat: unknown }) => [b.dates, b.repeat];
  expect(book.outline.map((b: { type: string }) => b.type)).toEqual(['page', 'group', 'spread', 'page', 'page', 'free', 'page']);
  expect(book.outline[1]).toMatchObject({ repeat: { times: 2 } });
  expect(book.outline[1].children.map(kinds)).toEqual([
    ['week', { times: 1 }], ['week', { times: 1 }], ['day', { to: 'week' }], ['week-review', { times: 1 }], ['day', { to: 'week' }], ['week-review', { times: 1 }],
  ]);
  expect([2, 3, 4, 6].map((i) => kinds(book.outline[i]))).toEqual([['week', { times: 1 }], ['day', { to: 'week' }], ['week-review', { times: 1 }], ['month-review', { times: 1 }]]);
  expect(book.outline[0].dates).toBeUndefined();
  expect(book.outline[6].pin).toBe('last');
  expect(await used(app)).toBe('52 of 52 pages');

  // the settings panel: Page type and How often
  await openSettings(app, '1.2');
  expect(await panel(app, 'outline-dates').inputValue()).toBe('day');
  expect(await panel(app, 'outline-each').inputValue()).toBe('to-week');
  expect(await panel(app, 'outline-each').locator('option').allInnerTexts()).toEqual(['Once', 'A number of times', 'To the end of the week', 'To the end of the month']);
  expect(await panel(app, 'outline-each-hint').count()).toBe(0);
  await shot(app, `${device}-page-types-settings`);

  // the outline: every dated row says the dates it covers
  await showOutline(app);
  const summary = (key: string) => row(app, key).locator('.crow-name').first().innerText();
  expect(await summary('1.0')).toContain('weeks 1, 3');
  expect(await summary('1.2')).toContain('Nov 1–7, 15–21');
  expect(await summary('1.4')).toContain('Nov 8–14, 22–28');
  expect(await summary('1.3')).toContain('weeks 1, 3');
  expect(await summary('3')).toContain('Nov 29–30');
  expect(await summary('6')).toContain('Nov');
  expect(await row(app, '1.3').locator('[data-key="row-reads"]').innerText()).toBe('reads: WEEK 45 NOV 1-NOV 7');
  await shot(app, `${device}-page-types-outline`);
  expect(await missingHelp(app)).toEqual([]);
  expect(await noOverflow(app)).toBe(true);

  // p.13 reads week 1, p.44 Nov 29, p.52 November
  expect(await pageText(app, '1.3', 13)).toContain('WEEK 45 NOV 1-NOV 7');
  expect(await pageText(app, '3', 44)).toContain('SUN NOV 29');
  expect(await pageText(app, '6', 52)).toContain('NOVEMBER REVIEW');

  // December 2026 starts on a Tuesday: the same outline, new dates
  await setCalendar(app, '2026', '12');
  await page.waitForFunction(() => document.querySelector('[data-key="calendar-summary"]')?.textContent?.includes('2026-12-31'));
  await hit(app, 'dialog.settings header button');
  await page.waitForSelector('dialog.settings', { state: 'hidden' });
  expect(await used(app)).toBe('52 of 52 pages');
  expect(await pageText(app, '1.2', 6)).toContain('TUE DEC 1');
  expect(await pageText(app, '3', 42)).toContain('SUN DEC 27');
  expect(app.errors).toEqual([]);
}

const devices: Device[] = process.env.SHOTS ? ['phone', 'tablet', 'desktop'] : ['phone', 'desktop'];
for (const device of devices) {
  describe(`page types on a ${device}`, () => {
    it('builds a week-by-week November 2026 book by hand from page types and how often, and re-dates it for December', async () => {
      await build(await open(env, device), device);
    }, 240_000);
  });
}
