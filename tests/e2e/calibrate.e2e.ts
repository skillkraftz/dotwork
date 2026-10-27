import { readFile } from 'node:fs/promises';
import { DEFAULT_PRINT } from '../../src/book/impose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { hit, missingHelp, open, openDoc, seedDoc, shot, start, stop, type App, type Env } from './harness';

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
/** The saved printer profile as the app reads it: a layout left at the defaults is not stored, so it is filled in from them. */
const profile = async (app: App) => {
  const stored = await app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.printer') ?? 'null'));
  return stored && { ...stored, layouts: { ...DEFAULT_PRINT.layouts, ...stored.layouts } };
};
/** The open book exactly as the Library holds it: no setting of the printer may ever change a byte of it. */
const bookDraft = (app: App) => openDoc(app, 'book');
const BOOK = JSON.stringify({ format: 'dotwork-book', version: 1, name: 'Untitled book', page_count: 52, page_numbers: true, print: { signatures: 1 }, pages: Array(52).fill(null), cover: { front: null, back: null } });
const download = async (app: App, selector: string) => {
  const [d] = await Promise.all([app.page.waitForEvent('download'), hit(app, selector)]);
  return { name: d.suggestedFilename(), bytes: await readFile((await d.path())!) };
};
/** A saved printer profile with no offsets or shifts, so a walk starts from simple numbers (the app's own defaults are the owner's calibration). */
const NONE = { front_offset_x_mm: 0, front_offset_y_mm: 0, back_offset_x_mm: 0, back_offset_y_mm: 0, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0 };
const FLAT = { creep_per_sheet_mm: 0.14, fore_edge_shift_mm: 0, cover_fore_edge_shift_mm: 0, target_fore_edge_margin_mm: 3.5, shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8, sheet_layout: 'half_letter', layouts: { half_letter: NONE, letter_two_up: NONE } };
const startFlat = async (app: App, layout = 'half_letter') => {
  await app.page.evaluate(([flat, l]) => { localStorage.setItem('dotwork.printer', JSON.stringify({ ...(flat as object), sheet_layout: l })); }, [FLAT, layout] as const);
  await seedDoc(app, 'book', JSON.parse(BOOK), JSON.parse(BOOK).name);
};
const noOverflow = (app: App) => app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const openCalibrate = async (app: App) => {
  await hit(app, '#export');
  await hit(app, 'dialog.export [data-tab="pdf"]');
  await app.page.waitForSelector('dialog.export [data-key="calibrate-open"]');
  await hit(app, 'dialog.export [data-key="calibrate-open"]');
  await app.page.waitForSelector('dialog.calibrate[open]');
};

