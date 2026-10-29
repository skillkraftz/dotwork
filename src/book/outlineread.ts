import type { Page } from '../format/types';
import { readPage } from '../format/read';
import { DATE_KINDS, fitsTo, MAX_BLOCKS, MAX_REPEAT, oldDateOutlines, takesRest, type Block, type Child, type DateKind, type Link, type Pin, type Repeat } from './outline';

type Fail = (rule: string, path: string, message: string) => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a parsed outline against the book rules (docs/book-format.md): every page inside is a valid page, a spread's pages are on
 * their sides, repeats and pins are in range, page types fit the repeats, a group holds page, spread and free-pages blocks with a number of times each, and
 * at most one top-level block takes what is left. Returns the blocks, or undefined when something was wrong (each failure is reported). A book made with the old date
 * settings (`{ each }` repeats) opens with those repeats Once and every block Plain, and its layout says to set the page types again.
 */
export function readOutline(raw: unknown, fail: Fail, at = 'outline'): Block[] | undefined {
  let ok = true, old = false;
  const bad = (rule: string, path: string, message: string) => { ok = false; fail(rule, path, message); };
  if (!Array.isArray(raw)) { bad('outline', at, '"outline" is required and must be a list of blocks (it may be empty).'); return undefined; }
  if (raw.length > MAX_BLOCKS) { bad('outline', at, `An outline holds at most ${MAX_BLOCKS} blocks, got ${raw.length}.`); return undefined; }

  const page = (v: unknown, path: string, side?: 'left' | 'right'): Page | null | undefined => {
    const r = readPage(v);
    if (!r.ok) { for (const i of r.issues) bad(i.rule, i.path === '(file)' ? path : `${path}.${i.path}`, i.message); return undefined; }
    if (side && r.page.side !== side) bad('spread-side', `${path}.side`, `The ${side} page of a spread must have "side": "${side}" (got ${JSON.stringify(r.page.side)}).`);
    return r.page;
  };
  const link = (v: unknown, path: string): Link | undefined => {
    if (v === undefined) return undefined;
    if (!isObject(v) || typeof v.id !== 'string' || typeof v.fingerprint !== 'string') { bad('from', path, '"from" must be {"id": string, "fingerprint": string}.'); return undefined; }
    return { id: v.id, fingerprint: v.fingerprint };
  };
  const repeat = (v: unknown, path: string, top: boolean): Repeat | undefined => {
    const keys = isObject(v) ? Object.keys(v).sort().join() : '';
    if (isObject(v) && keys === 'times' && Number.isInteger(v.times) && (v.times as number) >= 1 && (v.times as number) <= MAX_REPEAT) return { times: v.times as number };
    if (isObject(v) && keys === 'fill' && v.fill === true) {
      if (top) return { fill: true };
      bad('repeat', path, '"repeat" can only be {"fill": true} on a top-level page, spread or group block.');
      return undefined;
    }
    if (isObject(v) && keys === 'to' && (v.to === 'week' || v.to === 'month')) return { to: v.to };
    // The old date settings: each day, week or month of the calendar (or of a group's span). They become Once.
    if (isObject(v) && (keys === 'each' || keys === 'each,of')) { old = true; return { times: 1 }; }
    bad('repeat', path, `"repeat" must be {"times": 1 to ${MAX_REPEAT}}${top ? ', {"fill": true}' : ''} or {"to": "week" | "month"}, got ${JSON.stringify(v)}.`);
    return undefined;
  };
  const pin = (v: unknown, path: string): Pin | undefined => {
    if (v === undefined) return undefined;
    if (v === 'last' || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_REPEAT)) return v as Pin;
    bad('pin', path, `"pin" must be a page number from 1 to ${MAX_REPEAT}, or "last", got ${JSON.stringify(v)}.`);
    return undefined;
  };

  /** One block; `top` is false inside a group, where a block repeats a number of times and is never pinned. */
  const block = (v: unknown, p: string, top: boolean): Block | Child | undefined => {
    if (!isObject(v)) { bad('block', p, 'A block must be an object.'); return undefined; }
    const where = (key: string) => `${p}.${key}`;
    if (!top && v.pin !== undefined) bad('pin', where('pin'), 'A block inside a group can’t be pinned.');
    if (v.type === 'free') {
      if (!Array.isArray(v.pages)) { bad('free', where('pages'), '"pages" must be a list of pages (null for a blank one).'); return undefined; }
      const pages = v.pages.map((x, i) => (x === null ? null : page(x, `${where('pages')}[${i}]`)));
      if (v.pin !== undefined) bad('pin', where('pin'), 'Free pages take what is left, so they can’t be pinned.');
      return pages.some((x) => x === undefined) ? undefined : { type: 'free', pages: pages as (Page | null)[] };
    }
    const rep = repeat(v.repeat, where('repeat'), top);
    if (v.type === 'group' && v.dates !== undefined) bad('dates', where('dates'), 'A group has no page type: its page and spread blocks do.');
    const dates = v.dates === undefined ? undefined : DATE_KINDS.find((k) => k === v.dates);
    if (v.dates !== undefined && v.type !== 'group' && !dates) bad('dates', where('dates'), `"dates" must be ${DATE_KINDS.map((k) => `"${k}"`).join(', ')}, got ${JSON.stringify(v.dates)}.`);
    if (rep && 'to' in rep && v.type !== 'group') {
      if (dates && !fitsTo(dates, rep.to)) bad('repeat', where('repeat'), `A "${dates}" page can't repeat to the end of the ${rep.to}.`);
      else if (v.dates === undefined) bad('repeat', where('repeat'), '{"to": …} needs a page type ("dates"): a Day page runs to the end of the week or month, a Week page to the end of the month.');
    }
    if (v.type === 'group' && rep && 'to' in rep) bad('repeat', where('repeat'), 'A group repeats {"times": n} or {"fill": true}.');
    if (v.shared !== undefined && typeof v.shared !== 'boolean') bad('shared', where('shared'), '"shared" must be true or false.');
    const pn = top ? pin(v.pin, where('pin')) : undefined;
    const from = link(v.from, where('from'));
    if (pn !== undefined && rep && 'fill' in rep) bad('pin', where('pin'), 'A block can’t both fill what is left and be pinned.');
    const extra = { ...(dates ? { dates: dates as DateKind } : {}), ...(pn !== undefined ? { pin: pn } : {}), ...(from ? { from } : {}) };
    if (v.type === 'page') {
      const pg = v.page === null ? null : page(v.page, where('page'));
      return pg === undefined || !rep ? undefined : { type: 'page', page: pg, repeat: rep, ...extra };
    }
    if (v.type === 'spread') {
      if (typeof v.name !== 'string') bad('name', where('name'), '"name" is required and must be a string.');
      const left = page(v.left, where('left'), 'left'), right = page(v.right, where('right'), 'right');
      return !left || !right || !rep || typeof v.name !== 'string' ? undefined : { type: 'spread', name: v.name, left, right, repeat: rep, ...(typeof v.shared === 'boolean' ? { shared: v.shared } : {}), ...extra };
    }
    if (v.type === 'group') {
      if (!top) { bad('group', where('type'), 'Groups don’t nest: a group holds page, spread and free-pages blocks.'); return undefined; }
      if (typeof v.name !== 'string') bad('name', where('name'), '"name" is required and must be a string.');
      if (!Array.isArray(v.children)) { bad('group', where('children'), '"children" must be a list of blocks.'); return undefined; }
      const children = v.children.map((c, i) => block(c, `${where('children')}[${i}]`, false)) as (Child | undefined)[];
      return children.some((c) => !c) || !rep || typeof v.name !== 'string' ? undefined : { type: 'group', name: v.name, children: children as Child[], repeat: rep, ...(pn !== undefined ? { pin: pn } : {}) };
    }
    bad('block', where('type'), `"type" must be page, spread, free or group, got ${JSON.stringify(v.type)}.`);
    return undefined;
  };

  const blocks = raw.map((v, i) => block(v, `${at}[${i}]`, true));
  const rest = (blocks.filter(Boolean) as Block[]).filter(takesRest);
  if (rest.length > 1) bad('rest', at, 'Only one block may take what is left: a fill, or free pages.');
  if (ok && old) oldDateOutlines.add(blocks as Block[]);
  return ok ? (blocks as Block[]) : undefined;
}
