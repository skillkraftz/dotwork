import type { Page } from '../format/types';
import { readingOf, spansOf, type Calendar } from '../format/calendar';
import type { Reading, Unit } from '../format/tokens';
import { notesPage } from '../builtin/pages';

// A book is an outline: an ordered list of blocks. The pages it prints are worked out from it by `layoutOutline`, the one
// function that says what is on which page. See docs/book-format.md.

/** The design a block was placed from (its Library id) and a fingerprint of that design as it was placed. Recorded, not used yet. */
export interface Link { id: string; fingerprint: string }

/**
 * How often a block is placed: a number of times, as many times as use up the pages the others leave, or once for each day, week
 * or month of the book's calendar. Inside a group that repeats by week or month, a block can instead repeat once for each day
 * or week of the group's span (`of: 'span'`).
 */
export type Repeat = { times: number } | { fill: true } | { each: Unit } | { each: 'day' | 'week'; of: 'span' };
/** A page number, or the last page of the book (which follows the book if it is resized). */
export type Pin = number | 'last';

export interface PageBlock { type: 'page'; /** null is a blank page. */ page: Page | null; repeat: Repeat; pin?: Pin; from?: Link }
/**
 * `shared` sets whether both pages read the same day, week or month. Left out, a spread that repeats each day or week gives each page
 * its own (two a repeat: the left page k, the right page k+1) and one that repeats each month gives both pages the one month.
 */
export interface SpreadBlock { type: 'spread'; name: string; left: Page; right: Page; repeat: Repeat; shared?: boolean; pin?: Pin; from?: Link }
/**
 * Pages the owner fills by hand. At the top level the block takes whatever pages the others leave (blank, or the design
 * kept in `pages`); inside a group it is exactly its `pages` (one blank page when empty) for each repeat of the group.
 */
export interface FreeBlock { type: 'free'; pages: (Page | null)[] }
/** Page, spread and free-page blocks that repeat together. Groups don't nest. */
export interface GroupBlock { type: 'group'; name: string; children: Child[]; repeat: Repeat; pin?: Pin }
export type Child = PageBlock | SpreadBlock | FreeBlock;
export type Block = Child | GroupBlock;

export const MAX_REPEAT = 400;
export const MAX_BLOCKS = 200;

export const isFill = (b: Block): boolean => b.type !== 'free' && 'fill' in b.repeat;
export const timesOf = (r: Repeat): number => ('times' in r ? r.times : 1);
/** Whether a repeat follows the calendar (each day, week or month of it, or of a group's span). */
export const isEach = (r: Repeat): r is Extract<Repeat, { each: Unit }> => 'each' in r;
/** Whether a top-level block takes what the others leave: free pages, or a fill. */
export const takesRest = (b: Block): boolean => b.type === 'free' || isFill(b);

// ---- what a layout is ---------------------------------------------------------------

/** What lands on one page of the book. */
export interface Cell {
  kind: 'content' | 'gap' | 'free';
  /** The design; null is a blank page. A gap page is a Notes page. */
  page: Page | null;
  /** The top-level block it comes from. */
  block: number;
  /** For a block inside a group: which child. */
  child?: number;
  /** For a free page: which of the block's `pages` it is. */
  free?: number;
  /** What its tokens read: a day, a week or a month of the calendar; null when nothing is dated (no calendar, or outside it). */
  read: Reading | null;
}

/** What a top-level block did. */
export interface Row {
  block: number;
  /** Pages it takes, counting gap pages inside it (a group of spreads) but not the ones before it. */
  pages: number;
  /** Its first and last page number, or null when it takes none. */
  first: number | null;
  last: number | null;
  /** How many times it is placed (for free pages, how many pages it takes). */
  repeats: number;
  /** The gap pages (page numbers) just before it, kept so a spread starts on a left page. */
  gaps: number[];
  /** Gap pages inside it. */
  innerGaps: number;
  /** For free pages: the ones kept that don't fit in the book, as their index in `pages`. */
  beyond: number[];
}

