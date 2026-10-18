import { h } from '../panel';
import { contactSheet } from '../print/contact';
import { zip } from '../print/zip';
import type { ExportedFile } from '../print/export';
import type { Book } from './book';
import { svgToPng, FONT_CSS } from '../png';
import { isCompact } from '../sheet';
import regularUrl from '../fonts/CourierPrime-Regular.ttf?url';
import boldUrl from '../fonts/CourierPrime-Bold.ttf?url';

const PREVIEW_DPI = 60;
const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'book';
const kb = (n: number) => (n < 1024 * 100 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** The window that builds a book's print files and offers them: each one, or all together as a zip. */
export class ExportDialog {
  private dialog: HTMLDialogElement;
  private body = h('div', { class: 'export-body' });

  constructor(private download: (blob: Blob, filename: string) => void) {
    this.dialog = h('dialog', { class: 'library export', 'aria-label': 'Export print files' },
      h('header', {}, h('h2', {}, 'Print files'), h('button', { type: 'button', onclick: () => this.dialog.close() }, 'Close')),
      this.body);
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
  }

  async show(book: Book) {
    this.body.replaceChildren(h('p', { class: 'hint' }, 'Building the print files…'));
    if (!this.dialog.open) this.dialog.showModal();
    try {
      const files = await this.build(book);
      this.list(book, files);
    } catch (err) {
      this.body.replaceChildren(h('p', { class: 'warn' }, `Can’t export: ${(err as Error).message}`));
    }
  }

  private async build(book: Book): Promise<ExportedFile[]> {
    // The PDF code is loaded only when it is needed.
    const [{ exportBookFiles }, [regular, bold]] = await Promise.all([
      import('../print/export'),
      Promise.all([regularUrl, boldUrl].map(async (u) => (await fetch(u)).arrayBuffer())),
    ]);
    const files = await exportBookFiles(book, { regular, bold });
    const sheet = contactSheet(book, FONT_CSS);
    const px = (mm: number) => Math.round((mm / 25.4) * PREVIEW_DPI);
    const png = await svgToPng(sheet.svg, px(sheet.width), px(sheet.height), PREVIEW_DPI);
    files.splice(files.length - 1, 0, { name: 'preview.png', bytes: new Uint8Array(await png.arrayBuffer()), type: 'image/png' });
    return files;
  }

  private list(book: Book, files: ExportedFile[]) {
    const blob = (f: ExportedFile) => new Blob([f.bytes as BlobPart], { type: f.type });
    const preview = files.find((f) => f.name === 'preview.png')!;
    const previewUrl = URL.createObjectURL(blob(preview));
    const img = h('img', { src: previewUrl, alt: `Contact sheet of ${book.name}`, class: 'contact' });
    const rows = files.map((f) => h('li', {},
      h('span', { class: 'file' }, f.name), h('span', { class: 'hint' }, kb(f.bytes.length)),
      h('button', { type: 'button', onclick: () => this.download(blob(f), f.name) }, 'Download')));
    const all = h('button', {
      type: 'button', class: 'primary',
      onclick: () => this.download(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${slug(book.name)}-print.zip`),
    }, 'Download all (.zip)');
    // Phone browsers often refuse several downloads at once, so there the zip is the way and the files are tucked away.
    const list = h('ul', { class: 'export-files' }, ...rows);
    const individual = isCompact()
      ? h('details', { class: 'export-individual' }, h('summary', {}, 'Download files one at a time'), list)
      : list;
    this.body.replaceChildren(
      h('div', { class: 'export-actions' }, all),
      individual,
      h('p', { class: 'hint' }, 'Print each signature: print-first.pdf, put the stack back in the tray the same way, then print-second.pdf. Print cover.pdf single-sided on the cover paper. Fold, sew, then trim 3.5 in from the fold.'),
      img);
    this.dialog.addEventListener('close', () => URL.revokeObjectURL(previewUrl), { once: true });
  }
}
