import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cellToClient, choose, drag, hit, libraryItems, missingHelp, open, openDoc, reload, shot, start, stop, tool, waitSaved, type App, type Device, type Env,
} from './harness';

import { emptyPage } from '../../src/format/types';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const status = (app: App) => app.page.innerText('#doc-status');
const nameDialog = (app: App) => app.page.locator('dialog.ask[open]');

/** Draw one box on the page being edited. */
async function drawBox(app: App, from: [number, number] = [3, 4], to: [number, number] = [8, 9]) {
  await tool(app, 'box');
  await drag(app, await cellToClient(app, ...from), await cellToClient(app, ...to));
}

/** Answer the small name window: type a name (or keep what is there) and Save, or Cancel. */
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
}

async function openFromLibrary(app: App, name: string, tab = 'pages') {
  await choose(app, 'edit', '#library');
  await hit(app, `[data-tab="${tab}"]`);
  await app.page.waitForSelector(`.lib-card[data-name="${name}"]`);
  await hit(app, `.lib-card[data-name="${name}"] .lib-open`);
  await app.page.waitForSelector('dialog.library.browser', { state: 'hidden' });
}

async function exportTab(app: App, tab: 'import' | 'export' | 'png') {
  await hit(app, '#export');
  await app.page.waitForSelector('dialog.export[open]');
  await hit(app, `dialog.export [data-tab="${tab}"]`);
}

const pageFile = (name: string, x: number) => JSON.stringify({ ...emptyPage(), name, elements: [{ type: 'box', x, y: 3, w: 4, h: 3 }] });

