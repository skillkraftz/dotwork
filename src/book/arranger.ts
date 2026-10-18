import { PAGE_H_MM, PAGE_W_MM } from '../format/types';
import type { Spread } from '../format/spread';
import type { Page } from '../format/types';
import { blankTokens } from '../format/tokens';
import { pageContent, thumbnailSvg } from '../render';
import { h } from '../panel';
import type { Library, LibraryItem } from '../library/library';
import {
  bookPage, fillSlots, getSlot, MAX_PAGES, MIN_PAGES, pagesLostByResize, resizeBook, roundPageCount, setSlot, slotCount,
  type Book,
} from './book';
import { checkPrintSettings, signatureSizes } from './impose';

export interface ArrangerHost {
  library: Library;
  /** Called after every change to the book, so the draft can be kept. */
  changed(book: Book): void;
  exportFiles(book: Book): void;
}

type Design = { item: LibraryItem; data: Page | Spread };
const MAX_UNDO = 30;
const slotSvg = (book: Book, slot: number) => {
  const inner = slot === 0 || slot === book.page_count + 1;
  const number = inner || !book.page_numbers ? null : String(slot);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W_MM} ${PAGE_H_MM}" aria-hidden="true">` +
    pageContent(bookPage(book, slot), { mode: 'export', pageNumber: number, expand: blankTokens }) + '</svg>';
};

/** The book as a row of spreads: pick a design from the library, then place it in slots or fill a range of pages with it. */
export class Arranger {
  private book: Book;
  private from = 1;
  private to = 1;
  private anchor = 1;
  private chosen: Design | null = null;
  private designs: LibraryItem[] = [];
  private undoStack: string[] = [];

  private bar = h('div', { class: 'book-bar' });
  private spreadsEl = h('div', { class: 'book-spreads' });
  private side = h('aside', { class: 'book-side' });
  private warnEl = h('p', { class: 'warn', hidden: true });
  private selText = h('p', {});
  private fromInput = h('input', { type: 'number', min: 1, 'aria-label': 'From page' });
  private toInput = h('input', { type: 'number', min: 1, 'aria-label': 'To page' });
  private placeBtn = h('button', { type: 'button', class: 'primary', title: 'Put the chosen design in the selected slots (or double-click a slot)' });
  private clearBtn = h('button', { type: 'button' }, 'Clear');

  constructor(root: HTMLElement, private host: ArrangerHost, book: Book) {
    this.book = book;
    this.placeBtn.onclick = () => this.place();
    this.clearBtn.onclick = () => this.clear();
    const range = (input: HTMLInputElement, set: (v: number) => void) => {
      input.oninput = () => {
        const v = Math.round(Number(input.value));
        if (Number.isFinite(v) && v >= 1) { set(Math.min(this.book.page_count, v)); this.renderSelection(); }
      };
      input.onchange = () => this.renderSelection();
    };
    range(this.fromInput, (v) => { this.from = this.anchor = v; if (this.to < v) this.to = v; });
    range(this.toInput, (v) => { this.to = v; if (this.from > v) this.from = this.anchor = v; });
    root.replaceChildren(this.bar, h('div', { class: 'book-body' }, this.spreadsEl, this.side));
    this.render();
  }

  get current(): Book { return this.book; }

  /** Show a different book (opened, imported or new). */
  setBook(book: Book) {
    this.book = book;
    this.undoStack = [];
    this.from = this.to = this.anchor = 1;
    this.render();
  }

  /** Refresh the list of saved designs, e.g. when the view is shown. */
  async refreshDesigns() {
    this.designs = (await this.host.library.list()).filter((i) => i.kind !== 'book');
    if (this.chosen && !this.designs.some((d) => d.id === this.chosen!.item.id)) this.chosen = null;
    this.renderSide();
  }

  // ---- changes ----------------------------------------------------------------

  private edit(change: () => void) {
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
    this.from = Math.min(this.from, slotCount(this.book) - 1);
    this.to = Math.min(this.to, slotCount(this.book) - 1);
    this.host.changed(this.book);
    this.render();
  }

  /** The slots a design goes into. A spread given a single slot takes that slot's whole spread. */
  private targets(): [number, number] {
    let [lo, hi] = [Math.min(this.from, this.to), Math.max(this.from, this.to)];
    if (lo === hi && this.chosen?.data.format === 'dotwork-spread') [lo, hi] = [lo - (lo % 2), lo - (lo % 2) + 1];
    return [lo, hi];
  }

  private place(design: Design | null = this.chosen) {
    if (!design) return;
    const [lo, hi] = this.targets();
    this.edit(() => fillSlots(this.book, lo, hi, design.data));
  }

