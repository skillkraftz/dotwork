import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { box, cellToClient, choose, draft, drag, hit, open, shot, start, stop, tap, tool, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const noErrors = (app: App) => expect(app.errors).toEqual([]);
const visible = (app: App, sel: string) => app.page.locator(sel).isVisible();
const pageData = (app: App) => draft(app) as Promise<{ elements: Record<string, unknown>[]; identity?: string; page_number?: boolean; name: string }>;
const closeDialog = (app: App, dialog: string) => hit(app, `dialog.${dialog} header button`);

/** Every visible control in the open menus and windows is finger-sized (a hair of slack for rounding). */
async function smallControls(app: App, scope: string) {
  return app.page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} select, ${sel} input:not([type="checkbox"]):not([type="radio"]):not([type="file"])`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

for (const device of ['phone', 'tablet', 'desktop'] as const) {
  describe(`the three menus (${device})`, () => {
    it('Page switches views and shows the current one; Settings opens the settings', async () => {
      const app = await open(env, device);
      const { page } = app;
      expect((await page.locator('#menu-page').innerText()).replace('▾', '').trim()).toBe('Page');
      expect(await visible(app, '#list-page')).toBe(false);
      await hit(app, '#menu-page');
      expect(await page.locator('#list-page button').allInnerTexts()).toEqual(['Page', 'Spread', 'Book', 'Settings…']);
      expect(await page.locator('#view-page').getAttribute('aria-checked')).toBe('true');
      expect(await smallControls(app, '#list-page')).toEqual([]);
      await shot(app, `${device}-menu-page`);

      await hit(app, '#view-spread');
      expect(await visible(app, '#list-page')).toBe(false); // choosing closes it
      expect((await page.locator('#menu-page').innerText()).replace('▾', '').trim()).toBe('Spread');
      expect(await visible(app, device === 'desktop' ? '#spread' : '#canvas-left')).toBe(true);

      await choose(app, 'page', '#view-book');
      await page.waitForSelector('.stage-page');
      expect((await page.locator('#menu-page').innerText()).replace('▾', '').trim()).toBe('Book');
      await hit(app, '#menu-page');
      expect(await page.locator('#view-book').getAttribute('aria-checked')).toBe('true');
      await hit(app, '#settings');
      await page.waitForSelector('dialog.settings[open]');
      expect(await page.locator('dialog.settings h2').textContent()).toBe('Book settings');
      await closeDialog(app, 'settings');
      noErrors(app);
    });

    it('Edit holds Edit, Preview, Library and New; one menu is open at a time; tapping outside closes it', async () => {
      const app = await open(env, device);
      const { page } = app;
      await hit(app, '#menu-edit');
      expect(await page.locator('#list-edit button').allInnerTexts()).toEqual(['Edit', 'Preview', 'Library…', 'New']);
      expect(await page.locator('#mode-edit').getAttribute('aria-checked')).toBe('true');
      expect(await smallControls(app, '#list-edit')).toEqual([]);
      await shot(app, `${device}-menu-edit`);

      // opening the other one closes this one
      await hit(app, '#menu-page');
      expect(await visible(app, '#list-edit')).toBe(false);
      expect(await visible(app, '#list-page')).toBe(true);
      // a tap on the page, outside the menu, closes it
      await tap(app, await cellToClient(app, 10, 20));
      expect(await visible(app, '#list-page')).toBe(false);
      expect(await page.locator('#menu-page').getAttribute('aria-expanded')).toBe('false');
      // Escape closes it too
      await hit(app, '#menu-edit');
      await page.keyboard.press('Escape');
      expect(await visible(app, '#list-edit')).toBe(false);

      // Preview takes the tools away; Edit brings them back
      await choose(app, 'edit', '#mode-preview');
      expect(await visible(app, '#tools')).toBe(false);
      await hit(app, '#menu-edit');
      expect(await page.locator('#mode-preview').getAttribute('aria-checked')).toBe('true');
      await hit(app, '#mode-edit');
      expect(await visible(app, '#tools')).toBe(true);

      // New: a blank page
      await tool(app, 'box');
      await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 9, 8));
      expect((await pageData(app)).elements).toHaveLength(1);
      await choose(app, 'edit', '#new');
      expect((await pageData(app)).elements).toEqual([]);
      noErrors(app);
    });

    it('Export opens the export window directly, and undo, redo and help stay as icons', async () => {
      const app = await open(env, device);
      const { page } = app;
      for (const id of ['#undo', '#redo', '#help']) expect(await page.locator(`${id} .ico`).isVisible(), id).toBe(true);
      await hit(app, '#export');
      await page.waitForSelector('dialog.export[open]');
      expect(await visible(app, '#list-page')).toBe(false);
      await closeDialog(app, 'export');
      noErrors(app);
    });
  });
}

describe('the settings window', () => {
  it('starts with an empty identity and a gray example, then follows what is typed', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    expect((await pageData(app)).identity).toBeUndefined();
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    expect(await page.locator('dialog.settings h2').textContent()).toBe('Page settings');
    const identity = page.locator('[data-key="settings-identity-page"]');
    expect(await identity.inputValue()).toBe('');
    expect(await identity.getAttribute('placeholder')).toBe('{weekday} {month} {day}');
    expect(await page.locator('[data-key="settings-name-page"]').inputValue()).toBe('Untitled');

    await page.locator('[data-key="settings-name-page"]').fill('My page');
    await identity.fill('MON {day}');
    await page.waitForTimeout(50);
    expect(await pageData(app)).toMatchObject({ name: 'My page', identity: 'MON {day}' });
    await identity.fill('');
    expect((await pageData(app)).identity).toBeUndefined(); // emptied: out of the file
    await identity.fill('{nonsense}');
    expect(await page.locator('dialog.settings .warn').innerText()).toContain('Unknown token');
    await identity.fill('');
    await page.locator('[data-key="settings-side"]').selectOption('left');
    expect(await pageData(app)).toMatchObject({ side: 'left' });
    noErrors(app);
  });

  it('turns the page number on and off', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    const numbers = () => page.locator('#canvas text', { hasText: /^47$/ }).count();
    expect(await numbers()).toBe(1);
    await choose(app, 'page', '#settings');
    const toggle = page.locator('[data-key="settings-number-page"]');
    expect(await toggle.isChecked()).toBe(true);
    await toggle.click();
    expect((await pageData(app)).page_number).toBe(false);
    expect(await numbers()).toBe(0);
    await toggle.click();
    expect((await pageData(app)).page_number).toBeUndefined(); // back to the default
    expect(await numbers()).toBe(1);
    noErrors(app);
  });

  it('frees row 0 when the identity is empty, except the page number corner, and refuses changes that would break it', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    // empty identity: drawing starts in row 0
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 0), await cellToClient(app, 9, 3));
    expect((await pageData(app)).elements).toMatchObject([{ type: 'box', x: 3, y: 0 }]);
    // the page number's corner (right side, x 25 to 27) is kept clear
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 24, 0), await cellToClient(app, 27, 3));
    expect((await pageData(app)).elements).toHaveLength(1);
    expect(await page.locator('#notice').innerText()).toContain('page number');

    // an identity would take row 0 back: refused while something is drawn there
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-identity-page"]').fill('MON');
    expect(await page.locator('dialog.settings .fmsg:not([hidden])').innerText()).toContain('row 0');
    expect((await pageData(app)).identity).toBeUndefined();
    await page.locator('[data-key="settings-identity-page"]').fill('');
    await closeDialog(app, 'settings');

    // with the page number off the corner is free too
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-number-page"]').click();
    await closeDialog(app, 'settings');
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 24, 0), await cellToClient(app, 27, 3));
    expect((await pageData(app)).elements).toHaveLength(2);
    // ...and turning it back on is refused while the corner is covered
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-number-page"]').click();
    expect(await page.locator('dialog.settings .fmsg:not([hidden])').innerText()).toContain('page number');
    expect((await pageData(app)).page_number).toBe(false);
    noErrors(app);
  });

  it('closes row 0 while there is an identity', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-identity-page"]').fill('MON');
    await closeDialog(app, 'settings');
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 0), await cellToClient(app, 9, 3));
    expect((await pageData(app)).elements).toMatchObject([{ type: 'box', x: 3, y: 1 }]); // drawing starts below the header
    noErrors(app);
  });

  it('on a phone: page settings, spread settings (both pages) and book settings, all finger-sized', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    const d = (await box(app, 'dialog.settings'))!;
    expect([d.width, d.height]).toEqual([390, 844]); // a full-screen sheet
    expect(await smallControls(app, 'dialog.settings')).toEqual([]);
    await shot(app, 'phone-settings-page');
    await closeDialog(app, 'settings');

    await choose(app, 'page', '#view-spread');
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    expect(await page.locator('dialog.settings h3').allTextContents()).toEqual(['Left page', 'Right page']);
    expect(await page.locator('[data-key="settings-spread-name"]').getAttribute('placeholder')).toBe('Untitled spread');
    await page.locator('[data-key="settings-spread-name"]').fill('Weekly');
    expect(await page.evaluate(() => localStorage.getItem('dotwork.spread.name'))).toBe('Weekly');
    expect(await smallControls(app, 'dialog.settings')).toEqual([]);
    await shot(app, 'phone-settings-spread');
    await closeDialog(app, 'settings');

    await choose(app, 'page', '#view-book');
    await page.waitForSelector('.stage-page');
    await choose(app, 'page', '#settings');
    await page.waitForSelector('dialog.settings[open]');
    for (const key of ['settings-book-name', 'settings-book-pages', 'settings-book-numbers', 'book-thickness', 'book-offset-x', 'book-offset-y', 'book-signatures']) {
      expect(await page.locator(`dialog.settings [data-key="${key}"]`).count(), key).toBe(1);
    }
    await page.locator('[data-key="settings-book-name"]').fill('Field notes');
    await page.locator('[data-key="book-thickness"]').fill('0.2');
    await page.locator('[data-key="book-thickness"]').dispatchEvent('change');
    await page.locator('[data-key="settings-book-numbers"]').uncheck();
    const book = await page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book')!));
    expect(book).toMatchObject({ name: 'Field notes', page_numbers: false, print: { paper_thickness_mm: 0.2 } });
    expect(await smallControls(app, 'dialog.settings')).toEqual([]);
    await shot(app, 'phone-settings-book');
    noErrors(app);
  });
});

describe('the library', () => {
  const library = (app: App) => app.page.locator('dialog[aria-label="Library"]');

  it('lists the examples with the saved pages, searches by name, and keeps favorites', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'edit', '#library');
    await library(app).waitFor();
    // the examples live here, marked as examples; there is no separate "Load example"
    expect(await page.locator('#examples').count()).toBe(0);
    expect(await page.locator('.lib-card .hint', { hasText: /example/ }).count()).toBeGreaterThan(5);
    await page.waitForSelector('.lib-card');
    const all = await page.locator('.lib-card').count();

    // search matches names, any order, any case
    await page.locator('[data-help="library-search"]').fill('TRACKER month');
    expect(await page.locator('.lib-card .lib-name').allInnerTexts()).toEqual(['Monthly tracker']);
    await page.locator('[data-help="library-search"]').fill('zzz');
    await page.waitForSelector('[data-key="library-empty"]');
    expect(await page.locator('.lib-card').count()).toBe(0);
    expect(await page.locator('[data-key="library-empty"]').innerText()).toContain('matches');
    await page.locator('[data-help="library-search"]').fill('');
    await page.waitForFunction((n) => document.querySelectorAll('.lib-card').length === n, all);

    // the tabs
    for (const tab of ['spreads', 'books', 'widgets', 'favorites']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForSelector('[data-key="library-empty"]');
      expect(await page.locator('.lib-card').count(), tab).toBe(0);
      expect(await page.locator(`[data-tab="${tab}"]`).getAttribute('aria-selected')).toBe('true');
    }

    // a star puts a page under Favorites, and survives a reload
    await page.click('[data-tab="pages"]');
    await page.waitForSelector('.lib-card[data-name="Monthly tracker"]');
    const star = page.locator('.lib-card[data-name="Monthly tracker"] .lib-star');
    expect(await star.getAttribute('aria-pressed')).toBe('false');
    await star.click();
    await page.waitForSelector('.lib-card[data-name="Monthly tracker"] .lib-star[aria-pressed="true"]');
    await page.click('[data-tab="favorites"]');
    await page.waitForFunction(() => document.querySelectorAll('.lib-card').length === 1);
    expect(await page.locator('.lib-card .lib-name').allInnerTexts()).toEqual(['Monthly tracker']);
    await page.locator('[data-help="library-search"]').fill('nothing like it');
    await page.waitForSelector('[data-key="library-empty"]'); // search works inside Favorites too
    await page.locator('[data-help="library-search"]').fill('');
    await page.reload();
    await page.waitForSelector('#canvas');
    await choose(app, 'edit', '#library');
    await page.click('[data-tab="favorites"]');
    await page.waitForFunction(() => document.querySelectorAll('.lib-card').length === 1);
    expect(await page.locator('.lib-card .lib-name').allInnerTexts()).toEqual(['Monthly tracker']);
    await page.locator('.lib-card .lib-star').click(); // unstar
    await page.waitForSelector('[data-key="library-empty"]');
    noErrors(app);
  });

  it('opens an item when it is tapped, and keeps rename, duplicate and delete in the ⋯ menu', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'edit', '#library');
    await library(app).waitFor();
    // an example is copied, not renamed or deleted
    await page.click('.lib-card[data-name="Lined page"] .lib-more');
    await page.waitForSelector('.lib-menu');
    expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Duplicate']);
    await page.click('.lib-menu button');
    await page.waitForSelector('.lib-card[data-name="Lined page copy"]');
    // the copy is a saved page: all three
    await page.click('.lib-card[data-name="Lined page copy"] .lib-more');
    await page.waitForSelector('.lib-menu');
    expect(await page.locator('.lib-menu button').allInnerTexts()).toEqual(['Rename', 'Duplicate', 'Delete']);
    await page.click('.lib-menu button:has-text("Rename")');
    await page.locator('.lib-card input').fill('Ruled');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.lib-card[data-name="Ruled"]');
    page.once('dialog', (d) => void d.accept());
    await page.click('.lib-card[data-name="Ruled"] .lib-more');
    await page.waitForSelector('.lib-menu');
    await page.click('.lib-menu button:has-text("Delete")');
    await page.waitForFunction(() => !document.querySelector('.lib-card[data-name="Ruled"]'));

    // tapping the item opens it and closes the library
    await page.click('.lib-card[data-name="Lined page"] .lib-open');
    await page.waitForSelector('dialog[aria-label="Library"]', { state: 'hidden' });
    expect((await pageData(app)).name).toBe('Lined page');
    expect((await pageData(app)).elements.length).toBeGreaterThan(0);

    // in a spread, a tapped page goes on the page being edited
    await choose(app, 'page', '#view-spread');
    await page.locator('#canvas-right').click({ position: { x: 5, y: 5 } }); // make the right page the active one
    await choose(app, 'edit', '#library');
    await page.waitForSelector('.lib-card[data-name="Daily Good Time Journal"]');
    await page.click('.lib-card[data-name="Daily Good Time Journal"] .lib-open');
    const right = await page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.spread.right')!));
    expect(right).toMatchObject({ name: 'Daily Good Time Journal', side: 'right' });
    noErrors(app);
  });

  it('on a phone: a full-screen sheet of finger-sized rows, with the current kind of thing first', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await choose(app, 'edit', '#library');
    await library(app).waitFor();
    const d = (await box(app, 'dialog[aria-label="Library"]'))!;
    expect([d.width, d.height]).toEqual([390, 844]);
    expect(await page.locator('[data-tab="pages"]').getAttribute('aria-selected')).toBe('true');
    expect(await smallControls(app, 'dialog[aria-label="Library"]')).toEqual([]);
    await shot(app, 'phone-library');
    await page.locator('.lib-card[data-name="Monthly tracker"] .lib-more').tap();
    await shot(app, 'phone-library-menu');
    await page.locator('.lib-card[data-name="Monthly tracker"] .lib-more').tap();
    await page.locator('.lib-card[data-name="Monthly tracker"] .lib-star').tap();
    await page.locator('[data-tab="favorites"]').tap();
    await shot(app, 'phone-library-favorites');
    await page.locator('[data-help="library-search"]').fill('zzz');
    await shot(app, 'phone-library-search');
    noErrors(app);
  });

  it('puts a saved widget on the page from the Widgets tab', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await page.evaluate(() => localStorage.setItem('dotwork.widgets', JSON.stringify([{ id: 'w1', name: 'Notes box', elements: [{ type: 'box', x: 0, y: 0, w: 5, h: 4 }, { type: 'rule', x1: 0, y1: 2, x2: 5, y2: 2 }] }])));
    await page.reload();
    await page.waitForSelector('#canvas');
    await choose(app, 'edit', '#library');
    await page.click('[data-tab="widgets"]');
    await page.waitForSelector('.lib-card[data-name="Notes box"]');
    expect(await page.locator('.lib-card .lib-name').allInnerTexts()).toEqual(['Notes box']);
    await page.click('.lib-card .lib-open');
    await page.waitForSelector('dialog[aria-label="Library"]', { state: 'hidden' });
    expect(await page.locator('#notice').innerText()).toContain('Notes box');
    await tap(app, await cellToClient(app, 6, 10));
    expect((await pageData(app)).elements).toHaveLength(2);
    noErrors(app);
  });
});

describe('the export window', () => {
  /** Count the downloads the browser is asked for. */
  const watch = (app: App) => {
    const names: string[] = [];
    app.page.on('download', (d) => names.push(d.suggestedFilename()));
    return names;
  };
  const tab = (app: App, id: string) => hit(app, `dialog.export [data-tab="${id}"]`);
  const download = async (app: App) => {
    const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, 'dialog.export .export-actions .primary')]);
    return d;
  };
  const bytes = async (d: Awaited<ReturnType<typeof download>>) => {
    const { readFile } = await import('node:fs/promises');
    return readFile((await d.path())!);
  };

  it('has the four tabs, each saying what it does and what file you get, and downloads nothing until Download is pressed', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    const downloads = watch(app);
    await hit(app, '#export');
    await page.waitForSelector('dialog.export[open]');
    expect(await page.locator('dialog.export [role="tab"]').allInnerTexts()).toEqual(['Import', 'Export', 'PNG', 'PDF']);

    const sentences: Record<string, RegExp> = { import: /\.json file/, export: /untitled\.json/, png: /untitled\.png/, pdf: /untitled-book-print\.zip/ };
    for (const id of ['import', 'export', 'png', 'pdf']) {
      await tab(app, id);
      expect(await page.locator('dialog.export .export-what').innerText(), id).toMatch(sentences[id]);
    }
    // choose things on every tab: still nothing is saved
    await tab(app, 'png');
    await page.locator('dialog.export [data-key="png-dpi"]').selectOption('150');
    await tab(app, 'pdf');
    await page.locator('dialog.export [data-key="pdf-pages"]').check();
    await page.locator('dialog.export [data-key="pdf-cover"]').uncheck();
    expect(await page.locator('dialog.export .export-what').innerText()).toContain('untitled-book-pages.pdf');
    await page.locator('dialog.export [data-key="pdf-signatures"]').check();
    await page.locator('dialog.export [data-key="book-thickness"]').fill('0.15');
    await page.locator('dialog.export [data-key="book-thickness"]').dispatchEvent('change');
    await tab(app, 'export');
    await page.waitForTimeout(500);
    expect(downloads).toEqual([]);
    await closeDialog(app, 'export');
    expect(downloads).toEqual([]);
    noErrors(app);
  });

  it('Export saves the page as JSON, and Import reads it back', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'page', '#settings');
    await page.locator('[data-key="settings-name-page"]').fill('Round trip');
    await closeDialog(app, 'settings');
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 4), await cellToClient(app, 9, 8));
    await hit(app, '#export');
    await tab(app, 'export');
    expect(await page.locator('dialog.export .export-what').innerText()).toContain('round-trip.json');
    const d = await download(app);
    expect(d.suggestedFilename()).toBe('round-trip.json');
    const file = JSON.parse((await bytes(d)).toString('utf8'));
    expect(file).toMatchObject({ format: 'dotwork-page', name: 'Round trip' });
    expect(file.elements).toHaveLength(1);

    await closeDialog(app, 'export');
    await choose(app, 'edit', '#new');
    expect((await pageData(app)).elements).toEqual([]);
    await hit(app, '#export');
    await tab(app, 'import');
    await page.setInputFiles('dialog.export input[type="file"]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    expect(await page.locator('dialog.export .lib-msg').innerText()).toContain('not valid JSON');
    await page.setInputFiles('dialog.export input[type="file"]', { name: 'round-trip.json', mimeType: 'application/json', buffer: await bytes(d) });
    await page.waitForSelector('dialog.export', { state: 'hidden' });
    expect(await pageData(app)).toMatchObject({ name: 'Round trip' });
    expect((await pageData(app)).elements).toHaveLength(1);
    noErrors(app);
  });

  it('PNG offers the page or the spread and a resolution', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await hit(app, '#export');
    await tab(app, 'png');
    expect(await page.locator('dialog.export [name="png-scope"]').count()).toBe(0); // a lone page has nothing to choose
    await page.locator('dialog.export [data-key="png-dpi"]').selectOption('150');
    const one = await download(app);
    expect(one.suggestedFilename()).toBe('untitled.png');
    const png = await bytes(one);
    expect(png.readUInt32BE(16)).toBe(525); // 3.5 in at 150 DPI
    expect(png.readUInt32BE(20)).toBe(825);
    await closeDialog(app, 'export');

    await choose(app, 'page', '#view-spread');
    await hit(app, '#export');
    await tab(app, 'png');
    await page.locator('dialog.export [data-key="png-spread"]').check();
    await page.locator('dialog.export [data-key="png-dpi"]').selectOption('150');
    const both = await download(app);
    expect(both.suggestedFilename()).toBe('untitled-spread.png');
    expect((await bytes(both)).readUInt32BE(16)).toBe(1050); // both pages side by side
    await closeDialog(app, 'export');

    await choose(app, 'page', '#view-book');
    await hit(app, '#export');
    await tab(app, 'png');
    expect(await page.locator('dialog.export .export-actions .primary').isDisabled()).toBe(true); // no page to show in the book view
    noErrors(app);
  });

  it('PDF makes pages at final size, or print-ready signatures, with or without the cover', async () => {
    const app = await open(env, 'desktop');
    const { page } = app;
    await choose(app, 'page', '#view-book');
    await page.waitForSelector('.stage-page');
    await hit(app, '#export');
    await page.waitForSelector('dialog.export[open]');
    expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true'); // the book view opens on PDF

    await page.locator('dialog.export [data-key="pdf-pages"]').check();
    await page.locator('dialog.export [data-key="pdf-cover"]').uncheck();
    const pages = await download(app);
    expect(pages.suggestedFilename()).toBe('untitled-book-pages.pdf');
    expect((await bytes(pages)).subarray(0, 4).toString()).toBe('%PDF');

    await page.locator('dialog.export [data-key="pdf-signatures"]').check();
    const zip = await download(app);
    expect(zip.suggestedFilename()).toBe('untitled-book-print.zip');
    const text = (await bytes(zip)).toString('latin1');
    for (const f of ['print-first.pdf', 'print-second.pdf', 'summary.txt']) expect(text).toContain(f);
    expect(text).not.toContain('pages.pdf');
    noErrors(app);
  });

  it('on a phone: a full-screen sheet with finger-sized controls on every tab', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await hit(app, '#export');
    await page.waitForSelector('dialog.export[open]');
    const d = (await box(app, 'dialog.export'))!;
    expect([d.width, d.height]).toEqual([390, 844]);
    for (const id of ['import', 'export', 'png', 'pdf']) {
      await tab(app, id);
      expect(await smallControls(app, 'dialog.export'), id).toEqual([]);
      await shot(app, `phone-export-${id}`);
    }
    noErrors(app);
  });
});

describe('layers', () => {
  it('tapping a layer’s name selects the element and opens its properties', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await tool(app, 'box');
    await drag(app, await cellToClient(app, 3, 6), await cellToClient(app, 9, 10));
    await tool(app, 'rule');
    await drag(app, await cellToClient(app, 3, 14), await cellToClient(app, 12, 14));
    await hit(app, '#layers-button');
    await page.waitForSelector('#sheet[data-state="open"]');
    expect(await page.locator('#panel').getAttribute('data-tab')).toBe('layers');
    await shot(app, 'phone-layers');
    await hit(app, '#panel .layer-name >> nth=1'); // the box is the lower layer
    expect(await page.locator('#panel').getAttribute('data-tab')).toBe('properties');
    expect(await page.locator('#panel section[data-tab="properties"] h2').textContent()).toBe('Properties · box');
    expect(await page.locator('#sheet').getAttribute('data-state')).toBe('open');
    noErrors(app);
  });
});
