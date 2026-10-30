import { h } from './panel';
import { TOKEN_LIST, tokenProblem } from './format/tokens';
import { PAGE_SIDES, type Page } from './format/types';
import { validatePage } from './format/validate';
import { calendarFor, calendarMonths } from './format/calendar';
import { parts } from './format/dates';
import { LAYOUT_LIMITS, MAX_PAGES, MIN_PAGES, PRINT_LIMITS, resizeBook, roundPageCount, type Book } from './book/book';
import { DEFAULT_PRINT, EDGE_NAMES, LAYOUT_NAMES, METHOD_NAMES, METHOD_SHORT, PAPER_NAMES, PAPER_SETS, PRINT_METHODS, SHEET_LAYOUTS, methodOf, profileOf, type LayoutProfile, type PaperSet, type PrintMethod, type PrintSettings, type SheetLayout } from './book/impose';
import type { Store } from './store';
import type { SpreadSide } from './format/spread';

export type SettingsView = 'page' | 'spread' | 'book';

/** What the settings window needs from the editor around it. */
export interface SettingsHost {
  view(): SettingsView;
  /** The page or pages being edited: one for a page, left then right for a spread. */
  pages(): { store: Store; side: SpreadSide | null }[];
  /** The open page's name: the Library document's, not part of its data. */
  pageName(): string;
  setPageName(name: string): void;
  spreadName(): string;
  setSpreadName(name: string): void;
  /** A built-in is open: it can't be renamed (editing it makes a copy first). */
  nameLocked(): boolean;
  book(): Book;
  /** The open book's name: the Library document's. */
  setBookName(name: string): void;
  /** Whether the page being edited is a cover of a book (Edit here): it is always a cover page, whatever its flag says. */
  coverLocked(): boolean;
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

    // The single page's name is the document's name; the two pages of a spread keep a name of their own inside the spread.
    const name = h('input', {
      type: 'text', value: side ? store.page.name : this.host.pageName(), maxlength: 80, autocomplete: 'off', 'data-key': `settings-name-${tag}`, 'data-help': 'page-name', 'aria-label': 'Name',
      readOnly: !side && this.host.nameLocked(),
      oninput: () => { if (side) edit(`page-name`, (p) => { p.name = name.value; }); else this.host.setPageName(name.value); },
      onchange: () => { if (!side) name.value = this.host.pageName(); }, // a name already used got " 2" added
      onfocus: () => name.select(),
    });

    const numberOn = h('input', { type: 'checkbox', checked: store.page.page_number !== false, 'data-key': `settings-number-${tag}`, 'data-help': 'page-number' });
    const numberMsg = message();
    numberOn.onchange = () => {
      const problem = edit('page-number', (p) => { if (numberOn.checked) delete p.page_number; else p.page_number = false; });
      say(numberMsg, problem);
      if (problem) numberOn.checked = !numberOn.checked;
    };

    // A cover page has no page number and no identity, and row 0 is free to draw on. Turning it on clears the identity; turning it off brings the page number back.
    const locked = this.host.coverLocked();
    const coverOn = h('input', { type: 'checkbox', checked: store.page.cover === true || locked, disabled: locked, 'data-key': `settings-cover-${tag}`, 'data-help': 'page-cover' });
    const coverMsg = message();
    coverOn.onchange = () => {
      const problem = edit('page-cover', (p) => {
        if (coverOn.checked) { delete p.identity; p.page_number = false; p.cover = true; } else { delete p.cover; delete p.page_number; }
      });
      say(coverMsg, problem);
      if (problem) coverOn.checked = !coverOn.checked;
      else this.show();
    };
    numberOn.disabled = store.page.cover === true || locked;

    const mirror = h('input', { type: 'checkbox', checked: store.page.mirror_left === true, 'data-key': `settings-mirror-${tag}`, 'data-help': 'page-mirror' });
    mirror.onchange = () => { edit('page-mirror', (p) => { if (mirror.checked) p.mirror_left = true; else delete p.mirror_left; }); };

