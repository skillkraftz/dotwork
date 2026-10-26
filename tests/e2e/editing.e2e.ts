import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bar, box, cellToClient, doubleTap, draft, drag, hit, open, openDrawer, pinch, press, shot, start, stop, tap, tool, touch, twoFingerDrag, viewBoxOf, type App, type Env, seedPage,} from './harness';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

const elements = async (app: App) => (await draft(app)).elements as Record<string, unknown>[];
type Pt = { x: number; y: number };

/** A page with shading, a rule over it, a label, a box and some checkboxes. */
const SEED = {
  format: 'dotwork-page', version: 2, name: 'Seed', grid: { cols: 27, rows: 44, pitch_mm: 3 },
  elements: [
    { type: 'shade', tones: 'L', x: 2, y: 3, w: 12, h: 6 },
    { type: 'rule', x1: 2, y1: 6, x2: 10, y2: 6 },
    { type: 'text', x: 3, y: 12, text: 'Notes', tone: 'black' },
    { type: 'box', x: 16, y: 3, w: 8, h: 6 },
    { type: 'checkboxes', x: 3, y: 15, count: 4 },
  ],
};

/** A saved widget: a box with a label and three checkboxes. */
const WIDGET = {
  id: 'w1', name: 'Habit row',
  elements: [
    { type: 'box', x: 0, y: 0, w: 12, h: 3 },
    { type: 'text', x: 1, y: 1, text: 'Habit', tone: 'black' },
    { type: 'checkboxes', x: 8, y: 1, count: 3, direction: 'across' },
  ],
};

async function seed(app: App, page: object = SEED, widgets: object[] = []) {
  await app.page.evaluate((w) => localStorage.setItem('dotwork.widgets', JSON.stringify(w)), widgets);
  await seedPage(app, page);
}

const selectedLayers = (app: App) => app.page.locator('#panel .layer.selected').allInnerTexts();
const centre = (app: App, x: number, y: number) => cellToClient(app, x + 0.5, y + 0.5);
const contextLabels = async (app: App) => (await app.page.locator('#bar-context button .label').allInnerTexts()).map((t) => t.trim());
/** How many px a cell is across and down on screen. */
async function cellPx(app: App) {
  const a = await cellToClient(app, 0, 0), b = await cellToClient(app, 1, 1);
  return { x: b.x - a.x, y: b.y - a.y };
}
const dbl = (app: App, p: Pt) => (app.touch ? doubleTap(app, p) : app.page.mouse.dblclick(p.x, p.y));

/** A drag that stays down, to take a picture of it; call the result to let go. */
async function dragHold(app: App, from: Pt, to: Pt) {
  if (app.touch) {
    await touch(app, 'touchStart', [from]);
    for (let i = 1; i <= 6; i++) await touch(app, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }]);
    return async () => { await touch(app, 'touchEnd', []); await app.page.waitForTimeout(350); };
  }
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  for (let i = 1; i <= 6; i++) await app.page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
  return async () => { await app.page.mouse.up(); };
}

describe('the bottom bar (phone)', () => {
  it('shows each mode’s buttons, and Select’s change with the selection', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app);
    expect(await contextLabels(app)).toEqual(['Select all', 'Half']);
    await shot(app, 'phone-select-empty');
    await tap(app, await cellToClient(app, 3, 6)); // the rule
    expect(await contextLabels(app)).toEqual(['Props', 'Copy', 'Delete', 'Group', 'More']);
    await shot(app, 'phone-select-selected');
    await hit(app, '#bar-draw');
    expect(await contextLabels(app)).toEqual(['Pattern', 'Shade', 'Box', 'Rule', 'Text']);
    await shot(app, 'phone-draw');
    await hit(app, '#advanced');
    expect(await contextLabels(app)).toEqual(['Sequence', 'Icon', 'Checks', 'Widgets', 'Art']);
    await shot(app, 'phone-advanced');
    await hit(app, '#bar-select');
    await bar(app, 'more');
    await page.waitForSelector('.ctx-menu');
    expect((await page.locator('.ctx-menu button').allInnerTexts()).map((t) => t.trim())).toEqual(['Bring forward', 'Send backward', 'Select underneath', 'Save as widget', 'Half cells: off']);
    await shot(app, 'phone-more');
    expect(app.errors).toEqual([]);
  });

  it('has Select all, Delete and Duplicate act on the whole selection', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    await bar(app, 'selectAll');
    expect(await selectedLayers(app)).toHaveLength(5);
    await bar(app, 'duplicate');
    expect(await elements(app)).toHaveLength(10);
    await bar(app, 'remove');
    expect(await elements(app)).toHaveLength(5); // the five copies were the selection
    expect(app.errors).toEqual([]);
  });
});

