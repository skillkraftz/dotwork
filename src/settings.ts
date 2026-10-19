import { h } from './panel';
import { TOKENS, findUnknownTokens } from './format/tokens';
import { PAGE_SIDES, type Page } from './format/types';
import { validatePage } from './format/validate';
import { MAX_PAGES, MIN_PAGES, pagesLostByResize, resizeBook, roundPageCount, type Book } from './book/book';
import type { Store } from './store';
import type { SpreadSide } from './format/spread';

export type SettingsView = 'page' | 'spread' | 'book';

/** What the settings window needs from the editor around it. */
export interface SettingsHost {
  view(): SettingsView;
  /** The page or pages being edited: one for a page, left then right for a spread. */
  pages(): { store: Store; side: SpreadSide | null }[];
  spreadName(): string;
  setSpreadName(name: string): void;
  book(): Book;
  /** Change the book (with its own undo step) and keep the draft. */
  editBook(change: (book: Book) => void): void;
}

/** The example shown, in gray, in an empty identity field. */
export const IDENTITY_EXAMPLE = '{weekday} {month} {day}';

/** Rules a header change must not break: what is already drawn in row 0, or on the page number's corner. */
const HEADER_RULES = ['header-row', 'header-corner'];

const labelled = (label: string, control: HTMLElement, ...extra: (HTMLElement | null)[]) =>
  h('div', { class: 'field' }, h('label', {}, label), control, ...extra);

/**
 * The page number, and the header row's rules: the printed header takes row 0 while there is an identity. A change that
 * would leave something drawn where it is no longer allowed is refused, with the reason.
 */
function headerProblem(next: Page): string | null {
  const issue = validatePage(next).find((i) => HEADER_RULES.includes(i.rule));
  if (!issue) return null;
  return issue.rule === 'header-corner'
    ? 'Something is drawn on the page number’s corner in row 0. Move it first, or turn the page number off.'
    : 'Something is drawn in row 0. Move or delete it first: while there is an identity, row 0 is the header.';
}

/** The window for a page's, spread's or book's name and settings. It is rebuilt each time it is opened. */
export class SettingsDialog {
  private dialog: HTMLDialogElement;
  private title = h('h2', {});
  private body = h('div', { class: 'settings-body' });

  constructor(private host: SettingsHost) {
    this.dialog = h('dialog', { class: 'library settings', 'aria-label': 'Settings' },
      h('header', {}, this.title, h('button', { type: 'button', 'data-help': 'settings-close', onclick: () => this.dialog.close() }, 'Done')),
      this.body) as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
  }

  get isOpen() { return this.dialog.open; }

  show() {
    const view = this.host.view();
    this.title.textContent = view === 'book' ? 'Book settings' : view === 'spread' ? 'Spread settings' : 'Page settings';
    this.body.replaceChildren(...(view === 'book' ? this.bookSection() : view === 'spread' ? this.spreadSections() : this.pageSection(this.host.pages()[0], false)));
    if (!this.dialog.open) this.dialog.showModal();
  }

  // ---- a page -------------------------------------------------------------

  /** Name, page number, identity and side of one page. `heading` is shown over each page of a spread. */
  private pageSection({ store, side }: { store: Store; side: SpreadSide | null }, heading: boolean): HTMLElement[] {
    const edit = (key: string, change: (p: Page) => void): string | null => {
      const next = structuredClone(store.page);
      change(next);
      const problem = headerProblem(next);
      if (problem) return problem;
      store.commit(next, key);
      return null;
    };
    const message = () => h('span', { class: 'fmsg', role: 'status', hidden: true });
    const say = (el: HTMLElement, text: string | null) => { el.textContent = text ?? ''; el.hidden = !text; };
    const tag = side ?? 'page';

    const name = h('input', {
      type: 'text', value: store.page.name, maxlength: 80, autocomplete: 'off', 'data-key': `settings-name-${tag}`, 'data-help': 'page-name', 'aria-label': 'Name',
      oninput: () => { edit(`page-name`, (p) => { p.name = name.value; }); },
      onfocus: () => name.select(),
    });

    const numberOn = h('input', { type: 'checkbox', checked: store.page.page_number !== false, 'data-key': `settings-number-${tag}`, 'data-help': 'page-number' });
    const numberMsg = message();
    numberOn.onchange = () => {
      const problem = edit('page-number', (p) => { if (numberOn.checked) delete p.page_number; else p.page_number = false; });
      say(numberMsg, problem);
      if (problem) numberOn.checked = !numberOn.checked;
    };

    const identity = h('input', {
      type: 'text', value: store.page.identity ?? '', placeholder: IDENTITY_EXAMPLE, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'data-key': `settings-identity-${tag}`, 'data-help': 'page-identity', 'aria-label': 'Identity',
    });
    const identityMsg = message();
    const tokens = h('div');
    const showTokens = () => {
      const bad = findUnknownTokens(identity.value);
      tokens.replaceChildren(...(bad.length ? [h('p', { class: 'warn' }, `Unknown token ${bad.map((b) => `{${b}}`).join(' ')} – the page can’t be exported until it is fixed.`)] : []));
    };
    identity.oninput = () => {
      const v = identity.value;
      const problem = edit('page-identity', (p) => { if (v) p.identity = v; else delete p.identity; });
      say(identityMsg, problem);
      showTokens();
    };

    const sideField: HTMLElement = side
      ? h('p', { class: 'hint' }, `This is the ${side} page of the spread, so its spine and page number corner are fixed.`)
      : (() => {
        const select = h('select', {
          'data-key': 'settings-side', 'data-help': 'page-side', 'aria-label': 'Side',
          onchange: () => { say(sideMsg, edit('page-side', (p) => { if (select.value === 'either') delete p.side; else p.side = select.value as Page['side']; })); if (sideMsg.hidden === false) select.value = store.page.side ?? 'either'; },
        }, ...PAGE_SIDES.map((o) => h('option', { value: o, selected: o === (store.page.side ?? 'either') }, o)));
        const sideMsg = message();
        return labelled('Side', select, sideMsg);
      })();

    return [
      ...(heading ? [h('h3', {}, side === 'left' ? 'Left page' : 'Right page')] : []),
      labelled('Name', name),
      h('label', { class: 'inline' }, numberOn, 'Print the page number'),
      numberMsg,
      labelled('Identity', identity, identityMsg, tokens),
      h('p', { class: 'hint' }, `Optional text by the spine. Tokens: ${TOKENS.map((t) => `{${t}}`).join(' ')}; add +1 or -1 for another day, as in {day+1}. With no identity, row 0 (the header row) is free to draw on, except the page number’s corner.`),
      sideField,
    ].filter(Boolean) as HTMLElement[];
  }