export interface Layout {
  /** Page 1 is index 0; always `count` entries, null where nothing is placed (a blank page). */
  cells: (Cell | null)[];
  rows: Row[];
  /** Pages the blocks take, gap pages included. */
  used: number;
  /** The last page number anything lands on, which is more than the book has when it is over. */
  end: number;
  /** How many pages past the end of the book the blocks reach. */
  over: number;
  /** Things that don't work as set (pins in each other's way), one sentence each. */
  issues: string[];
}

interface Atom { pages: (Page | null)[]; /** What each page reads. */ reads: (Reading | null)[]; free?: number; child?: number }

const pinOf = (b: Block): Pin | undefined => (b.type === 'free' ? undefined : b.pin);

const blockName = (b: Block) => (b.type === 'page' ? b.page?.name || 'Blank' : b.type === 'free' ? 'Free pages' : b.name);

/** What each repeat of an `each` repeat reads. Without a calendar (or a span to read) there is one repeat and it is undated. */
function eachReads(r: Extract<Repeat, { each: Unit }>, cal: Calendar | undefined, span: Reading | null): (Reading | null)[] {
  if (!cal || ('of' in r && !span)) return [null];
  return spansOf(cal, r.each, 'of' in r && span ? span : undefined).map((s) => readingOf(cal, s));
}

/** What each repeat of a repeat reads: its day, week or month, or the span it sits in. `times` is how often a plain repeat runs. */
const repeatReads = (r: Repeat, times: number, cal: Calendar | undefined, span: Reading | null) =>
  isEach(r) ? { reads: eachReads(r, cal, span), unit: r.each } : { reads: Array.from({ length: times }, () => span), unit: null };

/** Atoms of a page or spread block, one for each thing it reads. */
function pageAtoms(c: PageBlock | SpreadBlock, child: number | undefined, times: number, cal: Calendar | undefined, span: Reading | null): Atom[] {
  const { reads, unit } = repeatReads(c.repeat, times, cal, span);
  if (c.type === 'page') return reads.map((r) => ({ pages: [c.page], reads: [r], child }));
  if (c.shared ?? (unit === null || unit === 'month')) return reads.map((r) => ({ pages: [c.left, c.right], reads: [r, r], child }));
  const out: Atom[] = [];
  for (let i = 0; i < reads.length; i += 2) out.push({ pages: [c.left, c.right], reads: [reads[i], reads[i + 1] ?? null], child });
  return out;
}

/** The pages of a free block inside a group, one atom each (one blank page when it holds none). */
const freeAtoms = (c: FreeBlock, child: number | undefined, span: Reading | null): Atom[] =>
  (c.pages.length ? c.pages : [null]).map((page, j) => ({ pages: [page], reads: [span], free: j, child }));

/** `times` repeats of what a block holds (for a block that follows the calendar, one for each day, week or month instead). */
function atomsOf(b: Block, cal: Calendar | undefined, times: number): Atom[] {
  if (b.type === 'free') return Array.from({ length: times }, () => freeAtoms(b, undefined, null)).flat();
  if (b.type === 'page' || b.type === 'spread') return pageAtoms(b, undefined, times, cal, null);
  return repeatReads(b.repeat, times, cal, null).reads.flatMap((span) =>
    b.children.flatMap((c, k) => (c.type === 'free' ? freeAtoms(c, k, span) : pageAtoms(c, k, timesOf(c.repeat), cal, span))));
}

const widthOf = (atoms: Atom[]) => atoms.reduce((n, a) => n + a.pages.length, 0);

const gapCell = (block: number): Cell => ({ kind: 'gap', page: notesPage(), block, read: null });

/**
 * Put atoms down from slot `start`, skipping slots `taken`. A spread starts on a left (even) page: where it would land on a
 * right one, or where its second page is taken, a gap page goes in first. Returns the slot after the last one used, and
 * whether a taken slot was in the way.
 */
