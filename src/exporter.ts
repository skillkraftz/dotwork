import { h } from './panel';
import { errorProblem, issuesProblem, problemView, type Problem } from './problems';
import { contactSheet } from './print/contact';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile, Include } from './print/export';
import type { Page } from './format/types';
import { bookLayout, readBook, type Book } from './book/book';
import { svgToPng, pageToPng, spreadToPng, FONT_CSS, PNG_DPI, PNG_DPIS } from './png';
import { layoutPicker, printFields, resetLayout } from './settings';
import { slug } from './slug';
import { loadFontBytes } from './print/fonts';
import { CalibrateDialog, type CalibrateHost } from './calibrate';

export type ExportTab = 'import' | 'export' | 'png' | 'pdf';
const TABS: [ExportTab, string][] = [['import', 'Import'], ['export', 'Export'], ['png', 'PNG'], ['pdf', 'PDF']];

const PREVIEW_DPI = 60;

/** What the export window needs from the editor around it. */
export interface ExportHost extends Pick<CalibrateHost, 'printer'> {
  view(): 'page' | 'spread' | 'book';
  /** The current page, spread or book as a JSON file: its data and a name for the file, or why it can't be saved. */
  json(): { ok: true; data: unknown; name: string } | { ok: false; problem: Problem };
  /** What a PNG can show right now: the page (or the spread page being edited), and in a spread both pages. Null in the book view. */
  png(): { page: Page; spread?: { left: Page; right: Page; name: string } } | null;
  book(): Book;
  /** The books saved in the Library: the choices for the bottom book of a two-up sheet. */
  savedBooks(): Promise<{ id: string; name: string; book: Book }[]>;
  editBook(change: (book: Book) => void): void;
  /** Called before a page, spread or book is downloaded: asks for a name if it is still Untitled. False if that was cancelled (nothing is downloaded). */
  beforeExport(what?: 'book'): Promise<boolean>;
  /** Add a chosen file as a new page, spread, book or section. */
  importFile(file: File): Promise<{ ok: true } | { ok: false; problem: Problem }>;
  download(blob: Blob, filename: string): void;
}

/**
 * One window for everything that moves a file in or out: Import, Export (JSON), PNG and PDF. Each tab says in a sentence
 * what it does and what file you get. Nothing is downloaded until a Download button is pressed.
 */
export class ExportDialog {
  private dialog: HTMLDialogElement;
  private tab: ExportTab = 'export';
  private tabs = new Map<ExportTab, HTMLElement>();
  private body = h('div', { class: 'export-body' });
  private status = h('p', { class: 'lib-msg', role: 'status', hidden: true });
  private png = { scope: 'page' as 'page' | 'spread', dpi: PNG_DPI as number };
  private pdf = { pages: true, cover: true, signatures: true };
  /** The Library book on the bottom half of a two-up sheet; empty is the book being exported. */
  private bottomId = '';
  private calibrate: CalibrateDialog;

  constructor(private host: ExportHost) {
    const tabBar = h('div', { class: 'lib-tabs', role: 'tablist', 'aria-label': 'Export sections' },
      ...TABS.map(([id, label]) => {
        const b = h('button', { type: 'button', role: 'tab', 'data-tab': id, 'data-help': `export-tab-${id}`, onclick: () => this.go(id) }, label);
        this.tabs.set(id, b);
        return b;
      }));
    this.dialog = h('dialog', { class: 'library export', 'aria-label': 'Import and export' },
      h('header', {}, h('h2', {}, 'Import and export'), h('button', { type: 'button', 'data-help': 'export-close', onclick: () => this.dialog.close() }, 'Close')),
      h('div', { class: 'lib-find' }, tabBar),
      this.status,
      this.body) as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
    // The Calibrate page replaces this window while it is open, and brings it back on the PDF tab when it is closed.
    this.calibrate = new CalibrateDialog(host, () => this.show('pdf'));
  }

  /** Open on a tab; with none, on Export (or PDF in the book view, where that is the point). */
  show(tab: ExportTab = this.host.view() === 'book' ? 'pdf' : 'export') {
    this.go(tab);
    if (!this.dialog.open) this.dialog.showModal();
  }

  private go(tab: ExportTab) {
    this.tab = tab;
    for (const [id, b] of this.tabs) b.setAttribute('aria-selected', String(id === tab));
    this.say(null);
    this.render();
  }

