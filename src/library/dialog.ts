import { formatIssue } from '../format/validate';
import { readPage } from '../format/read';
import type { Page } from '../format/types';
import { readSpread, type Spread, type SpreadSide } from '../format/spread';
import { readBook, bookPage, type Book } from '../book/book';
import { h } from '../panel';
import { thumbnailSvg } from '../render';
import oflUrl from '../fonts/OFL.txt?url';
import type { Library, LibraryItem } from './library';

/** What can be saved from the editor right now. */
export type SaveWhat = 'page' | 'spread' | 'left' | 'right' | 'book';

export interface SaveOption { what: SaveWhat; label: string; name: string }

/** What the dialog needs from the editor around it. */
export interface LibraryHost {
  saveOptions(): SaveOption[];
  data(what: SaveWhat): Page | Spread | Book;
  openPage(page: Page): void;
  openSpread(spread: Spread): void;
  openBook(book: Book): void;
  placePage(page: Page, side: SpreadSide): void;
  download(blob: Blob, filename: string): void;
  /** The window was closed; anything that lists the library can refresh. */
  closed?(): void;
}

const itemThumb = (item: LibraryItem) =>
  thumbnailSvg(item.kind === 'page' ? [item.data] : item.kind === 'spread' ? [item.data.left, item.data.right]
    : [bookPage(item.data, 0), bookPage(item.data, 1)]); // a book shows as its first spread

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The library window: save the current page or spread, and open, rename, duplicate and delete what is saved. */
export class LibraryDialog {
  private dialog: HTMLDialogElement;
  private msgEl = h('p', { class: 'lib-msg', role: 'status', hidden: true });
  private listEl = h('div', { class: 'lib-list' });
  private saveRow = h('div', { class: 'lib-save' });
  private renaming: string | null = null;
  private nameEdited = false;