    const identity = h('input', {
      type: 'text', value: store.page.identity ?? '', placeholder: IDENTITY_EXAMPLE, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'data-key': `settings-identity-${tag}`, 'data-help': 'page-identity', 'aria-label': 'Identity',
    });
    const identityMsg = message();
    const tokens = h('div');
    const showTokens = () => {
      const bad = tokenProblem(identity.value);
      tokens.replaceChildren(...(bad ? [h('p', { class: 'warn' }, `${bad} – the page can’t be exported until it is fixed.`)] : []));
    };
    identity.disabled = store.page.cover === true || locked;
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
      h('label', { class: 'inline' }, coverOn, 'Cover page'),
      h('p', { class: 'hint' }, locked ? 'This is a cover of the book, so it is always a cover page.' : 'A cover page has no page number and no identity, and row 0 is free to draw on. Turning it on clears the identity.'),
      coverMsg,
      h('label', { class: 'inline' }, numberOn, 'Print the page number'),
      numberMsg,
      h('label', { class: 'inline' }, mirror, 'Mirror on left pages'),
      h('p', { class: 'hint' }, 'The page is drawn flipped left to right wherever it sits on a left page (the left half of a spread, a left page of a book), in the editor and in print, so a strip along its outer edge stays on the outer edge. Text still reads normally.'),
      labelled('Identity', identity, identityMsg, tokens),
      h('p', { class: 'hint' }, `Optional text by the spine. Tokens: ${TOKEN_LIST}; add +1 or -1 to move by the token’s own unit (days, weeks, months or years), as in {month+1}, or @start / @end for the first or last day the page covers, as in {day@end}. With no identity, row 0 (the header row) is free to draw on, except the page number’s corner.`),
      sideField,
    ].filter(Boolean) as HTMLElement[];
  }

  // ---- a spread -----------------------------------------------------------

  private spreadSections(): HTMLElement[] {
    const name = h('input', {
      type: 'text', value: this.host.spreadName(), placeholder: 'Untitled', maxlength: 80, autocomplete: 'off', 'data-key': 'settings-spread-name', 'data-help': 'spread-name', 'aria-label': 'Spread name',
      readOnly: this.host.nameLocked(),
      oninput: () => this.host.setSpreadName(name.value),
      onchange: () => { name.value = this.host.spreadName(); },
      onfocus: () => name.select(),
    });
    return [labelled('Spread name', name), ...this.host.pages().flatMap((p) => this.pageSection(p, true))];
  }

  // ---- a book -------------------------------------------------------------

  private bookSection(): HTMLElement[] {
    const book = this.host.book();
    const name = h('input', {
      type: 'text', value: book.name, placeholder: 'Untitled', maxlength: 80, autocomplete: 'off', 'data-key': 'settings-book-name', 'data-help': 'book-name', 'aria-label': 'Book name',
      readOnly: this.host.nameLocked(),
      oninput: () => this.host.setBookName(name.value),
      onchange: () => { name.value = this.host.book().name; }, // a name already used got " 2" added
      onfocus: () => name.select(),
    });
    const pages = h('input', { type: 'number', value: book.page_count, min: MIN_PAGES, max: MAX_PAGES, step: 4, inputmode: 'numeric', 'data-key': 'settings-book-pages', 'data-help': 'book-pages', 'aria-label': 'Pages' });
    pages.onchange = () => {
      const count = roundPageCount(Number(pages.value));
      this.host.editBook((x) => resizeBook(x, count));
      pages.value = String(count);
    };
    const numbers = h('input', { type: 'checkbox', checked: book.page_numbers, 'data-key': 'settings-book-numbers', 'data-help': 'book-numbers' });
    numbers.onchange = () => this.host.editBook((b) => { b.page_numbers = numbers.checked; });
    return [
      labelled('Book name', name),
      labelled('Pages (a multiple of 4)', pages),
      h('label', { class: 'inline' }, numbers, 'Print page numbers'),
      signaturesField(() => this.host.book(), (change) => this.host.editBook(change)),
      ...calendarFields(() => this.host.book(), (change) => this.host.editBook(change)),
      h('p', { class: 'hint' }, 'The creep, offsets, scale and tones belong to your printer, not the book: they are in Import and export, on the PDF tab.'),
    ];
  }
}

type SharedKey = Exclude<keyof PrintSettings, 'sheet_layout' | 'print_method' | 'layouts'>;
export type PrintFieldKey = SharedKey | keyof LayoutProfile;

