import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { hit, missingHelp, open, shot, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

/** The entries of a zip whose files are stored without compression, as Dotwork writes them. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50;) {
    const size = bytes.readUInt32LE(at + 18), name = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const start = at + 30 + name + extra;
    out.set(bytes.subarray(at + 30, at + 30 + name).toString('utf8'), bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

/** Type into a number box the way a person does, and let the app see the change. */
const type = async (app: App, selector: string, value: string) => {
  const input = app.page.locator(selector);
  await input.fill(value);
  await input.dispatchEvent('input');
  await input.dispatchEvent('change');
};
const set = (app: App, dialog: string, key: string, value: string) => type(app, `dialog.${dialog} [data-key="${key}"]`, value);

/** Controls under 44 px, other than checkboxes and radios. */
const small = (app: App) => app.page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('dialog.calibrate button, dialog.calibrate input')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (r.height < 43.5 || r.width < 43.5)) out.push(`${el.tagName} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

const progress = (app: App) => app.page.locator('dialog.calibrate .cal-progress').innerText();
const profile = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.printer') ?? 'null'));
const bookPrint = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.book') ?? 'null')?.print);
const download = async (app: App, selector: string) => {
  const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, selector)]);
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) };
};
const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const device of ['phone', 'tablet', 'desktop'] as const) {
  describe(`the Calibrate wizard (${device})`, () => {
    it('walks the three steps: readings become offsets and a thickness, which are kept as the printer’s settings', async () => {
      const app = await open(env, device);
      const { page } = app;
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await page.waitForSelector('dialog.export [data-key="calibrate-open"]');
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0); // nothing saved yet
      await shot(app, `${device}-pdf-tab`);
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.export').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);

      // ---- step 1: alignment
      expect(await progress(app)).toBe('Step 1 of 3: Alignment');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-back"]').isDisabled()).toBe(true);
      expect(await page.locator('dialog.calibrate .cal-how li').count()).toBe(3);
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/best quality/);
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/CUPS \(localhost:631\)/);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-calibrate-step1`);

      const sheet = await download(app, 'dialog.calibrate [data-key="calibrate-download-alignment"]');
      expect(sheet.name).toBe('calibration-alignment.pdf');
      expect((await PDFDocument.load(sheet.bytes)).getPageCount()).toBe(2);

      await set(app, 'calibrate', 'calibrate-read-front-fold', '-1.5');
      await set(app, 'calibrate', 'calibrate-read-front-top', '4.35');
      await set(app, 'calibrate', 'calibrate-read-front-bottom', '3.35');
      await set(app, 'calibrate', 'calibrate-read-back-fold', '-1.2');
      const result = await page.locator('[data-key="calibrate-alignment-result"]').innerText();
      expect(result).toContain('Front x: 0 → -1.5 mm');
      expect(result).toContain('Front y: 0 → 0.5 mm'); // (4.35 - 3.35) / 2
      expect(result).toContain('Back x: 0 → -1.2 mm');
      expect(result).toContain('Back y: 0 → 0 mm');
      await page.locator('[data-key="calibrate-use-offsets"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-step1-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-offsets"]');
      expect(await profile(app)).toMatchObject({ front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2, back_offset_y_mm: 0 });
      expect(await bookPrint(app)).toMatchObject({ front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2 });
      expect(await page.locator('dialog.calibrate .lib-msg').innerText()).toMatch(/Saved as your printer’s settings/);
      expect(await page.locator('[data-key="calibrate-read-front-fold"]').inputValue()).toBe(''); // the readings are used up
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 2: creep and cover
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('pages 1 to 13');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('pages 14 to 26');
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/not with the cover/);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-calibrate-step2`);
      const zipped = await download(app, 'dialog.calibrate [data-key="calibrate-download-creep"]');
      expect(zipped.name).toBe('untitled-book-creep-test.zip');
      const files = unzip(zipped.bytes);
      expect([...files.keys()]).toEqual(['calibration-cover.pdf', 'creep-test.pdf', 'calibration.txt', 'book.json']);
      expect((await PDFDocument.load(files.get('creep-test.pdf')!)).getPageCount()).toBe(26);
      expect((await PDFDocument.load(files.get('calibration-cover.pdf')!)).getPageCount()).toBe(1);
      expect(files.get('calibration.txt')!.toString('utf8')).toContain('front offset x -1.5 mm');
      await set(app, 'calibrate', 'calibrate-read-cover', '3.95');
      await set(app, 'calibrate', 'calibrate-read-outermost', '3.8');
      await set(app, 'calibrate', 'calibrate-read-innermost', '4.04'); // 0.24 over 12 gaps: 0.02 too thick
      const creep = await page.locator('[data-key="calibrate-creep-result"]').innerText();
      expect(creep).toContain('0.14 → 0.12 mm');
      expect(creep).toContain('pushes the pages in by 0.15 mm');
      await page.locator('[data-key="calibrate-use-thickness"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-step2-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-thickness"]');
      expect(await profile(app)).toMatchObject({ paper_thickness_mm: 0.12, front_offset_x_mm: -1.5 });
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 3: check, and tones
      expect(await progress(app)).toBe('Step 3 of 3: Check');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-next"]').isDisabled()).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      await set(app, 'calibrate', 'calibrate-check-fore', '3.75');
      await set(app, 'calibrate', 'calibrate-check-top', '3.85');
      expect(await page.locator('[data-key="calibrate-check-result"]').innerText()).toContain('Fore-edge: 3.75 mm, target 3.95 mm: 0.2 mm too small');
      expect(await page.locator('[data-key="calibrate-check-result"]').innerText()).toContain('Top: 3.85 mm, target 3.85 mm: on target');
      await set(app, 'calibrate', 'book-tone-light', '8');
      expect(await profile(app)).toMatchObject({ shade_light_pct: 8 });
      await shot(app, `${device}-calibrate-step3`);

      // Back keeps what was typed
      await hit(app, 'dialog.calibrate [data-key="calibrate-back"]');
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      await hit(app, 'dialog.calibrate [data-key="calibrate-back"]');
      expect(await progress(app)).toBe('Step 1 of 3: Alignment');

      // Done goes back to the PDF tab, whose fields hold the new values, and the book agrees with the saved settings
      await hit(app, 'dialog.calibrate header button');
      await page.waitForSelector('dialog.export[open]');
      expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true');
      for (const [key, value] of [['book-front-offset-x', '-1.5'], ['book-front-offset-y', '0.5'], ['book-offset-x', '-1.2'], ['book-thickness', '0.12'], ['book-tone-light', '8']]) {
        expect(await page.locator(`dialog.export [data-key="${key}"]`).inputValue(), key).toBe(value);
      }
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0);
      expect(app.errors).toEqual([]);
    });

    it('says when the book differs from the printer’s settings, and takes either', async () => {
      const app = await open(env, device);
      const { page } = app;
      // A book made before the printer's settings were saved, with the default print settings.
      await page.evaluate(() => {
        localStorage.setItem('dotwork.book', JSON.stringify({
          format: 'dotwork-book', version: 1, name: 'Older book', page_count: 52, page_numbers: true,
          print: { paper_thickness_mm: 0.14, front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, signatures: 1, shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8 },
          pages: Array(52).fill(null), cover: { front: null, back: null },
        }));
        localStorage.setItem('dotwork.printer', JSON.stringify({
          paper_thickness_mm: 0.1, front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2, back_offset_y_mm: 0,
          shade_light_pct: 8, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
        }));
      });
      await page.reload();
      await page.waitForSelector('#canvas');
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      const notice = page.locator('[data-key="printer-notice"]');
      await notice.waitFor();
      expect(await missingHelp(app)).toEqual([]);
      const text = await notice.innerText();
      expect(text).toContain('differ from your printer’s saved settings');
      expect(text).toContain('paper thickness: 0.14 here, 0.1 saved');
      expect(text).toContain('front offset x: 0 here, -1.5 saved');
      await shot(app, `${device}-printer-notice`);

      // Keep this book's: the message goes, the book is as it was
      await hit(app, 'dialog.export [data-key="printer-keep-book"]');
      expect(await notice.count()).toBe(0);
      expect(await page.locator('dialog.export [data-key="book-thickness"]').inputValue()).toBe('0.14');
      // Change a setting back and forth: the message comes back when the difference is a new one
      await type(app, 'dialog.export [data-key="book-offset-x"]', '0.3');
      await notice.waitFor();

      // Use my printer settings: the book takes them all
      await hit(app, 'dialog.export [data-key="printer-use-saved"]');
      expect(await notice.count()).toBe(0);
      for (const [key, value] of [['book-thickness', '0.1'], ['book-front-offset-x', '-1.5'], ['book-front-offset-y', '0.5'], ['book-offset-x', '-1.2'], ['book-tone-light', '8']]) {
        expect(await page.locator(`dialog.export [data-key="${key}"]`).inputValue(), key).toBe(value);
      }
      expect(app.errors).toEqual([]);
    });

    it('starts a new book from the printer’s settings', async () => {
      const app = await open(env, device);
      const { page } = app;
      await page.evaluate(() => localStorage.setItem('dotwork.printer', JSON.stringify({
        paper_thickness_mm: 0.1, front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2, back_offset_y_mm: 0,
        shade_light_pct: 8, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
      })));
      await page.evaluate(() => localStorage.removeItem('dotwork.book'));
      await page.reload();
      await page.waitForSelector('#canvas');
      await hit(app, '#menu-page');
      await hit(app, '#view-book');
      await page.waitForSelector('.stage-page');
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      expect(await page.locator('dialog.export [data-key="book-front-offset-x"]').inputValue()).toBe('-1.5');
      expect(await page.locator('dialog.export [data-key="book-thickness"]').inputValue()).toBe('0.1');
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0);
      expect(app.errors).toEqual([]);
    });
  });
}