function put(atoms: Atom[], start: number, block: number, taken: (n: number) => boolean, out: Map<number, Cell>): { next: number; hit: boolean } {
  let p = start, hit = false;
  const skip = () => { while (taken(p)) { p++; hit = true; } };
  for (const a of atoms) {
    skip();
    if (a.pages.length === 2) {
      while (p % 2 === 1 || taken(p + 1)) { out.set(p, gapCell(block)); p++; skip(); }
    }
    a.pages.forEach((page, i) => out.set(p + i, { kind: a.free !== undefined ? 'free' : 'content', page, block, read: a.reads[i] ?? null, child: a.child, free: a.free }));
    p += a.pages.length;
  }
  return { next: p, hit };
}

const lastOf = (m: Map<number, Cell>) => { let e = 0; for (const k of m.keys()) if (k > e) e = k; return e; };

/**
 * Work out what is on every page of a book of `count` pages. Pinned blocks are placed first, at their page; the others follow
 * one after another from page 1, flowing around the pinned pages. The one block that takes the rest (a fill, or free pages)
 * takes as many pages as still fit, so a book keeps its length. Blocks that need more pages than the book has run past the
 * end: `over` says by how many.
 */
export function layoutOutline(outline: readonly Block[], count: number, cal?: Calendar): Layout {
  const issues: string[] = [];
  const pinned = new Map<number, Cell>();
  const rest = outline.findIndex((b) => pinOf(b) === undefined && takesRest(b));
  const repeats = (b: Block) => (b.type === 'free' ? 1 : isEach(b.repeat) ? repeatReads(b.repeat, 0, cal, null).reads.length : timesOf(b.repeat));

  outline.forEach((b, i) => {
    const pin = pinOf(b);
    if (pin === undefined) return;
    const atoms = atomsOf(b, cal, repeats(b));
    const width = widthOf(atoms);
    const taken = (n: number) => pinned.has(n);
    let start = typeof pin === 'number' ? pin : Math.max(1, count - width + 1);
    let out = new Map<number, Cell>(), r = put(atoms, start, i, taken, out);
    if (pin === 'last') {
      // The block ends on the last page: move the start back by what gap pages added.
      for (let tries = 0; tries < width + 2 && lastOf(out) > count && start > 1; tries++) {
        start = Math.max(1, start - (lastOf(out) - count));
        out = new Map();
        r = put(atoms, start, i, taken, out);
      }
    }
    if (r.hit) issues.push(`“${blockName(b)}” is pinned to ${pin === 'last' ? 'the last page' : `page ${pin}`}, but other pinned pages are in the way.`);
    for (const [n, cell] of out) pinned.set(n, cell);
  });

  /** Everything not pinned, with the block that takes the rest given `k` repeats (or, for free pages, `k` pages). */
  const flow = (k: number): Map<number, Cell> => {
    const out = new Map<number, Cell>();
    let p = 1;
    outline.forEach((b, i) => {
      if (pinOf(b) !== undefined) return;
      let atoms: Atom[];
      if (i === rest && b.type === 'free') atoms = Array.from({ length: k }, (_, j) => ({ pages: [b.pages[j] ?? null], reads: [null], free: j }));
      else atoms = atomsOf(b, cal, i === rest ? k : repeats(b));
      p = put(atoms, p, i, (n) => pinned.has(n) || out.has(n), out).next;
    });
    return out;
  };

  let k = 0;
  if (rest >= 0) {
    const b = outline[rest];
    const others = flow(0).size, room = count - others - pinned.size;
    if (b.type === 'free') {
      const min = b.pages.length;
      k = Math.max(min, room);
      while (k > min && lastOf(flow(k)) > count) k--;
    } else {
      const unit = widthOf(atomsOf(b, cal, 1));
      k = unit > 0 ? Math.max(0, Math.floor(room / unit)) : 0;
      while (k > 0 && lastOf(flow(k)) > count) k--;
    }
  }
  const placed = flow(k);
  const all = new Map<number, Cell>([...placed, ...pinned]);
  const end = lastOf(all);

  const rows: Row[] = outline.map((b, i) => {
    const slots = [...all].filter(([, c]) => c.block === i).map(([n]) => n).sort((x, y) => x - y);
    const firstContent = slots.findIndex((n) => all.get(n)!.kind !== 'gap');
    const lead = firstContent < 0 ? slots : slots.slice(0, firstContent);
    const mine = firstContent < 0 ? [] : slots.slice(firstContent);
    return {
      block: i, pages: mine.length, first: mine[0] ?? null, last: mine[mine.length - 1] ?? null,
      repeats: i === rest ? k : repeats(b), gaps: lead, innerGaps: mine.filter((n) => all.get(n)!.kind === 'gap').length,
      beyond: i === rest && b.type === 'free' ? mine.filter((n) => n > count).map((n) => all.get(n)!.free!) : [],
    };
  });

  return {
    cells: Array.from({ length: count }, (_, i) => all.get(i + 1) ?? null),
    rows, used: all.size, end, over: Math.max(0, end - count), issues,
  };
}

