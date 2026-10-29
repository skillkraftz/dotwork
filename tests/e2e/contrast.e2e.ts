import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellToClient, choose, open, seedPage, shot, start, stop, type App, type Env } from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const PAGE = {
  format: 'dotwork-page', version: 2, name: 'Grays', grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [{ type: 'shade', tones: 'L', x: 2, y: 3, w: 12, h: 6 }],
};

/** The gray of the screen at a point inside the Light shade, read from a screenshot of the editor. */
async function shadeGray(app: App) {
  const at = await cellToClient(app, 8, 5);
  const png = (await app.page.screenshot()).toString('base64');
  return app.page.evaluate(async ([data, x, y]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(Math.round((x as number) * 2), Math.round((y as number) * 2), 1, 1).data[0];
  }, [png, at.x, at.y] as const);
}

for (const device of ['phone', 'desktop'] as const) {
  describe(`darker grays on screen (${device})`, () => {
    it('darkens the Light shade by default and shows it as designed when switched off', async () => {
      const app = await open(env, device);
      await seedPage(app, PAGE);
      expect(await shadeGray(app)).toBeLessThan(225);
      await shot(app, `contrast-${device}-on`);
      await choose(app, 'edit', '#view-contrast');
      expect(await app.page.evaluate(() => localStorage.getItem('dotwork.view.contrast'))).toBe('0');
      expect(await shadeGray(app)).toBe(239);
      await shot(app, `contrast-${device}-off`);
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  });
}