/** How each printer setting is labelled and stepped in its field. `help` is the key of its entry in help.ts. */
const PRINT_FIELDS: Record<PrintFieldKey, { label: string; help: string; step: number }> = {
  creep_per_sheet_mm: { label: 'Creep per sheet (mm)', help: 'book-creep', step: 0.01 },
  fore_edge_shift_mm: { label: 'Fore-edge shift (mm)', help: 'book-fore-edge-shift', step: 0.1 },
  cover_fore_edge_shift_mm: { label: 'Cover shift (mm)', help: 'book-cover-shift', step: 0.1 },
  target_fore_edge_margin_mm: { label: 'Target fore-edge margin (mm)', help: 'book-target-margin', step: 0.1 },
  trim_margin_mm: { label: 'Trimmed top/bottom margin (mm)', help: 'book-trim-margin', step: 0.05 },
  inset_front_left_mm: { label: 'Front, left edge: last number printed (mm)', help: 'book-inset-front-left', step: 0.5 },
  inset_front_right_mm: { label: 'Front, right edge: last number printed (mm)', help: 'book-inset-front-right', step: 0.5 },
  inset_front_top_mm: { label: 'Front, top edge: last number printed (mm)', help: 'book-inset-front-top', step: 0.5 },
  inset_front_bottom_mm: { label: 'Front, bottom edge: last number printed (mm)', help: 'book-inset-front-bottom', step: 0.5 },
  inset_back_left_mm: { label: 'Back, left edge: last number printed (mm)', help: 'book-inset-back-left', step: 0.5 },
  inset_back_right_mm: { label: 'Back, right edge: last number printed (mm)', help: 'book-inset-back-right', step: 0.5 },
  inset_back_top_mm: { label: 'Back, top edge: last number printed (mm)', help: 'book-inset-back-top', step: 0.5 },
  inset_back_bottom_mm: { label: 'Back, bottom edge: last number printed (mm)', help: 'book-inset-back-bottom', step: 0.5 },
  front_offset_x_mm: { label: 'Front offset x (mm)', help: 'book-front-offset-x', step: 0.1 },
  front_offset_y_mm: { label: 'Front offset y (mm)', help: 'book-front-offset-y', step: 0.1 },
  back_offset_x_mm: { label: 'Back offset x (mm)', help: 'book-offset-x', step: 0.1 },
  back_offset_y_mm: { label: 'Back offset y (mm)', help: 'book-offset-y', step: 0.1 },
  back_rotation_deg: { label: 'Back rotation (°)', help: 'book-back-rotation', step: 0.01 },
  scale_x_pct: { label: 'Scale along the 8.5 in edge (%)', help: 'book-scale-x', step: 0.1 },
  scale_y_pct: { label: 'Scale along the 5.5 in edge (%)', help: 'book-scale-y', step: 0.1 },
  line_weight_x_pct: { label: 'Line weight along the 8.5 in edge (%)', help: 'book-line-weight', step: 1 },
  shade_light_pct: { label: 'Light shade (% black)', help: 'book-tone-light', step: 1 },
  shade_medium_pct: { label: 'Medium shade (% black)', help: 'book-tone-medium', step: 1 },
  shade_dark_pct: { label: 'Dark shade (% black)', help: 'book-tone-dark', step: 1 },
  gray_text_pct: { label: 'Gray text (% black)', help: 'book-tone-gray', step: 1 },
};

const isLayoutKey = (key: PrintFieldKey): key is keyof LayoutProfile => key in LAYOUT_LIMITS;
/**
 * Which paper the offset, scale and rotation fields are showing and writing: the inside paper's or the cover paper's. Not part of the printer profile;
 * it is shared by the print settings and the Calibrate window, so both show the same set.
 */
let shownPaper: PaperSet = 'inside';
export const paperShown = (): PaperSet => shownPaper;
export const showPaper = (paper: PaperSet) => { shownPaper = paper; };

/** A setting's value in the printer profile: a layout's settings are those of the layout and print method selected there, for the paper shown. */
export const printValue = (print: PrintSettings, key: PrintFieldKey, paper: PaperSet = shownPaper): number => (isLayoutKey(key) ? profileOf(print, paper)[key] : print[key]);

type EditPrinter = (change: (p: PrintSettings) => void) => void;