  // ---- a spread -----------------------------------------------------------

  private spreadSections(): HTMLElement[] {
    const name = h('input', {
      type: 'text', value: this.host.spreadName(), placeholder: 'Untitled spread', maxlength: 80, autocomplete: 'off', 'data-key': 'settings-spread-name', 'data-help': 'spread-name', 'aria-label': 'Spread name',
      oninput: () => this.host.setSpreadName(name.value),
      onfocus: () => name.select(),
    });
    return [labelled('Spread name', name), ...this.host.pages().flatMap((p) => this.pageSection(p, true))];
  }

  // ---- a book -------------------------------------------------------------

  private bookSection(): HTMLElement[] {
    const book = this.host.book();
    const name = h('input', {
      type: 'text', value: book.name, placeholder: 'Untitled book', maxlength: 80, autocomplete: 'off', 'data-key': 'settings-book-name', 'data-help': 'book-name', 'aria-label': 'Book name',
      oninput: () => this.host.editBook((b) => { b.name = name.value; }),
      onfocus: () => name.select(),
    });
    const pages = h('input', { type: 'number', value: book.page_count, min: MIN_PAGES, max: MAX_PAGES, step: 4, inputmode: 'numeric', 'data-key': 'settings-book-pages', 'data-help': 'book-pages', 'aria-label': 'Pages' });
    pages.onchange = () => {
      const b = this.host.book();
      const count = roundPageCount(Number(pages.value));
      const lost = pagesLostByResize(b, count);
      if (lost && !confirm(`Shortening the book to ${count} pages drops ${lost} designed page${lost > 1 ? 's' : ''}. Continue?`)) { pages.value = String(b.page_count); return; }
      this.host.editBook((x) => resizeBook(x, count));
      pages.value = String(count);
    };
    const numbers = h('input', { type: 'checkbox', checked: book.page_numbers, 'data-key': 'settings-book-numbers', 'data-help': 'book-numbers' });
    numbers.onchange = () => this.host.editBook((b) => { b.page_numbers = numbers.checked; });
    return [
      labelled('Book name', name),
      labelled('Pages (a multiple of 4)', pages),
      h('label', { class: 'inline' }, numbers, 'Print page numbers'),
      h('h3', {}, 'Printing'),
      ...printFields(() => this.host.book(), (change) => this.host.editBook(change)),
    ];
  }
}

/** Paper thickness, back offset and signatures: the settings that shape the print-ready files. Used in the settings and the export window. */
export function printFields(book: () => Book, edit: (change: (b: Book) => void) => void): HTMLElement[] {
  const num = (help: string, label: string, value: number, attrs: Record<string, unknown>, set: (b: Book, v: number) => void) => {
    const input = h('input', { type: 'number', value, 'aria-label': label, 'data-key': help, 'data-help': help, ...attrs });
    input.onchange = () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v)) edit((b) => set(b, v)); else input.value = String(value);
    };
    return h('label', { class: 'compact' }, label, input);
  };
  const p = book().print;
  return [
    num('book-thickness', 'Paper thickness (mm)', p.paper_thickness_mm, { min: 0, max: 1, step: 0.01 }, (b, v) => { b.print.paper_thickness_mm = v; }),
    num('book-offset-x', 'Back offset x (mm)', p.back_offset_x_mm, { min: -10, max: 10, step: 0.1 }, (b, v) => { b.print.back_offset_x_mm = v; }),
    num('book-offset-y', 'Back offset y (mm)', p.back_offset_y_mm, { min: -10, max: 10, step: 0.1 }, (b, v) => { b.print.back_offset_y_mm = v; }),
    num('book-signatures', 'Signatures', p.signatures, { min: 1, max: 20, step: 1 }, (b, v) => { b.print.signatures = Math.round(v); }),
    h('p', { class: 'hint' }, 'Creep shifts each sheet’s pages toward the fold by the sheets outside it × the paper thickness. The back offset moves everything on print-second.pdf (+x right, +y up) to match your printer.'),
  ];
}