describe('the properties drawer (phone)', () => {
  it('slides up from the bar and scrolls the page so the selection stays in view above it', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await seed(app, { ...SEED, elements: [{ type: 'box', x: 4, y: 36, w: 10, h: 5 }] });
    await tap(app, await cellToClient(app, 4, 38));
    const before = await viewBoxOf(app);
    const selBefore = (await page.locator('#content rect[stroke-dasharray]').first().boundingBox())!;
    await openDrawer(app);
    await page.waitForTimeout(350);
    const drawer = (await box(app, '#sheet'))!;
    const tools = (await box(app, '#tools'))!;
    expect(drawer.y + drawer.height).toBeCloseTo(tools.y, 0); // sits right on the bar
    const sel = (await page.locator('#content rect[stroke-dasharray]').first().boundingBox())!;
    expect(selBefore.y + selBefore.height).toBeGreaterThan(drawer.y); // it was under where the drawer is now
    expect(sel.y + sel.height).toBeLessThanOrEqual(drawer.y); // and now it is above
    expect(await viewBoxOf(app)).not.toEqual(before);
    await shot(app, 'phone-drawer');

    // the bottom bar stays in reach, and the page stays usable while the drawer is open
    expect(await page.locator('#bar-context [data-action="remove"]').isVisible()).toBe(true);
    await hit(app, '#sheet .sheet-close');
    await page.waitForTimeout(350);
    expect(await viewBoxOf(app)).toEqual(before); // closing puts the page back
    expect(app.errors).toEqual([]);
  });

  it('opens with a double-tap too', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    await doubleTap(app, await cellToClient(app, 16, 6)); // the box's left side
    expect(await app.page.locator('#sheet').getAttribute('data-state')).toBe('open');
    expect(app.errors).toEqual([]);
  });
});

