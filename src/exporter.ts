import { h } from './panel';
import { errorProblem, issuesProblem, problemView, type Problem } from './problems';
import { contactSheet } from './print/contact';
import { zip } from './print/zip';
import { withBookJson } from './print/bundle';
import type { ExportedFile, Include } from './print/export';
import type { Page } from './format/types';
import { readBook, type Book } from './book/book';
import { svgToPng, pageToPng, spreadToPng, FONT_CSS, PNG_DPI, PNG_DPIS } from './png';
import { layoutPicker, printFields } from './settings';
import { slug } from './slug';
import { loadFontBytes } from './print/fonts';
import { CalibrateDialog, type CalibrateHost } from './calibrate';
import { differing, printerOf } from './printer';
import { clonePrint } from './book/impose';

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
  /** Open a chosen file as a page, spread or book. */
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
  /** The book and printer settings whose difference was dismissed with Keep this book's. */
  private keptDifference = '';

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
      this.what('Opens a Dotwork .json file that you exported before: a page, a spread or a book. It replaces the page, spread or book you are editing now (Undo takes a page back).'),
      h('div', { class: 'export-actions' }, h('button', { type: 'button', class: 'primary', 'data-key': 'import-choose', 'data-help': 'export-import-choose', onclick: () => file.click() }, 'Choose a file…'), file),
    ];
  }

  // ---- Export (JSON) --------------------------------------------------------

  private exportTab(): HTMLElement[] {
    const thing = this.thing();
    const r = this.host.json();
    const fileName = r.ok ? `${slug(r.name, thing)}.json` : `${thing}.json`;
    return [
      this.what(`Saves the ${thing} you are editing as a .json file, so you can keep it, share it or import it again. You get `, h('strong', {}, fileName), '.'),
      this.downloadButton('export-json', () => {
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
    const px = Math.round((88.9 / 25.4) * this.png.dpi) * (whole ? 2 : 1);
    const py = Math.round((139.7 / 25.4) * this.png.dpi);
    return [
      this.what(`Saves a picture of ${whole ? 'the spread, both pages side by side,' : 'the page'} as a PNG, ${px} × ${py} pixels. You get `, h('strong', {}, `${slug(nameOf(), 'page')}.png`), '.'),
      ...(spread ? [h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'What to save' },
        radio('page', `This page (${shown.page.side === 'left' ? 'left' : 'right'})`), radio('spread', 'The whole spread'))] : []),
      h('label', { class: 'compact wide' }, 'Resolution', dpi),
      this.downloadButton('export-png', async () => {
        this.say('Making the PNG…');
        try {
          const blob = whole ? await spreadToPng(spread!.left, spread!.right, this.png.dpi) : await pageToPng(shown.page, this.png.dpi);
          this.say(null);
          this.host.download(blob, `${slug(nameOf(), 'page')}.png`);
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
    const notice = h('div', { class: 'printer-notice-slot' });
    this.fillNotice(notice);
    const twoUp = book.print.sheet_layout === 'letter_two_up';
    const names = [
      ...(pages ? ['pages.pdf'] : []), ...(cover ? ['cover-outside.pdf', 'cover-inside.pdf'] : []),
      ...(signatures ? [`${twoUp ? 'print-duplex.pdf, ' : ''}print-first.pdf and print-second.pdf for each signature, with preview.png and summary.txt`] : []),
    ];
    const redraw = () => { this.fillNotice(notice); this.render(); };
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
      layoutPicker(() => this.host.book(), (change) => this.host.editBook(change), redraw),
      ...(twoUp ? [this.bottomBook()] : []),
      h('div', { class: 'export-actions' }, h('button', {
        type: 'button', 'data-key': 'calibrate-open', 'data-help': 'calibrate-open',
        onclick: () => { this.dialog.close(); this.calibrate.show(); },
      }, 'Calibrate your printer…')),
      ...(signatures ? [notice, h('h3', {}, 'Printing'), ...printFields(() => this.host.book(), (change) => { this.host.editBook(change); this.fillNotice(notice); })] : []),
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
      h('p', { class: 'hint' }, 'The top half (Book 1) is this book. If the books have different numbers of sheets, the extra halves are blank. Sheet layout, offsets and scale come from this book.'));
  }

  /** The printer's saved settings and where the book's print settings differ from them: the key of that difference, and what differs. */
  private printerDifference() {
    const saved = this.host.printer.saved(), print = this.host.book().print;
    return { saved, print, keys: saved ? differing(print, saved) : [], id: JSON.stringify([printerOf(print), saved]) };
  }

  /**
   * Says so when the book's print settings differ from the printer's saved ones, and offers to take either. A change to a field
   * only updates the list, never the buttons: a tap that blurs a field and lands on a button must still reach it.
   */
  private fillNotice(slot: HTMLElement) {
    const { saved, keys, id } = this.printerDifference();
    if (!saved || keys.length === 0 || id === this.keptDifference) { slot.replaceChildren(); return; }
    const items = keys.map((k) => h('li', {}, `${k.name}: ${k.here} here, ${k.saved} saved`));
    const list = slot.querySelector('ul');
    if (list) { list.replaceChildren(...items); return; }
    const use = h('button', { type: 'button', class: 'primary', 'data-key': 'printer-use-saved', 'data-help': 'printer-use-saved' }, 'Use my printer settings');
    use.onclick = () => { this.host.editBook((b) => Object.assign(b.print, clonePrint({ ...b.print, ...this.host.printer.saved()! }))); this.render(); };
    const keep = h('button', { type: 'button', 'data-key': 'printer-keep-book', 'data-help': 'printer-keep-book' }, 'Keep this book’s');
    keep.onclick = () => { this.keptDifference = this.printerDifference().id; this.fillNotice(slot); };
    slot.replaceChildren(h('div', { class: 'printer-notice', role: 'status', 'data-key': 'printer-notice' },
      h('p', {}, 'This book’s print settings differ from your printer’s saved settings:'),
      h('ul', {}, ...items),
      h('div', { class: 'problem-actions' }, use, keep)));
  }

  private async buildPdf() {
    const book = this.host.book();
    const include: Include = { ...this.pdf };
    this.say('Building the PDFs…');
    let files: ExportedFile[] = [];
    let failure: unknown;
    try {
      // The PDF code is loaded only when it is needed.
      const [{ exportBookFiles }, fontBytes] = await Promise.all([import('./print/export'), loadFontBytes()]);
      // A two-up sheet's bottom book: the one chosen from the Library, else the book itself.
      const bottom = book.print.sheet_layout === 'letter_two_up' && this.bottomId ? (await this.host.savedBooks()).find((b) => b.id === this.bottomId)?.book : undefined;
      files = await exportBookFiles(book, fontBytes, include, bottom);
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
    if (check.ok) this.say(null);
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
