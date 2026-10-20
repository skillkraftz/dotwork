import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const set = async (app: App, dialog: string, key: string, value: string) => {
  const input = app.page.locator(`dialog.${dialog} [data-key="${key}"]`);
  await input.fill(value);
  await input.dispatchEvent('change');
};

/** Controls under 44 px, other than checkboxes and radios. */
const small = (app: App) => app.page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('dialog.calibrate button, dialog.calibrate input')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (r.height < 43.5 || r.width < 43.5)) out.push(`${el.tagName} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

for (const device of ['phone', 'tablet', 'desktop'] as const) {
  describe(`the Calibrate page (${device})`, () => {
    it('opens from the PDF tab, takes a change in place, downloads the calibration zip and returns to the PDF tab', async () => {
      const app = await open(env, device);
      const { page } = app;
      await hit(app, '#export');
      await hit(app, 'dialog.export [data-tab="pdf"]');
      await page.waitForSelector('dialog.export [data-key="calibrate-open"]');
      await shot(app, `${device}-pdf-tab`);
      await hit(app, 'dialog.export [data-key="calibrate-open"]');
      await page.waitForSelector('dialog.calibrate[open]');
      expect(await page.locator('dialog.export').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
      expect((await page.locator('dialog.calibrate h3').allInnerTexts()).map((t) => t.toLowerCase())).toEqual(['1. alignment (back offset)', '2. tones', '3. paper thickness (creep)']);
      expect(await missingHelp(app)).toEqual([]);
      if (app.touch) expect(await small(app)).toEqual([]); // finger-sized on touch devices
      await shot(app, `${device}-calibrate-top`);

      // The fields are inline: change one in each step without leaving.
      await set(app, 'calibrate', 'book-offset-x', '0.4');
      await set(app, 'calibrate', 'book-tone-light', '8');
      await set(app, 'calibrate', 'book-thickness', '0.12');
      await page.locator('dialog.calibrate .cal-step').nth(2).scrollIntoViewIfNeeded();
      await shot(app, `${device}-calibrate-creep`);

      const [d] = await Promise.all([page.waitForEvent('download'), hit(app, 'dialog.calibrate [data-key="calibrate-download"]')]);
      expect(d.suggestedFilename()).toBe('untitled-book-calibration.zip');
      const files = unzip(await readFile((await d.path())!));
      expect([...files.keys()]).toEqual(['calibration-first.pdf', 'calibration-second.pdf', 'creep-test.pdf', 'calibration-cover.pdf', 'calibration.txt', 'book.json']);
      const text = files.get('calibration.txt')!.toString('utf8');
      expect(text).toContain('back offset x 0.4 mm');
      expect(text).toContain('light 8 |');
      expect(text).toContain('paper thickness 0.12 mm');
      const book = JSON.parse(files.get('book.json')!.toString('utf8'));
      expect(book.print).toMatchObject({ back_offset_x_mm: 0.4, shade_light_pct: 8, paper_thickness_mm: 0.12 });
      expect(files.get('creep-test.pdf')!.subarray(0, 5).toString()).toBe('%PDF-');

      await hit(app, 'dialog.calibrate header button');
      await page.waitForSelector('dialog.export[open]');
      expect(await page.locator('dialog.export [data-tab="pdf"]').getAttribute('aria-selected')).toBe('true');
      expect(await page.locator('dialog.export [data-key="book-offset-x"]').inputValue()).toBe('0.4');
      expect(await page.locator('dialog.export [data-key="book-tone-light"]').inputValue()).toBe('8');
      expect(await page.locator('dialog.export [data-key="book-tone-gray"]').inputValue()).toBe('49.8');
      await shot(app, `${device}-pdf-tab-tones`);
      expect(app.errors).toEqual([]);
    });
  });
}