describe('selecting with fingers (phone)', () => {
  it('a one-finger drag on empty space draws a box and selects everything it touches', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    const view = await viewBoxOf(app);
    const release = await dragHold(app, await cellToClient(app, 25, 13), await cellToClient(app, 1, 8));
    expect(await app.page.locator('#content rect[fill="rgba(0,0,0,0.04)"]').count()).toBe(1); // the box is drawn while dragging
    await shot(app, 'phone-drag-select');
    await release();
    expect(await selectedLayers(app)).toHaveLength(3); // the shade, the box and the label
    expect(await selectedLayers(app)).toEqual(expect.arrayContaining([expect.stringContaining('shade'), expect.stringContaining('box'), expect.stringContaining('text')]));
    expect(await viewBoxOf(app)).toEqual(view); // one finger never pans
    expect(await elements(app)).toEqual(SEED.elements); // nothing moved
    await shot(app, 'phone-drag-selected');
    expect(app.errors).toEqual([]);
  });

  it('a box that touches nothing clears the selection', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    await tap(app, await cellToClient(app, 3, 6));
    expect(await selectedLayers(app)).toHaveLength(1);
    await drag(app, await cellToClient(app, 25, 30), await cellToClient(app, 18, 26));
    expect(await selectedLayers(app)).toHaveLength(0);
  });

  it('two fingers pan, and one finger does not', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    const middle = await cellToClient(app, 13, 30); // empty space
    await pinch(app, middle, 80, 200); // zoom in first, so that there is somewhere to pan to
    const zoomed = await viewBoxOf(app);
    await drag(app, middle, { x: middle.x - 50, y: middle.y + 30 });
    expect(await viewBoxOf(app)).toEqual(zoomed); // one finger: a selection box, no pan
    await twoFingerDrag(app, middle, -50, 30);
    const panned = await viewBoxOf(app);
    expect(panned[0]).toBeGreaterThan(zoomed[0]);
    expect(panned[1]).toBeLessThan(zoomed[1]);
    expect(panned[2]).toBeCloseTo(zoomed[2], 3);
    expect(await elements(app)).toEqual(SEED.elements);
  });

  it('a near-miss tap selects the nearest element within about 6 mm', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    // 14 px below the thin rule, which lies over a shaded area: the rule, not the shade
    const onRule = await cellToClient(app, 6, 6);
    await tap(app, { x: onRule.x, y: onRule.y + 14 });
    expect(await selectedLayers(app)).toEqual([expect.stringContaining('rule')]);
    await tap(app, await cellToClient(app, 22, 40)); // empty space clears
    // well past the end of the rule (more than 6 mm): the shade underneath is what was tapped
    await tap(app, await cellToClient(app, 12.5, 7.5));
    expect(await selectedLayers(app)).toEqual([expect.stringContaining('shade')]);
    await tap(app, await cellToClient(app, 22, 40));
    // small text: 3 cells right of the label's end, still within reach of a fingertip's slop
    const label = await centre(app, 3, 12);
    await tap(app, { x: label.x, y: label.y + 18 });
    expect(await selectedLayers(app)).toEqual([expect.stringContaining('text')]);
    // too far from anything: nothing
    await tap(app, await cellToClient(app, 22, 40));
    expect(await selectedLayers(app)).toHaveLength(0);
    expect(app.errors).toEqual([]);
  });
});

