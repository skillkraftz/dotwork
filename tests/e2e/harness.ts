import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { HELP } from '../../src/help';

export const SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  tabletLandscape: { width: 1180, height: 820 },
  desktop: { width: 1280, height: 800 },
} as const;
export type Device = keyof typeof SIZES;

const CANDIDATES = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

export interface Env { server: ViteDevServer; browser: Browser; url: string }

export async function start(): Promise<Env> {
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent', clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  const executablePath = CANDIDATES.find((p) => p && existsSync(p));
  const browser = await chromium.launch({ executablePath });
  return { server, browser, url };
}

export async function stop(env: Env) {
  await env.browser.close();
  await env.server.close();
}

export interface App {
  page: Page;
  ctx: BrowserContext;
  cdp: CDPSession | null;
  touch: boolean;
  errors: string[];
}

/** Open the app at a device size: phone and tablet get touch emulation, desktop a mouse. */
export async function open(env: Env, device: Device): Promise<App> {
  const touch = device !== 'desktop';
  const ctx = await env.browser.newContext({
    viewport: SIZES[device], deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, permissions: [],
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(env.url);
  await page.waitForSelector('#canvas');
  await page.evaluate(() => document.fonts.ready);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  return { page, ctx, cdp, touch, errors };
}

/** Where a grid cell (fractional allowed) is on screen, in client px, on the given canvas. */
export async function cellToClient(app: App, x: number, y: number, canvas = '#canvas') {
  return app.page.evaluate(([cx, cy, sel]) => {
    const svg = document.querySelector(sel as string) as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const p = new DOMPoint(3.95 + (cx as number) * 3, 3.85 + (cy as number) * 3).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, [x, y, canvas] as const);
}

type Pt = { x: number; y: number };
const touchPoints = (pts: Pt[]) => pts.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 1, radiusY: 1, force: 1 }));

/** Fingers on the screen, through the DevTools protocol so that several can be down at once. */
export async function touch(app: App, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) {
  await app.cdp!.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : touchPoints(pts) });
}

