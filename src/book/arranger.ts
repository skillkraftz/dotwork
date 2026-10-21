import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Page } from '../format/types';
import { withSide, type Spread } from '../format/spread';
import { addDays, formatDate, parts, sundayOf, todayIso, weekNumber } from '../format/dates';
import { MONTH_NAMES } from '../builtin/calendar';
import { pageContent, thumbnailSvg } from '../render';
import { h, tabBar } from '../panel';
import { issuesProblem, problemView } from '../problems';
import type { Library, LibraryItem } from '../library/library';
import { applyDesign, blankPage, bookExpand, bookPage, dateOf, fillSlots, getSlot, readBook, setDates, setSlot, slotCount, slotSide, type Book, type Design, type Facing } from './book';
import { BUILTIN_SPREADS } from '../builtin/library';
import { checkPrintSettings, signatureSizes } from './impose';
import { applyBuild, buildSummary, guessMove, planSteps, sectionFrom, stepLine, type BuildPlan } from './build';
import { MOVES, MOVE_LABEL, readSection, type Move, type Recipe, type Section, type Step } from './sections';
import { notesPage } from '../builtin/pages';
import { BUILTIN_SECTIONS, PRESETS } from '../builtin/sections';
import { flipThrough } from './flip';
import { contentsRows, datesLabel, datesStart, datesSummary, designName, endOfRun, listPages, opening, planDates, scopeSlots, slotLabel, whatChanges, type DatePlan, type Scope } from './plan';

export interface ArrangerHost {
  library: Library;
  /** The built-in example pages, offered next to the saved designs. */
  examples: readonly Page[];
  /** Called after every change to the book, so the draft can be kept. */
  changed(book: Book): void;
  exportFiles(book: Book): void;
}

const MAX_UNDO = 30;
const SPREADS_KEY = 'dotwork.book.spreads';
const PICKER_TAB_KEY = 'dotwork.book.picker-tab';
type PickerTab = 'pages' | 'spreads';
const PICKER_TABS: [PickerTab, string][] = [['pages', 'Pages'], ['spreads', 'Spreads']];
const SWIPE_PX = 50;
/** January … December, for people (the calendar's names are all capitals). */
const monthTitle = (month: number) => MONTH_NAMES[month - 1][0] + MONTH_NAMES[month - 1].slice(1).toLowerCase();
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/** A slot's page as an SVG, as it prints (with its page number unless it is a cover or numbers are off). */
const slotSvg = (book: Book, slot: number, extra = '', attrs = '') => {
  const inner = slot === 0 || slot === book.page_count + 1;
  const number = inner || !book.page_numbers ? null : String(slot);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W_MM} ${PAGE_H_MM}" aria-hidden="true"${attrs}>` +
    pageContent(bookPage(book, slot), { mode: 'export', pageNumber: number, expand: bookExpand(book, slot) }) + extra + '</svg>';
};
const outline = `<rect class="outline" x="0.15" y="0.15" width="${PAGE_W_MM - 0.3}" height="${PAGE_H_MM - 0.3}" fill="none"/>`;

/** What can be put on a page: a page, or a spread (which fills this page and the one beside it). */
type Choice = { name: string; kind: 'blank' | 'page' | 'spread'; data: Page | Spread | null };

type ScopeMode = Scope['mode'];
const SCOPE_MODES: { mode: ScopeMode; label: string }[] = [
  { mode: 'range', label: 'Pages … to …' },
  { mode: 'from', label: 'Every page from here to …' },
  { mode: 'left', label: 'Every left page, from … to …' },
  { mode: 'right', label: 'Every right page, from … to …' },
];

/** The book, one page at a time: step through it, choose a design for the page, copy it to more pages, and read the contents. */
export class Arranger {
  private book: Book;
  /** The slot being looked at: 0 is the inside front cover, 1..N the pages, N+1 the inside back cover. */
  private slot = 1;
  private spreads = stored(SPREADS_KEY) === '1';
  private undoStack: string[] = [];
  private saved: LibraryItem[] = [];
  private expanded = new Set<number>();
  private swipe: { x: number; y: number } | null = null;

  private bar = h('div', { class: 'book-bar' });
  private nav = h('div', { class: 'book-nav' });
  private stage = h('div', { class: 'book-stage' });
  private actions = h('div', { class: 'book-actions' });
  private contents = h('aside', { class: 'book-contents', 'aria-label': 'Contents' });
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
  /** Whether the Apply window also copies the facing page, so that a spread keeps its left and right pages. */
  private withFacing = false;
  private picker: HTMLDialogElement;
  private pickerBody = h('div', { class: 'picker-body' });
  private pickerTitle = h('h2', {});
  private apply: HTMLDialogElement;
  private applyBody = h('div', { class: 'apply-body' });
  private scope: Scope = { mode: 'range', from: 1, to: 1 };
  /** The "from" field's value, kept while the mode ("every page from here") has no `from`. */
  private scopeFrom = 1;
  private datesDialog: HTMLDialogElement;
  private datesBody = h('div', { class: 'apply-body' });
  private buildDialog: HTMLDialogElement;
  private buildBody = h('div', { class: 'apply-body' });
  private buildTitle = h('h2', {});
  /** What the book builder window is set to: the recipe being edited, and whether it is listing steps, sections to add, or gap pages. */
  private recipe: Recipe = { month: '2026-01', steps: [] };
  private buildView: 'steps' | 'add' | 'gap' = 'steps';
  /** What the steps list redraws when a number or date changes, so that typing doesn't lose its place. */
  private buildRefs: { summary: HTMLElement; go: HTMLButtonElement; lines: HTMLElement[] } | null = null;
  private savedSections: Section[] = [];
  private sectionDialog: HTMLDialogElement;
  private sectionBody = h('div', { class: 'apply-body' });
  /** What the Save pages as a section window is set to. */
  private sectioning = { from: 1, to: 1, name: '', move: 'none' as Move };
  private moreOpen = false;
  /** What the Dates window is set to; its first and last page are kept apart from the plan. */
  private dating = { mode: 'week' as 'week' | 'day', year: 2026, week: 1, start: '2026-01-01', from: 1, to: 1 };