for (const device of ['phone', 'desktop'] as const) {
  describe(`the Calibrate wizard (${device})`, () => {
    it('walks the three steps: print then measure, creep and shifts, check; everything is kept as the printer’s settings and never in the book', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startFlat(app);
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await page.waitForSelector('dialog.export [data-key="calibrate-open"]');
      await shot(app, `${device}-pdf-tab`);
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.export').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);

      // ---- step 1: the sheet
      expect(await progress(app)).toBe('Step 1 of 3: Sheet');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-back"]').isDisabled()).toBe(true);
      // The layout is shown, not chosen, here: that is done in the PDF tab.
      expect(await page.locator('dialog.calibrate [data-key="book-sheet-layout"]').count()).toBe(0);
      const layoutLine = await page.locator('dialog.calibrate [data-key="calibrate-layout"]').innerText();
      expect(layoutLine).toContain('Half letter');
      expect(layoutLine).toContain('Statement (Borderless)');
      expect(await page.locator('dialog.calibrate .cal-how li').count()).toBe(5);
      expect(await page.locator('dialog.calibrate .cal-how').innerText()).toContain('Fold the sheet top edge to bottom edge, crease hard, open it, and read where the crease crosses each horizontal-fold scale. Then fold left edge to right edge and read the vertical-fold scales.');
      expect(await page.locator('dialog.calibrate').innerText()).not.toMatch(/edge ruler|edge distance/i);
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/best quality/);
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/paper feed/);
      // The inputs are named by the paper's edges, the same words as the sheet.
      for (const label of ['see-through top x', 'see-through bottom x', 'see-through left y', 'see-through right y', 'horizontal fold, left scale', 'horizontal fold, right scale', 'vertical fold, top scale', 'vertical fold, bottom scale', 'parallel to the 8.5 in edge: should measure 100.0 mm', 'parallel to the 5.5 in edge: should measure 100.0 mm']) {
        expect(await page.locator(`dialog.calibrate input[aria-label="${label}"]`).count(), label).toBe(1);
      }
      expect(await page.locator('dialog.calibrate').innerText()).not.toMatch(/across|\bdown\b/i);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      await shot(app, `${device}-calibrate-sheet`);

      const sheet = await download(app, 'dialog.calibrate [data-key="calibrate-download-sheet"]');
      expect(sheet.name).toBe('calibration-sheet.pdf');
      expect((await PDFDocument.load(sheet.bytes)).getPageCount()).toBe(2);

      // The see-through readings, the fold readings and the 100 mm lines of a printer that is off.
      await set(app, 'calibrate', 'calibrate-read-top-x', '-0.4');
      await set(app, 'calibrate', 'calibrate-read-bottom-x', '-0.4');
      await set(app, 'calibrate', 'calibrate-read-left-y', '0.3');
      await set(app, 'calibrate', 'calibrate-read-right-y', '0.3');
      await set(app, 'calibrate', 'calibrate-read-vfold-top', '-1.5'); // the crease is left of the zero: the back is 1.5 mm too far right
      await set(app, 'calibrate', 'calibrate-read-vfold-bottom', '-1.5');
      await set(app, 'calibrate', 'calibrate-read-hfold-left', '0.5'); // the crease is above the zero: the back is 0.5 mm too low
      await set(app, 'calibrate', 'calibrate-read-hfold-right', '0.5');
      await set(app, 'calibrate', 'calibrate-read-line-x', '99.5');
      await set(app, 'calibrate', 'calibrate-read-line-y', '99.6');
      const result = await page.locator('[data-key="calibrate-sheet-result"]').innerText();
      expect(result).toContain('Front offset x: 0 → 1.1 mm'); // -0.4 against the back + 1.5: the front is what is left
      expect(result).toContain('Front offset y: 0 → 0.2 mm');
      expect(result).toContain('Back offset x: 0 → -1.5 mm'); // against the paper: minus the error
      expect(result).toContain('Back offset y: 0 → 0.5 mm');
      expect(result).toContain('Back rotation: 0 → 0 °');
      expect(result).toContain('Scale along the 8.5 in edge: 100 → 100.5 %');
      expect(result).toContain('Scale along the 5.5 in edge: 100 → 100.4 %');
      await page.locator('[data-key="calibrate-use-sheet"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-sheet-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-sheet"]');
      expect((await profile(app)).layouts.half_letter).toMatchObject({ front_offset_x_mm: 1.1, front_offset_y_mm: 0.2, back_offset_x_mm: -1.5, back_offset_y_mm: 0.5, back_rotation_deg: 0, scale_x_pct: 100.5, scale_y_pct: 100.4 });
      expect((await profile(app)).layouts.letter_two_up).toMatchObject(NONE); // the other layout is left alone
      // The book holds the design only: nothing of this reached it.
      expect(await bookDraft(app)).toEqual(JSON.parse(BOOK));
      expect(await page.locator('dialog.calibrate .lib-msg').innerText()).toMatch(/Saved as your printer’s settings/);
      expect(await page.locator('[data-key="calibrate-read-vfold-top"]').inputValue()).toBe(''); // the readings are used up
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 2: creep and cover
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('pages 1 and 2');
      expect(await page.locator('dialog.calibrate').innerText()).toContain('then pages 3 and 4');
      // The page count is the book's (52: 13 sheets, so 11 blank sheets of padding), editable before the download.
      expect(await page.locator('[data-key="calibrate-pages"]').inputValue()).toBe('52');
      expect(await page.locator('[data-key="calibrate-padding"]').innerText()).toContain('52 pages is 13 sheets');
      expect(await page.locator('[data-key="calibrate-padding"]').innerText()).toContain('11 blank sheets');
      expect(await page.locator('[data-key="calibrate-fold-around"]').innerText()).toBe('Fold the outermost sheet around 11 blank sheets of the same paper, with the innermost sheet in the middle, cover outside. Bind and trim as usual, then read the fore-edge margin on the cover, page 1 and the middle spread.');
      await set(app, 'calibrate', 'calibrate-pages', '12');
      expect(await page.locator('[data-key="calibrate-fold-around"]').innerText()).toContain('around 1 blank sheet of the same paper');
      expect(await page.locator('[data-key="calibrate-printed-pages"]').inputValue()).toBe('12'); // follows until the test is downloaded
      await set(app, 'calibrate', 'calibrate-pages', '10');
      expect(await page.locator('[data-key="calibrate-padding"]').innerText()).toContain('multiple of 4');
      await hit(app, 'dialog.calibrate [data-key="calibrate-download-creep"]');
      expect(await page.locator('dialog.calibrate .lib-msg').innerText()).toContain('multiple of 4'); // refused, nothing downloaded
      await set(app, 'calibrate', 'calibrate-pages', '52');
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
      expect((await PDFDocument.load(files.get('creep-test.pdf')!)).getPageCount()).toBe(4); // the outermost and the innermost sheet, both sides
      expect((await PDFDocument.load(files.get('calibration-cover.pdf')!)).getPageCount()).toBe(2); // the outside, then the inside
      const record = files.get('calibration.txt')!.toString('utf8');
      expect(record).toContain('front offset x 1.1 mm');
      expect(record).toContain('creep per sheet 0.16 mm');
      expect(record).toContain('the outermost and innermost sheet of a 52-page book (13 sheets)');
      expect(await page.locator('[data-key="calibrate-printed-pages"]').inputValue()).toBe('52');
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
      expect(creep).toContain('cover 3.5, page 1 3.5, middle spread 3.5');
      expect(creep).toContain('Spine-side margin of the innermost page on the paper: 2.13 mm.');
      expect(await page.locator('[data-key="calibrate-spine"]').getAttribute('class')).not.toContain('warn');
      await page.locator('[data-key="calibrate-use-creep"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-step2-result`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-creep"]');
      expect(await profile(app)).toMatchObject({ creep_per_sheet_mm: 0.318, fore_edge_shift_mm: 2, cover_fore_edge_shift_mm: 2.2 });
      expect((await profile(app)).layouts.half_letter.front_offset_x_mm).toBe(1.1);
      expect(await bookDraft(app)).toEqual(JSON.parse(BOOK));
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      expect(await page.locator('[data-key="calibrate-read-outermost"]').inputValue()).toBe(''); // the readings are used up
      await hit(app, 'dialog.calibrate [data-key="calibrate-next"]');

      // ---- step 3: check, and tones
      expect(await progress(app)).toBe('Step 3 of 3: Check');
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
      expect(await progress(app)).toBe('Step 2 of 3: Creep and cover');
      await hit(app, 'dialog.calibrate [data-key="calibrate-back"]');
      expect(await progress(app)).toBe('Step 1 of 3: Sheet');

      // Done goes back to the PDF tab, whose fields hold the new values
      await hit(app, 'dialog.calibrate header button');
      await page.waitForSelector('dialog.export[open]');
      expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true');
      for (const [key, value] of [['book-front-offset-x', '1.1'], ['book-front-offset-y', '0.2'], ['book-offset-x', '-1.5'], ['book-offset-y', '0.5'], ['book-back-rotation', '0'], ['book-scale-x', '100.5'], ['book-scale-y', '100.4'], ['book-creep', '0.318'], ['book-fore-edge-shift', '2'], ['book-cover-shift', '2.2'], ['book-tone-light', '8']]) {
        expect(await page.locator(`dialog.export [data-key="${key}"]`).inputValue(), key).toBe(value);
      }
      expect(await bookDraft(app)).toEqual(JSON.parse(BOOK));
      expect(app.errors).toEqual([]);
    });

    it('finds the back’s rotation from the see-through readings, and keeps it for the layout', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startFlat(app);
      await openCalibrate(app);
      await set(app, 'calibrate', 'calibrate-read-top-x', '0.3');
      await set(app, 'calibrate', 'calibrate-read-bottom-x', '-0.3');
      const result = await page.locator('[data-key="calibrate-sheet-result"]').innerText();
      expect(result).toContain('Back rotation: 0 → -0.278 °'); // 0.6 mm over 123.7 mm (H - 2m): counter-clockwise, so turn it back
      expect(result).toContain('Back offset x: 0 → 0 mm');
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-sheet"]');
      expect((await profile(app)).layouts.half_letter.back_rotation_deg).toBe(-0.278);
      expect((await profile(app)).layouts.letter_two_up.back_rotation_deg).toBe(0);
      await page.locator('[data-key="calibrate-read-top-x"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-rotation`);
      expect(app.errors).toEqual([]);
    });

    it('names the layout being calibrated, read-only, with a way to change it that goes to the PDF tab', async () => {
      const app = await open(env, device);
      const { page } = app;
      await startFlat(app, 'letter_two_up');
      await openCalibrate(app);
      const line = await page.locator('dialog.calibrate [data-key="calibrate-layout"]').innerText();
      expect(line).toContain('Letter, two-up');
      expect(line).toContain('Letter (not borderless)');
      expect(await page.locator('dialog.calibrate [data-key="book-sheet-layout"]').count()).toBe(0);
      // The inputs name the edges of this layout: the 11 in edge, not the 5.5 in edge.
      expect(await page.locator('dialog.calibrate input[aria-label="see-through left y"]').count()).toBe(1);
      expect(await page.locator('dialog.calibrate input[aria-label="parallel to the 11 in edge: should measure 100.0 mm"]').count()).toBe(1);
      expect(await page.locator('dialog.calibrate').innerText()).toMatch(/whole letter sheet/);
      expect(await missingHelp(app)).toEqual([]);
      await shot(app, `${device}-calibrate-sheet-two-up`);
      const two = await download(app, 'dialog.calibrate [data-key="calibrate-download-sheet"]');
      const doc = await PDFDocument.load(two.bytes);
      expect(doc.getPageCount()).toBe(2);
      expect(doc.getPage(0).getHeight()).toBeCloseTo(11 * 72, 0);
      // Change: back to the PDF tab, where the layout is chosen; then Calibrate again calibrates the new one, with fresh readings.
      await set(app, 'calibrate', 'calibrate-read-top-x', '0.2');
      await hit(app, 'dialog.calibrate [data-key="calibrate-change-layout"]');
      await page.waitForSelector('dialog.export[open]');
      expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true');
      await page.locator('dialog.export [data-key="book-sheet-layout"]').selectOption('half_letter');
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.calibrate [data-key="calibrate-layout"]').innerText()).toContain('Half letter');
      expect(await page.locator('[data-key="calibrate-read-top-x"]').inputValue()).toBe('');
      expect(app.errors).toEqual([]);
    });

    it('uses the printer profile for every book: nothing is compared or copied into the book', async () => {
      const app = await open(env, device);
      const { page } = app;
      const book = { format: 'dotwork-book', version: 1, page_count: 52, page_numbers: true, print: { signatures: 3 }, pages: Array(52).fill(null), cover: { front: null, back: null } };
      await page.evaluate((flat) => localStorage.setItem('dotwork.printer', JSON.stringify({ ...(flat as object), creep_per_sheet_mm: 0.1, shade_light_pct: 8 })), FLAT);
      await seedDoc(app, 'book', book, 'Book');
      await hit(app, '#menu-page');
      await hit(app, '#view-book');
      await page.waitForSelector('.stage-page');
      expect(await page.locator('#notice').isVisible()).toBe(false); // the book opened
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      expect(await page.locator('dialog.export [data-key="book-creep"]').inputValue()).toBe('0.1'); // the printer's, not the book's
      expect(await page.locator('dialog.export [data-key="book-tone-light"]').inputValue()).toBe('8');
      expect(await page.locator('dialog.export [data-key="book-signatures"]').inputValue()).toBe('3'); // the book's own
      expect(await page.locator('[data-key="printer-notice"]').count()).toBe(0);
      expect(app.errors).toEqual([]);
    });
  });
}