export async function drag(app: App, from: Pt, to: Pt, steps = 8) {
  if (!app.touch) {
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    for (let i = 1; i <= steps; i++) await app.page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await app.page.mouse.up();
    return;
  }
  await touch(app, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) await touch(app, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
  await touch(app, 'touchEnd', []);
  await settle(app);
}

/**
 * Emulated fingers act in microseconds. Wait out the browser's double-tap window so that the next tap on the same
 * button (say, the same tool again) isn't taken for the second half of a double tap, as it never would be by a person.
 */
export const settle = (app: App) => app.page.waitForTimeout(app.touch ? 350 : 0);

export async function tap(app: App, p: Pt) {
  if (app.touch) { await touch(app, 'touchStart', [p]); await touch(app, 'touchEnd', []); await settle(app); } else await app.page.mouse.click(p.x, p.y);
}

/** Hold a finger down for `ms`; leaves it down unless `release`. */
export async function press(app: App, p: Pt, ms = 650, release = true) {
  await touch(app, 'touchStart', [p]);
  await app.page.waitForTimeout(ms);
  if (release) await touch(app, 'touchEnd', []);
}

/** Two fingers moving together: a pan. */
export async function twoFingerDrag(app: App, from: Pt, dx: number, dy: number, steps = 8) {
  const at = (t: number): Pt[] => [{ x: from.x - 40 + dx * t, y: from.y + dy * t }, { x: from.x + 40 + dx * t, y: from.y + dy * t }];
  await touch(app, 'touchStart', at(0));
  for (let i = 1; i <= steps; i++) await touch(app, 'touchMove', at(i / steps));
  await touch(app, 'touchEnd', []);
  await settle(app);
}

export async function pinch(app: App, center: Pt, from: number, to: number, steps = 8) {
  const at = (d: number): Pt[] => [{ x: center.x - d / 2, y: center.y }, { x: center.x + d / 2, y: center.y }];
  await touch(app, 'touchStart', at(from));
  for (let i = 1; i <= steps; i++) await touch(app, 'touchMove', at(from + ((to - from) * i) / steps));
  await touch(app, 'touchEnd', []);
  await settle(app);
}

/** The draft page as the app keeps it. */
export async function draft(app: App): Promise<{ elements: Record<string, unknown>[] }> {
  return app.page.evaluate(() => JSON.parse(localStorage.getItem('dotwork.page') ?? '{"elements":[]}'));
}

export const box = (app: App, selector: string) => app.page.locator(selector).boundingBox();

/** Save a screenshot when SHOTS names a directory (used to make the pictures for the docs and the PR). */
export async function shot(app: App, name: string) {
  const dir = process.env.SHOTS;
  if (dir) await app.page.waitForTimeout(350); // let the sheet finish sliding
  if (dir) await app.page.screenshot({ path: `${dir}/${name}.png` });
}

export const viewBoxOf = (app: App, selector = '#canvas') =>
  app.page.locator(selector).evaluate((el) => (el.getAttribute('viewBox') ?? '').split(' ').map(Number));

/**
 * Tap or click a control, whichever the device has. An emulated tap straight after another touch is sometimes lost by the
 * browser (it does this to the old action bar too), so a finger waits out a moment first, as a person's would.
 */
export async function hit(app: App, selector: string) {
  if (!app.touch) { await app.page.click(selector); return; }
  await app.page.waitForTimeout(450);
  await app.page.tap(selector);
}

/** Open a top-bar menu ('page' or 'edit') and choose an item in it, by its id. */
export async function choose(app: App, menu: 'page' | 'edit', item: string) {
  await hit(app, `#menu-${menu}`);
  await hit(app, item);
}

/** Tap one of the five context buttons beside the modes (properties, duplicate, remove, group, more, selectAll, half, or a tool's name). */
export async function bar(app: App, action: string) {
  await hit(app, `#bar-context [data-action="${action}"]`);
}

/**
 * Open the properties drawer from the bar and wait for it. Chromium sometimes swallows the first tap after a synthetic drag or swipe (its
 * touch sequence is still closing), so if the drawer hasn't opened a moment later, tap again, as a person would.
 */
export async function openDrawer(app: App) {
  await bar(app, 'properties');
  const open = () => app.page.waitForSelector('#sheet[data-state="open"]', { timeout: 3000 }).then(() => true, () => false);
  if (!(await open())) { await bar(app, 'properties'); await app.page.waitForSelector('#sheet[data-state="open"]'); }
}

const DRAW_TOOLS = ['pattern', 'shade', 'box', 'rule', 'text'];
/** Arm a drawing tool the way a person does: pick its mode, then its button. 'select' goes back to Select mode. */
export async function tool(app: App, name: string) {
  if (name === 'select') { await hit(app, '#bar-select'); return; }
  if ((await app.page.locator(`#bar-context [data-tool="${name}"]`).count()) === 0) await hit(app, DRAW_TOOLS.includes(name) ? '#bar-draw' : '#advanced');
  await hit(app, `#bar-context [data-tool="${name}"]`);
}

/** Two fingers landing one after the other, as they do for a person: the first at `a`, a moment later the second at `b`, then moving apart. */
export async function stagger(app: App, a: Pt, b: Pt, spread = 100) {
  await touch(app, 'touchStart', [a]);
  await app.page.waitForTimeout(40);
  await touch(app, 'touchStart', [a, b]);
  const dir = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  for (let i = 1; i <= 8; i++) {
    const d = (spread * i) / 8;
    await touch(app, 'touchMove', [{ x: a.x - ((b.x - a.x) / dir) * d / 2, y: a.y - ((b.y - a.y) / dir) * d / 2 }, { x: b.x + ((b.x - a.x) / dir) * d / 2, y: b.y + ((b.y - a.y) / dir) * d / 2 }]);
  }
  await touch(app, 'touchEnd', []);
  await settle(app);
}

/** Two quick taps in the same place. */
export async function doubleTap(app: App, p: Pt) {
  await touch(app, 'touchStart', [p]);
  await touch(app, 'touchEnd', []);
  await app.page.waitForTimeout(80);
  await touch(app, 'touchStart', [p]);
  await touch(app, 'touchEnd', []);
  await settle(app);
}

/** Every visible control (button, menu item, input, select, summary, link) that has no entry in the help registry. */
export async function missingHelp(app: App): Promise<string[]> {
  return app.page.evaluate((known) => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="tab"], input, select, textarea, summary, a[href]');
    for (const el of controls) {
      if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'file')) continue;
      const style = getComputedStyle(el);
      if (el.getClientRects().length === 0 || style.visibility === 'hidden') continue;
      const key = el.dataset.help;
      const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} “${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}”`;
      if (!key) out.push(`${name}: no data-help`);
      else if (!known.includes(key)) out.push(`${name}: no help entry for “${key}”`);
    }
    return out;
  }, Object.keys(HELP));
}

/** Open the Book view's More menu and choose an item from it. */
export async function bookMore(app: App, item: string) {
  const press = async (target: ReturnType<App['page']['locator']>) => { if (app.touch) { await target.tap(); await settle(app); } else await target.click(); };
  await press(app.page.locator('[data-key="book-more"]'));
  await press(app.page.getByRole('menuitem', { name: item }));
}
