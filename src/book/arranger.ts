import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Page } from '../format/types';
import { withSide, type Spread } from '../format/spread';
import { fingerprint } from '../format/fingerprint';
import type { Expander } from '../format/tokens';
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
  firstCell, insertSpots, isEach, layoutOutline, nameOf, pageBlock, removeBlock, repeatLabel, replaceBlock, setDesign, setFreePage, setPin, setRepeat, setShared, spreadBlock, timesOf, totalLine, MAX_REPEAT,
  type Block, type Child, type GroupBlock, type Link, type Path, type Repeat, type Row, type Spot,
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
  /**
   * Open the page or spread editor on a copy that sits in the book (Edit here). Resolves false when it could not be opened (the
   * page or spread open before could not be written first), and then nothing has changed.
   */
  editHere(request: EditHere): Promise<boolean>;
}

/** What the page or spread editor needs to edit a copy where it sits in the book. */
export interface EditHere {
  kind: 'page' | 'spread';
  /** Copies to edit: the page, or the spread's left and right. */
  pages: Page[];
  /** A spread block's name (a page's is in the page). */
  name: string;
  /** Which page to start on, for a spread: 0 left, 1 right. */
  focus: 0 | 1;
  /** The bar's two parts: "p.14", and "Week planner, each week: changes all 5". */
  where: string;
  what: string;
  /** The page to come back to in the Book view. */
  slot: number;
  /** What Preview shows for each page: the slot's own date and page number (null: sample values). */
  preview: ({ expand: Expander; pageNumber: string | null } | null)[];
  /** Write the editor's pages (and a spread's name) into the book. The book autosaves. */
  commit(pages: Page[], name: string): void;
}

