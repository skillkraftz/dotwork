import { h } from './panel';
import { contactSheet } from './print/contact';
import { zip } from './print/zip';
import type { ExportedFile, Include } from './print/export';
import type { Page } from './format/types';
import type { Book } from './book/book';
import { svgToPng, pageToPng, spreadToPng, FONT_CSS, PNG_DPI, PNG_DPIS } from './png';
import { printFields } from './settings';
import regularUrl from './fonts/CourierPrime-Regular.ttf?url';
import boldUrl from './fonts/CourierPrime-Bold.ttf?url';

export type ExportTab = 'import' | 'export' | 'png' | 'pdf';
const TABS: [ExportTab, string][] = [['import', 'Import'], ['export', 'Export'], ['png', 'PNG'], ['pdf', 'PDF']];

export const slug = (name: string, fallback: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
const PREVIEW_DPI = 60;

/** What the export window needs from the editor around it. */
export interface ExportHost {
  view(): 'page' | 'spread' | 'book';
  /** The current page, spread or book as a JSON file: its data and a name for the file, or why it can't be saved. */
  json(): { ok: true; data: unknown; name: string } | { ok: false; messages: string[] };
  /** What a PNG can show right now: the page (or the spread page being edited), and in a spread both pages. Null in the book view. */
  png(): { page: Page; spread?: { left: Page; right: Page; name: string } } | null;
  book(): Book;
  editBook(change: (book: Book) => void): void;
  /** Open a chosen file as a page, spread or book. */
  importFile(file: File): Promise<{ ok: boolean; messages: string[] }>;
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
  private pdf = { kind: 'signatures' as 'pages' | 'signatures', cover: true };

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

  private say(message: string | string[] | null) {
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
      } else this.say(r.messages);
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
        if (!now.ok) { this.say(now.messages); return; }
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
          this.say(`PNG export failed: ${(err as Error).message}`);
        }
      }),
    ];
  }

  // ---- PDF ------------------------------------------------------------------

  private pdfTab(): HTMLElement[] {
    const book = this.host.book();
    const radio = (value: 'pages' | 'signatures', label: string, note: string) => {
      const input = h('input', { type: 'radio', name: 'pdf-kind', checked: this.pdf.kind === value, 'data-key': `pdf-${value}`, 'data-help': 'export-pdf-kind', 'aria-label': label });
      input.onchange = () => { this.pdf.kind = value; this.render(); };
      return h('label', { class: 'choice stack' }, input, h('span', {}, h('strong', {}, label), h('small', { class: 'hint' }, note)));
    };
    const cover = h('input', { type: 'checkbox', checked: this.pdf.cover, 'data-key': 'pdf-cover', 'data-help': 'export-pdf-cover' });
    cover.onchange = () => { this.pdf.cover = cover.checked; this.render(); };
    const signatures = this.pdf.kind === 'signatures';
    const files = signatures ? `print-first.pdf and print-second.pdf for each signature${this.pdf.cover ? ', and cover.pdf' : ''}` : `pages.pdf${this.pdf.cover ? ' and cover.pdf' : ''}`;
    const many = signatures || this.pdf.cover;
    return [
      this.what(`Makes PDFs from the book “${book.name || 'Untitled book'}” (${book.page_count} pages; arrange it in Book view). You get `, h('strong', {}, many ? `${slug(book.name, 'book')}-print.zip` : `${slug(book.name, 'book')}-pages.pdf`), `, holding ${files}.`),
      h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'What to make' },
        radio('pages', 'Pages at final size', 'Every page, one after another, 3.5 × 5.5 in. To read, check or print one page at a time.'),
        radio('signatures', 'Print-ready signatures', 'Pages arranged on letter-cut-in-half sheets, with creep, for printing on both sides and binding.')),
      ...(signatures ? [h('h3', {}, 'Printing'), ...printFields(() => this.host.book(), (change) => { this.host.editBook(change); })] : []),
      h('label', { class: 'inline' }, cover, 'Include the inside covers (cover.pdf)'),
      this.downloadButton('export-pdf', () => this.buildPdf()),
    ];
  }

  private async buildPdf() {
    const book = this.host.book();
    const include: Include = { signatures: this.pdf.kind === 'signatures', pages: this.pdf.kind === 'pages', cover: this.pdf.cover };
    this.say('Building the PDFs…');
    try {
      // The PDF code is loaded only when it is needed.
      const [{ exportBookFiles }, [regular, bold]] = await Promise.all([
        import('./print/export'),
        Promise.all([regularUrl, boldUrl].map(async (u) => (await fetch(u)).arrayBuffer())),
      ]);
      const files: ExportedFile[] = await exportBookFiles(book, { regular, bold }, include);
      if (include.signatures) {
        const sheet = contactSheet(book, FONT_CSS);
        const px = (mm: number) => Math.round((mm / 25.4) * PREVIEW_DPI);
        const png = await svgToPng(sheet.svg, px(sheet.width), px(sheet.height), PREVIEW_DPI);
        files.splice(files.length - 1, 0, { name: 'preview.png', bytes: new Uint8Array(await png.arrayBuffer()), type: 'image/png' });
      }
      this.say(null);
      const [only] = files;
      if (files.length === 1) this.host.download(new Blob([only.bytes as BlobPart], { type: only.type }), only.name === 'pages.pdf' ? `${slug(book.name, 'book')}-pages.pdf` : only.name);
      else this.host.download(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${slug(book.name, 'book')}-print.zip`);
    } catch (err) {
      this.say(`Can’t export: ${(err as Error).message}`);
    }
  }

  // ---- shared ---------------------------------------------------------------

  /** The one button that downloads. It is a separate step from choosing, so that nothing is saved by accident. */
  private downloadButton(key: string, go: () => void | Promise<void>, disabled = false): HTMLElement {
    const b = h('button', { type: 'button', class: 'primary', 'data-key': key, 'data-help': 'export-download', disabled }, 'Download');
    b.onclick = async () => { b.disabled = true; try { await go(); } finally { b.disabled = disabled; } };
    return h('div', { class: 'export-actions' }, b);
  }
}
