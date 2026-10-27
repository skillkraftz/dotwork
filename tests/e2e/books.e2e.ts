import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, hit, libraryItems, missingHelp, open, openDoc, reload, shot, start, stop, waitSaved, type App, type Device, type Env } from './harness';
import { emptyBook, setSlot } from '../../src/book/book';
import { BUILTIN_PAGES } from '../../src/builtin/library';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const nameDialog = (app: App) => app.page.locator('dialog.ask[open]');
const status = (app: App) => app.page.innerText('#doc-status');
const bookNames = async (app: App) => (await libraryItems(app)).filter((i) => i.kind === 'book').map((i) => i.name).sort();

/** Show the Book view and wait until its document is open and written. */
async function goBook(app: App) {
  await choose(app, 'page', '#view-book');
  await app.page.waitForSelector('.stage-page');
  await app.page.waitForSelector('#docbar:not([hidden])');
  await waitSaved(app);
}

/** Put a design on the page being looked at, from the picker. */
async function pickDesign(app: App, name: string) {
  await hit(app, '[data-help="book-choose"]');
  await app.page.waitForSelector('dialog.picker[open] .design');
  await hit(app, `dialog.picker .design:has-text("${name}")`);
  await app.page.waitForSelector('dialog.picker', { state: 'hidden' });
}

async function answerName(app: App, name: string | null, cancel = false) {
  await nameDialog(app).waitFor({ state: 'visible' });
  if (cancel) { await hit(app, 'dialog.ask[open] button:not(.primary)'); return; }
  if (name !== null) await app.page.fill('[data-key="ask-name"]', name);
  await hit(app, 'dialog.ask[open] .primary');
  await nameDialog(app).waitFor({ state: 'hidden' });
}

async function renameTo(app: App, name: string) {
  await hit(app, '#doc-name');
  await app.page.fill('#doc-name-field', name);
  await app.page.press('#doc-name-field', 'Enter');
  await app.page.waitForSelector('#doc-name-field', { state: 'detached' });
  await waitSaved(app);
}

async function openFromLibrary(app: App, name: string, tab: string) {
  await choose(app, 'edit', '#library');
  await hit(app, `[data-tab="${tab}"]`);
  await app.page.waitForSelector(`.lib-card[data-name="${name}"]`);
  await hit(app, `.lib-card[data-name="${name}"] .lib-open`);
  await app.page.waitForSelector('dialog.library.browser', { state: 'hidden' });
}

/** Edit > New, and wait until another document is open. */
async function newDoc(app: App) {
  const before = await app.page.innerText('#doc-name');
  await choose(app, 'edit', '#new');
  await app.page.waitForFunction((b) => document.querySelector('#doc-name')?.textContent !== b, before);
}