  private clear() {
    const [lo, hi] = [Math.min(this.from, this.to), Math.max(this.from, this.to)];
    this.edit(() => { for (let s = lo; s <= hi; s++) setSlot(this.book, s, null); });
  }

  private select(slot: number, extend: boolean) {
    if (extend) { this.from = this.anchor; this.to = slot; } else this.from = this.to = this.anchor = slot;
    this.renderSelection();
  }

  // ---- drawing ----------------------------------------------------------------

  private render() {
    this.renderBar();
    this.renderSpreads();
    this.renderSide();
  }

  private num(label: string, value: number, attrs: Record<string, unknown>, set: (v: number) => void) {
    const input = h('input', { type: 'number', value, 'aria-label': label, ...attrs });
    input.onchange = () => { const v = Number(input.value); if (Number.isFinite(v)) set(v); else this.render(); };
    return h('label', { class: 'compact' }, label, input);
  }

  private renderBar() {
    const b = this.book;
    const name = h('input', { type: 'text', value: b.name, 'aria-label': 'Book name', placeholder: 'Book name', maxlength: 80 });
    name.oninput = () => { b.name = name.value; this.host.changed(b); };
    const pages = h('input', { type: 'number', value: b.page_count, min: MIN_PAGES, max: MAX_PAGES, step: 4, 'aria-label': 'Pages' });
    pages.onchange = () => {
      const count = roundPageCount(Number(pages.value));
      const lost = pagesLostByResize(b, count);
      if (lost && !confirm(`Shortening the book to ${count} pages drops ${lost} designed page${lost > 1 ? 's' : ''}. Continue?`)) { pages.value = String(b.page_count); return; }
      this.edit(() => { resizeBook(b, count); this.from = this.to = this.anchor = Math.min(this.from, count); });
    };
    const numbers = h('input', { type: 'checkbox', checked: b.page_numbers, 'aria-label': 'Page numbers' });
    numbers.onchange = () => this.edit(() => { b.page_numbers = numbers.checked; });
    const p = b.print;
    const settings = h('details', { class: 'print-settings' },
      h('summary', {}, 'Print settings'),
      h('div', { class: 'print-fields' },
        this.num('Paper thickness (mm)', p.paper_thickness_mm, { min: 0, max: 1, step: 0.01 }, (v) => this.edit(() => { p.paper_thickness_mm = v; })),
        this.num('Back offset x (mm)', p.back_offset_x_mm, { min: -10, max: 10, step: 0.1 }, (v) => this.edit(() => { p.back_offset_x_mm = v; })),
        this.num('Back offset y (mm)', p.back_offset_y_mm, { min: -10, max: 10, step: 0.1 }, (v) => this.edit(() => { p.back_offset_y_mm = v; })),
        this.num('Signatures', p.signatures, { min: 1, max: 20, step: 1 }, (v) => this.edit(() => { p.signatures = Math.round(v); })),
      h('p', { class: 'hint' }, 'Creep shifts each sheet’s pages toward the fold by the sheets outside it × the paper thickness. The back offset moves everything on print-second.pdf (+x right, +y up) to match your printer.')));
    const undo = h('button', { type: 'button', disabled: this.undoStack.length === 0, onclick: () => this.undo(), title: 'Undo the last change to the book' }, 'Undo');
    this.bar.replaceChildren(
      name,
      h('label', { class: 'compact' }, 'Pages', pages),
      h('label', { class: 'toggle' }, numbers, ' Page numbers'),
      settings,
      undo,
      h('button', { type: 'button', class: 'primary', onclick: () => this.host.exportFiles(this.book) }, 'Export print files…'),
    );
    this.updateWarning();
  }

  private updateWarning() {
    const sizes = signatureSizes(this.book.page_count, this.book.print.signatures);
    const problem = checkPrintSettings(this.book.print, Math.max(...sizes) / 4);
    this.warnEl.textContent = problem ?? '';
    this.warnEl.hidden = !problem;
  }

