import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Page } from '../format/types';
import { withSide, type Spread } from '../format/spread';
import { addDays, formatDate, parts, sundayOf, weekNumber } from '../format/dates';
import { pageContent, thumbnailSvg } from '../render';
import { h } from '../panel';
import type { Library, LibraryItem } from '../library/library';
import { blankPage, bookExpand, bookPage, dateOf, fillSlots, getSlot, setDates, setSlot, slotCount, slotSide, type Book } from './book';
import { checkPrintSettings, signatureSizes } from './impose';
import { contentsRows, datesSummary, designName, endOfRun, listPages, opening, planDates, scopeSlots, slotLabel, whatChanges, type DatePlan, type Scope } from './plan';

export interface ArrangerHost {
  library: Library;
  /** The built-in example pages, offered next to the saved designs. */
  examples: Page[];
  /** Called after every change to the book, so the draft can be kept. */
  changed(book: Book): void;
  exportFiles(book: Book): void;
}

const MAX_UNDO = 30;
const SPREADS_KEY = 'dotwork.book.spreads';
const SWIPE_PX = 50;
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
  /** What the Dates window is set to; its first and last page are kept apart from the plan. */
  private dating = { mode: 'week' as 'week' | 'day', year: 2026, week: 1, start: '2026-01-01', from: 1, to: 1 };

  constructor(root: HTMLElement, private host: ArrangerHost, book: Book) {
    this.book = book;
    this.picker = h('dialog', { class: 'library picker', 'aria-label': 'Choose a design' },
      h('header', {}, this.pickerTitle, h('button', { type: 'button', 'data-help': 'picker-close', onclick: () => this.picker.close() }, 'Close')),
      this.pickerBody) as HTMLDialogElement;
    this.apply = h('dialog', { class: 'library apply', 'aria-label': 'Apply to more pages' },
      h('header', {}, h('h2', {}, 'Apply to more pages'), h('button', { type: 'button', 'data-help': 'apply-close', onclick: () => this.apply.close() }, 'Close')),
      this.applyBody) as HTMLDialogElement;
    this.datesDialog = h('dialog', { class: 'library apply dates', 'aria-label': 'Dates' },
      h('header', {}, h('h2', {}, 'Dates'), h('button', { type: 'button', 'data-help': 'dates-close', onclick: () => this.datesDialog.close() }, 'Close')),
      this.datesBody) as HTMLDialogElement;
    for (const d of [this.picker, this.apply, this.datesDialog]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(this.picker, this.apply, this.datesDialog);

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
      h('div', { class: 'book-main' }, this.nav, this.stage, this.msgEl, this.warnEl, this.actions), this.contents));
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
    this.render();
  }

  /** Refresh the list of saved designs, e.g. when the view is shown. */
  async refreshDesigns() {
    this.saved = (await this.host.library.list()).filter((i) => i.kind !== 'book');
    if (this.picker.open) this.renderPicker();
  }

  // ---- changes ----------------------------------------------------------------

  /** Make a change to the book as one undo step, keep the draft and redraw. */
  edit(change: () => void) {
    this.undoStack.push(JSON.stringify(this.book));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    change();
    this.host.changed(this.book);
    this.render();
  }

  private undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    this.book = JSON.parse(last) as Book;
    this.slot = Math.min(this.slot, slotCount(this.book) - 1);
    this.say(null);
    this.host.changed(this.book);
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
    this.bar.replaceChildren(
      undo,
      h('button', { type: 'button', 'data-help': 'book-dates', onclick: () => this.openDates() }, 'Dates…'),
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
      }, thumb, h('span', { class: 'crow-text' }, h('strong', {}, label), h('span', { class: 'crow-name' }, name)),
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

  private choices(): Choice[] {
    const left = slotSide(this.slot) === 'left';
    const out: Choice[] = [{ name: 'Blank', kind: 'blank', data: null }];
    const saved = this.saved.filter((i) => i.kind === 'page').map((i): Choice => ({ name: i.name, kind: 'page', data: i.data as Page }));
    const spreads = left ? this.saved.filter((i) => i.kind === 'spread').map((i): Choice => ({ name: i.name, kind: 'spread', data: i.data as Spread })) : [];
    return [...out, ...saved, ...spreads, ...this.host.examples.map((p): Choice => ({ name: p.name, kind: 'page', data: p }))];
  }

  private openPicker() {
    this.renderPicker();
    this.picker.showModal();
  }

  private renderPicker() {
    this.pickerTitle.textContent = `Design for ${slotLabel(this.book, this.slot).toLowerCase()}`;
    const side = slotSide(this.slot);
    const card = (c: Choice) => {
      const thumb = h('div', { class: 'thumb' });
      const pages = c.kind === 'spread' ? [(c.data as Spread).left, (c.data as Spread).right] : [withSide(c.data ? (c.data as Page) : blankPage(side), side)];
      thumb.innerHTML = thumbnailSvg(pages);
      return h('button', {
        type: 'button', class: `design${c.kind === 'spread' ? ' wide' : ''}`, 'data-kind': c.kind, 'data-help': 'picker-design',
        onclick: () => this.choose(c),
      }, thumb, h('span', { class: 'design-title' }, c.name), h('span', { class: 'hint' }, c.kind === 'blank' ? 'Empty page' : c.kind === 'spread' ? 'Spread: fills this page and the next' : 'Page'));
    };
    const all = this.choices();
    const section = (title: string, items: Choice[], empty?: string) => [
      h('h3', {}, title),
      items.length ? h('div', { class: 'design-list' }, ...items.map(card)) : h('p', { class: 'hint' }, empty ?? ''),
    ];
    const savedPages = all.filter((c) => c.kind === 'page' && !this.host.examples.includes(c.data as Page));
    this.pickerBody.replaceChildren(
      h('div', { class: 'design-list' }, card(all[0])),
      ...section('Saved pages', savedPages, 'Nothing saved yet. Pages you save to the Library appear here.'),
      ...(side === 'left' ? section('Saved spreads', all.filter((c) => c.kind === 'spread'), 'No saved spreads.') : []),
      ...section('Built-in examples', all.filter((c) => c.kind === 'page' && this.host.examples.includes(c.data as Page))),
    );
  }

  private choose(c: Choice) {
    this.picker.close();
    const at = this.slot;
    this.edit(() => {
      if (c.kind === 'blank') setSlot(this.book, at, null);
      else if (c.kind === 'spread') fillSlots(this.book, at, at + 1, c.data as Spread);
      else setSlot(this.book, at, c.data as Page);
    });
    this.say(c.kind === 'spread' ? `Placed “${c.name}” on ${slotLabel(this.book, at).toLowerCase()} and the page beside it.` : null);
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
    const update = () => {
      const s = this.scope;
      fromField.hidden = s.mode === 'from';
      const targets = scopeSlots(b, s, this.slot).filter((n) => n !== this.slot);
      const { changed, replaced } = whatChanges(b, targets, design);
      summary.textContent = changed.length === 0
        ? 'Nothing would change: those pages already have this design, or the range is empty.'
        : `Will change ${listPages(changed)}${replaced ? `. ${replaced === changed.length ? 'All of them' : replaced} already ${replaced === 1 && changed.length === 1 ? 'has' : 'have'} a design that will be replaced` : ''}.`;
      go.disabled = changed.length === 0;
      go.textContent = `${design ? 'Apply to' : 'Clear'} ${changed.length} page${changed.length === 1 ? '' : 's'}`;
      go.onclick = () => this.applyTo(changed, design);
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
    const known = dateOf(b, from) ?? new Date().toISOString().slice(0, 10);
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

  private applyTo(pages: number[], design: Page | null) {
    this.apply.close();
    this.edit(() => { for (const n of pages) setSlot(this.book, n, design); });
    this.say(`${design ? 'Applied' : 'Cleared'} ${pages.length} page${pages.length === 1 ? '' : 's'}. Undo takes it back.`);
  }
}
