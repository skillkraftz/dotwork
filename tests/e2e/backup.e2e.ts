import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { choose, hit, libraryItems, open, reload, seedPage, shot, start, stop, type App, type Device, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const BOX = [{ type: 'box', x: 0, y: 0, w: 5, h: 4 }, { type: 'rule', x1: 0, y1: 2, x2: 5, y2: 2 }];
const PAGE = { format: 'dotwork-page', version: 2, grid: { cols: 27, rows: 44, pitch_mm: 3 }, header: { number: 'outer', identity: '' }, elements: [{ type: 'box', x: 2, y: 3, w: 4, h: 4 }] };

/** Put a widget document in the Library store, and reload so the list picks it up. */
async function seedWidget(app: App, id: string, name: string) {
  await app.page.evaluate(async ([i, n, els]) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('dotwork', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('library', { keyPath: 'id' });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('library', 'readwrite');
        tx.objectStore('library').put({ id: i, kind: 'widget', name: n, updated: new Date().toISOString(), data: { elements: els } });
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, [id, name, BOX] as const);
  await reload(app);
}

async function openLibrary(app: App, tab: string) {
  await choose(app, 'edit', '#library');
  await app.page.waitForSelector('dialog.library.browser[open] .lib-card');
  await hit(app, `[data-tab="${tab}"]`);
}

/** Delete a card through its ⋯ menu, accepting the confirm. */
async function deleteCard(app: App, name: string) {
  app.page.once('dialog', (d) => void d.accept());
  await hit(app, `.lib-card[data-name="${name}"] .lib-more`);
  await hit(app, '.lib-menu [data-key="library-delete"]');
  await app.page.waitForSelector(`.lib-card[data-name="${name}"]`, { state: 'detached' });
}

const names = async (app: App) => (await libraryItems(app)).map((i) => `${i.kind}:${i.name}`).sort();

async function restoreFile(app: App, name: string, content: string) {
  await app.page.setInputFiles('input[data-key="library-restore-file"]', { name, mimeType: 'application/json', buffer: Buffer.from(content) });
  await app.page.waitForSelector('dialog.library.browser .lib-msg .problem');
}

for (const device of ['phone', 'desktop'] as Device[]) {
  describe(`backup and restore on a ${device}`, () => {
    it('backs up, loses a page and a widget, restores both; restoring twice adds nothing', async () => {
      const app = await open(env, device);
      const { page } = app;
      await seedPage(app, PAGE, 'Trip log');
      await seedWidget(app, 'w-notes', 'Notes box');
      const before = await names(app);
      expect(before).toEqual(expect.arrayContaining(['page:Trip log', 'widget:Notes box']));

      // back up
      await openLibrary(app, 'widgets');
      await page.waitForSelector('.lib-card[data-name="Notes box"]');
      await hit(app, '.lib-card[data-name="Notes box"] .lib-star');
      await shot(app, `backup-${device}-library`);
      const [download] = await Promise.all([page.waitForEvent('download'), hit(app, '[data-help="library-export"]')]);
      expect(download.suggestedFilename()).toMatch(/^dotwork-library-\d{4}-\d{2}-\d{2}\.json$/);
      const text = readFileSync(await download.path(), 'utf8');
      const file = JSON.parse(text);
      expect(file.items.map((i: { kind: string; name: string }) => `${i.kind}:${i.name}`)).toEqual(expect.arrayContaining(['page:Trip log', 'widget:Notes box']));
      expect(file.favorites).toEqual(['w-notes']);
      expect(Object.keys(file.printer.layouts).length).toBe(2);

      // delete the widget and the page
      await deleteCard(app, 'Notes box');
      await hit(app, '[data-tab="pages"]');
      await deleteCard(app, 'Trip log');
      expect((await names(app)).filter((n) => n === 'page:Trip log' || n === 'widget:Notes box')).toEqual([]);
      await page.evaluate(() => localStorage.setItem('dotwork.favorites', '[]'));

      // restore: both are back, with the favorite
      await restoreFile(app, download.suggestedFilename(), text);
      const summary = await page.innerText('dialog.library.browser .lib-msg');
      expect(summary).toMatch(/Added 2/);
      expect(await names(app)).toEqual(expect.arrayContaining(['page:Trip log', 'widget:Notes box']));
      await hit(app, '[data-tab="widgets"]');
      await page.waitForSelector('.lib-card[data-name="Notes box"]');
      expect(await page.locator('[data-help="library-star"][aria-pressed="true"]').count()).toBe(1);
      await shot(app, `restore-${device}-summary`);
      expect(await page.locator('.restore-printer').count()).toBe(0); // the same printer settings: nothing to ask

      // restore the same file again: nothing is added
      const count = (await libraryItems(app)).length;
      await restoreFile(app, download.suggestedFilename(), text);
      await page.waitForFunction(() => /Added 0\./.test(document.querySelector('dialog.library.browser .lib-msg')?.textContent ?? ''));
      expect(await page.innerText('dialog.library.browser .lib-msg')).toMatch(/Added 0\.\s*Skipped \d+ \(already here/);
      expect((await libraryItems(app)).length).toBe(count);
      expect((await names(app)).filter((n) => n === 'page:Trip log' || n === 'widget:Notes box')).toHaveLength(2);
      expect(app.errors).toEqual([]);
    });

    it('asks before replacing the printer settings, and the default is No', async () => {
      const app = await open(env, device);
      const { page } = app;
      await openLibrary(app, 'pages');
      const [download] = await Promise.all([page.waitForEvent('download'), hit(app, '[data-help="library-export"]')]);
      const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
      file.printer.creep_per_sheet_mm = 0.37;
      file.printer.layouts.letter_two_up.auto.inside.back_offset_x_mm = 1.5;
      const mine = await page.evaluate(() => localStorage.getItem('dotwork.printer'));

      await restoreFile(app, 'other-printer.json', JSON.stringify(file));
      await page.waitForSelector('.restore-printer');
      const question = await page.innerText('.restore-printer');
      expect(question).toContain('Replace your printer settings with the backup’s?');
      expect(question).toContain('0.37');
      await shot(app, `restore-${device}-printer-question`);
      if (app.touch) {
        const sizes = await page.locator('.restore-printer button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
      }
      // the Keep button is the first, primary one
      expect(await page.locator('.restore-printer button').first().innerText()).toBe('No, keep mine');
      expect(await page.evaluate(() => localStorage.getItem('dotwork.printer'))).toBe(mine); // asking changed nothing

      await hit(app, '[data-key="restore-printer-keep"]');
      expect(await page.evaluate(() => localStorage.getItem('dotwork.printer'))).toBe(mine);

      await restoreFile(app, 'other-printer.json', JSON.stringify(file));
      await page.waitForSelector('.restore-printer');
      await hit(app, '[data-key="restore-printer-replace"]');
      const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('dotwork.printer')))!);
      expect(stored.creep_per_sheet_mm).toBe(0.37);
      expect(stored.layouts.letter_two_up.auto.inside.back_offset_x_mm).toBe(1.5);
      expect(app.errors).toEqual([]);
    });

    it('a bad item is refused with its reason, and the rest comes back', async () => {
      const app = await open(env, device);
      const { page } = app;
      const file = {
        format: 'dotwork-library', version: 1, exported: '2026-10-26T00:00:00.000Z',
        items: [
          { id: 'ok', kind: 'widget', name: 'Fine', updated: '2026-10-26T00:00:00.000Z', data: { name: 'Fine', elements: BOX } },
          { id: 'bad', kind: 'widget', name: 'Broken', updated: '2026-10-26T00:00:00.000Z', data: { name: 'Broken', elements: [{ type: 'shade', x: 0, y: 0, w: 1, h: 1 }] } },
        ],
      };
      await openLibrary(app, 'widgets');
      await restoreFile(app, 'part.json', JSON.stringify(file));
      expect(await page.innerText('dialog.library.browser .lib-msg')).toMatch(/Added 1/);
      expect(await page.innerText('dialog.library.browser .lib-msg')).toMatch(/Refused 1/);
      expect(await page.locator('dialog.library.browser .lib-msg [data-help="copy-details"]').count()).toBe(1);
      expect(await names(app)).toContain('widget:Fine');
      expect(await names(app)).not.toContain('widget:Broken');
      expect(app.errors).toEqual([]);
    });
  });
}
