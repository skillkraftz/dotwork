import type { Page } from '../format/types';
import { notesPage } from '../builtin/pages';

// A book is an outline: an ordered list of blocks. The pages it prints are worked out from it by `layoutOutline`, the one
// function that says what is on which page. See docs/book-format.md.

/** The design a block was placed from (its Library id) and a fingerprint of that design as it was placed. Recorded, not used yet. */
export interface Link { id: string; fingerprint: string }

/** How often a block is placed: a number of times, or as many times as use up the pages the others leave. */
export type Repeat = { times: number } | { fill: true };
/** A page number, or the last page of the book (which follows the book if it is resized). */
export type Pin = number | 'last';

export interface PageBlock { type: 'page'; /** null is a blank page. */ page: Page | null; repeat: Repeat; pin?: Pin; from?: Link }
export interface SpreadBlock { type: 'spread'; name: string; left: Page; right: Page; repeat: Repeat; pin?: Pin; from?: Link }
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

interface Atom { pages: (Page | null)[]; free?: boolean }

const pinOf = (b: Block): Pin | undefined => (b.type === 'free' ? undefined : b.pin);

const blockName = (b: Block) => (b.type === 'page' ? b.page?.name || 'Blank' : b.type === 'free' ? 'Free pages' : b.name);

/** The atoms of one repeat of a child: a page, a spread (two pages that must start on a left page) or free pages, each repeated by the child's own repeat inside a group. */
function childAtoms(c: Child): Atom[] {
  if (c.type === 'free') return (c.pages.length ? c.pages : [null]).map((page) => ({ pages: [page], free: true }));
  const one: Atom = c.type === 'page' ? { pages: [c.page] } : { pages: [c.left, c.right] };
  return Array.from({ length: timesOf(c.repeat) }, () => one);
}

/** `times` repeats of what a block holds. */
function atomsOf(b: Block, times: number): Atom[] {
  const unit = b.type === 'group' ? b.children.flatMap(childAtoms) : b.type === 'free' ? childAtoms(b) : childAtoms({ ...b, repeat: { times: 1 } });
  return Array.from({ length: times }, () => unit).flat();
}

const widthOf = (atoms: Atom[]) => atoms.reduce((n, a) => n + a.pages.length, 0);

const gapCell = (block: number): Cell => ({ kind: 'gap', page: notesPage(), block });

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
    a.pages.forEach((page, i) => out.set(p + i, { kind: a.free ? 'free' : 'content', page, block }));
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
export function layoutOutline(outline: readonly Block[], count: number): Layout {
  const issues: string[] = [];
  const pinned = new Map<number, Cell>();
  const rest = outline.findIndex((b) => pinOf(b) === undefined && takesRest(b));
  const repeats = (b: Block) => (b.type === 'free' ? 1 : timesOf(b.repeat));

  outline.forEach((b, i) => {
    const pin = pinOf(b);
    if (pin === undefined) return;
    const atoms = atomsOf(b, repeats(b));
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
      if (i === rest && b.type === 'free') atoms = Array.from({ length: k }, (_, j) => ({ pages: [b.pages[j] ?? null], free: true }));
      else atoms = atomsOf(b, i === rest ? k : repeats(b));
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
      const unit = widthOf(atomsOf(b, 1));
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

export function addBlock(outline: readonly Block[], block: Block, to?: { group: number }): Block[] {
  const copy = clone(outline) as Block[];
  if (to) (copy[to.group] as GroupBlock).children.push(block as Child);
  else copy.push(block);
  return copy;
}

export function removeBlock(outline: readonly Block[], path: Path): Block[] {
  const copy = clone(outline) as Block[];
  listOf(copy, path).splice(indexIn(path), 1);
  return copy;
}

/** Whether a block can move one place up (-1) or down (1) in its list. */
export function canMove(outline: readonly Block[], path: Path, by: -1 | 1): boolean {
  const list = path.length === 1 ? outline : (outline[path[0]] as GroupBlock).children;
  const to = indexIn(path) + by;
  return to >= 0 && to < list.length;
}

export function moveBlock(outline: readonly Block[], path: Path, by: -1 | 1): Block[] {
  if (!canMove(outline, path, by)) return clone(outline) as Block[];
  const copy = clone(outline) as Block[];
  const list = listOf(copy, path), at = indexIn(path);
  [list[at], list[at + by]] = [list[at + by], list[at]];
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

/** Whether a top-level page, spread or free-pages block can go into a group. */
export const canMoveIn = (outline: readonly Block[], path: Path): boolean => path.length === 1 && outline[path[0]]?.type !== 'group' && outline.some((b) => b.type === 'group');

/** Move a top-level block to the end of a group. It repeats once there, and is no longer pinned or filling. */
export function moveIntoGroup(outline: readonly Block[], path: Path, group: number): Block[] {
  const copy = clone(outline) as Block[];
  const [block] = copy.splice(path[0], 1) as Child[];
  if (block.type !== 'free') {
    delete block.pin;
    if ('fill' in block.repeat) block.repeat = { times: 1 };
  }
  const target = group > path[0] ? group - 1 : group;
  (copy[target] as GroupBlock).children.push(block);
  return copy;
}

/** Move a block out of its group to just after it. */
export function moveOutOfGroup(outline: readonly Block[], path: [number, number]): Block[] {
  const copy = clone(outline) as Block[];
  const [block] = (copy[path[0]] as GroupBlock).children.splice(path[1], 1);
  copy.splice(path[0] + 1, 0, block);
  return copy;
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

/** "×6", or "fill what’s left". */
export const repeatLabel = (b: Block): string => (b.type === 'free' ? 'free pages' : 'fill' in b.repeat ? 'fill what’s left' : `×${b.repeat.times}`);

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