for (const device of ['phone', 'desktop'] as const) {
  describe(`the Calibrate wizard: fold twist and line weight (${device})`, () => {
    it('shows the twist against the paper once both readings of a fold pair are typed, and changes no setting', async () => {
      const app = await open(env, device);
      await startFlat(app);
      await openCalibrate(app);
      const twist = app.page.locator('dialog.calibrate [data-key="calibrate-fold-twist"]');
      expect(await twist.isHidden()).toBe(true);
      await set(app, 'calibrate', 'calibrate-read-hfold-left', '0.2');
      expect(await twist.isHidden()).toBe(true); // one reading of a pair says nothing about a twist
      await set(app, 'calibrate', 'calibrate-read-hfold-right', '0.5');
      expect(await twist.innerText()).toContain('Horizontal fold, twist against the paper: 0.3 mm over 76 mm');
      expect(await twist.innerText()).not.toContain('Vertical fold');
      await set(app, 'calibrate', 'calibrate-read-vfold-top', '-0.1');
      await set(app, 'calibrate', 'calibrate-read-vfold-bottom', '0.3');
      expect(await twist.innerText()).toContain('Vertical fold, twist against the paper: 0.4 mm over 76 mm');
      await twist.scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-fold-twist`);
      // Information only: the printer's settings are as they were.
      expect((await profile(app)).layouts.half_letter).toMatchObject(NONE);
      expect(await missingHelp(app)).toEqual([]);
    });

    it('takes the ladder step as a reading, shows the line weight in New settings, and keeps it as the selected layout’s printer setting, never in the book', async () => {
      const app = await open(env, device);
      await startFlat(app);
      await openCalibrate(app);
      const text = await app.page.locator('dialog.calibrate').innerText();
      expect(text).toMatch(/pairs of lines on side 1 still differ/);
      expect(text).toMatch(/never thickens lines/);
      await set(app, 'calibrate', 'calibrate-read-ladder', '90');
      const result = await app.page.locator('[data-key="calibrate-sheet-result"]').innerText();
      expect(result).toContain('Line weight along the 8.5 in edge: 100 → 90 %');
      await app.page.locator('[data-key="calibrate-use-sheet"]').scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-line-weight`);
      await hit(app, 'dialog.calibrate [data-key="calibrate-use-sheet"]');
      expect((await profile(app)).layouts.half_letter.line_weight_x_pct).toBe(90);
      expect((await profile(app)).layouts.letter_two_up.line_weight_x_pct ?? 100).toBe(100);
      expect(await bookDraft(app)).toEqual(JSON.parse(BOOK));
      await set(app, 'calibrate', 'calibrate-read-ladder', '500'); // brought back inside its limits
      expect(await app.page.locator('[data-key="calibrate-sheet-result"]').innerText()).toContain('→ 120 %');
      if (app.touch) expect(await small(app)).toEqual([]);
      expect(await noOverflow(app)).toBe(true);
      expect(await missingHelp(app)).toEqual([]);
    });
  });
}
