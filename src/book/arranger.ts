import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Page } from '../format/types';
import { withSide, type Spread } from '../format/spread';
import { fingerprint } from '../format/fingerprint';
import { readsText, suggestUnit } from '../format/tokens';
import { pageContent, thumbnailSvg } from '../render';
import { h, tabBar } from '../panel';
import { issuesProblem, problemView } from '../problems';
import type { Library, LibraryItem } from '../library/library';
import { exampleId, spreadId } from '../library/browse';
import { blankPage, bookExpand, bookLayout, bookPage, FIRST_SLOT, getSlot, isCover, lastSlot, readBook, resizeBook, setCover, slotSide, type Book } from './book';
import { BUILTIN_SPREADS } from '../builtin/library';
import { BUILTIN_SECTIONS } from '../builtin/sections';
import { sectionGroup, type Section } from './sections';
import { checkPrintSettings, signatureSizes, type PrintSettings } from './impose';
import { flipThrough } from './flip';
import { isUntitled } from '../documents';
import { designName, opening, slotLabel } from './labels';
import {
  addBlock, blockAt, canAddFree, canFill, canMove, canMoveIn, duplicateBlock, fillRepeat, freeBlock, groupBlock, moveBlock, moveIntoGroup, moveOutOfGroup,
  firstCell, isEach, nameOf, pageBlock, removeBlock, repeatLabel, replaceBlock, setFreePage, setPin, setRepeat, setShared, spreadBlock, timesOf, totalLine, MAX_REPEAT,
  type Block, type Child, type GroupBlock, type Link, type Path, type Repeat, type Row,
} from './outline';

export interface ArrangerHost {
  library: Library;
  /** The built-in example pages, offered next to the saved designs. */
  examples: readonly Page[];
  /** Called after every change to the book, so it can be saved. */
  changed(book: Book): void;
  /**
   * Asked before a change is made. False when the book can't be changed as it is (a built-in): the host then asks for a
   * name for a copy and calls `apply` again once the copy is open.
   */
  editing(apply: () => void): boolean;
  exportFiles(book: Book): void;
  /** A saved page or spread that is still Untitled is about to be placed: ask for its name first. Returns the name it ended with, or null if that was cancelled. */
  nameSaved(id: string, name: string, kind: 'page' | 'spread'): Promise<string | null>;
  /** The printer profile, to warn when the book can't be printed with it. */
  printer(): PrintSettings;
}

const MAX_UNDO = 30;
const SPREADS_KEY = 'dotwork.book.spreads';
const PICKER_TAB_KEY = 'dotwork.book.picker-tab';
type PickerTab = 'pages' | 'spreads' | 'blocks';
const PICKER_TABS: [PickerTab, string][] = [['pages', 'Pages'], ['spreads', 'Spreads'], ['blocks', 'Other']];
const SWIPE_PX = 50;
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A slot's page as an SVG, as it prints (with its page number unless it is a cover or numbers are off). */
const slotSvg = (book: Book, slot: number, extra = '', attrs = '') => {
  const number = isCover(book, slot) || !book.page_numbers ? null : String(slot);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W_MM} ${PAGE_H_MM}" aria-hidden="true"${attrs}>` +
    pageContent(bookPage(book, slot), { mode: 'export', pageNumber: number, expand: bookExpand(book, slot) }) + extra + '</svg>';
};
const outlineMark = `<rect class="outline" x="0.15" y="0.15" width="${PAGE_W_MM - 0.3}" height="${PAGE_H_MM - 0.3}" fill="none"/>`;

/** What can be put on a page: a page, or a spread (which takes two pages). */
type Choice = { name: string; kind: 'blank' | 'page' | 'spread'; data: Page | Spread | null; /** The Library entry (or the built-in's id), for the link kept with the block. */ id: string | null };

/**
 * Commit a field when it changes or Enter is pressed, once, and after the event that caused it has finished. Changing the outline
 * redraws the rows, which removes the field; doing that inside its own change or blur event (Enter used to blur it, a phone's Go key
 * blurs it) throws "The node to be removed is no longer a child", because removing a focused field fires blur again.
 */
function commitField(field: HTMLInputElement | HTMLSelectElement, commit: () => void) {
  let pending = false, last = field.value; // the value already committed: a blur after Enter fires change again for the same text
  const run = () => {
    if (pending || field.value === last) return;
    pending = true;
    last = field.value;
    setTimeout(() => { pending = false; commit(); }, 0); // a microtask would still run inside the event
  };
  field.addEventListener('change', run);
  field.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') run(); });
}

/** A path as an attribute value: "2" or "2.1". */
const keyOf = (path: Path) => path.join('.');

/** The pages a child takes in one repeat of its group (not counting any gap pages); for a child that follows the calendar, in all. */
const childPages = (c: Child, all: number) => (c.type === 'free' ? Math.max(1, c.pages.length) : isEach(c.repeat) ? all : (c.type === 'spread' ? 2 : 1) * timesOf(c.repeat));

/**
 * The book: its pages one at a time (or as spreads), and the outline that makes them. The outline is a list of blocks (a page,
 * a spread, free pages or a group) with a repeat and, if wanted, a page to pin to. The covers are designed on their own.
 */
export class Arranger {
  private book: Book;
  /** The slot being looked at: -1 is the outside front cover, 0 the inside front cover, 1..N the pages, N+1 the inside back cover, N+2 the outside back cover. */
  private slot = 1;
  private spreads = stored(SPREADS_KEY) === '1';
  private undoStack: string[] = [];
  private saved: LibraryItem[] = [];
  private savedSections: Section[] = [];
  private swipe: { x: number; y: number } | null = null;
  /** The row last tapped, and the row whose settings are open. */
  private selected: Path | null = null;
  private openRow: string | null = null;