/** One printer setting as a number field. A number outside its limits is brought back in rather than kept. */
export function printField(printer: () => PrintSettings, edit: EditPrinter, key: PrintFieldKey): HTMLElement {
  const { help, step } = PRINT_FIELDS[key], { min, max } = isLayoutKey(key) ? LAYOUT_LIMITS[key] : PRINT_LIMITS[key];
  // The scales are named by the paper's edges of the selected layout.
  const edges = EDGE_NAMES[printer().sheet_layout];
  const label = key === 'scale_x_pct' ? `Scale along the ${edges.x} edge (%)` : key === 'scale_y_pct' ? `Scale along the ${edges.y} edge (%)` : PRINT_FIELDS[key].label;
  // The set this field was drawn for: a change that arrives after the layout, method or paper was switched still goes to it.
  const layout = printer().sheet_layout, method = methodOf(printer()), paper = shownPaper;
  const value = printValue(printer(), key, paper);
  const input = h('input', { type: 'number', value, min, max, step, 'aria-label': label, 'data-key': help, 'data-help': help });
  input.onchange = () => {
    const typed = Number(input.value);
    if (input.value === '' || !Number.isFinite(typed)) { input.value = String(printValue(printer(), key, paper)); return; }
    const v = Math.min(max, Math.max(min, typed));
    input.value = String(v);
    edit((p) => { if (isLayoutKey(key)) p.layouts[layout][method][paper][key] = v; else p[key] = v; });
  };
  return h('label', { class: 'compact' }, label, input);
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The book's calendar: the month it starts in, how many months it lasts and the day weeks start on. A book with none is undated
 * (its date tokens print blank); the fields start on next month as a suggestion and nothing is set until Set calendar is tapped.
 * Once a calendar is set, changing a field changes it at once; Remove calendar makes the book undated again.
 */
export function calendarFields(book: () => Book, edit: (change: (b: Book) => void) => void): HTMLElement[] {
  const cal = book().calendar;
  const next = new Date(), nextMonth = new Date(Date.UTC(next.getFullYear(), next.getMonth() + 1, 1));
  const start = cal ? parts(cal.start) : { year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1 };
  const month = h('select', { 'aria-label': 'First month', 'data-key': 'calendar-month', 'data-help': 'book-calendar-month' },
    ...MONTH_LABELS.map((m, i) => h('option', { value: String(i + 1), selected: i + 1 === start.month }, m)));
  const year = h('input', { type: 'number', value: start.year, min: 1900, max: 2200, step: 1, inputmode: 'numeric', 'aria-label': 'Year', 'data-key': 'calendar-year', 'data-help': 'book-calendar-year' });
  const months = h('input', { type: 'number', value: cal ? calendarMonths(cal) : 1, min: 1, max: 24, step: 1, inputmode: 'numeric', 'aria-label': 'Months', 'data-key': 'calendar-months', 'data-help': 'book-calendar-months' });
  const weekStarts = h('select', { 'aria-label': 'Week starts on', 'data-key': 'calendar-week-start', 'data-help': 'book-calendar-week-start' },
    ...WEEKDAY_LABELS.map((d, i) => h('option', { value: String(i), selected: i === (cal?.week_starts ?? 0) }, d)));
  const clamp = (input: HTMLInputElement, lo: number, hi: number, fallback: number) => {
    const v = Math.round(Number(input.value));
    const ok = input.value !== '' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
    input.value = String(ok);
    return ok;
  };
  const make = () => calendarFor(clamp(year, 1900, 2200, start.year), Number(month.value), clamp(months, 1, 24, 1), Number(weekStarts.value));
  const state = h('div', { class: 'cal-actions' });
  const draw = () => {
    const current = book().calendar;
    state.replaceChildren(current
      ? h('button', { type: 'button', 'data-key': 'calendar-remove', 'data-help': 'book-calendar-remove', onclick: () => { edit((b) => { delete b.calendar; }); draw(); } }, 'Remove calendar')
      : h('button', { type: 'button', class: 'primary', 'data-key': 'calendar-set', 'data-help': 'book-calendar-set', onclick: () => { const c = make(); edit((b) => { b.calendar = c; }); draw(); } }, 'Set calendar'));
    summary.textContent = current ? `Dated: ${current.start} to ${current.end}, weeks start on ${WEEKDAY_LABELS[current.week_starts]}.` : 'Undated: date tokens print blank. Pick a month and tap Set calendar to date the pages.';
  };
  const summary = h('p', { class: 'hint', 'data-key': 'calendar-summary' });
  for (const field of [month, year, months, weekStarts]) {
    field.addEventListener('change', () => {
      if (!book().calendar) { clamp(year, 1900, 2200, start.year); clamp(months, 1, 24, 1); return; }
      const c = make();
      edit((b) => { b.calendar = c; });
      draw();
    });
  }
  draw();
  const row = (label: string, control: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), control);
  return [h('h3', {}, 'Calendar'), row('First month', month), row('Year', year), row('Months', months), row('Week starts on', weekStarts), summary, state];
}