for (const device of ['phone', 'tablet', 'desktop'] as Device[]) {
  describe(`documents on a ${device}`, () => {
    it('keeps what is drawn: reload and it is there, under its name, Saved', async () => {
      const app = await open(env, device);
      const { page } = app;
      // a new document is Untitled, and says so
      expect(await page.innerText('#doc-name')).toBe('Untitled: name it');
      await drawBox(app);
      await waitSaved(app);
      expect(await status(app)).toBe('Saved');
      await renameTo(app, 'Garden');
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe('Garden');
      expect(await page.locator('#doc-name .doc-chip').count()).toBe(0);
      await shot(app, `documents-${device}-saved`);
      await reload(app);
      expect(await page.innerText('#doc-name')).toBe('Garden');
      await waitSaved(app);
      const doc = await openDoc(app, 'page');
      expect(doc.name).toBe('Garden');
      expect(doc.elements).toMatchObject([{ type: 'box' }]);
      // the entry holds the name; the data holds none
      expect('name' in (await libraryItems(app)).find((i) => i.name === 'Garden')!.data).toBe(false);
      expect(await missingHelp(app)).toEqual([]);
      expect(app.errors).toEqual([]);
    });

    it('the Untitled chip renames in place and the name dialog numbers Untitled 2', async () => {
      const app = await open(env, device);
      const { page } = app;
      await shot(app, `documents-${device}-untitled-chip`);
      await drawBox(app); // an empty Untitled is not kept, so draw before starting another
      await waitSaved(app);
      await choose(app, 'edit', '#new');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Untitled 2: name it');
      await waitSaved(app);
      expect((await libraryItems(app)).filter((i) => i.kind === 'page').map((i) => i.name).sort()).toEqual(['Untitled', 'Untitled 2']);
      // a name already used gets 2 added
      await renameTo(app, 'Untitled');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Untitled 2: name it');
      await renameTo(app, 'Ideas jar');
      await renameTo(app, 'Ideas jar'); // renaming to its own name changes nothing
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Ideas jar');
      await renameTo(app, 'Weekly reflection'); // a built-in's name counts as taken
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Weekly reflection 2');
      expect(app.errors).toEqual([]);
    });

    it('a built-in opens read-only; editing it asks for a name and the copy has the edit', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openFromLibrary(app, 'Questions');
      await page.waitForSelector('#builtin-bar:not([hidden])');
      expect(await page.innerText('#builtin-bar')).toContain('Built-in. Editing makes a copy.');
      expect(await page.innerText('#doc-name')).toBe('Questions');
      await shot(app, `documents-${device}-builtin-bar`);
      const before = await libraryItems(app);
      const builtinCount = (await page.evaluate(() => document.querySelectorAll('#canvas *').length));
      expect(builtinCount).toBeGreaterThan(0);

      // cancelling leaves it as it was
      await drawBox(app, [2, 20], [6, 24]);
      await nameDialog(app).waitFor({ state: 'visible' });
      expect(await page.inputValue('[data-key="ask-name"]')).toBe('Questions copy');
      await shot(app, `documents-${device}-copy-name`);
      await answerName(app, null, true);
      expect((await libraryItems(app)).length).toBe(before.length);
      expect(await page.locator('#builtin-bar').isVisible()).toBe(true);

      // naming it makes the document and keeps the attempted edit
      await drawBox(app, [2, 20], [6, 24]);
      await answerName(app, null);
      await page.waitForSelector('#builtin-bar', { state: 'hidden' });
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe('Questions copy');
      const copy = await openDoc(app, 'page');
      const original = (await import('../../src/builtin/library')).BUILTIN_PAGES.find((p) => p.name === 'Questions')!;
      expect(copy.name).toBe('Questions copy');
      expect(copy.elements).toHaveLength(original.elements.length + 1);
      expect(copy.elements[copy.elements.length - 1]).toMatchObject({ type: 'box' });
      expect((await libraryItems(app)).length).toBe(before.length + 1);
      expect(app.errors).toEqual([]);
    });

    it('Edit a copy asks for a name too, and carries on in the copy', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openFromLibrary(app, 'Weekly reflection');
      await hit(app, '#doc-copy');
      await nameDialog(app).waitFor({ state: 'visible' });
      expect(await page.inputValue('[data-key="ask-name"]')).toBe('Weekly reflection copy');
      await answerName(app, 'My reflection');
      await page.waitForSelector('#builtin-bar', { state: 'hidden' });
      await waitSaved(app);
      expect((await openDoc(app, 'page')).name).toBe('My reflection');
      await reload(app);
      expect(await page.innerText('#doc-name')).toBe('My reflection');
    });

    it('reopens a built-in after a reload, still read-only', async () => {
      const app = await open(env, device);
      await openFromLibrary(app, 'Questions');
      await app.page.waitForSelector('#builtin-bar:not([hidden])');
      await reload(app);
      expect(await app.page.innerText('#doc-name')).toBe('Questions');
      expect(await app.page.locator('#builtin-bar').isVisible()).toBe(true);
    });

    it('asks for a name before the first export of an Untitled page', async () => {
      const app = await open(env, device);
      const { page } = app;
      await drawBox(app);
      await exportTab(app, 'export');
      const download = page.waitForEvent('download');
      await hit(app, '[data-key="export-json"]');
      await nameDialog(app).waitFor({ state: 'visible' });
      expect(await page.inputValue('[data-key="ask-name"]')).toBe('Untitled');
      await shot(app, `documents-${device}-export-name`);
      await answerName(app, 'Sketch');
      const file = await download;
      expect(file.suggestedFilename()).toBe('sketch.json');
      const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8'));
      expect(exported).toMatchObject({ format: 'dotwork-page', name: 'Sketch' });
      await waitSaved(app);
      expect(await openDoc(app, 'page')).toEqual(exported);
      // named now, so the next export does not ask
      const again = page.waitForEvent('download');
      await hit(app, '[data-key="export-json"]');
      await again;
      expect(await nameDialog(app).isVisible()).toBe(false);
    });

    it('imports the same page twice as two documents, named from the file', async () => {
      const app = await open(env, device);
      const { page } = app;
      for (let i = 0; i < 2; i++) {
        await exportTab(app, 'import');
        await page.setInputFiles('[data-key="import-file"]', { name: 'weekly.json', mimeType: 'application/json', buffer: Buffer.from(pageFile('Weekly', 5)) });
        await page.waitForSelector('dialog.export', { state: 'hidden' });
      }
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Weekly 2');
      await waitSaved(app);
      const names = (await libraryItems(app)).filter((i) => i.kind === 'page').map((i) => i.name).sort();
      expect(names).toEqual(['Weekly', 'Weekly 2']); // the empty Untitled it started with was not kept
      expect((await openDoc(app, 'page')).elements).toMatchObject([{ type: 'box', x: 5 }]);
    });

    it('switching between two pages and back keeps both', async () => {
      const app = await open(env, device);
      const { page } = app;
      await drawBox(app);
      await renameTo(app, 'First');
      await choose(app, 'edit', '#new'); // no waiting for the pause: the first is written before the switch
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Untitled: name it');
      await drawBox(app, [2, 10], [6, 14]);
      await drawBox(app, [10, 10], [14, 14]);
      await renameTo(app, 'Second');
      await openFromLibrary(app, 'First');
      await waitSaved(app);
      expect(await page.innerText('#doc-name')).toBe('First');
      expect((await openDoc(app, 'page')).elements).toHaveLength(1);
      await openFromLibrary(app, 'Second');
      await waitSaved(app);
      expect((await openDoc(app, 'page')).elements).toHaveLength(2);
      const items = await libraryItems(app);
      expect(items.find((i) => i.name === 'First')!.data.elements).toHaveLength(1);
      expect(items.find((i) => i.name === 'Second')!.data.elements).toHaveLength(2);
      expect(app.errors).toEqual([]);
    });

    it('Export JSON is the page as it is now, before the pause is over', async () => {
      const app = await open(env, device);
      const { page } = app;
      await renameTo(app, 'Now');
      await drawBox(app);
      await exportTab(app, 'export');
      const download = page.waitForEvent('download');
      await hit(app, '[data-key="export-json"]');
      const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await (await download).path())!, 'utf8'));
      expect(exported.elements).toMatchObject([{ type: 'box' }]);
      expect(exported.name).toBe('Now');
      await page.keyboard.press('Escape');
      await waitSaved(app);
      expect(await openDoc(app, 'page')).toEqual(exported); // what was exported is what was kept
    });

    it('the PNG tab says in one line that a page prints the sample date and number', async () => {
      const app = await open(env, device);
      await exportTab(app, 'png');
      expect(await app.page.innerText('dialog.export .export-body')).toContain('sample date (Mon 26 Oct 2026) and page number (47)');
    });

    it('saves a spread as one document, and switches views without losing either', async () => {
      const app = await open(env, device);
      const { page } = app;
      await drawBox(app);
      await choose(app, 'page', '#view-spread');
      await page.waitForFunction(() => document.querySelector('#doc-name')?.textContent === 'Untitled: name it');
      await tool(app, 'box');
      await drag(app, await cellToClient(app, 3, 4, '#canvas-left'), await cellToClient(app, 8, 9, '#canvas-left'));
      await renameTo(app, 'Pair');
      await waitSaved(app);
      expect((await openDoc(app, 'spread')).left.elements).toHaveLength(1);
      await reload(app);
      expect(await page.innerText('#doc-name')).toBe('Pair');
      await choose(app, 'page', '#view-page');
      await waitSaved(app);
      expect((await openDoc(app, 'page')).elements).toHaveLength(1);
      expect(app.errors).toEqual([]);
    });
  });
}