describe('groups (phone)', () => {
  /** Place the saved widget with its corner at (4, 20), on the seed page. */
  async function placed(app: App) {
    await seed(app, SEED, [WIDGET]);
    await tool(app, 'widget');
    await app.page.waitForSelector('.widget-row');
    await hit(app, '[data-key="widget-use"]');
    await app.page.waitForSelector('dialog.advanced', { state: 'hidden' });
    await tap(app, await cellToClient(app, 4, 20));
  }
  const groups = async (app: App) => (await elements(app)).map((e) => e.group);

  it('a placed widget stays grouped: tap any part for the whole, drag to move it as one', async () => {
    const app = await open(env, 'phone');
    await placed(app);
    expect(await groups(app)).toEqual([undefined, undefined, undefined, undefined, undefined, 'g1', 'g1', 'g1']);
    expect(await selectedLayers(app)).toHaveLength(3); // the widget is selected as it lands
    expect(await contextLabels(app)).toEqual(['Props', 'Copy', 'Delete', 'Ungroup', 'More']);
    await shot(app, 'phone-group-selected');

    await tap(app, await cellToClient(app, 2, 40)); // clear
    await tap(app, await centre(app, 5, 21)); // on the label only
    expect(await selectedLayers(app)).toHaveLength(3);

    const before = await elements(app);
    const from = await cellToClient(app, 5, 21);
    await drag(app, from, { x: from.x + 3 * (await cellPx(app)).x, y: from.y }); // three cells right
    const after = await elements(app);
    expect(after.slice(0, 5)).toEqual(before.slice(0, 5)); // the rest of the page stayed
    for (let i = 5; i < 8; i++) expect(after[i].x).toBe((before[i].x as number) + 3);
    expect(app.errors).toEqual([]);
  });

  it('a double-tap goes inside a group: pieces move on their own, and a tap outside leaves', async () => {
    const app = await open(env, 'phone');
    await placed(app);
    await tap(app, await cellToClient(app, 2, 40));
    expect(await app.page.locator('#group-banner').isVisible()).toBe(false);

    await doubleTap(app, await centre(app, 5, 21)); // the label
    expect(await app.page.locator('#group-banner').isVisible()).toBe(true);
    expect(await app.page.locator('#group-banner').innerText()).toContain('Editing inside a group');
    expect(await selectedLayers(app)).toEqual([expect.stringContaining('text')]); // just the piece that was tapped
    expect(await app.page.locator('#content g[opacity="0.3"]').count()).toBe(5); // the rest of the page is dimmed
    await shot(app, 'phone-inside-group');

    // move the label alone, by one cell down
    const before = await elements(app);
    const label = await centre(app, 5, 21);
    await drag(app, label, { x: label.x, y: label.y + (await cellPx(app)).y });
    const moved = await elements(app);
    expect(moved[6]).toMatchObject({ y: (before[6].y as number) + 1 });
    expect(moved[5]).toEqual(before[5]);
    expect(moved[7]).toEqual(before[7]);

    // tapping another piece selects that piece alone, still inside
    await tap(app, await centre(app, 13, 21));
    expect(await selectedLayers(app)).toEqual([expect.stringContaining('checkboxes')]);
    expect(await app.page.locator('#group-banner').isVisible()).toBe(true);

    // a tap outside the group leaves it
    await tap(app, await cellToClient(app, 2, 40));
    expect(await app.page.locator('#group-banner').isVisible()).toBe(false);
    expect(await app.page.locator('#content g[opacity="0.3"]').count()).toBe(0);
    await tap(app, await centre(app, 5, 22));
    expect(await selectedLayers(app)).toHaveLength(3); // back to the whole group

    // Done leaves too
    await doubleTap(app, await centre(app, 5, 22));
    expect(await app.page.locator('#group-banner').isVisible()).toBe(true);
    await hit(app, '#group-done');
    expect(await app.page.locator('#group-banner').isVisible()).toBe(false);
    expect(app.errors).toEqual([]);
  });

  it('respaces the pieces of a group from the properties drawer', async () => {
    const app = await open(env, 'phone');
    await placed(app);
    await doubleTap(app, await centre(app, 13, 21)); // the checkboxes
    await openDrawer(app);
    await app.page.waitForTimeout(350);
    const every = app.page.locator('[data-key="prop-every"]');
    await every.scrollIntoViewIfNeeded();
    await every.fill('2');
    await every.blur();
    expect((await elements(app))[7]).toMatchObject({ type: 'checkboxes', every: 2, group: 'g1' });
    expect(app.errors).toEqual([]);
  });

  it('Group ties a selection together and Ungroup lets it go', async () => {
    const app = await open(env, 'phone');
    await seed(app);
    await drag(app, await cellToClient(app, 25, 13), await cellToClient(app, 1, 8)); // shade, box and label
    expect(await contextLabels(app)).toEqual(['Props', 'Copy', 'Delete', 'Group', 'More']);
    await bar(app, 'group');
    // The first tap after a synthetic drag can be swallowed by Chromium; a person would tap again.
    if ((await groups(app)).every((g) => g === undefined)) await bar(app, 'group');
    expect((await elements(app)).map((e) => e.group)).toEqual(['g1', undefined, 'g1', 'g1', undefined]);
    expect(await contextLabels(app)).toEqual(['Props', 'Copy', 'Delete', 'Ungroup', 'More']);
    await tap(app, await cellToClient(app, 2, 40));
    await tap(app, await cellToClient(app, 16, 6)); // the box's side takes all three
    expect(await selectedLayers(app)).toHaveLength(3);
    await bar(app, 'duplicate');
    expect((await elements(app)).map((e) => e.group)).toContain('g2'); // a copy of a group is a group of its own
    await bar(app, 'group'); // Ungroup, for the copies
    expect((await elements(app)).filter((e) => e.group === 'g2')).toHaveLength(0);
    await hit(app, '#undo');
    await hit(app, '#undo'); // the ungroup, then the copy
    expect((await elements(app)).map((e) => e.group)).toEqual(['g1', undefined, 'g1', 'g1', undefined]);
    expect(app.errors).toEqual([]);
  });

  it('a long-press still opens the element menu, on a group member too', async () => {
    const app = await open(env, 'phone');
    await placed(app);
    await press(app, await centre(app, 5, 21));
    await app.page.waitForSelector('.ctx-menu');
    expect(await selectedLayers(app)).toHaveLength(3);
  });
});