/** How many signatures the book is split into: the one print setting that belongs to the book. */
export function signaturesField(book: () => Book, edit: (change: (b: Book) => void) => void): HTMLElement {
  const { min, max } = PRINT_LIMITS.signatures;
  const input = h('input', { type: 'number', value: book().print.signatures, min, max, step: 1, inputmode: 'numeric', 'aria-label': 'Signatures', 'data-key': 'book-signatures', 'data-help': 'book-signatures' });
  input.onchange = () => {
    const typed = Number(input.value);
    if (input.value === '' || !Number.isFinite(typed)) { input.value = String(book().print.signatures); return; }
    const v = Math.min(max, Math.max(min, Math.round(typed)));
    input.value = String(v);
    edit((b) => { b.print.signatures = v; });
  };
  return h('label', { class: 'compact' }, 'Signatures', input);
}

/** Picks the sheet layout the files are made for (the printer's setting). `redraw` runs after a change, to show the new layout's values. */
export function layoutPicker(printer: () => PrintSettings, edit: EditPrinter, redraw: () => void): HTMLElement {
  const select = h('select', { 'data-key': 'book-sheet-layout', 'data-help': 'book-sheet-layout', 'aria-label': 'Sheet layout' },
    ...SHEET_LAYOUTS.map((l) => h('option', { value: l, selected: l === printer().sheet_layout }, LAYOUT_NAMES[l])));
  select.onchange = () => { edit((p) => { p.sheet_layout = select.value as SheetLayout; }); redraw(); };
  return h('div', {}, h('label', { class: 'compact wide' }, 'Sheet layout', select),
    h('p', { class: 'hint' }, 'Half letter prints on the paper cut in half (as Statement, borderless). Letter, two-up puts two half-letter sheets on one letter sheet, a top book and a bottom book, with normal margins, so the printer can duplex by itself. The offsets, rotation and scale belong to the layout chosen here (and its print method and paper); everything else is shared.'));
}

/** Picks how the selected layout's paper is flipped: by the printer (auto duplex) or by hand. It is the printer's setting, kept per layout; each method has its own offsets. */
export function methodPicker(printer: () => PrintSettings, edit: EditPrinter, redraw: () => void, hint = true): HTMLElement {
  const layout = printer().sheet_layout;
  const select = h('select', { 'data-key': 'print-method', 'data-help': 'print-method', 'aria-label': 'Print method' },
    ...PRINT_METHODS.map((m) => h('option', { value: m, selected: m === methodOf(printer()) }, METHOD_NAMES[m])));
  select.onchange = () => { edit((p) => { p.print_method[layout] = select.value as PrintMethod; }); redraw(); };
  return h('div', {}, h('label', { class: 'compact wide' }, 'Print method', select),
    ...(!hint ? [] : [h('p', { class: 'hint' }, 'Auto duplex: the printer prints both sides itself (print-duplex.pdf). By hand: you print one side, put the stack back and print the other (print-first.pdf, then print-second.pdf). A printer places the back differently in the two, so each method has its own offsets.')]));
}

/** Picks which paper's offsets, scale and rotation are shown and changed: the inside paper's or the cover stock's (heavier paper is placed differently). */
export function paperPicker(redraw: () => void): HTMLElement {
  const select = h('select', { 'data-key': 'paper-set', 'data-help': 'paper-set', 'aria-label': 'Paper' },
    ...PAPER_SETS.map((k) => h('option', { value: k, selected: k === shownPaper }, PAPER_NAMES[k])));
  select.onchange = () => { showPaper(select.value as PaperSet); redraw(); };
  return h('label', { class: 'compact wide' }, 'Paper', select);
}

/** One line saying which set of offsets the fields below read and write: the layout, the print method and the paper. */
export const setLine = (print: PrintSettings): HTMLElement =>
  h('p', { class: 'hint set-line', 'data-key': 'print-set' }, 'Showing and changing: ', h('strong', {}, `${LAYOUT_NAMES[print.sheet_layout]}, ${METHOD_SHORT[methodOf(print)]}, ${PAPER_NAMES[shownPaper].toLowerCase()}`), '.');

/**
 * "Reset these offsets to defaults": a button that first shows what each setting of the selected layout, method and paper is now and what the default is, and
 * changes nothing until it is confirmed. `redraw` runs after a reset, to show the new values.
 */