  constructor(private library: Library, private host: LibraryHost) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) await this.importBackup(f);
    };
    this.dialog = h('dialog', { class: 'library', 'aria-label': 'Library' },
      h('header', {},
        h('h2', {}, 'Library'),
        h('button', { type: 'button', 'data-help': 'library-close', onclick: () => this.dialog.close() }, 'Close')),
      this.saveRow,
      this.msgEl,
      this.listEl,
      h('footer', {},
        h('button', { type: 'button', 'data-help': 'library-export', onclick: () => this.exportBackup() }, 'Export library'),
        h('button', { type: 'button', 'data-help': 'library-import', onclick: () => file.click() }, 'Import library'),
        file,
        h('span', { class: 'hint' }, 'Kept in this browser. Export a backup file to keep it safe.'),
        h('span', { class: 'hint' }, 'Courier Prime © The Courier Prime Project Authors, ',
          h('a', { href: oflUrl, target: '_blank', rel: 'noopener', 'data-help': 'credits-link' }, 'SIL OFL 1.1'), '.')),
    );
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.dialog.addEventListener('close', () => host.closed?.());
    document.body.append(this.dialog);
  }

  async show() {
    this.renaming = null;
    this.nameEdited = false;
    this.say(null);
    this.renderSave();
    await this.renderList();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private say(message: string | string[] | null) {
    const lines = message === null ? [] : Array.isArray(message) ? message : [message];
    this.msgEl.replaceChildren(...lines.map((l) => h('span', {}, l)));
    this.msgEl.hidden = lines.length === 0;
  }

  private close() { if (this.dialog.open) this.dialog.close(); }

  // ---- saving ---------------------------------------------------------------

  private renderSave(selected?: SaveWhat) {
    const options = this.host.saveOptions();
    const current = options.find((o) => o.what === selected) ?? options[0];
    const name = h('input', { type: 'text', value: current.name, 'aria-label': 'Name', 'data-help': 'library-save-name', maxlength: 80 });
    name.oninput = () => { this.nameEdited = true; };
    const what = h('select', { 'aria-label': 'What to save', 'data-help': 'library-save-what' },
      ...options.map((o) => h('option', { value: o.what, selected: o === current }, o.label)));
    what.onchange = () => {
      const o = options.find((x) => x.what === what.value)!;
      if (!this.nameEdited) name.value = o.name;
    };
    const save = h('button', { type: 'button', class: 'primary', 'data-help': 'library-save' }, 'Save to library');
    save.onclick = () => this.save(what.value as SaveWhat, name.value);
    name.onkeydown = (e) => { if (e.key === 'Enter') save.click(); };
    this.saveRow.replaceChildren(what, name, save);
  }

  private async save(what: SaveWhat, name: string) {
    const kind = what === 'spread' ? 'spread' : what === 'book' ? 'book' : 'page';
    const existing = await this.library.findByName(kind, name);
    if (existing && !confirm(`Replace the saved ${kind} “${existing.name}”?`)) return;
    const data = this.host.data(what);
    const check = kind === 'spread' ? readSpread(data) : kind === 'book' ? readBook(data) : readPage(data);
    if (!check.ok) {
      this.say(['Not saved: it breaks the page format.', ...check.issues.slice(0, 8).map(formatIssue)]);
      return;
    }
    const item = kind === 'spread' ? await this.library.save('spread', name, data as Spread)
      : kind === 'book' ? await this.library.save('book', name, data as Book)
        : await this.library.save('page', name, data as Page);
    this.say(`Saved ${kind} “${item.name}” to the library.`);
    this.nameEdited = false;
    this.renderSave(what);
    await this.renderList();
  }

  // ---- the list -------------------------------------------------------------

  private async renderList() {
    const items = await this.library.list();
    if (!items.length) {
      this.listEl.replaceChildren(h('p', { class: 'hint' }, 'Nothing saved yet. Name the current page, spread or book above and save it.'));
      return;
    }
    this.listEl.replaceChildren(...items.map((item) => this.card(item)));
  }

  private card(item: LibraryItem): HTMLElement {
    const thumb = h('div', { class: `thumb ${item.kind}`, role: 'img', 'aria-label': `Thumbnail of ${item.name}` });
    thumb.innerHTML = itemThumb(item);

    const title = this.renaming === item.id
      ? this.renameField(item)
      : h('strong', { class: 'lib-name', title: item.name }, item.name);
    const btn = (help: string, label: string, fn: () => void | Promise<void>, title?: string) =>
      h('button', { type: 'button', title, 'data-help': `library-${help}`, onclick: () => void fn() }, label);

    const actions: HTMLElement[] = [
      btn('open', 'Open', () => {
        if (item.kind === 'page') this.host.openPage(item.data);
        else if (item.kind === 'spread') this.host.openSpread(item.data);
        else this.host.openBook(item.data);
        this.close();
      }, item.kind === 'page' ? 'Edit this page on its own' : item.kind === 'spread' ? 'Edit this spread' : 'Arrange this book'),
    ];
    if (item.kind === 'page') {
      const place = (side: SpreadSide) => () => { this.host.placePage(item.data, side); this.close(); };
      actions.push(btn('left', '→ Left', place('left'), 'Use as the left page of the spread'), btn('right', '→ Right', place('right'), 'Use as the right page of the spread'));
    }
    actions.push(
      btn('rename', 'Rename', () => { this.renaming = item.id; return this.renderList(); }),
      btn('duplicate', 'Duplicate', async () => { await this.library.duplicate(item.id); await this.renderList(); }),
      btn('delete', 'Delete', async () => {
        if (!confirm(`Delete the saved ${item.kind} “${item.name}”? This can’t be undone.`)) return;
        await this.library.remove(item.id);
        await this.renderList();
      }),
    );
    return h('article', { class: 'lib-card' }, thumb,
      h('div', { class: 'lib-meta' }, title, h('span', { class: 'hint' }, `${item.kind} · ${when(item.updated)}`)),
      h('div', { class: 'lib-actions' }, ...actions));
  }

  private renameField(item: LibraryItem): HTMLElement {
    const input = h('input', { type: 'text', value: item.name, 'aria-label': 'New name', 'data-help': 'library-rename-field', maxlength: 80 });
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit) await this.library.rename(item.id, input.value);
      await this.renderList();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') void finish(true); else if (e.key === 'Escape') { e.stopPropagation(); void finish(false); } };
    input.onblur = () => void finish(true);
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }

  // ---- backup ---------------------------------------------------------------

  private async exportBackup() {
    const file = await this.library.exportAll();
    const day = file.exported.slice(0, 10);
    this.host.download(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }), `dotwork-library-${day}.json`);
  }

  private async importBackup(f: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch (err) {
      this.say(`${f.name} is not valid JSON: ${(err as Error).message}`);
      return;
    }
    const r = await this.library.importFile(parsed);
    if (!r.ok) {
      this.say([`Not imported: ${f.name} breaks the library format.`, ...r.issues.slice(0, 12).map(formatIssue), ...(r.issues.length > 12 ? [`…and ${r.issues.length - 12} more.`] : [])]);
    } else {
      this.say(`Imported ${r.added} new and ${r.replaced} replaced from ${f.name}.`);
    }
    await this.renderList();
  }
}