describe('shade and pattern properties', () => {
  for (const device of ['phone', 'tablet', 'desktop'] as const) {
    it(`edits tones, direction and every, with a live strip (${device})`, async () => {
      const app = await open(env, device);
      const { page } = app;
      await tool(app, 'shade');
      await drag(app, await cellToClient(app, 3, 6), await cellToClient(app, 22, 16));
      expect(await elements(app)).toEqual([{ type: 'shade', x: 3, y: 6, w: 19, h: 10, tones: 'L' }]);
      if (device !== 'desktop') { await openDrawer(app); await page.waitForTimeout(350); } else await bar(app, 'properties');

      const tones = page.locator('#panel [data-key="prop-tones"]');
      await tones.scrollIntoViewIfNeeded();
      await tones.fill('');
      await tones.pressSequentially('lbbmbb', { delay: 30 });
      expect(await tones.inputValue()).toBe('LBBMBB'); // capitals, as typed letters become tones
      expect(await elements(app)).toMatchObject([{ tones: 'LBBMBB' }]);
      await tones.pressSequentially('x'); // a letter that is not a tone is dropped
      expect(await tones.inputValue()).toBe('LBBMBB');
      // the strip shows the pattern: the light and the medium tones are in it
      const strip = page.locator('#panel .tone-strip svg');
      expect(await strip.locator('rect[fill="#efefef"]').count()).toBe(2); // 12 steps of LBBMBB: L at 0 and 6
      expect(await strip.locator('rect[fill="#dcdcdc"]').count()).toBe(2);
      await tones.fill('LB');
      expect(await strip.locator('rect[fill="#efefef"]').count()).toBe(6);
      await tones.fill('L'); // typed live: the strip follows before anything is applied elsewhere
      expect(await strip.locator('rect[fill="#efefef"]').count()).toBe(12);
      await tones.fill('LB');

      await page.locator('#panel select[data-key="prop-along"]').selectOption('checker');
      expect(await elements(app)).toMatchObject([{ tones: 'LB', along: 'checker' }]);
      expect(await strip.locator('rect').count()).toBe(36); // three rows of twelve
      await page.locator('#panel select[data-key="prop-along"]').selectOption('columns');
      const every = page.locator('#panel [data-key="prop-every"]');
      await every.fill('0.5');
      await every.blur();
      expect(await elements(app)).toMatchObject([{ along: 'columns', every: 0.5 }]);
      await page.locator('#panel select[data-key="prop-along"]').selectOption('checker');
      await every.fill('1');
      await every.blur();
      await shot(app, `${device}-shade-properties`);

      // the page draws what the strip showed: rows, columns and a checker of light tiles
      const light = () => page.locator('#canvas #content rect[fill="#efefef"]').count();
      await page.locator('#panel select[data-key="prop-along"]').selectOption('rows');
      expect(await light()).toBe(5); // LB over ten rows: five light rows
      await page.locator('#panel select[data-key="prop-along"]').selectOption('columns');
      expect(await light()).toBe(10); // LB over nineteen columns: ten light columns
      await page.locator('#panel select[data-key="prop-along"]').selectOption('checker');
      expect(await light()).toBe(95); // a light tile on every other cell of ten rows of nineteen
      expect(app.errors).toEqual([]);
      await app.ctx.close();
    });
  }

  it('gives pattern lines a weight, dots a size, and lines a first edge', async () => {
    const app = await open(env, 'phone');
    const { page } = app;
    await tool(app, 'pattern');
    await drag(app, await cellToClient(app, 3, 6), await cellToClient(app, 22, 14));
    await openDrawer(app);
    await page.waitForTimeout(350);
    const canvasHas = (sel: string) => page.locator(`#canvas #content ${sel}`).count();
    const lines = () => page.locator('#canvas #content path[fill="none"][stroke-linecap="butt"]').first().getAttribute('d');

    expect(await canvasHas('path[stroke="#c4c4c4"]')).toBeGreaterThan(0); // hair by default
    const rowsBefore = ((await lines()) ?? '').split('H').length - 1;
    await page.locator('#panel [data-key="prop-first"]').scrollIntoViewIfNeeded();
    await page.locator('#panel [data-key="prop-first"]').tap();
    expect(await elements(app)).toMatchObject([{ pattern: 'lines', first: true }]);
    expect((((await lines()) ?? '').split('H').length - 1) - rowsBefore).toBe(1); // the top line is there too

    await page.locator('#panel select[data-key="prop-weight"]').selectOption('thick');
    expect(await elements(app)).toMatchObject([{ weight: 'thick' }]);
    expect(await canvasHas('path[stroke="#000"][stroke-width="0.529"]')).toBe(1);
    await page.locator('#panel select[data-key="prop-weight"]').selectOption('thin');
    expect(await canvasHas('path[stroke="#000"][stroke-width="0.176"]')).toBe(1);

    await page.locator('#panel select[data-key="prop-pattern"]').selectOption('vlines');
    expect(await page.locator('#panel [data-key="prop-first"]').count()).toBe(1); // vlines: the left line
    await page.locator('#panel select[data-key="prop-pattern"]').selectOption('dots');
    expect(await page.locator('#panel [data-key="prop-first"]').count()).toBe(0);
    expect(await elements(app)).toMatchObject([{ pattern: 'dots', x: 3, y: 6, w: 19, h: 8 }]);
    expect((await elements(app))[0]).not.toHaveProperty('weight');
    expect((await elements(app))[0]).not.toHaveProperty('first');
    await page.locator('#panel select[data-key="prop-dots"]').selectOption('large');
    expect(await canvasHas('path[stroke-width="0.9"]')).toBe(1);
    expect(app.errors).toEqual([]);
  });
});