/** Where a copy sits in the book: a page or spread block (inside a group too), a free page, or a cover. */
type EditTarget = { kind: 'block'; path: Path } | { kind: 'free'; path: Path; index: number } | { kind: 'cover'; slot: number };

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
  private picking: { for: 'cover' } | { for: 'free'; path: Path; index: number } | { for: 'replace'; path: Path } | { for: 'add'; group: number | null; /** The block (or, in a group, the child) the owner is on, which the new one goes after. */ current: number | null } = { for: 'add', group: null, current: null };
  /** The card opened in the Add… picker: what it makes, how often it repeats, and where it goes. */
  private pending: { key: string; make: (c?: Choice) => Block; choice?: Choice; repeat: Repeat | null; where: Spot['id'] } | null = null;

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
    const target = this.targetAt(this.slot);
    const editPage = target ? h('button', {
      type: 'button', 'data-key': 'book-edit-page', 'data-help': 'book-edit-page', onclick: () => void this.editHere(target, this.slot),
      title: 'Change this page where it sits in the book (a spread opens both of its pages)',
    }, 'Edit page') : null;
    this.actions.replaceChildren(...([
      h('p', { class: 'design-name' }, h('span', { class: 'hint' }, `${slotLabel(this.book, this.slot)}: `), h('strong', {}, designName(here)),
        cover ? null : h('span', { class: 'hint page-origin' }, ` · ${this.origin(this.slot)}`)),
      cover ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-help': 'book-choose', onclick: () => void this.openCoverPicker() }, 'Choose design…'),
        h('button', { type: 'button', disabled: !here, 'data-help': 'book-clear', onclick: () => this.edit(() => setCover(this.book, this.slot, null)), title: 'Make this cover blank' }, 'Clear'),
        editPage,
      ) : free ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-key': 'free-design', 'data-help': 'free-design', onclick: () => void this.openFreePicker(free.path, free.index) }, 'Choose design…'),
        h('button', { type: 'button', disabled: !here, 'data-key': 'free-clear', 'data-help': 'free-clear', onclick: () => this.clearFree(free.path, free.index), title: 'Make this free page blank' }, 'Clear'),
        editPage,
      ) : editPage ? h('div', { class: 'row' }, editPage) : null,
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
      ...(block.type === 'page' || block.type === 'spread' ? [
        button('outline-edit-here', 'Edit here', () => { this.contents.classList.remove('open'); void this.editHere({ kind: 'block', path }); },
          { disabled: !this.slotOf({ kind: 'block', path }), title: this.slotOf({ kind: 'block', path }) ? null : 'This block takes no pages yet, so there is no page to edit' }),
        button('outline-replace', 'Replace design…', () => void this.openReplacePicker(path)),
      ] : []),
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
    const parent = path.length === 1 ? null : (this.book.outline[path[0]] as GroupBlock);
    return this.repeatChooser(block.repeat, path.length === 1, parent && isEach(parent.repeat) ? parent.repeat.each : null, (next) => this.editOutline((x) => setRepeat(x, path, next)), 'outline-each', 'outline-each');
  }

  /** The "How often" select. `spanUnit` is the unit a group that repeats by week or month spans, for the blocks inside it. */
  private repeatChooser(r: Repeat, top: boolean, spanUnit: 'day' | 'week' | 'month' | null, set: (next: Repeat) => void, key: string, help: string): HTMLElement {
    const cal = !!this.book.calendar;
    const options: [string, string, boolean][] = top
      ? [['times', 'A number of times', true], ...(['day', 'week', 'month'] as const).map((u): [string, string, boolean] => [u, `Each ${u} of the calendar${cal ? '' : ' (set a calendar first)'}`, cal])]
      : [['times', 'A number of times', true], ...(['day', 'week'] as const).map((u): [string, string, boolean] => [`span-${u}`, `Each ${u} of the group’s span${spanUnit ? '' : ' (the group must repeat by week or month)'}`, !!spanUnit])];
    const value = !isEach(r) ? 'times' : 'of' in r ? `span-${r.each}` : r.each;
    const select = h('select', { 'aria-label': 'How often', 'data-key': key, 'data-help': help },
      ...options.map(([v, label, on]) => h('option', { value: v, selected: v === value, disabled: !on && v !== value }, label)));
    commitField(select, () => {
      const v = select.value;
      set(v === 'times' ? { times: 1 } : v.startsWith('span-') ? { each: v.slice(5) as 'day' | 'week', of: 'span' } : { each: v as 'day' | 'week' | 'month' });
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

  /** The block Add… goes after: the selected row, else the block that owns the page being looked at (a cover or gap page has none). In a group, the selected child. */
  private currentBlock(group: number | null): number | null {
    if (group !== null) return this.selected && this.selected.length === 2 && this.selected[0] === group ? this.selected[1] : null;
    if (this.selected) return this.selected[0];
    const cell = this.slot >= 1 && this.slot <= this.book.page_count ? bookLayout(this.book).cells[this.slot - 1] : null;
    return cell && cell.kind !== 'gap' ? cell.block : null;
  }

  private async openAdd(group: number | null) {
    await this.refreshDesigns();
    this.picking = { for: 'add', group, current: this.currentBlock(group) };
    this.pending = null;
    this.renderPicker();
    this.picker.showModal();
  }

  private async openCoverPicker() {
    await this.refreshDesigns();
    this.picking = { for: 'cover' };
    this.pending = null;
    this.renderPicker();
    this.picker.showModal();
  }

  private async openReplacePicker(path: Path) {
    await this.refreshDesigns();
    this.picking = { for: 'replace', path };
    this.pending = null;
    this.renderPicker();
    this.picker.showModal();
  }

  private async openFreePicker(path: Path, index: number) {
    await this.refreshDesigns();
    this.picking = { for: 'free', path, index };
    this.pending = null;
    this.renderPicker();
    this.picker.showModal();
  }

  private renderPicker() {
    const cover = this.picking.for !== 'add';
    const replacing = this.picking.for === 'replace' ? blockAt(this.book.outline, this.picking.path) : undefined;
    const into = this.picking.for === 'add' ? this.picking.group : null;
    this.pickerTitle.textContent = replacing ? `Replace design: ${nameOf(replacing)}` : this.picking.for === 'free' ? `Design for free page ${this.picking.index + 1}` : cover ? `Design for ${slotLabel(this.book, this.slot).toLowerCase()}` : into !== null ? `Add to ${nameOf(this.book.outline[into] ?? groupBlock('the group'))}` : 'Add to the book';
    const tab = replacing?.type === 'spread' ? 'spreads' : cover ? 'pages' : this.pickerTab;
    this.pickerTabs.el.parentElement!.hidden = cover;
    this.pickerTabs.select(tab);
    const side = cover && !replacing ? slotSide(this.slot) : 'right';
    const card = (c: Choice) => {
      const thumb = h('div', { class: 'thumb' });
      const pages = c.kind === 'spread' ? [(c.data as Spread).left, (c.data as Spread).right] : [withSide(c.data ? (c.data as Page) : blankPage(side), side)];
      thumb.innerHTML = thumbnailSvg(pages);
      const hint = c.kind === 'blank' ? 'Empty page' : c.kind === 'spread' ? 'Spread: two facing pages' : 'Page';
      if (this.picking.for === 'add') return this.addCard({ key: `${c.kind}:${c.id ?? c.name}`, name: c.name, hint, kind: c.kind, wide: c.kind === 'spread', thumb, make: (ch) => this.blockFromChoice(ch ?? c), choice: c });
      return h('button', {
        type: 'button', class: `design${c.kind === 'spread' ? ' wide' : ''}`, 'data-kind': c.kind, 'data-help': 'picker-design', 'data-name': c.name,
        onclick: () => void this.choose(c),
      }, thumb, h('span', { class: 'design-title' }, c.name), h('span', { class: 'hint' }, hint));
    };
    const section = (title: string, items: Choice[], empty?: string) => [
      h('h3', {}, title),
      items.length ? h('div', { class: 'design-list' }, ...items.map(card)) : h('p', { class: 'hint' }, empty ?? ''),
    ];
    const choice = (kind: 'page' | 'spread', id: (d: never) => string) => (data: Page | Spread): Choice => ({ name: data.name, kind, data, id: id(data as never) });
    const saved = (kind: 'page' | 'spread') => this.saved.filter((i) => i.kind === kind).map((i): Choice => ({ name: i.name, kind, data: { ...(i.data as Page | Spread), name: i.name }, id: i.id }));
    const builtinPage = choice('page', exampleId), builtinSpread = choice('spread', spreadId);
    const scroll = this.pickerBody.scrollTop; // the card being set redraws the list: stay where it was
    const body = (items: HTMLElement[]) => { this.pickerBody.replaceChildren(...items); this.pickerBody.scrollTop = scroll; };
    if (tab === 'blocks') {
      body(this.otherBlocks());
      return;
    }
    body(tab === 'pages'
      ? [
        ...(cover ? [h('div', { class: 'design-list' }, card({ name: 'Blank', kind: 'blank', data: null, id: null }))] : []),
        ...section('Saved pages', saved('page'), 'Nothing saved yet. Pages you save to the Library appear here.'),
        ...section('Built-in pages', this.host.examples.map(builtinPage)),
      ]
      : [
        ...section('Saved spreads', saved('spread'), 'No saved spreads.'),
        ...section('Built-in spreads', BUILTIN_SPREADS.map(builtinSpread)),
      ]);
  }

  /** The Other tab: a blank page, free pages, a new group, and sections (which add a group). */
  private otherBlocks(): HTMLElement[] {
    const inGroup = this.picking.for === 'add' && this.picking.group !== null;
    const thumbOf = (pages: Page[]) => { const t = h('div', { class: 'thumb' }); t.innerHTML = thumbnailSvg(pages); return t; };
    const card = (name: string, hint: string, key: string, pages: Page[], make: () => Block, disabled = false) =>
      this.addCard({ key, name, hint, kind: 'other', wide: false, thumb: thumbOf(pages), make, disabled, dataKey: key });
    const blank = () => [blankPage('right')];
    const sectionCard = (s: Section) => card(s.name, `Section: ${plural(s.children.length, 'block')}`, 'add-section', [this.sectionFirstPage(s)], () => sectionGroup(s));
    const free = canAddFree(this.book.outline) || inGroup;
    return [
      h('div', { class: 'design-list' },
        card('Blank page', 'An empty page, repeated as often as you set.', 'add-blank', blank(), () => pageBlock(null)),
        card('Free pages', inGroup ? 'A page you fill by hand, in each repeat.' : free ? 'Pages you fill by hand: they take the pages the other blocks leave.' : 'Another block already takes what is left.', 'add-free', blank(), () => freeBlock(inGroup ? [null] : []), !free),
        ...(inGroup ? [] : [card('New group', 'Blocks that repeat together. Add pages and spreads to it after.', 'add-group', blank(), () => groupBlock('Group'))])),
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

  /** The block a design makes: a page, or a spread, with the link to the design it came from. */
  private blockFromChoice(c: Choice): Block {
    const link = (p: Page | null, q?: Page): Link | undefined => (c.id && p ? { id: c.id, fingerprint: q ? `${fingerprint(p)}/${fingerprint(q)}` : fingerprint(p) } : undefined);
    if (c.kind === 'spread') {
      const s = c.data as Spread;
      return spreadBlock(c.name, s.left, s.right, 1, link(s.left, s.right));
    }
    return pageBlock(c.kind === 'blank' ? null : (c.data as Page), 1, link(c.data as Page | null));
  }

  /** A saved design that is still Untitled is named before it is placed. Resolves the choice with its name, or null if that was cancelled. */
  private async named(c: Choice): Promise<Choice | null> {
    if (!(c.id && !c.id.startsWith('example:') && c.data && isUntitled(c.name))) return c;
    const name = await this.host.nameSaved(c.id, c.name, c.kind as 'page' | 'spread');
    if (name === null) return null;
    void this.refreshDesigns();
    return { ...c, name, data: { ...c.data, name } as Page | Spread };
  }

  /** A design chosen for a cover, a free page, or to replace a block's (adding a block goes through the card's Add button instead). */
  private async choose(c: Choice) {
    const named = await this.named(c);
    if (!named) return;
    c = named;
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
    if (this.picking.for === 'replace') {
      const { path } = this.picking;
      const old = blockAt(this.book.outline, path);
      const link = (p: Page | null, q?: Page): Link | undefined => (c.id && p ? { id: c.id, fingerprint: q ? `${fingerprint(p)}/${fingerprint(q)}` : fingerprint(p) } : undefined);
      if (c.kind === 'spread') {
        const s = c.data as Spread;
        this.editOutline((o) => setDesign(o, path, { name: c.name, left: s.left, right: s.right }, link(s.left, s.right) ?? null));
      } else this.editOutline((o) => setDesign(o, path, { page: c.kind === 'blank' ? null : (c.data as Page) }, link(c.data as Page | null) ?? null));
      this.say(`Replaced the design of “${old ? nameOf(old) : 'the block'}” with “${c.name}”. Undo takes it back.`);
    }
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

  // ---- the card being set in the Add… picker ----------------------------------------------

  /** The group the picker adds into, or null for the top level. */
  private addGroup(): number | null { return this.picking.for === 'add' ? this.picking.group : null; }

  private addSpots(): Spot[] { return this.picking.for === 'add' ? insertSpots(this.book.outline, this.picking.current, this.picking.group) : []; }

  /** What the open card makes, with the repeat set on it. */
  private pendingBlock(p: NonNullable<Arranger['pending']>): Block {
    const b = p.make(p.choice);
    return b.type !== 'free' && p.repeat ? { ...b, repeat: p.repeat } : b;
  }

  /** Tapping a card opens it in place: its repeat (prefilled the way its dates suggest), where it goes, and its own Add. Tapping it again closes it. */
  private expand(key: string, make: (c?: Choice) => Block, choice?: Choice) {
    if (this.pending?.key === key) this.pending = null;
    else {
      const start = this.withSuggestedRepeat(make(choice), this.addGroup());
      this.pending = { key, make, choice, repeat: start.type === 'free' ? null : start.repeat, where: this.addSpots()[0]?.id ?? 'end' };
    }
    this.renderPicker();
    this.pickerBody.querySelector('.design.open')?.scrollIntoView?.({ block: 'start' });
  }

  private addCard(o: { key: string; name: string; hint: string; kind: string; wide: boolean; thumb: HTMLElement; make: (c?: Choice) => Block; choice?: Choice; disabled?: boolean; dataKey?: string }): HTMLElement {
    const p = this.pending;
    const attrs = { 'data-kind': o.kind, 'data-name': o.name, 'data-key': o.dataKey ?? null };
    const title = [o.thumb, h('span', { class: 'design-title' }, o.name), h('span', { class: 'hint' }, o.hint)];
    if (!p || p.key !== o.key) {
      return h('button', { type: 'button', class: `design${o.wide ? ' wide' : ''}`, ...attrs, 'data-help': 'picker-design', disabled: o.disabled ?? false, 'aria-expanded': 'false', onclick: () => this.expand(o.key, o.make, o.choice) }, ...title);
    }
    return h('div', { class: `design open${o.wide ? ' wide' : ''}`, ...attrs },
      h('button', { type: 'button', class: 'design-head', 'data-help': 'picker-design-open', 'aria-expanded': 'true', onclick: () => this.expand(o.key, o.make, o.choice) }, ...title),
      this.addOptions(p));
  }

  /** The open card's settings: repeat, where, the line that says where it lands, and Add. */
  private addOptions(p: NonNullable<Arranger['pending']>): HTMLElement {
    const group = this.addGroup(), o = this.book.outline, top = group === null;
    const set = (patch: Partial<typeof p>) => { Object.assign(p, patch); this.renderPicker(); };
    const fields: HTMLElement[] = [];
    if (p.repeat) {
      const r = p.repeat, filling = 'fill' in r;
      const parent = group === null ? null : o[group];
      const spanUnit = parent?.type === 'group' && isEach(parent.repeat) ? parent.repeat.each : null;
      if (!filling) {
        fields.push(this.repeatChooser(r, top, spanUnit, (next) => set({ repeat: next }), 'add-each', 'add-each'));
        if (!isEach(r)) fields.push(this.stepper('Repeat', 'add-repeat', timesOf(r), 1, MAX_REPEAT, (n) => set({ repeat: { times: n } })));
      }
      if (top) {
        const can = canAddFree(o);
        fields.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Fill'),
          h('button', {
            type: 'button', 'data-key': 'add-fill', 'data-help': 'add-fill', 'aria-pressed': String(filling), disabled: !filling && !can,
            title: !filling && !can ? 'Another block already takes what is left' : null, onclick: () => set({ repeat: filling ? { times: 1 } : fillRepeat() }),
          }, filling ? 'Filling what’s left' : 'Fill what’s left')));
      }
    }
    const spots = this.addSpots(), spot = spots.find((x) => x.id === p.where) ?? spots[0];
    const where = h('select', { 'aria-label': 'Where', 'data-key': 'add-where', 'data-help': 'add-where' },
      ...spots.map((x) => h('option', { value: x.id, selected: x.id === spot.id }, x.label)));
    commitField(where, () => set({ where: where.value as Spot['id'] }));
    fields.push(h('div', { class: 'field' }, h('label', {}, 'Where'), where));
    const { text, over } = this.landing(this.pendingBlock(p), group, spot.index);
    return h('div', { class: 'design-set' }, ...fields,
      h('p', { class: `lands${over ? ' over' : ''}`, role: 'status', 'data-key': 'add-lands' }, text),
      h('button', { type: 'button', class: 'primary add-confirm', 'data-key': 'add-confirm', 'data-help': 'add-confirm', onclick: () => void this.confirmAdd() }, 'Add'));
  }

  /** Where a block would land, worked out by laying the outline out with it: "Lands on p.13–14", or in red that the book would be over. */
  private landing(block: Block, group: number | null, index: number): { text: string; over: boolean } {
    const lay = layoutOutline(addBlock(this.book.outline, block, group === null ? { index } : { group, index }), this.book.page_count, this.book.calendar);
    const slots = group === null
      ? (lay.rows[index]?.first != null ? lay.cells.flatMap((c, i) => (c && c.block === index && c.kind !== 'gap' ? [i + 1] : [])) : [])
      : lay.cells.flatMap((c, i) => (c && c.block === group && c.child === index && c.kind !== 'gap' ? [i + 1] : []));
    const first = slots[0], last = slots[slots.length - 1];
    const lands = !slots.length
      ? (block.type === 'group' && !block.children.length ? 'An empty group takes no pages until you add blocks to it.' : 'Takes no pages here.')
      : `Lands on p.${first}${last !== first ? `–${last}` : ''}${slots.length > 2 ? `, ${plural(slots.length, 'page')}` : ''}`;
    return lay.over > 0 ? { text: `${lands}. Book would be over by ${plural(lay.over, 'page')}`, over: true } : { text: lands, over: false };
  }

  /** The card's Add button: put the block where it was set to go. */
  private async confirmAdd() {
    const p = this.pending;
    if (!p) return;
    if (p.choice) {
      const named = await this.named(p.choice);
      if (!named) return;
      p.choice = named;
    }
    const spots = this.addSpots(), spot = spots.find((x) => x.id === p.where) ?? spots[0];
    this.addBlock(this.pendingBlock(p), spot.index);
  }

  /** Insert a block at `index` of the outline (or of the group the picker was opened from), select its row and show its first page. */
  private addBlock(block: Block, index: number) {
    this.picker.close();
    this.pending = null;
    const group = this.addGroup();
    const path: Path = group !== null ? [group, index] : [index];
    this.editOutline((o) => addBlock(o, block, group !== null ? { group, index } : { index }), () => {
      const o = this.book.outline, lay = bookLayout(this.book);
      this.selected = path;
      this.openRow = null;
      const first = group !== null ? firstCell(lay, group, index)?.slot : lay.rows[index]?.first;
      if (first) this.slot = first;
      const at = blockAt(o, path);
      const how = at && at.type !== 'free' && isEach(at.repeat) ? ` It repeats ${repeatLabel(at, group !== null ? (o[group] as GroupBlock) : undefined)}; change that in its settings.` : '';
      this.say(`Added “${nameOf(block)}”${group !== null ? ` to ${nameOf(o[group])}` : ''}.${how} Undo takes it back.`);
    });
    this.contents.querySelector('.orow.selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- edit here ---------------------------------------------------------------

  /** Where the page in a slot can be edited: its cover, free page, or block. A gap page, and a page nothing is placed on, have none. */
  private targetAt(slot: number): EditTarget | null {
    if (isCover(this.book, slot)) return { kind: 'cover', slot };
    const free = this.freeAt(slot);
    if (free) return { kind: 'free', ...free };
    const cell = bookLayout(this.book).cells[slot - 1];
    return cell && cell.kind === 'content' ? { kind: 'block', path: cell.child === undefined ? [cell.block] : [cell.block, cell.child] } : null;
  }

  /** The first page a target is on, or null when it is on none. */
  private slotOf(t: EditTarget): number | null {
    if (t.kind === 'cover') return t.slot;
    const lay = bookLayout(this.book);
    if (t.kind === 'block') return firstCell(lay, t.path[0], t.path.length === 2 ? t.path[1] : undefined)?.slot ?? null;
    const at = lay.cells.findIndex((c) => !!c && c.kind === 'free' && c.block === t.path[0] && c.child === (t.path.length === 2 ? t.path[1] : undefined) && c.free === t.index);
    return at < 0 ? null : at + 1;
  }

  /** Open the page or spread editor on a copy in the book. The Book view's Undo takes the whole edit back. */
  private async editHere(t: EditTarget, at?: number) {
    if (!this.host.editing(() => void this.editHere(t, at))) return;
    const request = this.requestFor(t, at);
    if (!request) return;
    this.say(null);
    if (await this.host.editHere(request)) {
      this.undoStack.push(JSON.stringify(this.book));
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
  }

  /** `at` is the page being looked at, when Edit here was opened from it; without it the block's first page is used. */
  private requestFor(t: EditTarget, at?: number): EditHere | null {
    const b = this.book;
    const first = this.slotOf(t);
    // a spread's left page is the even one of the opening that holds the page looked at
    const slot = at === undefined || first === null ? first : t.kind === 'block' && blockAt(b.outline, t.path)?.type === 'spread' ? opening(at)[0] : at;
    const reads = (first: number, n: number) => Array.from({ length: n }, (_, i) => {
      const at = first + i;
      return isCover(b, at) ? (b.calendar ? { expand: bookExpand(b, at), pageNumber: null } : null) : { expand: bookExpand(b, at), pageNumber: b.page_numbers ? String(at) : null };
    });
    const commitWith = (write: (pages: Page[], name: string) => void) => (pages: Page[], name: string) => {
      write(pages, name);
      this.host.changed(b);
    };
    const common = { slot: slot ?? this.slot, focus: ((at ?? slot) !== null && slotSide((at ?? slot)!) === 'right' ? 1 : 0) as 0 | 1, name: '' };
    if (t.kind === 'cover') {
      const label = slotLabel(b, t.slot).toLowerCase();
      return {
        ...common, kind: 'page', pages: [structuredClone(getSlot(b, t.slot) ?? blankPage(slotSide(t.slot)))], where: `the ${label}`,
        what: 'a cover: changes only this one', preview: reads(t.slot, 1), commit: commitWith((pages) => setCover(b, t.slot, pages[0])),
      };
    }
    if (t.kind === 'free') {
      const block = blockAt(b.outline, t.path);
      if (block?.type !== 'free' || slot === null) return null;
      return {
        ...common, kind: 'page', pages: [structuredClone(block.pages[t.index] ?? blankPage(slotSide(slot)))], where: `p.${slot}`,
        what: `Free page ${t.index + 1}: changes only this page`, preview: reads(slot, 1),
        commit: commitWith((pages) => { b.outline = setFreePage(b.outline, t.path, t.index, pages[0]); }),
      };
    }
    const block = blockAt(b.outline, t.path);
    if (!block || (block.type !== 'page' && block.type !== 'spread') || slot === null) return null;
    const parent = t.path.length === 2 ? (b.outline[t.path[0]] as GroupBlock) : undefined;
    const placed = bookLayout(b).cells.filter((c) => !!c && c.kind === 'content' && c.block === t.path[0] && (t.path.length === 1 || c.child === t.path[1])).length;
    const n = block.type === 'spread' ? Math.ceil(placed / 2) : placed;
    const what = `${nameOf(block)}, ${repeatLabel(block, parent)}: ${n > 1 ? `changes all ${n}` : `changes this ${block.type}`}`;
    if (block.type === 'page') {
      return {
        ...common, kind: 'page', pages: [structuredClone(block.page ?? blankPage(slotSide(slot)))], where: `p.${slot}`, what, preview: reads(slot, 1),
        commit: commitWith((pages) => { b.outline = setDesign(b.outline, t.path, { page: pages[0] }); }),
      };
    }
    return {
      ...common, kind: 'spread', pages: [structuredClone(block.left), structuredClone(block.right)], name: block.name, where: `pp.${slot}–${slot + 1}`, what,
      preview: reads(slot, 2), commit: commitWith((pages, name) => { b.outline = setDesign(b.outline, t.path, { name, left: pages[0], right: pages[1] }); }),
    };
  }

  /** Back from Edit here: show the Book view again on that page, with the change in the outline and the pages. */
  returnTo(slot: number) {
    this.slot = Math.max(FIRST_SLOT, Math.min(lastSlot(this.book), slot));
    this.selected = null;
    this.openRow = null;
    this.say(null);
    this.checkBook();
    this.render();
  }

  // ---- flip through --------------------------------------------------------------

  private flip() {
    flipThrough(this.book, (slot, align) => slotSvg(this.book, slot, outlineMark, ` preserveAspectRatio="${align} meet"`), (left) => this.go(left), {
      can: (slot) => this.targetAt(slot) !== null,
      open: (slot) => { const t = this.targetAt(slot); if (t) { this.go(slot); void this.editHere(t, slot); } },
    });
  }
}
