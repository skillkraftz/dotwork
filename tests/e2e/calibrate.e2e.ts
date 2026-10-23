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
/** A saved printer profile with no offsets or shifts, so a walk starts from simple numbers (the app's own defaults are the owner's calibration). */
const NONE = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100 };
const FLAT = { creep_per_sheet_mm: 0.14, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8, sheet_layout: 'half_letter', layouts: { half_letter: NONE, letter_two_up: NONE } };
const startFlat = async (app: App) => {
  await app.page.evaluate((flat) => { localStorage.setItem('dotwork.printer', JSON.stringify(flat)); localStorage.removeItem('dotwork.book'); }, FLAT);
  await app.page.reload();
  await app.page.waitForSelector('#canvas');
};
const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const device of ['phone', 'tablet', 'desktop'] as const) {
  describe(`the Calibrate wizard (${device})`, () => {
    it('walks the four steps: the size, readings become offsets, creep and shifts, which are kept as the printer’s settings', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startFlat(app);
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await page.waitForSelector('dialog.export [data-key="calibrate-open"]');
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0); // nothing saved yet
      await shot(app, `${device}-pdf-tab`);
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.export').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);

      // ---- step 1: size
      expect(await progress(app)).toBe('Step 1 of 4: Size');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-back"]').isDisabled()).toBe(true);
      expect(await page.locator('dialog.calibrate [data-key="book-sheet-layout"]').inputValue()).toBe('half_letter');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('Statement (Borderless)');
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-calibrate-size`);
      const sized = await download(app, 'dialog.calibrate [data-key="calibrate-download-size"]');
      expect(sized.name).toBe('calibration-size.pdf');
      expect((await PDFDocument.load(sized.bytes)).getPageCount()).toBe(1);
      await set(app, 'calibrate', 'calibrate-read-size-h', '98.8');
      await set(app, 'calibrate', 'calibrate-read-size-v', '102.3');
      const scaled = await page.locator('[data-key="calibrate-size-result"]').innerText();
      expect(scaled).toContain('Width scale: 100 → 101.21 %');
      expect(scaled).toContain('Height scale: 100 → 97.75 %');
      await page.locator('[data-key="calibrate-use-scale"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-size-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-scale"]');
      expect(await profile(app)).toMatchObject({ layouts: { half_letter: { scale_x_pct: 101.21, scale_y_pct: 97.75 }, letter_two_up: { scale_x_pct: 100, scale_y_pct: 100 } } });
      expect(await page.locator('dialog.calibrate .lib-msg').innerText()).toMatch(/Saved as your printer’s settings/);
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 2: alignment
      expect(await progress(app)).toBe('Step 2 of 4: Alignment');
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
      expect((await profile(app)).layouts.half_letter).toMatchObject({ front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2, back_offset_y_mm: 0 });
      expect((await bookPrint(app)).layouts.half_letter).toMatchObject({ front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2 });
      expect((await profile(app)).layouts.letter_two_up).toMatchObject(NONE); // the other layout is left alone
      expect(await page.locator('dialog.calibrate .lib-msg').innerText()).toMatch(/Saved as your printer’s settings/);
      expect(await page.locator('[data-key="calibrate-read-front-fold"]').inputValue()).toBe(''); // the readings are used up
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 3: creep and cover
      expect(await progress(app)).toBe('Step 3 of 4: Creep and cover');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('pages 1 to 13');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('pages 14 to 26');
      expect(await page.locator('dialog.calibrate').innerText()).not.toMatch(/pushes the pages in/);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-calibrate-step2`);
      // the values the test will print with are editable before the download; set the creep to the paper's thickness
      for (const key of ['book-creep', 'book-fore-edge-shift', 'book-cover-shift', 'book-target-margin']) expect(await page.locator(`dialog.calibrate [data-key="${key}"]`).count(), key).toBe(1);
      await set(app, 'calibrate', 'book-creep', '0.16');
      expect(await page.locator('[data-key="calibrate-printed-creep"]').inputValue()).toBe('0.16'); // follows until the test is downloaded
      const zipped = await download(app, 'dialog.calibrate [data-key="calibrate-download-creep"]');
      expect(zipped.name).toBe('untitled-book-creep-test.zip');
      const files = unzip(zipped.bytes);
      expect([...files.keys()]).toEqual(['calibration-cover.pdf', 'creep-test.pdf', 'calibration.txt', 'book.json']);
      expect((await PDFDocument.load(files.get('creep-test.pdf')!)).getPageCount()).toBe(26);
      expect((await PDFDocument.load(files.get('calibration-cover.pdf')!)).getPageCount()).toBe(2); // the outside, then the inside
      const record = files.get('calibration.txt')!.toString('utf8');
      expect(record).toContain('front offset x -1.5 mm');
      expect(record).toContain('creep per sheet 0.16 mm');
      expect(record).toContain('fore-edge shift 0 | cover shift 0 | target margin 3.5 mm');
      // changing the setting after printing doesn't change what the readings start from
      await set(app, 'calibrate', 'book-creep', '0.3');
      expect(await page.locator('[data-key="calibrate-printed-creep"]').inputValue()).toBe('0.16');
      // a small spine-side margin is warned about: creep 0.3 printed, nothing read to move it
      await set(app, 'calibrate', 'calibrate-printed-creep', '0.3');
      await set(app, 'calibrate', 'calibrate-read-cover', '3.5');
      await set(app, 'calibrate', 'calibrate-read-outermost', '3.5');
      await set(app, 'calibrate', 'calibrate-read-innermost', '3.5');
      expect(await page.locator('[data-key="calibrate-spine"]').innerText()).toMatch(/0\.35 mm.*small/);
      await set(app, 'calibrate', 'calibrate-printed-creep', '0.16');
      // the owner's readings
      await set(app, 'calibrate', 'calibrate-read-cover', '5.7');
      await set(app, 'calibrate', 'calibrate-read-outermost', '5.5');
      await set(app, 'calibrate', 'calibrate-read-innermost', '3.6');
      const creep = await page.locator('[data-key="calibrate-creep-result"]').innerText();
      expect(creep).toContain('Creep per sheet: 0.3 → 0.32 mm');
      expect(creep).toContain('Fore-edge shift: 0 → 2 mm');
      expect(creep).toContain('Cover shift: 0 → 2.2 mm');
      expect(creep).toContain('cover 3.5, sheet 1 3.5, sheet 13 3.5');
      expect(creep).toContain('Spine-side margin of the innermost page on the paper: 2.13 mm.');
      expect(await page.locator('[data-key="calibrate-spine"]').getAttribute('class')).not.toContain('warn');
      await page.locator('[data-key="calibrate-use-creep"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-step2-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-creep"]');
      expect(await profile(app)).toMatchObject({ creep_per_sheet_mm: 0.318, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2 });
      expect((await profile(app)).layouts.half_letter.front_offset_x_mm).toBe(-1.5);
      expect(await progress(app)).toBe('Step 3 of 4: Creep and cover');
      expect(await page.locator('[data-key="calibrate-read-outermost"]').inputValue()).toBe(''); // the readings are used up
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 4: check, and tones
      expect(await progress(app)).toBe('Step 4 of 4: Check');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-next"]').isDisabled()).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      await set(app, 'calibrate', 'calibrate-check-fore', '3.75');
      await set(app, 'calibrate', 'calibrate-check-top', '3.85');
      expect(await page.locator('[data-key="calibrate-check-result"]').innerText()).toContain('Fore-edge: 3.75 mm, target 3.5 mm: 0.25 mm too big');
      expect(await page.locator('[data-key="calibrate-check-result"]').innerText()).toContain('Top: 3.85 mm, target 3.85 mm: on target');
      await set(app, 'calibrate', 'book-tone-light', '8');
      expect(await profile(app)).toMatchObject({ shade_light_pct: 8 });
      await shot(app, `${device}-calibrate-step3`);

      // Back keeps what was typed
      await hit(app, 'dialog.calibrate [data-key="calibrate-back"]');
      expect(await progress(app)).toBe('Step 3 of 4: Creep and cover');
      await hit(app, 'dialog.calibrate [data-key="calibrate-back"]');
      expect(await progress(app)).toBe('Step 2 of 4: Alignment');

      // Done goes back to the PDF tab, whose fields hold the new values, and the book agrees with the saved settings
      await hit(app, 'dialog.calibrate header button');
      await page.waitForSelector('dialog.export[open]');
      expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true');
      for (const [key, value] of [['book-front-offset-x', '-1.5'], ['book-front-offset-y', '0.5'], ['book-offset-x', '-1.2'], ['book-scale-x', '101.21'], ['book-scale-y', '97.75'], ['book-creep', '0.318'], ['book-fore-edge-shift', '2'], ['book-cover-shift', '2.2'], ['book-tone-light', '8']]) {
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
        const NONE_ = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100 };
        const SAVED_ = { ...NONE_, front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2 };
        localStorage.setItem('dotwork.book', JSON.stringify({
          format: 'dotwork-book', version: 1, name: 'Older book', page_count: 52, page_numbers: true,
          print: { creep_per_sheet_mm: 0.14, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, sheet_layout: 'half_letter', layouts: { half_letter: NONE_, letter_two_up: NONE_ }, signatures: 1, shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8 },
          pages: Array(52).fill(null), cover: { front: null, back: null },
        }));
        localStorage.setItem('dotwork.printer', JSON.stringify({
          creep_per_sheet_mm: 0.1, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, sheet_layout: 'half_letter', layouts: { half_letter: SAVED_, letter_two_up: NONE_ },
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
      expect(text).toContain('creep per sheet: 0.14 here, 0.1 saved');
      expect(text).toContain('half letter front offset x: 0 here, -1.5 saved');
      await shot(app, `${device}-printer-notice`);

      // Keep this book's: the message goes, the book is as it was
      await hit(app, 'dialog.export [data-key="printer-keep-book"]');
      expect(await notice.count()).toBe(0);
      expect(await page.locator('dialog.export [data-key="book-creep"]').inputValue()).toBe('0.14');
      // Change a setting back and forth: the message comes back when the difference is a new one
      await type(app, 'dialog.export [data-key="book-offset-x"]', '0.3');
      await notice.waitFor();

      // Use my printer settings: the book takes them all
      await hit(app, 'dialog.export [data-key="printer-use-saved"]');
      expect(await notice.count()).toBe(0);
      for (const [key, value] of [['book-creep', '0.1'], ['book-front-offset-x', '-1.5'], ['book-front-offset-y', '0.5'], ['book-offset-x', '-1.2'], ['book-tone-light', '8']]) {
        expect(await page.locator(`dialog.export [data-key="${key}"]`).inputValue(), key).toBe(value);
      }
      expect(app.errors).toEqual([]);
    });

    it('starts a new book from the printer’s settings', async () => {
      const app = await open(env, device);
      const { page } = app;
      await page.evaluate(() => {
        const none = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100 };
        localStorage.setItem('dotwork.printer', JSON.stringify({
          creep_per_sheet_mm: 0.1, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, sheet_layout: 'half_letter',
          layouts: { half_letter: { ...none, front_offset_x_mm: -1.5, front_offset_y_mm: 0.5, back_offset_x_mm: -1.2 }, letter_two_up: none },
          shade_light_pct: 8, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
        }));
      });
      await page.evaluate(() => localStorage.removeItem('dotwork.book'));
      await page.reload();
      await page.waitForSelector('#canvas');
      await hit(app, '#menu-page');
      await hit(app, '#view-book');
      await page.waitForSelector('.stage-page');
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      expect(await page.locator('dialog.export [data-key="book-front-offset-x"]').inputValue()).toBe('-1.5');
      expect(await page.locator('dialog.export [data-key="book-creep"]').inputValue()).toBe('0.1');
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0);
      expect(app.errors).toEqual([]);
    });
  });
}