async function importFile(app: App, name: string, text: string) {
  await hit(app, '#export');
  await app.page.waitForSelector('dialog.export[open]');
  await hit(app, 'dialog.export [data-tab="import"]');
  await app.page.setInputFiles('[data-key="import-file"]', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await app.page.waitForSelector('dialog.export', { state: 'hidden' });
}

const bookFile = (name: string) => {
  const b = emptyBook();
  b.name = name;
  setSlot(b, 1, BUILTIN_PAGES.find((p) => p.name === 'Lined page')!);
  return JSON.stringify(b);
};

for (const device of ['phone', 'tablet', 'desktop'] as Device[]) {
  describe(`books are documents on a ${device}`, () => {
    it('opens two books and switches between them without losing either', async () => {
      const app = await open(env, device);
      const { page } = app;
      await goBook(app);
      expect(await page.innerText('#doc-name')).toBe('Untitled: name it');
      await shot(app, `books-${device}-untitled-chip`);
      await pickDesign(app, 'Lined page');
      await waitSaved(app);
      await renameTo(app, 'Alpha');
      await shot(app, `books-${device}-saved`);
      expect(await status(app)).toBe('Saved');

      await newDoc(app); // Alpha is kept as it is
      expect(await page.innerText('#doc-name')).toBe('Untitled: name it');
      expect(await page.locator('.design-name strong').innerText()).not.toBe('Lined page'); // a blank book
      await pickDesign(app, 'Dot grid page');
      await renameTo(app, 'Beta');
      expect(await bookNames(app)).toEqual(['Alpha', 'Beta']);

      await openFromLibrary(app, 'Alpha', 'books');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Alpha');
      expect(await page.locator('.design-name strong').innerText()).toBe('Lined page');
      await openFromLibrary(app, 'Beta', 'books');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Beta');
      expect(await page.locator('.design-name strong').innerText()).toBe('Dot grid page');
      expect(await bookNames(app)).toEqual(['Alpha', 'Beta']);
      expect(await missingHelp(app)).toEqual([]);
      expect(app.errors).toEqual([]);
    });

    it('imports a book twice and gets two documents', async () => {
      const app = await open(env, device);
      const { page } = app;
      await importFile(app, 'field-notes.json', bookFile('Field notes'));
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Field notes');
      await importFile(app, 'field-notes.json', bookFile('Field notes'));
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Field notes 2');
      await waitSaved(app);
      expect(await bookNames(app)).toEqual(['Field notes', 'Field notes 2']);
      expect((await openDoc(app, 'book')).pages[0].name).toBe('Lined page');
      expect(app.errors).toEqual([]);
    });

    it('a built-in book that takes no options is read-only; editing it asks for a name and the copy has the edit; a reload brings it back Saved', async () => {
      const app = await open(env, device);
      const { page } = app;
      // a template with no questions opens what it builds, read-only
      await choose(app, 'edit', '#library');
      await hit(app, '[data-tab="books"]');
      await page.waitForSelector('.lib-card[data-name="Blank journal"]');
      await hit(app, '.lib-card[data-name="Blank journal"] .lib-open');
      await page.waitForSelector('dialog.template[open]');
      await hit(app, '[data-key="template-build"]');
      await page.waitForSelector('#builtin-bar:not([hidden])');
      await page.waitForSelector('.stage-page');
      expect(await page.innerText('#builtin-bar')).toContain('Built-in. Editing makes a copy.');
      const builtinName = await page.innerText('#doc-name'); // the template's own name
      expect(builtinName).toMatch(/blank journal/i);
      await shot(app, `books-${device}-builtin-bar`);
      const before = await bookNames(app);

      // cancelling leaves it as it was
      await pickDesign(app, 'Lined page');
      await nameDialog(app).waitFor({ state: 'visible' });
      expect(await page.inputValue('[data-key="ask-name"]')).toBe(`${builtinName} copy`);
      await answerName(app, null, true);
      expect(await bookNames(app)).toEqual(before);
      expect(await page.locator('#builtin-bar').isVisible()).toBe(true);

      // naming it makes the document and keeps the attempted edit
      await pickDesign(app, 'Lined page');
      await answerName(app, null);
      await page.waitForSelector('#builtin-bar', { state: 'hidden' });
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe(`${builtinName} copy`);
      const copy = await openDoc(app, 'book');
      expect(copy.name).toBe(`${builtinName} copy`);
      expect(copy.pages[0].name).toBe('Lined page');

      await reload(app);
      await page.waitForSelector('.stage-page');
      await page.waitForFunction((n) => document.querySelector('#doc-name')?.textContent === n, `${builtinName} copy`);
      await waitSaved(app);
      expect(await status(app)).toBe('Saved');
      expect(await page.locator('.design-name strong').innerText()).toBe('Lined page');
      expect(app.errors).toEqual([]);
    });

    it('a book built from a template with options is a document at once: editable, saved, and there after a reload', async () => {
      const app = await open(env, device);
      const { page } = app;
      await choose(app, 'edit', '#library');
      await hit(app, '[data-tab="books"]');
      await page.waitForSelector('.lib-card[data-name="Year planner"]');
      await hit(app, '.lib-card[data-name="Year planner"] .lib-open');
      await page.waitForSelector('dialog.template[open]');
      await page.fill('[data-key="template-year"]', '2026');
      await hit(app, '[data-key="template-build"]');
      await page.waitForSelector('.stage-page');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === '2026 year planner');
      expect(await page.locator('#builtin-bar').isVisible()).toBe(false);
      await waitSaved(app);
      expect((await libraryItems(app)).map((i) => i.name)).toContain('2026 year planner');

      // editing needs no name and no copy: it is written as it is made
      await pickDesign(app, 'Lined page');
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe('2026 year planner');
      const edited = await openDoc(app, 'book');
      expect(edited.pages[0].name).toBe('Lined page');
      await shot(app, `books-${device}-template-document`);

      await reload(app);
      await page.waitForSelector('.stage-page');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === '2026 year planner');
      await waitSaved(app);
      expect((await openDoc(app, 'book')).pages[0].name).toBe('Lined page');
      expect(app.errors).toEqual([]);
    });

    it('asks for a name before the first export of an Untitled book, as it does for a page', async () => {
      const app = await open(env, device);
      const { page } = app;
      await goBook(app);
      await pickDesign(app, 'Lined page');
      await hit(app, '#export');
      await page.waitForSelector('dialog.export[open]');
      await hit(app, 'dialog.export [data-tab="export"]');
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        (async () => { await hit(app, '[data-key="export-json"]'); await answerName(app, 'Trip log'); })(),
      ]);
      expect(file.suggestedFilename()).toBe('trip-log.json');
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe('Trip log');
      expect(app.errors).toEqual([]);
    });

    it('asks for a name before the print zip of an Untitled book', async () => {
      const app = await open(env, device);
      const { page } = app;
      await goBook(app);
      await hit(app, '#export');
      await page.waitForSelector('dialog.export[open]');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await hit(app, '[data-key="export-pdf"]');
      await answerName(app, null, true);
      expect(await page.locator('dialog.export [data-key="export-pdf"]').isEnabled()).toBe(true); // nothing is running
      expect(await page.innerText('#doc-name')).toBe('Untitled: name it');
    });

    it('New, then switching away without drawing, leaves no empty Untitled behind', async () => {
      const app = await open(env, device);
      const { page } = app;
      // pages
      await hit(app, '#doc-name');
      await page.fill('#doc-name-field', 'Keeper');
      await page.press('#doc-name-field', 'Enter');
      await waitSaved(app);
      await newDoc(app);
      expect((await libraryItems(app)).filter((i) => i.kind === 'page').map((i) => i.name).sort()).toEqual(['Keeper', 'Untitled']);
      await openFromLibrary(app, 'Keeper', 'pages');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Keeper');
      await waitSaved(app);
      expect((await libraryItems(app)).filter((i) => i.kind === 'page').map((i) => i.name)).toEqual(['Keeper']);

      // books
      await goBook(app);
      await pickDesign(app, 'Lined page');
      await renameTo(app, 'Kept book');
      await newDoc(app);
      expect(await bookNames(app)).toEqual(['Kept book', 'Untitled']);
      await openFromLibrary(app, 'Kept book', 'books');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Kept book');
      await waitSaved(app);
      expect(await bookNames(app)).toEqual(['Kept book']);
      expect(app.errors).toEqual([]);
    });

    it('sections are listed with Rename, Duplicate, Delete and Export, and Import adds them', async () => {
      const app = await open(env, device);
      const { page } = app;
      const section = JSON.stringify({ format: 'dotwork-section', version: 1, name: 'Week', pages: [null, null], days: [0, 1], weekday: 1, move: 'week', left: false });
      await importFile(app, 'week.json', section);
      await importFile(app, 'week.json', section);
      await waitSaved(app);
      expect((await libraryItems(app)).filter((i) => i.kind === 'section').map((i) => i.name).sort()).toEqual(['Week', 'Week 2']);

      await choose(app, 'edit', '#library');
      await hit(app, '[data-tab="sections"]');
      await page.waitForSelector('.lib-card[data-name="Week"]');
      await hit(app, '.lib-card[data-name="Week"] .lib-more');
      await page.waitForSelector('.lib-menu');
      expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Rename', 'Duplicate', 'Export', 'Delete']);
      expect(await missingHelp(app)).toEqual([]);

      const [file] = await Promise.all([page.waitForEvent('download'), hit(app, '.lib-menu [data-key="library-export-section"]')]);
      expect(file.suggestedFilename()).toBe('week.json');

      await hit(app, '.lib-card[data-name="Week"] .lib-more');
      await hit(app, '.lib-menu [data-key="library-duplicate"]');
      await answerName(app, 'Week again');
      await page.waitForSelector('.lib-card[data-name="Week again"]');

      await hit(app, '.lib-card[data-name="Week 2"] .lib-more');
      page.once('dialog', (d) => void d.accept());
      await hit(app, '.lib-menu [data-key="library-delete"]');
      await page.waitForSelector('.lib-card[data-name="Week 2"]', { state: 'detached' });
      expect((await libraryItems(app)).filter((i) => i.kind === 'section').map((i) => i.name).sort()).toEqual(['Week', 'Week again']);
      expect(app.errors).toEqual([]);
    });
  });

  describe(`a browser that can’t keep documents, on a ${device}`, () => {
    it('says so at the top, works from memory, never shows Saved, and makes Export prominent', async () => {
      const app = await open(env, device, { noStorage: true });
      const { page } = app;
      const warning = page.locator('#keep-warning');
      await warning.waitFor({ state: 'visible' });
      expect(await warning.innerText()).toContain('can’t keep your documents');
      expect(await page.locator('#export').evaluate((el) => el.classList.contains('attention'))).toBe(true);
      expect(await status(app)).toBe('Not saved');
      await shot(app, `books-${device}-cant-keep`);

      // it still works: rename, and the book view
      await renameTo(app, 'Scratch').catch(() => {});
      await page.waitForTimeout(700);
      expect(await status(app)).not.toBe('Saved');
      await choose(app, 'page', '#view-book');
      await page.waitForSelector('.stage-page');
      await page.waitForSelector('#docbar:not([hidden])');
      expect(await warning.isVisible()).toBe(true);
      await page.waitForTimeout(700);
      expect(await status(app)).not.toBe('Saved');
      expect(await missingHelp(app)).toEqual([]);

      // the notice's Export opens the export window
      await hit(app, '#keep-export');
      await page.waitForSelector('dialog.export[open]');
      expect(app.errors).toEqual([]);
    });
  });
}