for (const device of ['phone', 'tablet', 'desktop'] as Device[]) {
  describe(`saving, honestly (${device})`, () => {
  it('a write the browser refuses shows Not saved with the real reason and Retry, never Saved', async () => {
    const app = await open(env, device);
    const { page } = app;
    await waitSaved(app);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).__put = put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    });
    await drawBox(app);
    await page.waitForFunction(() => document.querySelector('#doc-status')?.textContent === 'Not saved');
    expect(await page.locator('#doc-retry').isVisible()).toBe(true);
    const notice = page.locator('#notice');
    await notice.waitFor({ state: 'visible' });
    expect(await notice.innerText()).toContain('storage is full');
    await shot(app, `documents-${device}-not-saved`);
    await notice.locator('[data-key="copy-details"]').click();
    await page.waitForFunction(() => /Copied|Couldn’t copy/.test(document.querySelector('#notice [data-key="copy-details"]')!.textContent!));
    await page.waitForTimeout(1200);
    expect(await status(app)).toBe('Not saved'); // it does not turn into Saved by itself
    await hit(app, '#doc-retry');
    await page.waitForTimeout(200);
    expect(await status(app)).toBe('Not saved'); // still full
    await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__put; });
    await hit(app, '#doc-retry');
    await waitSaved(app);
    expect(await notice.isVisible()).toBe(false);
    expect((await openDoc(app, 'page')).elements).toMatchObject([{ type: 'box' }]);
  });

  it('writes after a pause, and at once when the tab is hidden', async () => {
    const app = await open(env, device);
    const { page } = app;
    await waitSaved(app);
    // the 400 ms pause never ends on its own here, so only the hide can write
    await page.evaluate(() => {
      const set = window.setTimeout.bind(window);
      (window as any).setTimeout = (fn: TimerHandler, ms?: number, ...rest: unknown[]) => set(fn, ms === 400 ? 1e9 : ms, ...rest);
    });
    await drawBox(app);
    await page.waitForTimeout(700);
    expect(await status(app)).toBe('Saving…');
    expect((await libraryItems(app))[0].data.elements).toEqual([]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await waitSaved(app);
    expect((await libraryItems(app))[0].data.elements).toMatchObject([{ type: 'box' }]);
  });
  });
}
