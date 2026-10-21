import { readPage } from '../format/read';
import { GRID_X_MM, GRID_Y_MM, PITCH_MM, emptyPage, type Page } from '../format/types';
import { readSpread, type Spread, type SpreadSide } from '../format/spread';
import { readBook, bookPage, type Book } from '../book/book';
import { h, tabBar } from '../panel';
import { errorProblem, issuesProblem, problemView, type Problem } from '../problems';
import { pageContent, thumbnailSvg } from '../render';
import { placeWidget, widgetSize, type Widget, type WidgetStore } from '../widgets';
import oflUrl from '../fonts/OFL.txt?url';
import type { BookTemplate } from '../builtin/templates';
import type { Library, LibraryItem } from './library';
import type { Favorites } from './favorites';
import { TABS, TAB_LABEL, artId, exampleId, spreadId, templateId, visibleEntries, widgetId, type Entry, type LibraryTab } from './browse';
import { TemplateDialog } from './templatedialog';
import { TEMPLATES } from '../builtin/templates';
import { BUILTIN_ART, BUILTIN_NOTICES, BUILTIN_SPREADS, BUILTIN_WIDGETS, asCopy } from '../builtin/library';
import { isArtWidget } from '../art/widget';
import { importArtFile } from '../art/report';

/** What can be saved from the editor right now. */
export type SaveWhat = 'page' | 'spread' | 'left' | 'right' | 'book';

export interface SaveOption { what: SaveWhat; label: string; name: string }

/** What the dialog needs from the editor around it. */
export interface LibraryHost {
  view(): 'page' | 'spread' | 'book';
  saveOptions(): SaveOption[];
  data(what: SaveWhat): Page | Spread | Book;
  /** The built-in example pages, listed with the saved pages. Opening or placing one makes a copy. */
  examples: readonly Page[];
  widgets: WidgetStore;
  favorites: Favorites;
  /** In a spread, the side a tapped page is placed on; null when it should open on its own. */
  pageTarget(): SpreadSide | null;
  openPage(page: Page): void;
  openSpread(spread: Spread): void;
  /** `fresh` is for a book made just now from a template, which takes the printer's saved print settings. */
  openBook(book: Book, fresh?: boolean): void;
  placePage(page: Page, side: SpreadSide): void;
  /** Arm the widget tool, ready to be put on the page. */
  useWidget(widget: Widget): void;
  /** Arm the art tool: drag a rectangle on the page for the art to fill, or tap to put it down at its first size. */
  useArt(art: Widget): void;
  download(blob: Blob, filename: string): void;
  /** The window was closed; anything that lists the library can refresh. */
  closed?(): void;
}

const itemThumb = (e: Entry): string =>
  e.kind === 'page' ? thumbnailSvg([e.data])
    : e.kind === 'spread' ? thumbnailSvg([e.data.left, e.data.right])
      : e.kind === 'book' ? thumbnailSvg([bookPage(e.data, 0), bookPage(e.data, 1)]) // a book shows as its first spread
        : e.kind === 'template' ? templateThumb(e.data)
          : widgetThumbnail(e.data);

const templateThumbs = new Map<string, string>();
/** A template shows the first spread of the book it builds with its default answers. */
function templateThumb(t: BookTemplate): string {
  let svg = templateThumbs.get(t.id);
  if (!svg) {
    const book = t.build();
    svg = thumbnailSvg([bookPage(book, 0), bookPage(book, 1)]);
    templateThumbs.set(t.id, svg);
  }
  return svg;
}

/** A widget drawn on its own, cropped to the cells it covers. */
export function widgetThumbnail(widget: Widget): string {
  const { w, h: hh } = widgetSize(widget);
  const page: Page = { ...emptyPage(), elements: placeWidget(widget, { x: 0, y: 1 }) };
  const pad = 2, x = GRID_X_MM - pad, y = GRID_Y_MM + PITCH_MM - pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w * PITCH_MM + 2 * pad} ${hh * PITCH_MM + 2 * pad}" role="img">${pageContent(page, { mode: 'export', pageNumber: null })}</svg>`;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const KIND_LABEL = { page: 'Page', spread: 'Spread', book: 'Book', widget: 'Widget', art: 'Art', template: 'Book template' } as const;