// Edits return a new outline and leave the old one as it was (so a layout can be kept for an outline that hasn't changed).

/** A block's place: [i] at the top level, [group, child] inside a group. */
export type Path = [number] | [number, number];

const clone = <T>(v: T): T => structuredClone(v);

export const blockAt = (outline: readonly Block[], path: Path): Block | undefined =>
  path.length === 1 ? outline[path[0]] : (outline[path[0]] as GroupBlock | undefined)?.children?.[path[1]];

/** The list a path sits in: the outline, or a group's children. */
const listOf = (outline: Block[], path: Path): Block[] => (path.length === 1 ? outline : (outline[path[0]] as GroupBlock).children);
const indexIn = (path: Path) => path[path.length - 1];

/** Replace one block (inside a copy of the outline). */
export function replaceBlock(outline: readonly Block[], path: Path, next: Block): Block[] {
  const copy = clone(outline) as Block[];
  listOf(copy, path)[indexIn(path)] = next;
  return copy;
}

/**
 * Insert a block into the outline, or into a group's children (`group`), at `index` (the end when left out; clamped to the list).
 * The block that takes what's left keeps doing so wherever the new one goes: the layout works that out.
 */
export function addBlock(outline: readonly Block[], block: Block, to: { group?: number; index?: number } = {}): Block[] {
  const copy = clone(outline) as Block[];
  const list: Block[] = to.group === undefined ? copy : (copy[to.group] as GroupBlock).children;
  list.splice(Math.max(0, Math.min(list.length, to.index ?? list.length)), 0, block);
  return copy;
}

/**
 * Where Add… puts a block, given the selected row (the last of the selection, or null): right after it, inside its group if it is
 * a child; at the end of a selected group's children; with nothing selected, before the block that takes what's left, else at the end.
 * A group (which can't nest) goes after the selected group or child's group instead. A block that itself takes what's left goes at the end.
 */
export function insertPoint(outline: readonly Block[], selected: Path | null, block: Block): { group?: number; index: number } {
  const at = selected && blockAt(outline, selected) ? selected : null;
  if (!at) {
    const rest = outline.findIndex((b) => pinOf(b) === undefined && takesRest(b));
    return { index: rest >= 0 && !takesRest(block) ? rest : outline.length };
  }
  const [g, k] = at;
  const here = outline[g];
  if (block.type === 'group') return { index: g + 1 };
  if (at.length === 2) return { group: g, index: k! + 1 };
  return here.type === 'group' ? { group: g, index: here.children.length } : { index: g + 1 };
}

export function removeBlock(outline: readonly Block[], path: Path): Block[] {
  const copy = clone(outline) as Block[];
  listOf(copy, path).splice(indexIn(path), 1);
  return copy;
}

/** A copy of the block right after it. The copy is not pinned, and a block that takes the rest is copied as ×1. */
export function duplicateBlock(outline: readonly Block[], path: Path): Block[] {
  const copy = clone(outline) as Block[];
  const list = listOf(copy, path), at = indexIn(path);
  const twin = clone(list[at]);
  if (twin.type !== 'free') delete twin.pin;
  if (twin.type !== 'free' && 'fill' in twin.repeat) twin.repeat = { times: 1 };
  list.splice(at + 1, 0, twin);
  return copy;
}

