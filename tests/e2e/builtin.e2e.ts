import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, hit, libraryItems, missingHelp, open, openDoc, shot, start, stop, waitSaved, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
/**
 * The book a template built. One with questions is a document already. One without opens read-only, so it is not in the
 * Library yet; take Edit a copy to read what was built (the copy's name loses its " copy").
 */
const savedBook = async (app: App) => {
  await app.page.waitForSelector('#doc-name');
  if (await app.page.locator('#builtin-bar').isVisible()) {
    await hit(app, '#doc-copy');
    await app.page.waitForSelector('dialog.ask[open]');
    await hit(app, 'dialog.ask[open] .primary');
    await app.page.waitForSelector('#builtin-bar', { state: 'hidden' });
  }
  await waitSaved(app);
  const book = await openDoc(app, 'book');
  return { ...book, name: book.name.replace(/ copy$/, '') };
};

async function openLibrary(app: App) {
  await choose(app, 'edit', '#library');
  await app.page.waitForSelector('dialog.library.browser[open] .lib-card');
}

async function smallControls(app: App, scope: string) {
  return app.page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} input[type="text"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

/** Open the library on its Books tab and take a template through its questions. */
async function build(app: App, template: string, answers: Record<string, string> = {}) {
  await openLibrary(app);
  await hit(app, '[data-tab="books"]');
  await app.page.waitForSelector(`.lib-card[data-name="${template}"]`);
  await hit(app, `.lib-card[data-name="${template}"] .lib-open`);
  await app.page.waitForSelector('dialog.template[open]');
  for (const [key, value] of Object.entries(answers)) await app.page.fill(`[data-key="template-${key}"]`, value);
  return app.page.locator('dialog.template');
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`the built-in library on a ${device}`, () => {
    it('fills every tab, marks the examples and never changes one', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openLibrary(app);
      const tabs: [string, string[]][] = [['pages', ['Weekly reflection', 'Daily Log', 'week tracker checklist']], ['spreads', ['Book notes', 'Daily Log Spread', 'Idea variations']], ['books', ['Monthly journal']], ['widgets', ['Mood scale', 'Engagement gauge', 'Energy gauge']]];
      for (const [tab, names] of tabs) {
        await hit(app, `[data-tab="${tab}"]`);
        for (const name of names) await page.waitForSelector(`.lib-card[data-name="${name}"]`);
        await shot(app, `library-${device}-${tab}`);
      }
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await smallControls(app, 'dialog.library.browser')).toEqual([]);

      // an example's menu can only copy it; Duplicate asks for a name, prefilled
      await hit(app, '[data-tab="pages"]');
      await page.waitForSelector('.lib-card[data-name="Questions"]');
      await hit(app, '.lib-card[data-name="Questions"] .lib-more');
      await page.waitForSelector('.lib-menu');
      expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Duplicate']);
      await hit(app, '.lib-menu button');
      await page.waitForSelector('dialog.ask[open]');
      expect(await page.inputValue('[data-key="ask-name"]')).toBe('Questions copy');
      await hit(app, 'dialog.ask .primary');
      await page.waitForSelector('.lib-card[data-name="Questions copy"]');

      // opening one is read-only: nothing is created until it is edited
      const before = (await libraryItems(app)).filter((i) => i.name === 'Questions').length;
      await hit(app, '.lib-card[data-name="Questions"] .lib-open');
      await page.waitForSelector('dialog.library.browser', { state: 'hidden' });
      await page.waitForSelector('#builtin-bar:not([hidden])');
      expect(await page.innerText('#doc-name')).toBe('Questions');
      expect(await page.innerText('#builtin-bar')).toContain('Built-in. Editing makes a copy.');
      expect((await libraryItems(app)).filter((i) => i.name === 'Questions').length).toBe(before); // still no document named Questions
      noErrors(app);
    });

    it('builds a dated year planner from its questions', async () => {
      const app = await open(env, device);
      const dialog = await build(app, 'Year planner', { year: '2026', first: '43', last: '52' });
      expect(await dialog.locator('input').count()).toBe(3);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await smallControls(app, 'dialog.template')).toEqual([]);
      await shot(app, `template-${device}-questions`);
      // a stepper moves the last week and stays in range
      await hit(app, '[data-key="template-last-inc"]');
      expect(await app.page.inputValue('[data-key="template-last"]')).toBe('52');
      await hit(app, '[data-key="template-first-dec"]');
      expect(await app.page.inputValue('[data-key="template-first"]')).toBe('42');
      await hit(app, '[data-key="template-first-inc"]');
      await hit(app, '[data-key="template-build"]');
      await app.page.waitForSelector('.stage-page');
      const book = await savedBook(app);
      expect(book.name).toBe('2026 year planner');
      expect(book.page_count).toBe(52);
      expect(book.dates.slice(0, 2)).toEqual(['2026-10-18', '2026-10-25']);
      await shot(app, `book-${device}-year-planner`);
      noErrors(app);
    });

    it.each([
      ['Monthly journal', { year: '2027', month: '2' }, 'FEBRUARY 2027 journal'],
      ['Idea book', {}, 'Idea book'],
    ] as const)('builds the %s', async (template, answers, name) => {
      const app = await open(env, device);
      await build(app, template, answers);
      await hit(app, '[data-key="template-build"]');
      await app.page.waitForSelector('.stage-page');
      const book = await savedBook(app);
      expect(book.name).toBe(name);
      expect(book.page_count).toBe(52);
      expect(book.pages.filter(Boolean)).toHaveLength(52);
      expect(book.cover.front && book.cover.back).toBeTruthy();
      await shot(app, `book-${device}-${template.toLowerCase().replace(/ /g, '-')}`);
      noErrors(app);
    });
  });
}