export function resetLayout(printer: () => PrintSettings, edit: EditPrinter, redraw: () => void): HTMLElement {
  const layout = printer().sheet_layout, method = methodOf(printer()), paper = shownPaper, name = `${LAYOUT_NAMES[layout]}, ${METHOD_SHORT[method]}, ${PAPER_NAMES[paper].toLowerCase()}`, box = h('div', { class: 'reset-layout' });
  const ask = () => {
    const now = printer().layouts[layout][method][paper], defaults = DEFAULT_PRINT.layouts[layout][method][paper];
    // The measured printable insets are calibration numbers: a reset leaves them as they are.
    const keys = (Object.keys(LAYOUT_LIMITS) as (keyof LayoutProfile)[]).filter((k) => !k.startsWith('inset_'));
    const reset = h('button', { type: 'button', class: 'primary', 'data-key': 'reset-layout-yes', 'data-help': 'reset-layout-yes' }, 'Yes, reset');
    reset.onclick = () => {
      edit((p) => {
        const insets = Object.fromEntries(Object.entries(p.layouts[layout][method][paper]).filter(([k]) => k.startsWith('inset_')));
        p.layouts[layout][method][paper] = { ...DEFAULT_PRINT.layouts[layout][method][paper], ...insets };
      });
      redraw();
    };
    const cancel = h('button', { type: 'button', 'data-key': 'reset-layout-cancel', 'data-help': 'reset-layout-cancel' }, 'Cancel');
    cancel.onclick = () => box.replaceChildren(button);
    box.replaceChildren(h('div', { class: 'restore-printer', role: 'group', 'aria-label': `Reset ${name} to defaults`, 'data-key': 'reset-layout-question' },
      h('p', { class: 'problem-title' }, `Reset the ${name.toLowerCase()} settings to the defaults?`),
      h('div', { class: 'restore-rows' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Now'), h('th', {}, 'Default'))),
        h('tbody', {}, ...keys.map((k) => h('tr', { class: now[k] === defaults[k] ? '' : 'differs' }, h('td', {}, PRINT_FIELDS[k].label), h('td', {}, String(now[k])), h('td', {}, String(defaults[k]))))))),
      h('div', { class: 'problem-actions' }, cancel, reset)));
  };
  const button = h('button', { type: 'button', 'data-key': 'reset-layout', 'data-help': 'reset-layout' }, 'Reset these offsets to defaults');
  button.onclick = ask;
  box.append(button);
  return box;
}

/**
 * Creep, shifts, the offsets, rotation and scale of the selected layout, print method and paper, signatures and tones: the settings that shape the print-ready files.
 * All but the signatures are the printer's, not the book's.
 */
export function printFields(printer: () => PrintSettings, edit: EditPrinter, book: () => Book, editBook: (change: (b: Book) => void) => void, redraw: () => void): HTMLElement[] {
  const field = (key: PrintFieldKey) => printField(printer, edit, key);
  return [
    field('creep_per_sheet_mm'), field('fore_edge_shift_mm'), field('cover_fore_edge_shift_mm'), field('target_fore_edge_margin_mm'), signaturesField(book, editBook),
    ...(printer().sheet_layout === 'letter_two_up' ? [field('trim_margin_mm')] : []),
    paperPicker(redraw), setLine(printer()),
    field('front_offset_x_mm'), field('front_offset_y_mm'), field('back_offset_x_mm'), field('back_offset_y_mm'), field('back_rotation_deg'), field('scale_x_pct'), field('scale_y_pct'), field('line_weight_x_pct'),
    h('p', { class: 'hint' }, 'Creep moves each sheet’s pages toward the fold by the sheets outside it × the creep per sheet (often more than the paper’s thickness; the Calibrate page finds it). The fore-edge shifts move every page away from the fold, so the trimmed fore-edge margin lands on the target. The front offset moves everything printed first (print-first.pdf, the fronts of print-duplex.pdf, cover-outside.pdf), the back offset everything printed second (+x right, +y up, as seen on that side), to cancel what your printer does to each side; the back rotation turns the back about the sheet’s centre (+ is counter-clockwise as seen on the back). The scale moves everything on the sheet about its centre, to cancel a printer that enlarges or shrinks it; it never stretches lines, dots or letters. The line weight is only for a printer that draws lines along the 8.5 in edge thicker than lines along the other edge; the Calibrate page’s line pairs show it. The Calibrate page finds all of these.'),
    field('shade_light_pct'), field('shade_medium_pct'), field('shade_dark_pct'), field('gray_text_pct'),
    h('p', { class: 'hint' }, 'Tones are how dark the light, medium and dark shades and the gray text print: 0 is white, 100 is black. They change the PDFs only, not the editor or PNGs. The Calibrate page helps you choose them.'),
  ];
}