/** A block that is no longer pinned, filling or following the calendar: what it becomes inside a group. */
function intoGroup<T extends Block>(block: T): T {
  if (block.type === 'free') return block;
  delete block.pin;
  if ('fill' in block.repeat || (isEach(block.repeat) && !('of' in block.repeat))) block.repeat = { times: 1 };
  return block;
}

/** What a block becomes outside its group: "each … of the group's span" means nothing there. */
function outOfGroup<T extends Block>(block: T): T {
  if (block.type !== 'free' && isEach(block.repeat) && 'of' in block.repeat) block.repeat = { times: 1 };
  return block;
}

/** The paths with duplicates and children of selected groups taken out, in the order of the outline. */
export function normalizePaths(paths: readonly Path[]): Path[] {
  const tops = new Set(paths.filter((p) => p.length === 1).map((p) => p[0]));
  const seen = new Set<string>();
  return paths
    .filter((p) => !(p.length === 2 && tops.has(p[0])))
    .filter((p) => { const k = p.join('.'); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a[0] - b[0] || (a[1] ?? -1) - (b[1] ?? -1)) as Path[];
}

/** Where a drop lands: the top level, or inside a group, before the block at `index` of that list as it is now (the end when past it). */
export interface DropTarget { group?: number; index: number }

const pathsOf = (outline: readonly Block[], blocks: readonly Block[]): Path[] =>
  blocks.map((b): Path => {
    const top = outline.indexOf(b);
    if (top >= 0) return [top];
    const g = outline.findIndex((x) => x.type === 'group' && x.children.includes(b as Child));
    return [g, (outline[g] as GroupBlock).children.indexOf(b as Child)];
  });

/** Only one top-level block may take what is left. */
const restOk = (outline: readonly Block[]) => outline.filter(takesRest).length <= 1;

/**
 * Move a set of blocks together, in their order, to a place in the outline or in a group. Dropping next to a block that is itself
 * being moved lands it where that block was. A block that goes into a group is no longer pinned or following the calendar; one that
 * comes out loses "of the group's span". Returns the new outline and where the moved blocks are now, or null when it can't be done
 * (a group dropped into a group, or a second block that takes what's left at the top level).
 */
export function moveBlocks(outline: readonly Block[], paths: readonly Path[], to: DropTarget): { outline: Block[]; moved: Path[] } | null {
  const copy = clone(outline) as Block[];
  const blocks = normalizePaths(paths).map((p) => blockAt(copy, p));
  if (!blocks.length || blocks.some((b) => !b)) return null;
  const moving = blocks as Block[];
  const target = to.group === undefined ? null : (copy[to.group] as GroupBlock | undefined);
  if (to.group !== undefined && (target?.type !== 'group' || moving.some((b) => b.type === 'group'))) return null;
  const list: Block[] = target ? target.children : copy;
  const anchor = list.slice(Math.max(0, to.index)).find((b) => !moving.includes(b));
  const origin = new Map(moving.map((b) => [b, copy.find((g) => g.type === 'group' && g.children.includes(b as Child)) ?? null]));
  for (const l of [copy, ...copy.flatMap((b) => (b.type === 'group' ? [b.children as Block[]] : []))]) {
    for (let i = l.length - 1; i >= 0; i--) if (moving.includes(l[i])) l.splice(i, 1);
  }
  for (const b of moving) {
    if (origin.get(b) === target) continue; // moved within its own list
    if (target) intoGroup(b); else outOfGroup(b);
  }
  list.splice(anchor ? list.indexOf(anchor) : list.length, 0, ...moving);
  return restOk(copy) ? { outline: copy, moved: pathsOf(copy, moving) } : null;
}

/** Delete several blocks at once. */
export function removeBlocks(outline: readonly Block[], paths: readonly Path[]): Block[] {
  const copy = clone(outline) as Block[];
  const doomed = normalizePaths(paths).map((p) => blockAt(copy, p));
  for (const l of [copy, ...copy.flatMap((b) => (b.type === 'group' ? [b.children as Block[]] : []))]) {
    for (let i = l.length - 1; i >= 0; i--) if (doomed.includes(l[i])) l.splice(i, 1);
  }
  return copy;
}

/** Duplicate several blocks, each right after itself. Returns the new outline and where the copies are. */
export function duplicateBlocks(outline: readonly Block[], paths: readonly Path[]): { outline: Block[]; copies: Path[] } {
  let out = clone(outline) as Block[];
  const sorted = normalizePaths(paths);
  for (const p of [...sorted].reverse()) out = duplicateBlock(out, p);
  // Each copy sits right after its block, pushed on by the copies made before it (in the outline, or in the same group).
  const copies = sorted.map((p, i): Path => {
    const earlier = sorted.slice(0, i), tops = earlier.filter((q) => q.length === 1).length;
    return p.length === 1 ? [p[0] + tops + 1] : [p[0] + tops, p[1] + earlier.filter((q) => q.length === 2 && q[0] === p[0]).length + 1];
  });
  return { outline: out, copies };
}

/**
 * Put top-level page, spread and free-pages blocks into a new group named "Group" that repeats once, where the first of them was.
 * They are no longer pinned, filling or following the calendar. Returns null when a group is among them or nothing is.
 */
export function groupBlocks(outline: readonly Block[], indexes: readonly number[]): { outline: Block[]; group: number } | null {
  const at = [...new Set(indexes)].sort((a, b) => a - b);
  if (!at.length || at.some((i) => !outline[i] || outline[i].type === 'group')) return null;
  const copy = clone(outline) as Block[];
  const children = at.map((i) => intoGroup(copy[i]) as Child);
  for (let k = at.length - 1; k >= 0; k--) copy.splice(at[k], 1);
  copy.splice(at[0], 0, groupBlock('Group', children));
  return { outline: copy, group: at[0] };
}

/** Take a group apart: its blocks take its place, each repeating as it did (null when that would give two blocks that take what's left). */
export function ungroupBlock(outline: readonly Block[], index: number): { outline: Block[]; first: number; count: number } | null {
  const g = outline[index];
  if (g?.type !== 'group') return null;
  const copy = clone(outline) as Block[];
  const kids = (copy[index] as GroupBlock).children.map(outOfGroup);
  copy.splice(index, 1, ...kids);
  return restOk(copy) ? { outline: copy, first: index, count: kids.length } : null;
}

/** Change a block's repeat. A fill replaces any other fill or free pages at the top level (the caller checks `canFill`) and drops the pin. */
export function setRepeat(outline: readonly Block[], path: Path, repeat: Repeat): Block[] {
  const b = blockAt(outline, path);
  if (!b || b.type === 'free') return clone(outline) as Block[];
  const next = clone(b);
  if ('times' in repeat) repeat = { times: Math.max(1, Math.min(MAX_REPEAT, Math.round(repeat.times))) };
  next.repeat = repeat;
  if ('fill' in repeat) delete next.pin;
  return replaceBlock(outline, path, next);
}

/** Whether this block may be set to fill what is left: only at the top level, and only if nothing else takes the rest. */
export const canFill = (outline: readonly Block[], path: Path): boolean => {
  const b = blockAt(outline, path);
  return path.length === 1 && !!b && b.type !== 'free' && !outline.some((o, i) => i !== path[0] && takesRest(o));
};

/** Whether free pages may be added at the top level: nothing else takes the rest. */
export const canAddFree = (outline: readonly Block[]): boolean => !outline.some(takesRest);

export function setPin(outline: readonly Block[], path: Path, pin: Pin | null): Block[] {
  const b = blockAt(outline, path);
  if (!b || path.length !== 1 || b.type === 'free') return clone(outline) as Block[];
  const next = clone(b);
  if (pin === null) delete next.pin; else next.pin = typeof pin === 'number' ? Math.max(1, Math.min(MAX_REPEAT, Math.round(pin))) : pin;
  if (pin !== null && 'repeat' in next && 'fill' in next.repeat) next.repeat = { times: 1 };
  return replaceBlock(outline, path, next);
}

export function renameGroup(outline: readonly Block[], index: number, name: string): Block[] {
  const g = outline[index];
  return g?.type === 'group' ? replaceBlock(outline, [index], { ...clone(g), name }) : (clone(outline) as Block[]);
}

// ---- making blocks ------------------------------------------------------------------

export const pageBlock = (page: Page | null, times = 1, from?: Link): PageBlock => ({ type: 'page', page, repeat: { times }, ...(from ? { from } : {}) });
export const spreadBlock = (name: string, left: Page, right: Page, times = 1, from?: Link): SpreadBlock => ({ type: 'spread', name, left, right, repeat: { times }, ...(from ? { from } : {}) });
export const freeBlock = (pages: (Page | null)[] = []): FreeBlock => ({ type: 'free', pages });
export const groupBlock = (name: string, children: Child[] = [], times = 1): GroupBlock => ({ type: 'group', name, children, repeat: { times } });
export const fillRepeat = (): Repeat => ({ fill: true });

/** What the outline calls a block. */
export const nameOf = blockName;

/** "×6", "fill what’s left", "each day", or, inside a group that repeats by week, "each day of the week". */
export function repeatLabel(b: Block, parent?: GroupBlock): string {
  if (b.type === 'free') return 'free pages';
  const r = b.repeat;
  if ('fill' in r) return 'fill what’s left';
  if (!isEach(r)) return `×${r.times}`;
  if (!('of' in r)) return `each ${r.each}`;
  const span = parent && isEach(parent.repeat) ? parent.repeat.each : null;
  return `each ${r.each} of ${span ? `the ${span}` : 'the group’s span'}`;
}

/** The answers to "How often": a plain number (once, or a number of times), or every day, week or month of the calendar (or of a group's span). */
export type HowOften = 'once' | 'times' | 'day' | 'week' | 'month' | 'span-day' | 'span-week';

export const howOftenOf = (r: Repeat): HowOften | 'fill' =>
  'fill' in r ? 'fill' : !isEach(r) ? (r.times === 1 ? 'once' : 'times') : 'of' in r ? `span-${r.each}` : r.each;

/**
 * The choices for "How often", in plain words. At the top level: Once, A number of times, Every day / week / month (dated). Inside a
 * group that repeats by week or month (`spanUnit`): the same with "each week", and Every day of the week (dated), and for a month also
 * Every week of the month. The dated ones are off without a calendar, or outside such a group; the choice already made is always listed.
 */
export function howOftenOptions(top: boolean, spanUnit: Unit | null, calendar: boolean, now: Repeat): { value: HowOften; label: string; on: boolean }[] {
  const each = spanUnit ? ` each ${spanUnit}` : '';
  const options: { value: HowOften; label: string; on: boolean }[] = [{ value: 'once', label: `Once${each}`, on: true }, { value: 'times', label: `A number of times${each}`, on: true }];
  if (top) for (const u of ['day', 'week', 'month'] as const) options.push({ value: u, label: `Every ${u} (dated)${calendar ? '' : ': set a calendar first'}`, on: calendar });
  else if (spanUnit === 'week' || spanUnit === 'month') for (const u of spanUnit === 'month' ? (['day', 'week'] as const) : (['day'] as const)) options.push({ value: `span-${u}`, label: `Every ${u} of the ${spanUnit} (dated)`, on: true });
  const have = howOftenOf(now);
  if (have !== 'fill' && !options.some((o) => o.value === have)) options.push({ value: have, label: have.startsWith('span-') ? `Every ${have.slice(5)} of the group’s span (dated)` : `Every ${have} (dated)`, on: false });
  return options;
}

/** The repeat a "How often" answer makes (a number of times starts at 2: Once is 1). */
export function repeatOf(answer: HowOften, now: Repeat): Repeat {
  if (answer === 'once') return { times: 1 };
  if (answer === 'times') return { times: isEach(now) || 'fill' in now ? 2 : Math.max(2, now.times) };
  return answer.startsWith('span-') ? { each: answer.slice(5) as 'day' | 'week', of: 'span' } : { each: answer as Unit };
}

/** Whether a repeat by a plain number in a book with a calendar prints no dates: not inside a group that follows the calendar, where it reads the group's span. */
export const printsNoDates = (r: Repeat, parent: GroupBlock | null, calendar: boolean): boolean => calendar && 'times' in r && !(parent && isEach(parent.repeat));

/** The first page a block (or a child of a group) lands on, or null when it takes none. */
export const firstCell = (layout: Layout, block: number, child?: number): { slot: number; cell: Cell } | null => {
  const at = layout.cells.findIndex((c) => !!c && c.kind !== 'gap' && c.block === block && (child === undefined || c.child === child));
  return at < 0 ? null : { slot: at + 1, cell: layout.cells[at]! };
};

/**
 * Put a design on one of a free-pages block's pages (null makes it blank). The list is padded with blank pages up to it, and
 * blank pages at its end are dropped, which is how a free page that doesn't fit is taken out.
 */
export function setFreePage(outline: readonly Block[], path: Path, index: number, page: Page | null): Block[] {
  const b = blockAt(outline, path);
  if (!b || b.type !== 'free') return clone(outline) as Block[];
  const pages = [...b.pages];
  while (pages.length <= index) pages.push(null);
  pages[index] = page ? clone(page) : null;
  while (pages.length && pages[pages.length - 1] === null) pages.pop();
  return replaceBlock(outline, path, { type: 'free', pages });
}

/** A page or spread block's design: one page (null is blank), or a spread's name and two pages. */
export type Design = { page: Page | null } | { name: string; left: Page; right: Page };

/**
 * Put a design in a page or spread block, keeping its repeat, pin, shared setting, position and group. `from` is the link to the
 * design it came from: left out it stays as it is (editing in place), a link replaces it, null takes it off (a blank page has none).
 * A design of the other kind than the block changes nothing.
 */
export function setDesign(outline: readonly Block[], path: Path, design: Design, from?: Link | null): Block[] {
  const b = blockAt(outline, path);
  const link = (old?: Link): { from?: Link } => { const f = from === undefined ? old : from; return f ? { from: f } : {}; };
  if (b?.type === 'page' && 'page' in design) {
    const { from: old, ...rest } = clone(b);
    return replaceBlock(outline, path, { ...rest, page: design.page ? clone(design.page) : null, ...link(old) });
  }
  if (b?.type === 'spread' && 'left' in design) {
    const { from: old, ...rest } = clone(b);
    return replaceBlock(outline, path, { ...rest, name: design.name, left: clone(design.left), right: clone(design.right), ...link(old) });
  }
  return clone(outline) as Block[];
}

/** Whether a spread's two pages read the same day, week or month. */
export function setShared(outline: readonly Block[], path: Path, shared: boolean): Block[] {
  const b = blockAt(outline, path);
  return b?.type === 'spread' ? replaceBlock(outline, path, { ...clone(b), shared }) : (clone(outline) as Block[]);
}

/** "Make the book N pages": the next multiple of 4 that holds `end` pages. */
export const pagesToHold = (end: number): number => Math.ceil(end / 4) * 4;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What the Book view says about the page total: "48 of 52 pages", and when the blocks need more pages than the book has, how far over
 * it is ("over by 4 pages", shown in red) and the page count that would hold them (the offer "Make the book 56 pages"; null when
 * even 400 pages would not do).
 */
export function totalLine(layout: Layout, count: number): { used: string; over: string | null; makeLonger: number | null } {
  const make = pagesToHold(layout.end);
  return {
    used: `${layout.used} of ${count} pages`,
    over: layout.over > 0 ? `over by ${plural(layout.over, 'page')}` : null,
    makeLonger: layout.over > 0 && make > count && make <= 400 ? make : null,
  };
}