  private bar = h('div', { class: 'book-bar' });
  private nav = h('div', { class: 'book-nav' });
  private totalEl = h('div', { class: 'book-total', role: 'status' });
  private stage = h('div', { class: 'book-stage' });
  private actions = h('div', { class: 'book-actions' });
  private contents = h('aside', { class: 'book-contents', 'aria-label': 'Outline' });
  private warnEl = h('p', { class: 'warn', hidden: true });
  private msgEl = h('p', { class: 'book-msg', role: 'status', hidden: true });
  /** Why the book breaks the format (with Copy details), when it does. */
  private problemEl = h('div', { class: 'book-problem', hidden: true });
  private pickerTab: PickerTab = stored(PICKER_TAB_KEY) === 'spreads' ? 'spreads' : 'pages';
  private pickerTabs = tabBar('Kinds of design', PICKER_TABS, 'picker-tab', (t) => {
    this.pickerTab = t;
    try { localStorage.setItem(PICKER_TAB_KEY, t); } catch { /* ignore */ }
    this.renderPicker();
  });
  private picker: HTMLDialogElement;
  private pickerBody = h('div', { class: 'picker-body' });
  private pickerTitle = h('h2', {});
  /** What the picker is choosing: a design for a cover, or a block to add (to a group, or to the end of the outline). */
  private picking: { for: 'cover' } | { for: 'free'; path: Path; index: number } | { for: 'add'; group: number | null } = { for: 'add', group: null };