  constructor(root: HTMLElement, private host: ArrangerHost, book: Book) {
    this.book = book;
    this.picker = h('dialog', { class: 'library picker', 'aria-label': 'Choose a design' },
      h('header', {}, this.pickerTitle, h('button', { type: 'button', 'data-help': 'picker-close', onclick: () => this.picker.close() }, 'Close')),
      h('div', { class: 'lib-find' }, this.pickerTabs.el),
      this.pickerBody) as HTMLDialogElement;
    this.apply = h('dialog', { class: 'library apply', 'aria-label': 'Apply to more pages' },
      h('header', {}, h('h2', {}, 'Apply to more pages'), h('button', { type: 'button', 'data-help': 'apply-close', onclick: () => this.apply.close() }, 'Close')),
      this.applyBody) as HTMLDialogElement;
    this.datesDialog = h('dialog', { class: 'library apply dates', 'aria-label': 'Dates' },
      h('header', {}, h('h2', {}, 'Dates'), h('button', { type: 'button', 'data-help': 'dates-close', onclick: () => this.datesDialog.close() }, 'Close')),
      this.datesBody) as HTMLDialogElement;
    this.buildDialog = h('dialog', { class: 'library apply build', 'aria-label': 'Book builder' },
      h('header', {}, this.buildTitle, h('button', { type: 'button', 'data-help': 'build-close', onclick: () => this.buildDialog.close() }, 'Close')),
      this.buildBody) as HTMLDialogElement;
    this.sectionDialog = h('dialog', { class: 'library apply section-save', 'aria-label': 'Save pages as a section' },
      h('header', {}, h('h2', {}, 'Save pages as a section'), h('button', { type: 'button', 'data-help': 'section-close', onclick: () => this.sectionDialog.close() }, 'Close')),
      this.sectionBody) as HTMLDialogElement;
    for (const d of [this.picker, this.apply, this.datesDialog, this.buildDialog, this.sectionDialog]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(this.picker, this.apply, this.datesDialog, this.buildDialog, this.sectionDialog);
    document.addEventListener('pointerdown', (e) => {
      if (this.moreOpen && !(e.target as HTMLElement).closest('.book-more')) { this.moreOpen = false; this.renderBar(); }
    }, true);

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
      h('div', { class: 'book-main' }, this.nav, this.stage, this.problemEl, this.msgEl, this.warnEl, this.actions), this.contents));
    this.render();
  }

  get current(): Book { return this.book; }

  /** Show a different book (opened, imported or new). */
  setBook(book: Book) {
    this.book = book;
    this.undoStack = [];
    this.expanded.clear();
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
    this.undoStack.push(JSON.stringify(this.book));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    change();
    this.host.changed(this.book);
    this.checkBook();
    this.render();
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
    this.slot = Math.min(this.slot, slotCount(this.book) - 1);
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
    this.slot = Math.max(0, Math.min(slotCount(this.book) - 1, slot));
    this.say(null);
    this.renderView();
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
    this.renderContents();
  }

  /** Everything that follows the current page. */
  private renderView() {
    this.renderNav();
    this.renderStage();
    this.renderActions();
    this.markCurrent();
  }

  private renderBar() {
    const undo = h('button', { type: 'button', disabled: this.undoStack.length === 0, onclick: () => this.undo(), 'data-help': 'book-undo', title: 'Undo the last change to the book' }, 'Undo');
    const item = (help: string, label: string, run: () => void) =>
      h('button', { type: 'button', role: 'menuitem', 'data-key': help, 'data-help': help, onclick: () => { this.moreOpen = false; this.renderBar(); run(); } }, label);
    // The less-used actions sit in a menu, so that the bar fits a phone without scrolling sideways.
    const more = h('div', { class: 'book-more' },
      h('button', { type: 'button', 'data-key': 'book-more', 'data-help': 'book-more', 'aria-haspopup': 'menu', 'aria-expanded': String(this.moreOpen), onclick: () => { this.moreOpen = !this.moreOpen; this.renderBar(); } }, 'More ▾'),
      this.moreOpen ? h('div', { class: 'menu-list', role: 'menu', 'aria-label': 'More for the book' },
        item('book-dates', 'Dates…', () => this.openDates()),
        item('book-save-section', 'Save pages as a section…', () => this.openSaveSection()),
        item('book-flip', 'Flip through', () => this.flip())) : null);
    this.bar.replaceChildren(
      undo,
      h('button', { type: 'button', 'data-key': 'book-build', 'data-help': 'book-build', onclick: () => void this.openBuild() }, 'Build book…'),
      more,
      h('button', { type: 'button', class: 'primary', 'data-help': 'book-export', onclick: () => this.host.exportFiles(this.book) }, 'Print files…'),
    );
    this.updateWarning();
  }

  private updateWarning() {
    const sizes = signatureSizes(this.book.page_count, this.book.print.signatures);
    const problem = checkPrintSettings(this.book.print, Math.max(...sizes) / 4);
    this.warnEl.textContent = problem ?? '';
    this.warnEl.hidden = !problem;
  }

  private renderNav() {
    const last = slotCount(this.book) - 1;
    const [left, right] = opening(this.slot);
    const where = this.spreads
      ? `${slotLabel(this.book, left)} and ${slotLabel(this.book, right).toLowerCase()}`
      : slotLabel(this.book, this.slot);
    const sub = this.spreads ? 'Tap a page to pick it' : `${slotSide(this.slot) === 'left' ? 'Left' : 'Right'}-hand page`;
    const prevAt = this.spreads ? left : this.slot, nextAt = this.spreads ? right : this.slot;
    this.nav.replaceChildren(
      h('button', { type: 'button', class: 'nav-step', 'data-help': 'nav-prev', 'aria-label': this.spreads ? 'Previous spread' : 'Previous page', disabled: prevAt <= 0, onclick: () => this.step(-1) }, '‹'),
      h('div', { class: 'where', 'aria-live': 'polite' }, h('strong', {}, where), h('span', { class: 'hint' }, sub)),
      h('button', { type: 'button', class: 'nav-step', 'data-help': 'nav-next', 'aria-label': this.spreads ? 'Next spread' : 'Next page', disabled: nextAt >= last, onclick: () => this.step(1) }, '›'),
      h('button', { type: 'button', class: 'view-toggle', 'data-help': 'book-spreads', 'aria-pressed': String(this.spreads), title: 'Show two facing pages side by side', onclick: () => this.setSpreads(!this.spreads) }, 'Spreads'),
      h('button', { type: 'button', class: 'contents-toggle', 'data-help': 'book-contents', onclick: () => this.contents.classList.add('open') }, 'Contents'),
    );
  }

  private renderStage() {
    const slots = this.spreads ? opening(this.slot) : [this.slot];
    this.stage.classList.toggle('spreads', this.spreads);
    this.stage.replaceChildren(...slots.map((n, i) => {
      const align = !this.spreads ? 'xMidYMid' : i === 0 ? 'xMaxYMid' : 'xMinYMid';
      const el = h('button', {
        type: 'button', class: `stage-page${this.spreads && n === this.slot ? ' current' : ''}`,
        'aria-label': `${slotLabel(this.book, n)}, ${designName(getSlot(this.book, n))}`, 'aria-pressed': this.spreads ? String(n === this.slot) : null,
        tabindex: this.spreads ? 0 : -1, 'data-slot': n, 'data-help': 'book-stage-page',
      });
      el.innerHTML = slotSvg(this.book, n, outline, ` preserveAspectRatio="${align} meet"`);
      el.onclick = () => { if (this.spreads) this.go(n); };
      return el;
    }));
  }

  private renderActions() {
    const here = getSlot(this.book, this.slot);
    const date = dateOf(this.book, this.slot);
    this.actions.replaceChildren(
      h('p', { class: 'design-name' }, h('span', { class: 'hint' }, `${slotLabel(this.book, this.slot)}: `), h('strong', {}, designName(here)),
        date ? h('span', { class: 'hint page-date' }, ` · ${formatDate(date)}`) : null),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-help': 'book-choose', onclick: () => this.openPicker() }, 'Choose design…'),
        h('button', { type: 'button', 'data-help': 'book-apply', onclick: () => this.openApply() }, 'Apply to more pages…'),
        h('button', { type: 'button', disabled: !here, 'data-help': 'book-clear', onclick: () => this.edit(() => setSlot(this.book, this.slot, null)), title: 'Make this page blank' }, 'Clear'),
      ),
    );
  }

  // ---- contents -----------------------------------------------------------------

  private renderContents() {
    const b = this.book;
    const item = (from: number, to: number, name: string, expandable: boolean) => {
      const label = expandable ? `Pages ${from}–${to}` : from === 0 || from === b.page_count + 1 ? slotLabel(b, from) : `Page ${from}`;
      const thumb = h('span', { class: 'crow-thumb' });
      thumb.innerHTML = slotSvg(b, from, outline);
      const open = this.expanded.has(from);
      const row = h('button', {
        type: 'button', class: 'crow', 'data-help': 'contents-row', 'data-from': from, 'data-to': to, 'aria-expanded': expandable ? String(open) : null,
        onclick: () => {
          if (expandable) { if (open) this.expanded.delete(from); else this.expanded.add(from); this.renderContents(); return; }
          this.go(from);
          this.contents.classList.remove('open');
        },
      }, thumb, h('span', { class: 'crow-text' }, h('strong', {}, label), h('span', { class: 'crow-name' }, name),
        datesLabel(b, from, to) ? h('span', { class: 'crow-date' }, datesLabel(b, from, to)) : null),
      expandable ? h('span', { class: 'crow-more', 'aria-hidden': 'true' }, open ? '▾' : '▸') : null);
      return row;
    };
    const rows: HTMLElement[] = [];
    for (const r of contentsRows(b)) {
      const many = r.to > r.from;
      rows.push(h('li', {}, item(r.from, r.to, r.name, many)));
      if (many && this.expanded.has(r.from)) {
        const kids = [];
        for (let n = r.from; n <= r.to; n++) kids.push(h('li', {}, item(n, n, r.name, false)));
        rows.push(h('li', {}, h('ul', { class: 'crow-kids' }, ...kids)));
      }
    }
    this.contents.replaceChildren(
      h('header', {}, h('h2', {}, 'Contents'), h('button', { type: 'button', class: 'contents-close', 'data-help': 'contents-close', onclick: () => this.contents.classList.remove('open') }, 'Close')),
      h('ul', { class: 'crows' }, ...rows),
    );
    this.markCurrent();
  }

  /** Mark the contents row for the current page (without rebuilding the list) and keep it in view. */
  private markCurrent() {
    const n = this.slot;
    let found: HTMLElement | null = null;
    for (const el of this.contents.querySelectorAll<HTMLElement>('.crow')) {
      const here = n >= Number(el.dataset.from) && n <= Number(el.dataset.to);
      // A collapsed run holds the page too, but its own row is a better mark when it is expanded.
      const inside = here && (el.dataset.from === el.dataset.to || !this.expanded.has(Number(el.dataset.from)));
      el.classList.toggle('current', inside);
      if (inside) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
      if (inside) found = el;
    }
    found?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- choosing a design ---------------------------------------------------------

  private openPicker() {
    // Spreads fill this page and the next, so they are offered on left pages only.
    if (slotSide(this.slot) !== 'left') this.pickerTab = 'pages';
    this.renderPicker();
    this.picker.showModal();
  }

  private renderPicker() {
    this.pickerTitle.textContent = `Design for ${slotLabel(this.book, this.slot).toLowerCase()}`;
    const side = slotSide(this.slot);
    const tab = side === 'left' ? this.pickerTab : 'pages';
    this.pickerTabs.el.parentElement!.hidden = side !== 'left';
    this.pickerTabs.select(tab);
    const card = (c: Choice) => {
      const thumb = h('div', { class: 'thumb' });
      const pages = c.kind === 'spread' ? [(c.data as Spread).left, (c.data as Spread).right] : [withSide(c.data ? (c.data as Page) : blankPage(side), side)];
      thumb.innerHTML = thumbnailSvg(pages);
      return h('button', {
        type: 'button', class: `design${c.kind === 'spread' ? ' wide' : ''}`, 'data-kind': c.kind, 'data-help': 'picker-design',
        onclick: () => this.choose(c),
      }, thumb, h('span', { class: 'design-title' }, c.name), h('span', { class: 'hint' }, c.kind === 'blank' ? 'Empty page' : c.kind === 'spread' ? 'Spread: fills this page and the next' : 'Page'));
    };
    const section = (title: string, items: Choice[], empty?: string) => [
      h('h3', {}, title),
      items.length ? h('div', { class: 'design-list' }, ...items.map(card)) : h('p', { class: 'hint' }, empty ?? ''),
    ];
    const choice = (kind: 'page' | 'spread') => (data: Page | Spread): Choice => ({ name: data.name, kind, data });
    const saved = (kind: 'page' | 'spread') => this.saved.filter((i) => i.kind === kind).map((i) => choice(kind)(i.data as Page | Spread));
    this.pickerBody.replaceChildren(...(tab === 'pages'
      ? [
        h('div', { class: 'design-list' }, card({ name: 'Blank', kind: 'blank', data: null })),
        ...section('Saved pages', saved('page'), 'Nothing saved yet. Pages you save to the Library appear here.'),
        ...section('Built-in pages', this.host.examples.map(choice('page'))),
      ]
      : [
        ...section('Saved spreads', saved('spread'), 'No saved spreads.'),
        ...section('Built-in spreads', BUILTIN_SPREADS.map(choice('spread'))),
      ]));
  }

  private choose(c: Choice) {
    this.picker.close();
    const at = this.slot;
    let numberOff: number[] = [];
    this.edit(() => {
      if (c.kind === 'blank') setSlot(this.book, at, null);
      else if (c.kind === 'spread') numberOff = fillSlots(this.book, at, at + 1, c.data as Spread);
      else if (setSlot(this.book, at, c.data as Page)) numberOff = [at];
    });
    this.say([
      c.kind === 'spread' ? `Placed “${c.name}” on ${slotLabel(this.book, at).toLowerCase()} and the page beside it.` : '',
      this.numberOffNote(numberOff),
    ].filter(Boolean).join(' ') || null);
  }

  /** Tell the owner when placing a design on this side moved its page-number corner under something. */
  private numberOffNote(slots: number[]) {
    const pages = slots.filter((n) => n >= 1 && n <= this.book.page_count);
    return pages.length ? `The page number is off on ${listPages(pages)}: the design has something in the corner it would sit in on that side.` : '';
  }

  // ---- applying to more pages ----------------------------------------------------

  private openApply() {
    const last = this.book.page_count;
    const from = Math.max(1, Math.min(last, this.slot + 1));
    this.scope = { mode: 'range', from, to: last };
    this.scopeFrom = from;
    this.renderApply();
    this.apply.showModal();
  }

  /** Build the dialog's controls. Typing in a number field only updates the summary, so the field keeps its focus. */
  private renderApply() {
    const b = this.book;
    const design = getSlot(b, this.slot);
    const thumb = h('div', { class: 'thumb small' });
    thumb.innerHTML = thumbnailSvg([bookPage(b, this.slot)]);
    const summary = h('p', { class: 'apply-summary', role: 'status' });
    const go = h('button', { type: 'button', class: 'primary', 'data-help': 'apply-go' });
    const fromField = this.field('From page', 'from', () => update());
    const toField = this.field('To page', 'to', () => update());
    const facing = getSlot(b, this.slot % 2 ? this.slot - 1 : this.slot + 1);
    const both = h('input', { type: 'checkbox', checked: this.withFacing, 'aria-label': 'Copy the facing page too', 'data-key': 'apply-facing', 'data-help': 'apply-facing' });
    const bothLabel = h('label', { class: 'choice' }, both, 'Copy the facing page too, so the pair repeats as a spread');
    bothLabel.hidden = !facing;
    both.onchange = () => { this.withFacing = both.checked; update(); };
    const update = () => {
      const s = this.scope;
      fromField.hidden = s.mode === 'from';
      const targets = scopeSlots(b, s, this.slot).filter((n) => n !== this.slot);
      const pair = this.withFacing && facing ? this.pairFrom(design, facing) : null;
      const { changed, replaced } = whatChanges(b, targets, pair ?? design);
      summary.textContent = changed.length === 0
        ? 'Nothing would change: those pages already have this design, or the range is empty.'
        : `Will change ${listPages(changed)}${replaced ? `. ${replaced === changed.length ? 'All of them' : replaced} already ${replaced === 1 && changed.length === 1 ? 'has' : 'have'} a design that will be replaced` : ''}.`;
      go.disabled = changed.length === 0;
      go.textContent = `${design ? 'Apply to' : 'Clear'} ${changed.length} page${changed.length === 1 ? '' : 's'}`;
      go.onclick = () => this.applyTo(changed, pair ?? design);
    };
    const radios = SCOPE_MODES.map(({ mode, label }) => {
      const input = h('input', { type: 'radio', name: 'scope', checked: this.scope.mode === mode, 'aria-label': label, 'data-help': 'apply-scope' });
      input.onchange = () => {
        const { from, to } = { from: 'from' in this.scope ? this.scope.from : this.scopeFrom, to: this.scope.to };
        this.scope = mode === 'from' ? { mode, to } : { mode, from, to };
        this.scopeFrom = from;
        update();
      };
      return h('label', { class: 'choice' }, input, label);
    });
    this.applyBody.replaceChildren(
      h('div', { class: 'apply-design' }, thumb, h('p', {}, h('span', { class: 'hint' }, `Copy the design of ${slotLabel(b, this.slot).toLowerCase()}:`), h('strong', {}, designName(design)))),
      h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Which pages' }, ...radios),
      h('div', { class: 'row' }, fromField, toField),
      bothLabel,
      summary,
      h('div', { class: 'row' }, go, h('button', { type: 'button', 'data-help': 'apply-cancel', onclick: () => this.apply.close() }, 'Cancel')),
    );
    update();
  }

  /** A page-number field bound to the scope's `from` or `to`. */
  private field(label: string, key: 'from' | 'to', changed: () => void) {
    const value = key === 'to' ? this.scope.to : this.scopeFrom;
    const input = h('input', { type: 'number', value, min: 1, max: this.book.page_count, 'aria-label': label, 'data-help': `apply-${key}` });
    const read = () => {
      const v = Math.round(Number(input.value));
      if (!input.value || !Number.isFinite(v)) return;
      const n = Math.max(1, Math.min(this.book.page_count, v));
      if (key === 'from') { this.scopeFrom = n; if ('from' in this.scope) this.scope.from = n; } else this.scope.to = n;
      changed();
    };
    input.oninput = read;
    input.onchange = () => { read(); input.value = String(key === 'to' ? this.scope.to : this.scopeFrom); };
    return h('label', { class: 'compact' }, label, input);
  }

  // ---- dates ---------------------------------------------------------------------

  private openDates() {
    const b = this.book, d = this.dating;
    const from = Math.max(1, Math.min(b.page_count, this.slot));
    const { start: known, weekly } = datesStart(b, from);
    if (!dateOf(b, from) && b.dates) d.mode = weekly ? 'week' : 'day'; // continue the rhythm of the dates before it
    d.from = from;
    d.to = endOfRun(b, from);
    d.start = known;
    d.year = parts(addDays(sundayOf(known), 6)).year; // the year whose week numbers count it
    d.week = weekNumber(known);
    this.renderDates();
    this.datesDialog.showModal();
  }

  private renderDates() {
    const b = this.book, d = this.dating;
    const plan = (): DatePlan => (d.mode === 'week' ? { mode: 'week', year: d.year, week: d.week } : { mode: 'day', start: d.start });
    const range = (): [number, number] => [Math.min(d.from, d.to), Math.max(d.from, d.to)];
    const summary = h('p', { class: 'apply-summary', role: 'status' });
    const set = h('button', { type: 'button', class: 'primary', 'data-key': 'dates-set', 'data-help': 'dates-set' }, 'Set dates');
    const clear = h('button', { type: 'button', 'data-key': 'dates-clear', 'data-help': 'dates-clear' }, 'Clear dates');
    const update = () => {
      const [lo, hi] = range();
      const dates = planDates(plan(), hi - lo + 1);
      summary.textContent = datesSummary(plan(), lo, hi);
      set.disabled = !dates;
      clear.disabled = !b.dates || b.dates.slice(lo - 1, hi).every((x) => x === null);
      set.onclick = () => {
        if (!dates) return;
        this.datesDialog.close();
        this.edit(() => setDates(b, lo, dates));
        this.say(`Dated ${hi - lo + 1} page${hi === lo ? '' : 's'}. Undo takes it back.`);
      };
      clear.onclick = () => {
        this.datesDialog.close();
        this.edit(() => setDates(b, lo, Array.from({ length: hi - lo + 1 }, () => null)));
        this.say(`Cleared the dates on ${hi - lo + 1} page${hi === lo ? '' : 's'}. Undo takes it back.`);
      };
    };
    const num = (label: string, key: 'year' | 'week' | 'from' | 'to', help: string, min: number, max: number) => {
      const input = h('input', { type: 'number', value: d[key], min, max, 'aria-label': label, 'data-key': `dates-${key}`, 'data-help': help });
      const read = () => { const v = Math.round(Number(input.value)); if (input.value && Number.isFinite(v)) { d[key] = key === 'from' || key === 'to' ? Math.max(1, Math.min(b.page_count, v)) : v; update(); } };
      input.oninput = read;
      input.onchange = () => { read(); if (key === 'from' || key === 'to') input.value = String(d[key]); };
      return h('label', { class: 'compact' }, label, input);
    };
    const mode = (value: 'week' | 'day', label: string) => {
      const input = h('input', { type: 'radio', name: 'dates-mode', checked: d.mode === value, 'aria-label': label, 'data-key': `dates-mode-${value}`, 'data-help': 'dates-mode' });
      input.onchange = () => { d.mode = value; this.renderDates(); };
      return h('label', { class: 'choice' }, input, label);
    };
    const start = h('input', { type: 'date', value: d.start, 'aria-label': 'Starting date', 'data-key': 'dates-start', 'data-help': 'dates-start' });
    start.oninput = start.onchange = () => { d.start = start.value; update(); };
    this.datesBody.replaceChildren(
      h('p', { class: 'hint' }, 'Dated pages print their {weekday}, {day}, {month} and other tokens with the date; pages without a date leave them blank.'),
      h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Each page is' }, mode('week', 'Each page is one week'), mode('day', 'Each page is one day')),
      d.mode === 'week'
        ? h('div', { class: 'row' }, num('Year', 'year', 'dates-year', 1900, 2200), num('Starting week', 'week', 'dates-week', 1, 54))
        : h('div', { class: 'row' }, h('label', { class: 'compact' }, 'Starting date', start)),
      h('div', { class: 'row' }, num('From page', 'from', 'dates-from', 1, b.page_count), num('To page', 'to', 'dates-to', 1, b.page_count)),
      summary,
      h('div', { class: 'row' }, set, clear, h('button', { type: 'button', 'data-help': 'dates-cancel', onclick: () => this.datesDialog.close() }, 'Cancel')),
    );
    update();
  }

  // ---- save pages as a section -----------------------------------------------------

  private openSaveSection() {
    const s = this.sectioning, last = this.book.page_count;
    s.from = s.to = Math.max(1, Math.min(last, this.slot));
    s.name = '';
    s.move = guessMove(this.book, s.from, s.to);
    this.renderSaveSection();
    this.sectionDialog.showModal();
  }

  private renderSaveSection() {
    const b = this.book, s = this.sectioning;
    const summary = h('p', { class: 'apply-summary', role: 'status' });
    const save = h('button', { type: 'button', class: 'primary', 'data-key': 'section-save', 'data-help': 'section-save' }, 'Save section');
    const range = (): [number, number] => [Math.min(s.from, s.to), Math.max(s.from, s.to)];
    const update = () => {
      const [lo, hi] = range();
      const dated = Array.from({ length: hi - lo + 1 }, (_, i) => dateOf(b, lo + i)).some(Boolean);
      summary.textContent = `${hi === lo ? `Page ${lo}` : `Pages ${lo}–${hi}`}: ${hi - lo + 1} page${hi === lo ? '' : 's'}, starting on a ${lo % 2 === 0 ? 'left' : 'right'} page. ${dated ? 'Their dates are kept relative to the first dated page.' : 'None has a date, so its dates can’t move.'}`;
      save.onclick = () => void this.saveSection();
    };
    const num = (label: string, key: 'from' | 'to', help: string) => {
      const input = h('input', { type: 'number', value: s[key], min: 1, max: b.page_count, inputmode: 'numeric', 'aria-label': label, 'data-key': `section-${key}`, 'data-help': help });
      const read = () => { const v = Math.round(Number(input.value)); if (input.value && Number.isFinite(v)) { s[key] = Math.max(1, Math.min(b.page_count, v)); update(); } };
      input.oninput = read;
      input.onchange = () => { read(); input.value = String(s[key]); };
      return h('label', { class: 'compact' }, label, input);
    };
    const name = h('input', { type: 'text', value: s.name, placeholder: 'Name', maxlength: 80, 'aria-label': 'Name', 'data-key': 'section-name', 'data-help': 'section-name', autocomplete: 'off' });
    name.oninput = () => { s.name = name.value; };
    const move = h('select', { 'aria-label': 'Each time it repeats, its dates', 'data-key': 'section-move', 'data-help': 'section-move' },
      ...MOVES.map((m) => h('option', { value: m, selected: m === s.move }, MOVE_LABEL[m])));
    move.onchange = () => { s.move = move.value as Move; };
    this.sectionBody.replaceChildren(
      h('p', { class: 'hint' }, 'Saves a run of this book’s pages to the Library, with its dates, so the book builder can repeat it. A section keeps the side of the spine it began on.'),
      h('div', { class: 'row' }, num('From page', 'from', 'section-from'), num('To page', 'to', 'section-to')),
      h('label', { class: 'compact wide' }, 'Name', name),
      h('label', { class: 'compact wide' }, 'Each repeat, its dates', move),
      summary,
      h('div', { class: 'row' }, save, h('button', { type: 'button', 'data-help': 'section-cancel', onclick: () => this.sectionDialog.close() }, 'Cancel')));
    update();
  }

  private async saveSection() {
    const s = this.sectioning, [lo, hi] = [Math.min(s.from, s.to), Math.max(s.from, s.to)];
    const name = s.name.trim() || (hi === lo ? `Page ${lo}` : `Pages ${lo}–${hi}`);
    const section = sectionFrom(this.book, lo, hi, name, s.move);
    const check = readSection(section);
    if (!check.ok) { this.say(`Not saved: ${check.issues[0].message}`); this.sectionDialog.close(); return; }
    const existing = await this.host.library.findByName('section', name);
    if (existing && !confirm(`Replace the saved section “${existing.name}”?`)) return;
    try {
      await this.host.library.save('section', name, section);
    } catch (err) {
      this.say(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
      this.sectionDialog.close();
      return;
    }
    this.sectionDialog.close();
    await this.refreshDesigns();
    this.say(`Saved the section “${name}” (${section.pages.length} page${section.pages.length === 1 ? '' : 's'}). Find it in Library, Sections, and add it to the book with Build book.`);
  }

  // ---- the book builder ------------------------------------------------------------

  private async openBuild() {
    const b = this.book;
    await this.refreshDesigns();
    const first = b.dates?.find(Boolean);
    this.recipe = b.recipe ? structuredClone(b.recipe) : { month: (first ?? todayIso()).slice(0, 7), steps: [] };
    this.buildView = 'steps';
    this.renderBuild();
    this.buildDialog.showModal();
  }

  /** The recipe's month as its year and its month number. */
  private get recipeMonth() { const [year, month] = this.recipe.month.split('-').map(Number); return { year, month }; }

  private renderBuild() {
    if (this.buildView !== 'steps') return this.renderChooser();
    const r = this.recipe;
    this.buildTitle.textContent = 'Book builder';
    const summary = h('div', { class: 'apply-summary', role: 'status' });
    const go = h('button', { type: 'button', class: 'primary', 'data-key': 'build-go', 'data-help': 'build-go' }, 'Generate book');
    const lines: HTMLElement[] = [];
    this.buildRefs = { summary, go, lines };

    const { year, month } = this.recipeMonth;
    const setMonth = (y: number, m: number) => { r.month = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`; this.refreshBuild(); };
    const monthSel = h('select', { 'aria-label': 'Month', 'data-key': 'build-month', 'data-help': 'build-month' },
      ...MONTH_NAMES.map((_, i) => h('option', { value: i + 1, selected: i + 1 === month }, monthTitle(i + 1))));
    monthSel.onchange = () => setMonth(this.recipeMonth.year, Number(monthSel.value));
    const yearIn = h('input', { type: 'number', value: year, min: 1900, max: 2200, inputmode: 'numeric', 'aria-label': 'Year', 'data-key': 'build-year', 'data-help': 'build-year' });
    yearIn.oninput = () => { const v = Math.round(Number(yearIn.value)); if (yearIn.value && v >= 1900 && v <= 2200) setMonth(v, this.recipeMonth.month); };

    const fillTaken = r.steps.some((s) => s.repeat.kind === 'fill');
    const stepCard = (step: Step, i: number) => {
      const rep = step.repeat;
      const sec = step.section;
      const kind = h('select', { 'aria-label': `Step ${i + 1}: how often`, 'data-key': 'step-repeat', 'data-help': 'build-step-repeat' },
        h('option', { value: 'times', selected: rep.kind === 'times' }, 'A number of times'),
        h('option', { value: 'weeks', selected: rep.kind === 'weeks' }, 'Each week of a month'),
        h('option', { value: 'fill', selected: rep.kind === 'fill', disabled: fillTaken && rep.kind !== 'fill' }, 'Fill what’s left'));
      kind.onchange = () => {
        delete step.start;
        step.repeat = kind.value === 'weeks' ? { kind: 'weeks', only_in_month: true } : kind.value === 'fill' ? { kind: 'fill' } : { kind: 'times', count: 1 };
        this.renderBuild();
      };
      const controls: HTMLElement[] = [h('label', { class: 'compact wide' }, 'Repeat', kind)];
      if (rep.kind === 'times') controls.push(this.countField(rep.count, `Step ${i + 1}: times`, (n) => { rep.count = n; this.refreshBuild(); }));
      if (rep.kind === 'weeks') {
        const only = h('input', { type: 'checkbox', checked: rep.only_in_month, 'aria-label': `Step ${i + 1}: only days in the month`, 'data-key': 'step-only', 'data-help': 'build-step-only' });
        only.onchange = () => { rep.only_in_month = only.checked; this.refreshBuild(); };
        const m = h('input', { type: 'month', value: rep.month ?? '', 'aria-label': `Step ${i + 1}: month`, 'data-key': 'step-month', 'data-help': 'build-step-start' });
        m.oninput = m.onchange = () => { if (m.value) rep.month = m.value; else delete rep.month; this.refreshBuild(); };
        controls.push(h('label', { class: 'compact wide' }, 'Other month', m), h('label', { class: 'choice' }, only, 'Only days in the month'));
      } else {
        const start = h('input', { type: 'date', value: step.start ?? '', 'aria-label': `Step ${i + 1}: first date`, 'data-key': 'step-start', 'data-help': 'build-step-start' });
        start.oninput = start.onchange = () => { if (start.value) step.start = start.value; else delete step.start; this.refreshBuild(); };
        controls.push(h('label', { class: 'compact wide' }, 'First date', start));
      }
      const tool = (help: string, label: string, text: string, disabled: boolean, run: () => void) =>
        h('button', { type: 'button', class: 'step-tool', 'data-key': help, 'data-help': help, 'aria-label': `${label} step ${i + 1}`, disabled, onclick: run }, text);
      const move = (to: number) => { const [x] = r.steps.splice(i, 1); r.steps.splice(to, 0, x); this.renderBuild(); };
      const line = h('p', { class: 'hint step-adds' });
      lines.push(line);
      return h('li', { class: 'step-card', 'data-step': i },
        h('div', { class: 'step-head' },
          h('strong', {}, `${i + 1}. ${sec.name}`),
          h('span', { class: 'step-tools' },
            tool('build-step-up', 'Move up', '↑', i === 0, () => move(i - 1)),
            tool('build-step-down', 'Move down', '↓', i === r.steps.length - 1, () => move(i + 1)),
            tool('build-step-remove', 'Remove', '✕', false, () => { r.steps.splice(i, 1); this.renderBuild(); }))),
        h('p', { class: 'hint' }, `${sec.pages.length} page${sec.pages.length === 1 ? '' : 's'} · starts on a ${sec.left ? 'left' : 'right'} page · dates ${sec.move === 'none' ? 'stay the same' : MOVE_LABEL[sec.move].toLowerCase()} each repeat`),
        h('div', { class: 'step-controls' }, ...controls),
        line);
    };

    const gapName = r.gap?.name ?? 'Notes';
    this.buildBody.replaceChildren(
      h('p', { class: 'hint' }, 'Builds the whole book from steps. Each step repeats a section from the Library. This replaces every page of the book, and Undo takes it back. To build another month, change the month and generate again.'),
      h('div', { class: 'row' }, h('label', { class: 'compact' }, 'Month', monthSel), h('label', { class: 'compact' }, 'Year', yearIn)),
      h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Start from'),
        ...PRESETS.map((p) => h('button', { type: 'button', 'data-key': `build-preset-${p.id}`, 'data-help': 'build-preset', title: p.description, onclick: () => { r.steps = structuredClone(p.steps); this.renderBuild(); } }, p.name))),
      r.steps.length ? h('ol', { class: 'steps' }, ...r.steps.map(stepCard)) : h('p', { class: 'hint', 'data-key': 'build-empty' }, 'No steps yet. Start from a preset, or add a section as the first step.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', 'data-key': 'build-add', 'data-help': 'build-add', onclick: () => { this.buildView = 'add'; this.renderBuild(); } }, 'Add a step…'),
        h('button', { type: 'button', 'data-key': 'build-gap', 'data-help': 'build-gap', onclick: () => { this.buildView = 'gap'; this.renderBuild(); } }, `Gap page: ${gapName}…`)),
      h('div', { class: 'build-foot' }, summary, h('div', { class: 'row' }, go, h('button', { type: 'button', 'data-help': 'build-cancel', onclick: () => this.buildDialog.close() }, 'Cancel'))));
    this.refreshBuild();
  }

  /** A number of repeats with − and + buttons. */
  private countField(value: number, label: string, set: (n: number) => void) {
    const input = h('input', { type: 'text', inputmode: 'numeric', value: String(value), autocomplete: 'off', 'aria-label': label, 'data-key': 'step-count', 'data-help': 'build-step-count' });
    let n = value;
    const clamp = (v: number) => Math.max(1, Math.min(400, Math.round(v)));
    input.oninput = () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) { n = clamp(v); set(n); } };
    input.onblur = () => { input.value = String(n); };
    const step = (dir: 1 | -1) => h('button', {
      type: 'button', class: 'step', 'data-key': `step-count-${dir > 0 ? 'inc' : 'dec'}`, 'data-help': dir > 0 ? 'step-inc' : 'step-dec', 'aria-label': `${dir > 0 ? 'More' : 'Fewer'}: ${label}`,
      onmousedown: (e: Event) => e.preventDefault(),
      onclick: () => { n = clamp(n + dir); input.value = String(n); set(n); },
    }, dir > 0 ? '+' : '−');
    return h('div', { class: 'field num step-count' }, h('label', {}, 'Times'), h('div', { class: 'stepper' }, step(-1), input, step(1)));
  }

  /** Re-plan after any change and update the summary, each step's line and the Generate button, without redrawing the controls. */
  private refreshBuild() {
    const refs = this.buildRefs;
    if (!refs) return;
    const b = this.book, r = this.recipe;
    const plan: BuildPlan = planSteps(r, b.page_count);
    refs.summary.replaceChildren(...buildSummary(plan, b.page_count).map((line, i) => h('p', { class: i === 0 ? 'usage' : '' }, line)));
    r.steps.forEach((step, i) => { if (refs.lines[i]) refs.lines[i].textContent = `Adds ${stepLine(step, plan.steps[i], r.month)}`; });
    refs.go.disabled = !!plan.problem || r.steps.length === 0;
    refs.go.onclick = () => {
      this.buildDialog.close();
      let off: number[] = [];
      this.edit(() => { off = applyBuild(b, plan); });
      this.slot = Math.min(this.slot, b.page_count);
      this.say([
        `Built the book from ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}: ${plan.used} of ${b.page_count} pages used. Undo takes it back.`,
        plan.gaps.length ? `Added a gap page (${plan.gapName}) on ${listPages(plan.gaps)}.` : '', this.numberOffNote(off),
      ].filter(Boolean).join(' '));
    };
  }

  /** The list a step is added from (sections), or the gap page is chosen from (pages). */
  private renderChooser() {
    const adding = this.buildView === 'add';
    this.buildTitle.textContent = adding ? 'Add a step' : 'Gap page';
    const back = h('button', { type: 'button', 'data-key': 'build-back', 'data-help': 'build-back', onclick: () => { this.buildView = 'steps'; this.renderBuild(); } }, 'Back to the steps');
    const card = (name: string, hint: string, pages: (Page | null)[], pick: () => void) => {
      const thumb = h('div', { class: 'thumb' });
      thumb.innerHTML = thumbnailSvg(pages.slice(0, 2).map((p) => p ?? blankPage('right')));
      return h('button', { type: 'button', class: 'design wide', 'data-key': 'build-pick', 'data-help': 'build-pick', 'data-name': name, onclick: pick },
        thumb, h('span', { class: 'design-title' }, name), h('span', { class: 'hint' }, hint));
    };
    const group = (title: string, cards: HTMLElement[], empty: string) => [h('h3', {}, title), cards.length ? h('div', { class: 'design-list' }, ...cards) : h('p', { class: 'hint' }, empty)];
    if (adding) {
      const add = (section: Section) => () => {
        this.recipe.steps.push({ section: structuredClone(section), repeat: { kind: 'times', count: 1 } });
        this.buildView = 'steps';
        this.renderBuild();
      };
      const sectionCard = (s: Section) => card(s.name, `${s.pages.length} page${s.pages.length === 1 ? '' : 's'} · dates ${s.move === 'none' ? 'stay the same' : MOVE_LABEL[s.move].toLowerCase()}`, s.pages, add(s));
      this.buildBody.replaceChildren(back,
        ...group('Saved sections', this.savedSections.map(sectionCard), 'None yet. In the Book view, More, Save pages as a section.'),
        ...group('Built-in sections', BUILTIN_SECTIONS.map(sectionCard), ''));
    } else {
      const pick = (page: Page | null) => () => { if (page) this.recipe.gap = structuredClone(page); else delete this.recipe.gap; this.buildView = 'steps'; this.renderBuild(); };
      const pageCard = (p: Page) => card(p.name, 'Page', [p], pick(p));
      this.buildBody.replaceChildren(back,
        h('p', { class: 'hint' }, 'The page that fills in so a part starts on the same side of the spine. Notes unless you choose another.'),
        h('div', { class: 'design-list' }, card('Notes', 'The default', [notesPage()], pick(null))),
        ...group('Saved pages', this.saved.filter((i) => i.kind === 'page').map((i) => pageCard(i.data as Page)), 'No saved pages yet.'),
        ...group('Built-in pages', this.host.examples.filter((p) => p.name !== 'Notes').map(pageCard), ''));
    }
  }

  // ---- flip through --------------------------------------------------------------

  private flip() {
    flipThrough(this.book, (slot, align) => slotSvg(this.book, slot, outline, ` preserveAspectRatio="${align} meet"`), (left) => this.go(left));
  }

  /** This page and the one facing it, as a left and right pair. */
  private pairFrom(here: Page | null, facing: Page | null): Facing {
    return slotSide(this.slot) === 'left' ? { left: here, right: facing } : { left: facing, right: here };
  }

  private applyTo(pages: number[], design: Design) {
    this.apply.close();
    let numberOff: number[] = [];
    this.edit(() => { numberOff = applyDesign(this.book, pages, design); });
    this.say([`${design ? 'Applied' : 'Cleared'} ${pages.length} page${pages.length === 1 ? '' : 's'}. Undo takes it back.`, this.numberOffNote(numberOff)].filter(Boolean).join(' '));
  }
}