/** Where the library opens: on pages (in a spread they are what you place), or on books when arranging one. */
const VIEW_TAB = { page: 'pages', spread: 'pages', book: 'books' } as const;
const KIND_TAB = { page: 'pages', spread: 'spreads', book: 'books' } as const;
const isWidgetKind = (e: Entry): e is Extract<Entry, { kind: 'widget' | 'art' }> => e.kind === 'widget' || e.kind === 'art';

/**
 * The library browser: search, tabs for pages, spreads, art, books, widgets and favorites, a star on every item, and the
 * built-in examples listed beside what is saved. Tapping an item opens or places it; renaming, duplicating and deleting
 * are in the ⋯ menu on each one.
 */
export class LibraryDialog {
  private dialog: HTMLDialogElement;
  private msgEl = h('p', { class: 'lib-msg', role: 'status', hidden: true });
  private listEl = h('div', { class: 'lib-list' });
  private saveRow = h('div', { class: 'lib-save' });
  private artRow = h('div', { class: 'lib-save', hidden: true });
  private search = h('input', { type: 'text', 'aria-label': 'Search by name', placeholder: 'Search by name', 'data-help': 'library-search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  private tabsBar = tabBar('Library sections', TABS.map((t) => [t, TAB_LABEL[t]] as [LibraryTab, string]), 'library-tab',
    (t) => { this.tab = t; this.menuFor = null; this.renderTabs(); void this.renderList(); });
  private tab: LibraryTab = 'pages';
  private templates = new TemplateDialog();
  private renaming: string | null = null;
  private menuFor: string | null = null;

  constructor(private library: Library, private host: LibraryHost) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) await this.importBackup(f);
    };
    const svgFile = h('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: true, 'data-key': 'art-file' });
    svgFile.onchange = async () => {
      const f = svgFile.files?.[0];
      svgFile.value = '';
      if (f) await this.importArt(f);
    };
    this.artRow.append(
      h('button', { type: 'button', class: 'primary', 'data-key': 'library-art-import', 'data-help': 'library-art-import', onclick: () => svgFile.click() }, 'Import SVG art'),
      h('span', { class: 'hint' }, 'Shapes and colors come in; text, images and effects are left out.'),
      svgFile);
    this.search.oninput = () => void this.renderList();
    this.dialog = h('dialog', { class: 'library browser', 'aria-label': 'Library' },
      h('header', {},
        h('h2', {}, 'Library'),
        h('button', { type: 'button', 'data-help': 'library-close', onclick: () => this.dialog.close() }, 'Close')),
      this.saveRow,
      this.artRow,
      h('div', { class: 'lib-find' }, this.search, this.tabsBar.el),
      this.msgEl,
      this.listEl,
      h('footer', {},
        h('button', { type: 'button', 'data-help': 'library-export', onclick: () => this.exportBackup() }, 'Back up library'),
        h('button', { type: 'button', 'data-help': 'library-import', onclick: () => file.click() }, 'Restore backup'),
        file,
        h('span', { class: 'hint' }, 'Courier Prime © The Courier Prime Project Authors, ',
          h('a', { href: oflUrl, target: '_blank', rel: 'noopener', 'data-help': 'credits-link' }, 'SIL OFL 1.1'), '.')),
    );
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
      else if (this.menuFor && !(e.target as HTMLElement).closest('.lib-more, .lib-menu')) { this.menuFor = null; void this.renderList(); }
    });
    this.dialog.addEventListener('close', () => host.closed?.());
    host.widgets.subscribe(() => { if (this.dialog.open) void this.renderList(); });
    document.body.append(this.dialog);
  }

  async show() {
    this.renaming = null;
    this.menuFor = null;
    this.search.value = '';
    this.tab = VIEW_TAB[this.host.view()];
    this.say(null);
    this.renderSave();
    this.renderTabs();
    await this.renderList();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private say(message: string | string[] | Problem | null) {
    if (message !== null && typeof message === 'object' && 'details' in message) {
      this.msgEl.replaceChildren(problemView(message));
      this.msgEl.hidden = false;
      return;
    }
    const lines = message === null ? [] : Array.isArray(message) ? message : [message];
    this.msgEl.replaceChildren(...lines.map((l) => h('span', {}, l)));
    this.msgEl.hidden = lines.length === 0;
  }

  private close() { if (this.dialog.open) this.dialog.close(); }

  private renderTabs() {
    this.tabsBar.select(this.tab);
    this.artRow.hidden = this.tab !== 'art';
  }

  /** Read an SVG file into the saved art, and say what came in and what was left out. */
  private async importArt(file: File) {
    const r = await importArtFile(file, this.host.widgets);
    if (!r.ok) { this.say(r.problem); return; }
    this.say(r.problem ?? `Imported “${r.name}”. Tap it, then drag a rectangle on the page for it.`);
    if (r.problem) this.msgEl.prepend(h('p', {}, `Tap “${r.name}”, then drag a rectangle on the page for it.`));
    await this.renderList();
  }

  // ---- saving ---------------------------------------------------------------

  /** One button per thing that can be saved: it is saved under its own name (set in Settings). */
  private renderSave() {
    this.saveRow.replaceChildren(...this.host.saveOptions().map((o) => h('button', {
      type: 'button', class: 'primary', 'data-key': `library-save-${o.what}`, 'data-help': 'library-save', title: `Save under the name “${o.name}”`,
      onclick: () => void this.save(o),
    }, `Save ${o.label.toLowerCase()}`)));
  }

  private async save(option: SaveOption) {
    const { what, name } = option;
    const kind = what === 'spread' ? 'spread' : what === 'book' ? 'book' : 'page';
    const existing = await this.library.findByName(kind, name);
    if (existing && !confirm(`Replace the saved ${kind} “${existing.name}”?`)) return;
    const data = this.host.data(what);
    const check = kind === 'spread' ? readSpread(data) : kind === 'book' ? readBook(data) : readPage(data);
    if (!check.ok) {
      this.say(issuesProblem(`Not saved: the ${kind} breaks the format.`, check.issues));
      return;
    }
    let item: LibraryItem;
    try {
      item = kind === 'spread' ? await this.library.save('spread', name, data as Spread)
        : kind === 'book' ? await this.library.save('book', name, data as Book)
          : await this.library.save('page', name, data as Page);
    } catch (err) {
      this.say(errorProblem('Not saved.', err)); // a built-in's name, or the browser's storage refusing
      return;
    }
    this.say(`Saved ${kind} “${item.name}” to the library.`);
    this.tab = KIND_TAB[kind];
    this.renderTabs();
    await this.renderList();
  }

  // ---- the list -------------------------------------------------------------

  private async entries(): Promise<Entry[]> {
    const saved = (await this.library.list()).map((i): Entry => ({ ...i, updated: i.updated, example: false }) as Entry);
    const examples = this.host.examples.map((data): Entry => ({ kind: 'page', id: exampleId(data), name: data.name, updated: null, example: true, data }));
    const spreads = BUILTIN_SPREADS.map((data): Entry => ({ kind: 'spread', id: spreadId(data), name: data.name, updated: null, example: true, data }));
    const templates = TEMPLATES.map((data): Entry => ({ kind: 'template', id: templateId(data), name: data.name, updated: null, example: true, data }));
    const widgets = this.host.widgets.list().filter((w) => !isArtWidget(w)).map((data): Entry => ({ kind: 'widget', id: widgetId(data), name: data.name, updated: null, example: false, data }));
    const builtinWidgets = BUILTIN_WIDGETS.map((data): Entry => ({ kind: 'widget', id: widgetId(data), name: data.name, updated: null, example: true, data }));
    const art = [...this.host.widgets.list().filter(isArtWidget).map((data) => [data, false] as const), ...BUILTIN_ART.map((data) => [data, true] as const)]
      .map(([data, example]): Entry => ({ kind: 'art', id: artId(data), name: data.name, updated: null, example, data }));
    return [...saved, ...examples, ...spreads, ...templates, ...widgets, ...builtinWidgets, ...art];
  }

  /** Counts the draws, so that a slow one can't land after a newer one and show an old search. */
  private drawn = 0;

  /** What the built-ins of this tab are missing, one line each. */
  private notices(tab: LibraryTab): HTMLElement[] {
    return BUILTIN_NOTICES.filter((n) => n.tab === tab).map((n) => h('p', { class: 'hint lib-notice', 'data-key': 'library-notice' }, n.text));
  }

  private async renderList() {
    const run = ++this.drawn;
    const query = this.search.value, tab = this.tab;
    const entries = await this.entries();
    if (run !== this.drawn) return;
    const shown = visibleEntries(entries, tab, query, (id) => this.host.favorites.has(id));
    if (!shown.length) {
      const empty: Record<LibraryTab, string> = {
        pages: 'No pages yet. Save the page you are editing with the button above.',
        spreads: 'No spreads yet. Save the spread you are editing with the button above.',
        art: 'No art yet. Import an SVG file with the button above.',
        books: 'No books yet. Save the book you are arranging with the button above.',
        widgets: 'No widgets yet. Select elements on a page, then More, Save as widget.',
        favorites: 'Nothing starred yet. Tap the star on anything to find it here.',
      };
      this.listEl.replaceChildren(...this.notices(tab), h('p', { class: 'hint', 'data-key': 'library-empty' }, query.trim() ? `Nothing in ${TAB_LABEL[this.tab]} matches “${query.trim()}”.` : empty[this.tab]));
      return;
    }
    this.listEl.replaceChildren(...this.notices(tab), ...shown.map((e) => this.card(e)));
  }

  /** Tapping the item: open it, put it on the spread page being edited, or arm the widget tool. */
  private use(e: Entry) {
    if (e.kind === 'template') {
      this.close();
      this.templates.open(e.data, (book) => this.host.openBook(book, true));
      return;
    }
    // A built-in can't be changed, so what opens or is placed is a copy under its own name plus “copy”.
    if (e.kind === 'page') {
      const page = e.example ? asCopy(e.data) : e.data, side = this.host.pageTarget();
      if (side) this.host.placePage(page, side); else this.host.openPage(page);
    } else if (e.kind === 'spread') this.host.openSpread(e.example ? asCopy(e.data) : e.data);
    else if (e.kind === 'book') this.host.openBook(e.data);
    else if (e.kind === 'art') this.host.useArt(e.data);
    else this.host.useWidget(e.data);
    this.close();
  }

  private card(e: Entry): HTMLElement {
    const thumb = h('div', { class: `thumb ${e.kind}`, role: 'img', 'aria-label': `Thumbnail of ${e.name}` });
    thumb.innerHTML = itemThumb(e);
    const starred = this.host.favorites.has(e.id);
    const title = this.renaming === e.id ? this.renameField(e) : h('strong', { class: 'lib-name', title: e.name }, e.name);
    const meta = [KIND_LABEL[e.kind], e.example && e.kind !== 'template' ? 'example' : e.updated ? when(e.updated) : e.kind === 'widget' ? `${e.data.elements.length} element${e.data.elements.length === 1 ? '' : 's'}` : e.kind === 'art' ? 'imported' : ''].filter(Boolean).join(' · ');
    const open = h('button', {
      type: 'button', class: 'lib-open', 'data-key': 'library-item', 'data-help': 'library-item', 'data-kind': e.kind, 'aria-label': `${this.openVerb(e)} ${e.name}`,
      onclick: () => this.use(e),
    }, thumb);
    const star = h('button', {
      type: 'button', class: 'lib-star', 'data-key': 'library-star', 'data-help': 'library-star', 'aria-pressed': String(starred), 'aria-label': starred ? `Unstar ${e.name}` : `Star ${e.name}`,
      onclick: () => { this.host.favorites.toggle(e.id); void this.renderList(); },
    }, starred ? '★' : '☆');
    const more = h('button', {
      type: 'button', class: 'lib-more', 'data-key': 'library-more', 'data-help': 'library-more', 'aria-haspopup': 'menu', 'aria-expanded': String(this.menuFor === e.id), 'aria-label': `More for ${e.name}`,
      onclick: () => { this.menuFor = this.menuFor === e.id ? null : e.id; void this.renderList(); },
    }, '⋯');
    return h('article', { class: `lib-card${this.menuFor === e.id ? ' menu-open' : ''}`, 'data-name': e.name },
      open,
      h('div', { class: 'lib-meta' }, title, h('span', { class: 'hint' }, meta)),
      h('div', { class: 'lib-tools' }, star, e.kind === 'template' ? null : more),
      this.menuFor === e.id ? this.menu(e) : null);
  }

  private openVerb(e: Entry) {
    return e.kind === 'widget' ? 'Use widget' : e.kind === 'art' ? 'Place art' : e.kind === 'template' ? 'Build a book from' : e.kind === 'page' && this.host.pageTarget() ? `Place on the ${this.host.pageTarget()} page:` : 'Open';
  }

  /** Rename, duplicate and delete; the built-in examples can only be copied. */
  private menu(e: Entry): HTMLElement {
    const item = (help: string, label: string, fn: () => void | Promise<void>) =>
      h('button', { type: 'button', role: 'menuitem', 'data-key': `library-${help}`, 'data-help': `library-${help}`, onclick: () => { this.menuFor = null; void fn(); } }, label);
    const items: HTMLElement[] = [];
    if (!e.example) items.push(item('rename', 'Rename', () => { this.renaming = e.id; return this.renderList(); }));
    items.push(item('duplicate', 'Duplicate', () => this.duplicate(e)));
    if (!e.example) {
      items.push(item('delete', 'Delete', async () => {
        if (!confirm(`Delete the saved ${e.kind} “${e.name}”? This can’t be undone.`)) { await this.renderList(); return; }
        if (isWidgetKind(e)) this.host.widgets.remove(e.data.id); else await this.library.remove(e.id);
        await this.renderList();
      }));
    }
    return h('div', { class: 'menu-list lib-menu', role: 'menu', 'aria-label': `${e.name} menu` }, ...items);
  }

  private async duplicate(e: Entry) {
    try { await this.copy(e); } catch (err) { this.say(errorProblem('Not duplicated.', err)); return; }
    await this.renderList();
  }

  private async copy(e: Entry) {
    if (e.kind === 'template') return;
    if (isWidgetKind(e)) this.host.widgets.add(`${e.name} copy`, e.data.elements);
    else if (e.example) {
      const copy = asCopy(e.data as Page | Spread);
      const saved = e.kind === 'spread' ? await this.library.save('spread', copy.name, copy as Spread) : await this.library.save('page', copy.name, copy as Page);
      this.tab = e.kind === 'spread' ? 'spreads' : 'pages';
      this.renderTabs();
      this.say(`Saved a copy of “${e.name}” to your ${e.kind}s as “${saved.name}”.`);
    } else await this.library.duplicate(e.id);
  }

  private renameField(e: Entry): HTMLElement {
    const input = h('input', { type: 'text', value: e.name, 'aria-label': 'New name', 'data-help': 'library-rename-field', maxlength: 80 });
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit) {
        try {
          if (isWidgetKind(e)) this.host.widgets.rename(e.data.id, input.value); else await this.library.rename(e.id, input.value);
        } catch (err) { this.say(errorProblem('Not renamed.', err)); }
      }
      await this.renderList();
    };
    input.onkeydown = (ev) => { if (ev.key === 'Enter') void finish(true); else if (ev.key === 'Escape') { ev.stopPropagation(); void finish(false); } };
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
      this.say(errorProblem(`Not restored: ${f.name} is not valid JSON.`, err));
      return;
    }
    let r: Awaited<ReturnType<Library['importFile']>>;
    try {
      r = await this.library.importFile(parsed);
    } catch (err) {
      this.say(errorProblem(`Not restored: the library couldn’t be written from ${f.name}.`, err)); // e.g. the browser's storage is full
      return;
    }
    if (!r.ok) {
      this.say(issuesProblem(`Not restored: ${f.name} breaks the library format.`, r.issues));
    } else {
      this.say(`Imported ${r.added} new and ${r.replaced} replaced from ${f.name}.`);
    }
    await this.renderList();
  }
}

export type { LibraryItem };