  constructor(root: HTMLElement, private host: ArrangerHost, book: Book) {
    this.book = book;
    this.picker = h('dialog', { class: 'library picker', 'aria-label': 'Choose a design' },
      h('header', {}, this.pickerTitle, h('button', { type: 'button', 'data-help': 'picker-close', onclick: () => this.picker.close() }, 'Close')),
      h('div', { class: 'lib-find' }, this.pickerTabs.el),
      this.pickerBody) as HTMLDialogElement;
    this.picker.addEventListener('click', (e) => { if (e.target === this.picker) this.picker.close(); });
    document.body.append(this.picker);

    this.stage.addEventListener('pointerdown', (e) => { this.swipe = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; });
    this.stage.addEventListener('pointercancel', () => { this.swipe = null; });
    this.stage.addEventListener('pointerup', (e) => {
      const s = this.swipe;
      this.swipe = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) this.step(dx < 0 ? 1 : -1);
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
    });
    root.replaceChildren(this.bar, h('div', { class: 'book-body' },
      h('div', { class: 'book-main' }, this.nav, this.totalEl, this.stage, this.problemEl, this.msgEl, this.warnEl, this.actions), this.contents));
    this.render();
  }

  get current(): Book { return this.book; }

  /** Show a different book (opened, imported or new). */
  setBook(book: Book) {
    this.book = book;
    this.undoStack = [];
    this.selected = null;
    this.openRow = null;
    this.slot = 1;
    this.say(null);
    this.checkBook();
    this.render();
  }

  /** Refresh the list of saved designs, e.g. when the view is shown. */
  async refreshDesigns() {
    const items = await this.host.library.list();
    this.saved = items.filter((i) => i.kind === 'page' || i.kind === 'spread');
    this.savedSections = items.flatMap((i) => (i.kind === 'section' ? [i.data] : []));
    if (this.picker.open) this.renderPicker();
  }

  // ---- changes ----------------------------------------------------------------

  /** Make a change to the book as one undo step, keep the draft and redraw. */
  edit(change: () => void) {
    if (!this.host.editing(() => this.edit(change))) return;
    this.undoStack.push(JSON.stringify(this.book));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    change();
    this.host.changed(this.book);
    this.checkBook();
    this.render();
  }

  /** Change the outline as one undo step. `change` gets the outline as it is when the change is made and returns the new one; `after` then sets what is selected. */
  private editOutline(change: (outline: Block[]) => Block[], after?: () => void) {
    this.edit(() => { this.book.outline = change(this.book.outline); after?.(); });
  }

  /** Read the book back through the book format after a change. If it breaks, say why (never silently keep a book that can't be exported). */
  private checkBook() {
    const r = readBook(this.book);
    this.problemEl.replaceChildren(...(r.ok ? [] : [problemView(issuesProblem('This book breaks the book format, so it can’t be exported as JSON.', r.issues))]));
    this.problemEl.hidden = r.ok;
  }

  private undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    this.book = JSON.parse(last) as Book;
    this.slot = Math.min(this.slot, lastSlot(this.book));
    this.selected = null;
    this.openRow = null;
    this.say(null);
    this.host.changed(this.book);
    this.checkBook();
    this.render();
  }

  private say(text: string | null) {
    this.msgEl.textContent = text ?? '';
    this.msgEl.hidden = !text;
  }

  // ---- moving around -----------------------------------------------------------

  private go(slot: number) {
    this.slot = Math.max(FIRST_SLOT, Math.min(lastSlot(this.book), slot));
    this.say(null);
    this.renderView(true);
  }

  /** Previous or next: one page, or one opening when viewing spreads. */
  private step(direction: -1 | 1) {
    this.go(this.spreads ? opening(this.slot)[0] + 2 * direction : this.slot + direction);
  }

  private setSpreads(on: boolean) {
    this.spreads = on;
    try { localStorage.setItem(SPREADS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    this.renderView();
  }

  // ---- drawing ----------------------------------------------------------------

  private render() {
    this.renderBar();
    this.renderView();
    this.renderOutline();
  }

  /** Everything that follows the current page. `scroll` also brings the page's row into view in the outline (when the page changed, not when a row was edited). */
  private renderView(scroll = false) {
    this.renderNav();
    this.renderTotal();
    this.renderStage();
    this.renderActions();
    this.markCurrent(scroll);
  }

  private renderBar() {
    const lay = bookLayout(this.book);
    this.bar.replaceChildren(
      h('button', { type: 'button', disabled: this.undoStack.length === 0, onclick: () => this.undo(), 'data-key': 'book-undo', 'data-help': 'book-undo', title: 'Undo the last change to the book' }, 'Undo'),
      h('button', { type: 'button', 'data-key': 'book-add', 'data-help': 'book-add', onclick: () => void this.openAdd(null) }, 'Add…'),
      h('button', { type: 'button', 'data-key': 'book-flip', 'data-help': 'book-flip', onclick: () => this.flip() }, 'Flip through'),
      h('button', {
        type: 'button', class: 'primary', 'data-key': 'book-export', 'data-help': 'book-export', disabled: lay.over > 0,
        title: lay.over > 0 ? `The book is over by ${plural(lay.over, 'page')}: make it longer or take blocks out before printing.` : null,
        onclick: () => this.host.exportFiles(this.book),
      }, 'Print files…'),
    );
    this.updateWarning();
  }

  private updateWarning() {
    const sizes = signatureSizes(this.book.page_count, this.book.print.signatures);
    const problem = checkPrintSettings(this.host.printer(), Math.max(...sizes) / 4);
    this.warnEl.textContent = problem ?? '';
    this.warnEl.hidden = !problem;
  }

  /** "48 of 52 pages", or in red how far over the book is, with the way to fix it. */
  private totalView(): HTMLElement {
    const lay = bookLayout(this.book), line = totalLine(lay, this.book.page_count);
    const make = line.makeLonger;
    return h('div', { class: `total${line.over ? ' over' : ''}` },
      h('strong', { 'data-key': 'book-used' }, line.used),
      line.over ? h('span', { class: 'over-by', 'data-key': 'book-over' }, line.over) : null,
      make ? h('button', { type: 'button', 'data-key': 'book-make-longer', 'data-help': 'book-make-longer', onclick: () => this.edit(() => resizeBook(this.book, make)) }, `Make the book ${make} pages`) : null,
      ...lay.issues.map((t) => h('span', { class: 'issue' }, t)));
  }

  private renderTotal() { this.totalEl.replaceChildren(this.totalView()); }

  private renderNav() {
    const last = lastSlot(this.book);
    const [left, right] = opening(this.slot);
    // The outside covers have no page beside them.
    const shown = this.shownSlots();
    const where = this.spreads
      ? shown.map((n, i) => (i ? slotLabel(this.book, n).toLowerCase() : slotLabel(this.book, n))).join(' and ')
      : slotLabel(this.book, this.slot);
    const sub = this.spreads ? 'Tap a page to pick it' : `${slotSide(this.slot) === 'left' ? 'Left' : 'Right'}-hand page`;
    const prevAt = this.spreads ? left : this.slot, nextAt = this.spreads ? right : this.slot;
    this.nav.replaceChildren(
      h('button', { type: 'button', class: 'nav-step', 'data-help': 'nav-prev', 'aria-label': this.spreads ? 'Previous spread' : 'Previous page', disabled: prevAt <= FIRST_SLOT, onclick: () => this.step(-1) }, '‹'),
      h('div', { class: 'where', 'aria-live': 'polite' }, h('strong', {}, where), h('span', { class: 'hint' }, sub)),
      h('button', { type: 'button', class: 'nav-step', 'data-help': 'nav-next', 'aria-label': this.spreads ? 'Next spread' : 'Next page', disabled: nextAt >= last, onclick: () => this.step(1) }, '›'),
      h('button', { type: 'button', class: 'view-toggle', 'data-help': 'book-spreads', 'aria-pressed': String(this.spreads), title: 'Show two facing pages side by side', onclick: () => this.setSpreads(!this.spreads) }, 'Spreads'),
      h('button', { type: 'button', class: 'contents-toggle', 'data-help': 'book-outline', onclick: () => this.contents.classList.add('open') }, 'Outline'),
    );
  }

  /** The slots on the stage: the page, or the pages of its opening (the outside covers stand alone). */
  private shownSlots(): number[] {
    return this.spreads ? opening(this.slot).filter((n) => n >= FIRST_SLOT && n <= lastSlot(this.book)) : [this.slot];
  }

  private renderStage() {
    const slots = this.shownSlots();
    this.stage.classList.toggle('spreads', this.spreads);
    this.stage.replaceChildren(...slots.map((n) => {
      const align = !this.spreads ? 'xMidYMid' : slotSide(n) === 'left' ? 'xMaxYMid' : 'xMinYMid';
      const el = h('button', {
        type: 'button', class: `stage-page${this.spreads && n === this.slot ? ' current' : ''}`,
        'aria-label': `${slotLabel(this.book, n)}, ${designName(getSlot(this.book, n))}`, 'aria-pressed': this.spreads ? String(n === this.slot) : null,
        tabindex: this.spreads ? 0 : -1, 'data-slot': n, 'data-help': 'book-stage-page',
      });
      el.innerHTML = slotSvg(this.book, n, outlineMark, ` preserveAspectRatio="${align} meet"`);
      el.onclick = () => { if (this.spreads) this.go(n); };
      return el;
    }));
  }

  /** The block that makes a page, as a sentence: "from block 3, Daily Log ×6", or the gap page's reason. */
  private origin(slot: number): string {
    const cell = bookLayout(this.book).cells[slot - 1];
    if (!cell) return 'Nothing is placed here, so the page is blank.';
    const block = this.book.outline[cell.block];
    if (cell.kind === 'gap') return 'Gap page: keeps the spread on a left page.';
    return `From block ${cell.block + 1}, ${nameOf(block)}.`;
  }

  /** The free-pages block and page a slot is, if it is a free page. */
  private freeAt(slot: number): { path: Path; index: number } | null {
    const cell = slot >= 1 && slot <= this.book.page_count ? bookLayout(this.book).cells[slot - 1] : null;
    return cell && cell.kind === 'free' && cell.free !== undefined ? { path: cell.child === undefined ? [cell.block] : [cell.block, cell.child], index: cell.free } : null;
  }

  private clearFree(path: Path, index: number) { this.editOutline((o) => setFreePage(o, path, index, null)); }

  private renderActions() {
    const here = getSlot(this.book, this.slot);
    const cover = isCover(this.book, this.slot);
    const free = this.freeAt(this.slot);
    this.actions.replaceChildren(...([
      h('p', { class: 'design-name' }, h('span', { class: 'hint' }, `${slotLabel(this.book, this.slot)}: `), h('strong', {}, designName(here)),
        cover ? null : h('span', { class: 'hint page-origin' }, ` · ${this.origin(this.slot)}`)),
      cover ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-help': 'book-choose', onclick: () => void this.openCoverPicker() }, 'Choose design…'),
        h('button', { type: 'button', disabled: !here, 'data-help': 'book-clear', onclick: () => this.edit(() => setCover(this.book, this.slot, null)), title: 'Make this cover blank' }, 'Clear'),
      ) : free ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-key': 'free-design', 'data-help': 'free-design', onclick: () => void this.openFreePicker(free.path, free.index) }, 'Choose design…'),
        h('button', { type: 'button', disabled: !here, 'data-key': 'free-clear', 'data-help': 'free-clear', onclick: () => this.clearFree(free.path, free.index), title: 'Make this free page blank' }, 'Clear'),
      ) : null,
    ].filter(Boolean) as HTMLElement[]));
  }

  // ---- the outline -----------------------------------------------------------------

  private renderOutline() {
    const b = this.book, lay = bookLayout(b);
    const rows: HTMLElement[] = [];
    rows.push(this.coverRow(FIRST_SLOT), this.coverRow(0));
    if (!b.outline.length) rows.push(h('li', { class: 'orow-empty' }, h('p', { class: 'hint', 'data-key': 'outline-empty' }, 'No blocks yet, so every page is blank. Tap Add… to put pages, spreads, free pages or a group in the book.')));
    b.outline.forEach((block, i) => {
      const row = lay.rows[i];
      if (row.gaps.length) rows.push(this.gapRow(row.gaps));
      rows.push(this.blockRow([i], block, row, b.outline.length));
      if (block.type === 'group') {
        const kids = block.children.map((c, k) => this.blockRow([i, k], c, null, block.children.length));
        rows.push(h('li', { class: 'orow-kids-item' }, h('ul', { class: 'orows orow-kids' }, ...kids)));
      }
    });
    rows.push(this.coverRow(b.page_count + 1), this.coverRow(lastSlot(b)));
    this.contents.replaceChildren(
      h('header', {}, h('h2', {}, 'Outline'), h('button', { type: 'button', class: 'contents-close', 'data-help': 'outline-close', onclick: () => this.contents.classList.remove('open') }, 'Close')),
      h('div', { class: 'outline-total' }, this.totalView(),
        h('p', { class: 'hint calendar-line', 'data-key': 'outline-calendar' }, b.calendar ? `Calendar: ${b.calendar.start} to ${b.calendar.end}` : 'No calendar: pages print no dates. Set one in Settings.')),
      h('ul', { class: 'orows' }, ...rows),
      h('div', { class: 'outline-add' }, h('button', { type: 'button', class: 'primary', 'data-key': 'outline-add', 'data-help': 'book-add', onclick: () => void this.openAdd(null) }, 'Add…')),
    );
    this.markCurrent();
  }

  private thumbOf(block: Block): string {
    const first = block.type === 'group' ? block.children[0] : block;
    if (!first || first.type === 'free') return thumbnailSvg([blankPage('right')]);
    if (first.type === 'spread') return thumbnailSvg([first.left, first.right]);
    return thumbnailSvg([withSide(first.page ?? blankPage('right'), 'right')]);
  }

  /** A cover: not a block, just a way to look at it (it is designed with Choose design). */
  private coverRow(slot: number): HTMLElement {
    const thumb = h('span', { class: 'crow-thumb' });
    thumb.innerHTML = slotSvg(this.book, slot, outlineMark);
    return h('li', { class: 'orow cover' },
      h('button', { type: 'button', class: 'orow-main', 'data-help': 'outline-row', 'data-slot': slot, onclick: () => { this.go(slot); this.contents.classList.remove('open'); } },
        thumb, h('span', { class: 'crow-text' }, h('strong', {}, slotLabel(this.book, slot)), h('span', { class: 'crow-name' }, designName(getSlot(this.book, slot))))));
  }

  private gapRow(slots: number[]): HTMLElement {
    return h('li', { class: 'orow gap', 'data-key': 'gap-row' },
      h('button', { type: 'button', class: 'orow-main', 'data-help': 'outline-row', onclick: () => { this.go(slots[0]); this.contents.classList.remove('open'); } },
        h('span', { class: 'crow-text' }, h('strong', {}, plural(slots.length, 'gap page')), h('span', { class: 'crow-name' }, `${slots.length === 1 ? `Page ${slots[0]}` : `Pages ${slots.join(', ')}`}: keeps the spread on a left page`))));
  }

  /** What a block row says under its name: "×10 · 10 pages · p.1–10 · pinned: last page". */
  private summary(block: Block, row: Row | null, path: Path): string {
    const parent = path.length === 2 ? (this.book.outline[path[0]] as GroupBlock) : undefined;
    const parts: string[] = [];
    if (block.type === 'free') parts.push(row ? 'takes what’s left' : 'free pages');
    else parts.push(repeatLabel(block, parent));
    if (row) {
      parts.push(plural(row.pages, 'page'));
      if (row.first !== null) parts.push(row.last !== row.first ? `p.${row.first}–${row.last}` : `p.${row.first}`);
      if (row.innerGaps) parts.push(plural(row.innerGaps, 'gap page'));
      if (row.beyond.length) parts.push(`${row.beyond.length} ${row.beyond.length === 1 ? 'doesn’t' : 'don’t'} fit`);
    } else if (block.type !== 'group') {
      const all = parent ? bookLayout(this.book).cells.filter((c) => c && c.block === path[0] && c.child === path[1]).length : 0;
      parts.push(plural(childPages(block, all), 'page') + (block.type !== 'free' && isEach(block.repeat) ? ' in all' : ''));
    }
    if (block.type === 'group') parts.push(plural(block.children.length, 'block'));
    if (block.type !== 'free' && block.pin !== undefined) parts.push(block.pin === 'last' ? 'pinned: last page' : `pinned: p.${block.pin}`);
    return parts.join(' · ');
  }

  /** What the block's first repeat prints ("SUN NOV 1"), or null for a group, free pages, or pages that print no dates. */
  private readsLine(block: Block, path: Path): string | null {
    if (block.type === 'group' || block.type === 'free') return null;
    const lay = bookLayout(this.book);
    // With a calendar, a block that doesn't follow it (a plain ×N, a fill) reads nothing; say so rather than "outside the calendar".
    const parent = path.length === 2 ? this.book.outline[path[0]] : null;
    const follows = isEach(block.repeat) || (parent !== null && parent.type === 'group' && isEach(parent.repeat));
    const cal: boolean | 'unplaced' = this.book.calendar ? (follows ? true : 'unplaced') : false;
    const first = firstCell(lay, path[0], path.length === 2 ? path[1] : undefined);
    const pages = block.type === 'spread' ? [block.left, block.right] : [block.page];
    const reads = pages.map((p, i) => readsText(p, first ? (lay.cells[first.slot - 1 + i]?.read ?? null) : null, cal));
    const shown = reads.filter((t, i): t is string => !!t && reads.indexOf(t) === i);
    return shown.length ? shown.join(' | ') : null;
  }

  private blockRow(path: Path, block: Block, row: Row | null, siblings: number): HTMLElement {
    const key = keyOf(path), name = nameOf(block);
    const thumb = h('span', { class: 'crow-thumb' });
    thumb.innerHTML = this.thumbOf(block);
    const open = this.openRow === key;
    const here = this.selected && keyOf(this.selected) === key;
    const tool = (help: string, label: string, text: string, disabled: boolean, run: () => void) =>
      h('button', { type: 'button', class: 'orow-tool', 'data-key': help, 'data-help': help, 'aria-label': `${label}: ${name}`, disabled, onclick: run }, text);
    const at = path.length === 1 ? path[0] : path[1];
    const reads = this.readsLine(block, path);
    const main = h('button', {
      type: 'button', class: 'orow-main', 'data-help': 'outline-row', 'data-block': key, 'aria-label': `${name}, ${this.summary(block, row, path)}`,
      onclick: () => {
        this.selected = path;
        const first = row?.first ?? null;
        if (first !== null) this.go(first);
        this.renderOutline();
        this.contents.classList.remove('open'); // on a phone the outline covers the page: show it
      },
    }, thumb, h('span', { class: 'crow-text' }, h('strong', {}, name), h('span', { class: 'crow-name' }, this.summary(block, row, path)),
      reads ? h('span', { class: 'crow-reads', 'data-key': 'row-reads' }, `reads: ${reads}`) : null));
    return h('li', { class: `orow${here ? ' selected' : ''}${path.length === 2 ? ' child' : ''}`, 'data-block-row': key },
      h('div', { class: 'orow-line' }, main,
        h('div', { class: 'orow-tools' },
          tool('outline-up', 'Move up', '↑', !canMove(this.book.outline, path, -1) || at === 0, () => this.move(path, -1)),
          tool('outline-down', 'Move down', '↓', !canMove(this.book.outline, path, 1) || at === siblings - 1, () => this.move(path, 1)),
          h('button', { type: 'button', class: 'orow-tool', 'data-key': 'outline-more', 'data-help': 'outline-more', 'aria-expanded': String(open), 'aria-label': `Settings: ${name}`, onclick: () => { this.openRow = open ? null : key; this.renderOutline(); } }, '⋯'))),
      open ? this.settings(path, block) : null);
  }

  private move(path: Path, by: -1 | 1) {
    const next: Path = path.length === 1 ? [path[0] + by] : [path[0], path[1] + by];
    this.editOutline((o) => moveBlock(o, path, by), () => {
      this.selected = next;
      this.openRow = this.openRow === keyOf(path) ? keyOf(next) : this.openRow;
    });
  }

  /** The open settings of a row: repeat, pin, duplicate, delete, move into or out of a group. */
  private settings(path: Path, block: Block): HTMLElement {
    const o = this.book.outline, top = path.length === 1;
    const key = keyOf(path);
    const button = (help: string, label: string, run: () => void, extra: Record<string, unknown> = {}) =>
      h('button', { type: 'button', 'data-key': help, 'data-help': help, onclick: run, ...extra }, label);
    const controls: (HTMLElement | null)[] = [];

    if (block.type === 'free') {
      controls.push(h('p', { class: 'hint' }, top ? 'Pages you fill by hand. They take whatever pages the other blocks leave.' : 'Pages you fill by hand, for each repeat of the group.'), ...this.freeList(path, block));
    } else {
      const filling = 'fill' in block.repeat;
      if (!filling) {
        controls.push(this.repeatSelect(path, block));
        if (!isEach(block.repeat)) controls.push(this.stepper('Repeat', 'outline-repeat', timesOf(block.repeat), 1, MAX_REPEAT, (n) => this.editOutline((x) => setRepeat(x, path, { times: n }))));
        else if (block.type === 'spread') {
          const unit = block.repeat.each, shared = block.shared ?? unit === 'month';
          controls.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Pages'),
            button('outline-shared', shared ? `Both pages the same ${unit}` : `One ${unit} for each page`, () => this.editOutline((x) => setShared(x, path, !shared)), { 'aria-pressed': String(shared) })));
        }
      }
      if (top) {
        controls.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Fill'),
          button('outline-fill', filling ? 'Filling what’s left' : 'Fill what’s left', () => this.editOutline((x) => setRepeat(x, path, filling ? { times: 1 } : fillRepeat())), {
            'aria-pressed': String(filling), disabled: !filling && !canFill(o, path),
            title: !filling && !canFill(o, path) ? 'Another block already takes what is left' : null,
          })));
        const pin = block.pin;
        controls.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Pin to page'),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Pin to page' },
            button('outline-pin-none', 'Not pinned', () => this.editOutline((x) => setPin(x, path, null)), { 'aria-pressed': String(pin === undefined) }),
            button('outline-pin-page', 'Page', () => this.editOutline((x) => setPin(x, path, typeof pin === 'number' ? pin : this.pinDefault(path[0], block))), { 'aria-pressed': String(typeof pin === 'number') }),
            button('outline-pin-last', 'Last page', () => this.editOutline((x) => setPin(x, path, 'last')), { 'aria-pressed': String(pin === 'last') }))));
        if (typeof pin === 'number') controls.push(this.stepper('Page', 'outline-pin-number', pin, 1, MAX_REPEAT, (n) => this.editOutline((x) => setPin(x, path, n))));
      }
    }

    if (block.type === 'group') {
      const name = h('input', { type: 'text', value: block.name, maxlength: 80, autocomplete: 'off', 'aria-label': 'Group name', 'data-key': 'outline-group-name', 'data-help': 'outline-group-name' });
      commitField(name, () => this.editOutline((x) => replaceBlock(x, path, { ...(blockAt(x, path) as typeof block), name: name.value.trim() || 'Group' })));
      controls.push(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
        button('outline-add-to-group', 'Add to this group…', () => void this.openAdd(path[0])));
    }

    const actions: HTMLElement[] = [
      button('outline-duplicate', 'Duplicate', () => this.editOutline((x) => duplicateBlock(x, path), () => { this.selected = top ? [path[0] + 1] : [path[0], path[1] + 1]; this.openRow = null; })),
      button('outline-delete', 'Delete', () => this.editOutline((x) => removeBlock(x, path), () => { this.selected = null; this.openRow = null; })),
    ];
    if (!top) actions.push(button('outline-out', 'Move out of the group', () => this.editOutline((x) => moveOutOfGroup(x, path as [number, number]), () => { this.selected = [path[0] + 1]; this.openRow = null; })));
    if (top && canMoveIn(o, path)) {
      const groups = o.flatMap((b, i) => (b.type === 'group' ? [[i, b.name] as const] : []));
      const into = h('select', { 'aria-label': 'Move into a group', 'data-key': 'outline-into', 'data-help': 'outline-into' },
        h('option', { value: '' }, 'Move into a group…'), ...groups.map(([i, n]) => h('option', { value: String(i) }, `${n} (block ${i + 1})`)));
      commitField(into, () => {
        if (into.value === '') return;
        const g = Number(into.value);
        this.editOutline((x) => moveIntoGroup(x, path, g), () => { this.selected = [g > path[0] ? g - 1 : g]; this.openRow = null; });
      });
      actions.push(into);
    }
    return h('div', { class: 'orow-settings', 'data-key': `settings-${key}` }, ...controls, h('div', { class: 'row' }, ...actions));
  }

  /** How often the block repeats: a number of times, or for each day, week or month of the calendar (or of the group's span). */
  private repeatSelect(path: Path, block: Exclude<Block, { type: 'free' }>): HTMLElement {
    const cal = !!this.book.calendar, top = path.length === 1;
    const parent = top ? null : (this.book.outline[path[0]] as GroupBlock);
    const spanUnit = parent && isEach(parent.repeat) ? parent.repeat.each : null;
    const options: [string, string, boolean][] = top
      ? [['times', 'A number of times', true], ...(['day', 'week', 'month'] as const).map((u): [string, string, boolean] => [u, `Each ${u} of the calendar${cal ? '' : ' (set a calendar first)'}`, cal])]
      : [['times', 'A number of times', true], ...(['day', 'week'] as const).map((u): [string, string, boolean] => [`span-${u}`, `Each ${u} of the group’s span${spanUnit ? '' : ' (the group must repeat by week or month)'}`, !!spanUnit])];
    const r = block.repeat;
    const value = !isEach(r) ? 'times' : 'of' in r ? `span-${r.each}` : r.each;
    const select = h('select', { 'aria-label': 'How often', 'data-key': 'outline-each', 'data-help': 'outline-each' },
      ...options.map(([v, label, on]) => h('option', { value: v, selected: v === value, disabled: !on && v !== value }, label)));
    commitField(select, () => {
      const v = select.value;
      const next: Repeat = v === 'times' ? { times: 1 } : v.startsWith('span-') ? { each: v.slice(5) as 'day' | 'week', of: 'span' } : { each: v as 'day' | 'week' | 'month' };
      this.editOutline((x) => setRepeat(x, path, next));
    });
    return h('div', { class: 'field' }, h('label', {}, 'How often'), select);
  }

  /** The free pages that hold a design or don't fit, each with a way to take it off. */
  private freeList(path: Path, block: Extract<Block, { type: 'free' }>): HTMLElement[] {
    const lay = bookLayout(this.book);
    const beyond = path.length === 1 ? lay.rows[path[0]]?.beyond ?? [] : [];
    const slotOf = (j: number) => lay.cells.findIndex((c) => !!c && c.kind === 'free' && c.block === path[0] && c.child === (path.length === 2 ? path[1] : undefined) && c.free === j) + 1;
    const shown = block.pages.flatMap((p, j) => (p || beyond.includes(j) ? [j] : []));
    if (!shown.length) return [];
    return [h('ul', { class: 'free-list', 'data-key': 'free-list' }, ...shown.map((j) => {
      const at = slotOf(j), fits = !beyond.includes(j);
      return h('li', {},
        h('span', {}, h('strong', {}, `Free page ${j + 1}`), ` · ${designName(block.pages[j])}`, fits ? (at ? ` · p.${at}` : '') : null, fits ? null : h('em', { class: 'nofit' }, ' · doesn’t fit')),
        h('button', { type: 'button', 'data-key': 'free-clear-listed', 'data-help': 'free-clear', 'aria-label': `Clear free page ${j + 1}`, onclick: () => this.clearFree(path, j) }, 'Clear'));
    }))];
  }

  /** The page a block is at now, for Pin to page to start from (a spread needs a left, even, page). */
  private pinDefault(index: number, block: Block): number {
    const at = bookLayout(this.book).rows[index]?.first ?? 1;
    return block.type === 'spread' && at % 2 ? at + 1 : at;
  }

  /** A whole number with − and + buttons. A typed number counts when the field is left; the buttons count at once. */
  private stepper(label: string, help: string, value: number, min: number, max: number, set: (n: number) => void): HTMLElement {
    const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
    const input = h('input', { type: 'text', inputmode: 'numeric', value: String(value), autocomplete: 'off', 'aria-label': label, 'data-key': help, 'data-help': help });
    commitField(input, () => { const v = parseInt(input.value, 10); if (Number.isFinite(v) && clamp(v) !== value) set(clamp(v)); else input.value = String(value); });
    const step = (dir: 1 | -1) => h('button', {
      type: 'button', class: 'step', 'data-key': `${help}-${dir > 0 ? 'inc' : 'dec'}`, 'data-help': dir > 0 ? 'step-inc' : 'step-dec', 'aria-label': `${dir > 0 ? 'More' : 'Fewer'}: ${label}`,
      disabled: clamp(value + dir) === value, onmousedown: (e: Event) => e.preventDefault(), onclick: () => set(clamp(value + dir)),
    }, dir > 0 ? '+' : '−');
    return h('div', { class: 'field num' }, h('label', {}, label), h('div', { class: 'stepper' }, step(-1), input, step(1)));
  }

  /** Mark the row holding the current page (without rebuilding the list), and bring it into view if asked. */
  private markCurrent(scroll = false) {
    const n = this.slot;
    const lay = bookLayout(this.book);
    const cell = n >= 1 && n <= this.book.page_count ? lay.cells[n - 1] : null;
    let found: HTMLElement | null = null;
    for (const el of this.contents.querySelectorAll<HTMLElement>('.orow')) {
      const main = el.querySelector<HTMLElement>('.orow-main');
      const inside = main?.dataset.slot !== undefined ? Number(main.dataset.slot) === n : !!cell && cell.kind !== 'gap' && main?.dataset.block === String(cell.block);
      el.classList.toggle('current', inside);
      if (inside) main?.setAttribute('aria-current', 'true'); else main?.removeAttribute('aria-current');
      if (inside) found = el;
    }
    if (scroll) found?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- choosing a design ---------------------------------------------------------

  private async openAdd(group: number | null) {
    await this.refreshDesigns();
    this.picking = { for: 'add', group };
    this.renderPicker();
    this.picker.showModal();
  }

  private async openCoverPicker() {
    await this.refreshDesigns();
    this.picking = { for: 'cover' };
    this.renderPicker();
    this.picker.showModal();
  }

  private async openFreePicker(path: Path, index: number) {
    await this.refreshDesigns();
    this.picking = { for: 'free', path, index };
    this.renderPicker();
    this.picker.showModal();
  }

  private renderPicker() {
    const cover = this.picking.for !== 'add';
    const into = this.picking.for === 'add' ? this.picking.group : null;
    this.pickerTitle.textContent = this.picking.for === 'free' ? `Design for free page ${this.picking.index + 1}` : cover ? `Design for ${slotLabel(this.book, this.slot).toLowerCase()}` : into !== null ? `Add to ${nameOf(this.book.outline[into] ?? groupBlock('the group'))}` : 'Add to the book';
    const tab = cover ? 'pages' : this.pickerTab;
    this.pickerTabs.el.parentElement!.hidden = cover;
    this.pickerTabs.select(tab);
    const side = cover ? slotSide(this.slot) : 'right';
    const card = (c: Choice) => {
      const thumb = h('div', { class: 'thumb' });
      const pages = c.kind === 'spread' ? [(c.data as Spread).left, (c.data as Spread).right] : [withSide(c.data ? (c.data as Page) : blankPage(side), side)];
      thumb.innerHTML = thumbnailSvg(pages);
      return h('button', {
        type: 'button', class: `design${c.kind === 'spread' ? ' wide' : ''}`, 'data-kind': c.kind, 'data-help': 'picker-design', 'data-name': c.name,
        onclick: () => void this.choose(c),
      }, thumb, h('span', { class: 'design-title' }, c.name), h('span', { class: 'hint' }, c.kind === 'blank' ? 'Empty page' : c.kind === 'spread' ? 'Spread: two facing pages' : 'Page'));
    };
    const section = (title: string, items: Choice[], empty?: string) => [
      h('h3', {}, title),
      items.length ? h('div', { class: 'design-list' }, ...items.map(card)) : h('p', { class: 'hint' }, empty ?? ''),
    ];
    const choice = (kind: 'page' | 'spread', id: (d: never) => string) => (data: Page | Spread): Choice => ({ name: data.name, kind, data, id: id(data as never) });
    const saved = (kind: 'page' | 'spread') => this.saved.filter((i) => i.kind === kind).map((i): Choice => ({ name: i.name, kind, data: { ...(i.data as Page | Spread), name: i.name }, id: i.id }));
    const builtinPage = choice('page', exampleId), builtinSpread = choice('spread', spreadId);
    if (tab === 'blocks') {
      this.pickerBody.replaceChildren(...this.otherBlocks());
      return;
    }
    this.pickerBody.replaceChildren(...(tab === 'pages'
      ? [
        ...(cover ? [h('div', { class: 'design-list' }, card({ name: 'Blank', kind: 'blank', data: null, id: null }))] : []),
        ...section('Saved pages', saved('page'), 'Nothing saved yet. Pages you save to the Library appear here.'),
        ...section('Built-in pages', this.host.examples.map(builtinPage)),
      ]
      : [
        ...section('Saved spreads', saved('spread'), 'No saved spreads.'),
        ...section('Built-in spreads', BUILTIN_SPREADS.map(builtinSpread)),
      ]));
  }

  /** The Other tab: a blank page, free pages, a new group, and sections (which add a group). */
  private otherBlocks(): HTMLElement[] {
    const inGroup = this.picking.for === 'add' && this.picking.group !== null;
    const thumbOf = (pages: Page[]) => { const t = h('div', { class: 'thumb' }); t.innerHTML = thumbnailSvg(pages); return t; };
    const card = (name: string, hint: string, key: string, thumb: HTMLElement, run: () => void, disabled = false) =>
      h('button', { type: 'button', class: 'design', 'data-help': 'picker-design', 'data-key': key, 'data-name': name, disabled, onclick: run }, thumb, h('span', { class: 'design-title' }, name), h('span', { class: 'hint' }, hint));
    const blank = () => thumbOf([blankPage('right')]);
    const sectionCard = (s: Section) => card(s.name, `Section: ${plural(s.children.length, 'block')}`, 'add-section', thumbOf([this.sectionFirstPage(s)]), () => this.addBlock(sectionGroup(s)));
    const free = canAddFree(this.book.outline) || inGroup;
    return [
      h('div', { class: 'design-list' },
        card('Blank page', 'An empty page, repeated as often as you set.', 'add-blank', blank(), () => this.addBlock(pageBlock(null))),
        card('Free pages', inGroup ? 'A page you fill by hand, in each repeat.' : free ? 'Pages you fill by hand: they take the pages the other blocks leave.' : 'Another block already takes what is left.', 'add-free', blank(), () => this.addBlock(freeBlock(inGroup ? [null] : [])), !free),
        ...(inGroup ? [] : [card('New group', 'Blocks that repeat together. Add pages and spreads to it after.', 'add-group', blank(), () => this.addBlock(groupBlock('Group')))])),
      ...(inGroup ? [] : [
        h('h3', {}, 'Saved sections'), this.savedSections.length ? h('div', { class: 'design-list' }, ...this.savedSections.map(sectionCard)) : h('p', { class: 'hint' }, 'No saved sections.'),
        h('h3', {}, 'Built-in sections'), h('div', { class: 'design-list' }, ...BUILTIN_SECTIONS.map(sectionCard)),
      ]),
    ];
  }

  private sectionFirstPage(s: Section): Page {
    const first = s.children[0];
    return !first || first.type === 'free' ? blankPage('right') : first.type === 'spread' ? first.left : withSide(first.page ?? blankPage('right'), 'right');
  }

  private async choose(c: Choice) {
    if (c.id && !c.id.startsWith('example:') && c.data && isUntitled(c.name)) {
      const name = await this.host.nameSaved(c.id, c.name, c.kind as 'page' | 'spread');
      if (name === null) return;
      c = { ...c, name, data: { ...c.data, name } as Page | Spread };
      void this.refreshDesigns();
    }
    this.picker.close();
    if (this.picking.for === 'cover') {
      const at = this.slot;
      this.edit(() => setCover(this.book, at, c.kind === 'blank' ? null : (c.data as Page)));
      return;
    }
    if (this.picking.for === 'free') {
      const { path, index } = this.picking;
      this.editOutline((o) => setFreePage(o, path, index, c.kind === 'blank' ? null : (c.data as Page)));
      return;
    }
    const link = (p: Page | null, q?: Page): Link | undefined => (c.id && p ? { id: c.id, fingerprint: q ? `${fingerprint(p)}/${fingerprint(q)}` : fingerprint(p) } : undefined);
    if (c.kind === 'spread') {
      const s = c.data as Spread;
      this.addBlock(spreadBlock(c.name, s.left, s.right, 1, link(s.left, s.right)));
    } else this.addBlock(pageBlock(c.data as Page, 1, link(c.data as Page)));
  }

  /**
   * A page or spread that prints dates is placed to repeat the way its tokens suggest (docs/product-model.md, D13): each day, week or
   * month of the calendar, or, in a group that repeats by week or month, each day of its span. Anything else stays ×1.
   */
  private withSuggestedRepeat(block: Block, group: number | null): Block {
    if (block.type !== 'page' && block.type !== 'spread') return block;
    const unit = block.type === 'page' ? suggestUnit(block.page) : suggestUnit(block.left, block.right);
    if (!unit) return block;
    if (group === null) return this.book.calendar ? { ...block, repeat: { each: unit } } : block;
    const parent = this.book.outline[group];
    return unit === 'day' && parent?.type === 'group' && isEach(parent.repeat) ? { ...block, repeat: { each: 'day', of: 'span' } } : block;
  }

  /** Add a block to the end of the outline (or the end of the group the picker was opened from) and show it. */
  private addBlock(block: Block) {
    this.picker.close();
    const group = this.picking.for === 'add' ? this.picking.group : null;
    block = this.withSuggestedRepeat(block, group);
    this.editOutline((o) => addBlock(o, block, group !== null ? { group } : undefined), () => {
      const o = this.book.outline;
      this.selected = group !== null ? [group, (o[group] as Extract<Block, { type: 'group' }>).children.length - 1] : [o.length - 1];
      this.openRow = null;
      const row = bookLayout(this.book).rows[group ?? o.length - 1];
      if (row?.first) this.slot = row.first;
      const at = group !== null ? (o[group] as GroupBlock).children[(o[group] as GroupBlock).children.length - 1] : o[o.length - 1];
      const how = at.type !== 'free' && isEach(at.repeat) ? ` It repeats ${repeatLabel(at, group !== null ? (o[group] as GroupBlock) : undefined)}; change that in its settings.` : '';
      this.say(`Added “${nameOf(block)}”${group !== null ? ` to ${nameOf(o[group])}` : ''}.${how} Undo takes it back.`);
    });
    this.contents.querySelector('.orow.selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- flip through --------------------------------------------------------------

  private flip() {
    flipThrough(this.book, (slot, align) => slotSvg(this.book, slot, outlineMark, ` preserveAspectRatio="${align} meet"`), (left) => this.go(left));
  }
}