  private renderSpreads() {
    const b = this.book;
    const count = slotCount(b);
    const rows: HTMLElement[] = [];
    for (let left = 0; left < count; left += 2) {
      const slot = (n: number) => {
        const inner = n === 0 || n === b.page_count + 1;
        const empty = getSlot(b, n) === null;
        const cell = h('div', {
          class: `slot${empty ? ' empty' : ''}${inner ? ' inner' : ''}`, role: 'button', tabindex: 0, draggable: false,
          'data-slot': n, 'aria-label': inner ? (n === 0 ? 'Inside front cover' : 'Inside back cover') : `Page ${n}${empty ? ', empty' : ''}`,
        });
        cell.innerHTML = slotSvg(b, n);
        cell.onclick = (e) => this.select(n, e.shiftKey);
        cell.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(n, e.shiftKey); } };
        cell.ondblclick = () => this.place();
        cell.ondragover = (e) => { if (e.dataTransfer?.types.includes('text/dotwork-design')) e.preventDefault(); };
        cell.ondrop = (e) => {
          const id = e.dataTransfer?.getData('text/dotwork-design');
          const item = this.designs.find((d) => d.id === id);
          if (!item || item.kind === 'book') return;
          e.preventDefault();
          this.chosen = { item, data: item.data };
          this.from = this.to = this.anchor = n;
          this.place();
        };
        return cell;
      };
      const label = left === 0 ? `Cover · 1` : left + 1 === count - 1 ? `${left} · Cover` : `${left} · ${left + 1}`;
      const cap = h('button', { type: 'button', class: 'spread-label', title: 'Select both pages', onclick: () => { this.from = this.anchor = left; this.to = left + 1; this.renderSelection(); } }, label);
      rows.push(h('div', { class: 'spread' }, h('div', { class: 'pair' }, slot(left), slot(left + 1)), cap));
    }
    this.spreadsEl.replaceChildren(...rows);
    this.renderSelection();
  }

  /** Mark the selected slots and bring the selection controls up to date, without rebuilding anything. */
  private renderSelection() {
    const [lo, hi] = [Math.min(this.from, this.to), Math.max(this.from, this.to)];
    for (const el of this.spreadsEl.querySelectorAll<HTMLElement>('.slot')) {
      const n = Number(el.dataset.slot);
      el.classList.toggle('selected', n >= lo && n <= hi);
    }
    const [tlo, thi] = this.targets();
    this.selText.textContent = this.describe(lo, hi);
    this.placeBtn.textContent = tlo === thi ? 'Place here' : `Place in ${thi - tlo + 1} slots`;
    this.placeBtn.disabled = !this.chosen;
    this.clearBtn.disabled = !getSlotRange(this.book, lo, hi);
    const last = this.book.page_count;
    for (const [input, v] of [[this.fromInput, lo], [this.toInput, hi]] as const) {
      if (document.activeElement !== input) input.value = String(Math.max(1, Math.min(last, v)));
    }
  }

  private describe(lo: number, hi: number): string {
    const last = this.book.page_count + 1;
    const one = (n: number) => (n === 0 ? 'inside front cover' : n === last ? 'inside back cover' : `page ${n}`);
    return lo === hi ? one(lo) : `${one(lo)} to ${one(hi)}`;
  }

  private renderSide() {
    const cards = this.designs.map((item) => {
      const thumb = h('div', { class: 'thumb' });
      thumb.innerHTML = thumbnailSvg(item.kind === 'page' ? [item.data] : item.kind === 'spread' ? [item.data.left, item.data.right] : []);
      const chosen = this.chosen?.item.id === item.id;
      const card = h('button', {
        type: 'button', class: `design${chosen ? ' chosen' : ''}`, draggable: true, 'aria-pressed': chosen, title: `${item.name} (${item.kind})`,
      }, thumb, h('span', { class: 'lib-name' }, item.name), h('span', { class: 'hint' }, item.kind));
      const design = (): Design => ({ item, data: item.data as Page | Spread });
      card.onclick = () => { this.chosen = design(); this.renderSide(); };
      card.ondblclick = () => { this.chosen = design(); this.place(); };
      card.ondragstart = (e) => { e.dataTransfer?.setData('text/dotwork-design', item.id); };
      return card;
    });
    this.side.replaceChildren(
      h('h2', {}, 'Selection'),
      this.selText,
      h('div', { class: 'row' }, h('label', { class: 'compact' }, 'Pages from', this.fromInput), h('label', { class: 'compact' }, 'to', this.toInput)),
      h('div', { class: 'row' }, this.placeBtn, this.clearBtn),
      h('p', { class: 'hint' }, 'Click a page to select it, Shift-click to extend, or choose a range above. The covers are the first and last slots. A spread design needs two slots; with one selected it fills that whole spread.'),
      this.warnEl,
      h('h2', {}, 'Designs'),
      cards.length ? h('div', { class: 'design-list' }, ...cards) : h('p', { class: 'hint' }, 'No saved pages or spreads yet. Design some, save them to the Library, then choose them here.'),
    );
    this.renderSelection();
    this.updateWarning();
  }
}

/** Whether any slot from lo to hi holds a design. */
const getSlotRange = (b: Book, lo: number, hi: number) => {
  for (let s = lo; s <= hi; s++) if (getSlot(b, s)) return true;
  return false;
};