describe('every screen size', () => {
  for (const device of ['tablet', 'desktop'] as const) {
    it(`${device}: the bar, the drawer or panel, drag-select and editing inside a group`, async () => {
      const app = await open(env, device);
      const { page } = app;
      await seed(app, SEED, [WIDGET]);
      await shot(app, `${device}-select-empty`);
      await hit(app, '#bar-draw');
      await shot(app, `${device}-draw`);
      await hit(app, '#advanced');
      await shot(app, `${device}-advanced`);
      await hit(app, '#bar-select');

      const release = await dragHold(app, await cellToClient(app, 25, 13), await cellToClient(app, 1, 8));
      await shot(app, `${device}-drag-select`);
      await release();
      expect(await selectedLayers(app)).toHaveLength(3);
      await shot(app, `${device}-select-selected`);
      await bar(app, 'properties');
      // an emulated tap straight after a held drag is sometimes dropped by the browser: a person would just tap again
      if (device === 'tablet' && !(await page.locator('#sheet[data-state="open"]').count())) { await page.waitForTimeout(800); if (!(await page.locator('#sheet[data-state="open"]').count())) await bar(app, 'properties'); }
      if (device === 'tablet') { await page.waitForSelector('#sheet[data-state="open"]'); }
      await shot(app, `${device}-properties`);
      if (device === 'tablet') await hit(app, '#sheet .sheet-close');

      await tool(app, 'widget');
      await page.waitForSelector('.widget-row');
      await hit(app, '[data-key="widget-use"]');
      await tap(app, await cellToClient(app, 4, 20));
      expect(await selectedLayers(app)).toHaveLength(3);
      await tap(app, await cellToClient(app, 2, 40));
      await dbl(app, await centre(app, 5, 21));
      expect(await page.locator('#group-banner').isVisible()).toBe(true);
      await shot(app, `${device}-inside-group`);
      expect(app.errors).toEqual([]);
    });
  }
});