  private say(message: string | string[] | Problem | null) {
    if (message !== null && typeof message === 'object' && 'details' in message) {
      this.status.replaceChildren(problemView(message));
      this.status.hidden = false;
      return;
    }
    const lines = message === null ? [] : Array.isArray(message) ? message : [message];
    this.status.replaceChildren(...lines.map((l) => h('span', {}, l)));
    this.status.hidden = lines.length === 0;
  }

  private render() {
    const content = { import: () => this.importTab(), export: () => this.exportTab(), png: () => this.pngTab(), pdf: () => this.pdfTab() }[this.tab]();
    this.body.replaceChildren(...content);
  }

  private what = (this_: string, ...rest: (string | HTMLElement)[]) => h('p', { class: 'export-what' }, this_, ...rest);
  private thing = () => ({ page: 'page', spread: 'spread', book: 'book' })[this.host.view()];

  // ---- Import ---------------------------------------------------------------

  private importTab(): HTMLElement[] {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-key': 'import-file' });
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const r = await this.host.importFile(f);
      if (r.ok) {
        this.dialog.close();
      } else this.say(r.problem);
    };
    return [
      this.what('Adds a Dotwork .json file that you exported before: a page, a spread, a book or a section. It becomes a new document in your Library, named from the file (with 2 added if that name is taken). A page, spread or book is opened; a section is listed under Sections. Nothing you have is replaced.'),
      h('div', { class: 'export-actions' }, h('button', { type: 'button', class: 'primary', 'data-key': 'import-choose', 'data-help': 'export-import-choose', onclick: () => file.click() }, 'Choose a file…'), file),
    ];
  }

  // ---- Export (JSON) --------------------------------------------------------

  private exportTab(): HTMLElement[] {
    const thing = this.thing();
    const r = this.host.json();
    const fileName = r.ok ? `${slug(r.name, thing)}.json` : `${thing}.json`;
    return [
      this.what(`Saves the ${thing} you are editing, as it is now, as a .json file, so you can keep it, share it or import it again. You get `, h('strong', {}, fileName), '.'),
      this.downloadButton('export-json', async () => {
        if (!(await this.host.beforeExport())) return;
        const now = this.host.json();
        if (!now.ok) { this.say(now.problem); return; }
        this.say(null);
        this.host.download(new Blob([JSON.stringify(now.data, null, 2) + '\n'], { type: 'application/json' }), `${slug(now.name, thing)}.json`);
      }),
    ];
  }

  // ---- PNG ------------------------------------------------------------------

  private pngTab(): HTMLElement[] {
    const shown = this.host.png();
    if (!shown) {
      return [this.what('A PNG is a picture of one page or one spread. Switch to Page or Spread in the top bar, then come back here.'), this.downloadButton('export-png', () => {}, true)];
    }
    const spread = shown.spread;
    if (!spread) this.png.scope = 'page';
    const radio = (value: 'page' | 'spread', label: string) => {
      const input = h('input', { type: 'radio', name: 'png-scope', checked: this.png.scope === value, 'data-key': `png-${value}`, 'data-help': 'export-png-scope', 'aria-label': label });
      input.onchange = () => { this.png.scope = value; this.render(); };
      return h('label', { class: 'choice' }, input, label);
    };
    const dpi = h('select', { 'data-key': 'png-dpi', 'data-help': 'export-png-dpi', 'aria-label': 'Resolution' },
      ...PNG_DPIS.map((d) => h('option', { value: d, selected: d === this.png.dpi }, `${d} DPI${d === PNG_DPI ? ' (best for printing)' : d === 150 ? ' (small file)' : ''}`)));
    dpi.onchange = () => { this.png.dpi = Number(dpi.value); this.render(); };
    const whole = spread && this.png.scope === 'spread';
    const nameOf = () => (whole ? spread!.name : shown.page.name);
    /** What is on screen now, after a name may have been asked for. */
    const nowShown = () => { const n = this.host.png()!; return { page: n.page, spread: n.spread, whole: !!n.spread && whole }; };
    const px = Math.round((88.9 / 25.4) * this.png.dpi) * (whole ? 2 : 1);
    const py = Math.round((139.7 / 25.4) * this.png.dpi);
    return [
      this.what(`Saves a picture of ${whole ? 'the spread, both pages side by side,' : 'the page'} as a PNG, ${px} × ${py} pixels. You get `, h('strong', {}, `${slug(nameOf(), 'page')}.png`), '.'),
      ...(spread ? [h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'What to save' },
        radio('page', `This page (${shown.page.side === 'left' ? 'left' : 'right'})`), radio('spread', 'The whole spread'))] : []),
      h('label', { class: 'compact wide' }, 'Resolution', dpi),
      h('p', { class: 'hint export-note' }, 'A page or spread has no date or number of its own, so the picture shows the sample date (Mon 26 Oct 2026) and page number (47).'),
      this.downloadButton('export-png', async () => {
        if (!(await this.host.beforeExport())) return;
        const now = nowShown();
        this.say('Making the PNG…');
        try {
          const blob = now.whole ? await spreadToPng(now.spread!.left, now.spread!.right, this.png.dpi) : await pageToPng(now.page, this.png.dpi);
          this.say(null);
          this.host.download(blob, `${slug(now.whole ? now.spread!.name : now.page.name, 'page')}.png`);
        } catch (err) {
          this.say(errorProblem('PNG export failed.', err));
        }
      }),
    ];
  }

  // ---- PDF ------------------------------------------------------------------

  private pdfTab(): HTMLElement[] {
    const book = this.host.book();
    const box = (key: 'pages' | 'cover' | 'signatures', label: string, note: string) => {
      const input = h('input', { type: 'checkbox', checked: this.pdf[key], 'data-key': `pdf-${key}`, 'data-help': `export-pdf-${key}`, 'aria-label': label });
      input.onchange = () => { this.pdf[key] = input.checked; this.render(); };
      return h('label', { class: 'choice stack' }, input, h('span', {}, h('strong', {}, label), h('small', { class: 'hint' }, note)));
    };
    const { pages, cover, signatures } = this.pdf;
    const printer = this.host.printer.get(), twoUp = printer.sheet_layout === 'letter_two_up';
    const names = [
      ...(pages ? ['pages.pdf'] : []), ...(cover ? ['cover-outside.pdf', 'cover-inside.pdf'] : []),
      ...(signatures ? [`${twoUp ? 'print-duplex.pdf, ' : ''}print-first.pdf and print-second.pdf for each signature, with preview.png and summary.txt`] : []),
    ];
    const redraw = () => this.render();
    return [
      names.length === 0
        ? this.what('Choose at least one file to make.')
        : this.what(`Makes PDFs from the book “${book.name || 'Untitled book'}” (${book.page_count} pages; arrange it in Book view). You get `,
          h('strong', {}, `${slug(book.name, 'book')}-print.zip`), `, holding ${names.join(', ')} and book.json (the book as JSON; error.txt too if anything goes wrong).`),
      h('div', { class: 'choices', role: 'group', 'aria-label': 'What to make' },
        box('pages', 'pages.pdf', 'Every page at final size, 3.5 × 5.5 in, one after another. To read, check or print one page at a time.'),
        box('cover', 'Covers', 'cover-outside.pdf (outside back | outside front) printed first, then cover-inside.pdf (inside front | inside back) on the back of it. Single-sided passes, no creep.'),
        box('signatures', 'Print files', twoUp
          ? 'print-duplex.pdf (front, back, front, back… for a printer that duplexes by itself), and print-first.pdf and print-second.pdf for when it can’t: two sheets per letter sheet, with creep, cut marks and labels. Also a preview and a summary.'
          : 'print-first.pdf (side A) and print-second.pdf (side B): pages arranged on letter-cut-in-half sheets, with creep, for printing on both sides and binding. Also a preview and a summary.')),
      layoutPicker(() => this.host.printer.get(), (change) => this.host.printer.edit(change), redraw),
      resetLayout(() => this.host.printer.get(), (change) => this.host.printer.edit(change), redraw),
      ...(twoUp ? [this.bottomBook()] : []),
      h('div', { class: 'export-actions' }, h('button', {
        type: 'button', 'data-key': 'calibrate-open', 'data-help': 'calibrate-open',
        onclick: () => { this.dialog.close(); this.calibrate.show(); },
      }, 'Calibrate your printer…')),
      ...(signatures ? [h('h3', {}, 'Printing'), h('p', { class: 'hint' }, 'These belong to your printer, not the book: they are kept in this browser and used for every book. Only the signatures are saved in the book.'), ...printFields(() => this.host.printer.get(), (change) => this.host.printer.edit(change), () => this.host.book(), (change) => this.host.editBook(change))] : []),
      this.downloadButton('export-pdf', () => this.buildPdf(), names.length === 0),
    ];
  }

  /** Which book is on the bottom half of a two-up sheet: the one being exported (so both halves are the same book) or one saved in the Library. */
  private bottomBook(): HTMLElement {
    const select = h('select', { 'data-key': 'pdf-bottom-book', 'data-help': 'export-bottom-book', 'aria-label': 'Bottom book' }, h('option', { value: '' }, 'Same as the top book'));
    select.onchange = () => { this.bottomId = select.value; };
    void this.host.savedBooks().then((books) => {
      for (const b of books) select.append(h('option', { value: b.id }, b.name || 'Untitled book'));
      select.value = books.some((b) => b.id === this.bottomId) ? this.bottomId : '';
      this.bottomId = select.value;
    });
    return h('div', {}, h('label', { class: 'compact wide' }, 'Bottom book (Book 2)', select),
      h('p', { class: 'hint' }, 'The top half (Book 1) is this book. If the books have different numbers of sheets, the extra halves are blank. Both halves print with your printer settings.'));
  }

  private async buildPdf() {
    if (!(await this.host.beforeExport('book'))) return; // the print zip is the book, whichever view is showing
    const book = this.host.book(), print = this.host.printer.get();
    const over = bookLayout(book).over;
    if (over > 0) { this.say(`Can’t print yet: the book is over by ${over} page${over === 1 ? '' : 's'}. In the Book view, Make the book longer, or take blocks out of the outline.`); return; }
    const include: Include = { ...this.pdf };
    this.say('Building the PDFs…');
    let files: ExportedFile[] = [];
    let warnings: string[] = [];
    let failure: unknown;
    try {
      // The PDF code is loaded only when it is needed.
      const [{ exportBookFiles }, fontBytes] = await Promise.all([import('./print/export'), loadFontBytes()]);
      // A two-up sheet's bottom book: the one chosen from the Library, else the book itself.
      const bottom = print.sheet_layout === 'letter_two_up' && this.bottomId ? (await this.host.savedBooks()).find((b) => b.id === this.bottomId)?.book : undefined;
      const made = await exportBookFiles(book, print, fontBytes, include, bottom);
      files = made;
      warnings = made.warnings;
      if (include.signatures) {
        const sheet = contactSheet(book, FONT_CSS);
        const px = (mm: number) => Math.round((mm / 25.4) * PREVIEW_DPI);
        const png = await svgToPng(sheet.svg, px(sheet.width), px(sheet.height), PREVIEW_DPI);
        files.splice(files.length - 1, 0, { name: 'preview.png', bytes: new Uint8Array(await png.arrayBuffer()), type: 'image/png' });
      }
    } catch (err) {
      failure = err;
    }
    // The zip always carries the book as JSON, and error.txt when anything failed, so a problem can be found from the zip alone.
    const bundle = withBookJson(book, files, failure);
    try {
      this.host.download(new Blob([zip(bundle) as BlobPart], { type: 'application/zip' }), `${slug(book.name, 'book')}-print.zip`);
    } catch (err) {
      this.say(errorProblem('The download could not be made.', err));
      return;
    }
    if (failure !== undefined) {
      this.say(errorProblem('Can’t export: the PDFs could not be built. A zip with the book as JSON and an error.txt was downloaded instead.', failure));
      return;
    }
    // The PDFs were built from the book as it is, so say so on screen too if it breaks the format.
    const check = readBook(book);
    // Content near the sheet's edge is not a failure: the files were made, and the owner checks by printing that page.
    if (check.ok) this.say(warnings.length ? ['The files were made. The print driver may cut off content near the sheet’s edge: check these by printing the page first.', ...warnings] : null);
    else this.say(issuesProblem('The files were made, but the book breaks the book format. The zip has an error.txt with the reasons.', check.issues));
  }

  // ---- shared ---------------------------------------------------------------

  /** The one button that downloads. It is a separate step from choosing, so that nothing is saved by accident. */
  private downloadButton(key: string, go: () => void | Promise<void>, disabled = false): HTMLElement {
    const b = h('button', { type: 'button', class: 'primary', 'data-key': key, 'data-help': 'export-download', disabled }, 'Download');
    b.onclick = async () => { b.disabled = true; try { await go(); } finally { b.disabled = disabled; } };
    return h('div', { class: 'export-actions' }, b);
  }
}
