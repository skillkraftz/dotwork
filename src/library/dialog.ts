import { GRID_X_MM, GRID_Y_MM, PITCH_MM, emptyPage, type Page } from '../format/types';
import type { Spread, SpreadSide } from '../format/spread';
import { bookPage, type Book } from '../book/book';
import type { Block } from '../book/outline';
import { h, tabBar } from '../panel';
import { errorProblem, issuesProblem, problemView, type Problem } from '../problems';
import { slug } from '../slug';
import { pageContent, thumbnailSvg } from '../render';
import { placeWidget, widgetSize, type Widget, type WidgetStore } from '../widgets';
import type { PrintSettings } from '../book/impose';
import oflUrl from '../fonts/OFL.txt?url';
import type { BookTemplate } from '../builtin/templates';
import { isOldFormat, type Library, type LibraryItem } from './library';
import { printerRows, restoreBackup, summaryProblem } from './backup';
import type { Favorites } from './favorites';
import { TABS, TAB_LABEL, artId, exampleId, sectionId, spreadId, templateId, visibleEntries, widgetId, type Entry, type LibraryTab } from './browse';
import { TemplateDialog } from './templatedialog';
import { TEMPLATES } from '../builtin/templates';
import { BUILTIN_ART, BUILTIN_NOTICES, BUILTIN_SPREADS, BUILTIN_WIDGETS } from '../builtin/library';
import { BUILTIN_SECTIONS } from '../builtin/sections';
import type { Section } from '../book/sections';
import { importArtFile } from '../art/report';

/** What the dialog needs from the editor around it. */
export interface LibraryHost {
  view(): 'page' | 'spread' | 'book';
  /** The built-in example pages, listed with the saved pages. Opening or placing one makes a copy. */
  examples: readonly Page[];
  widgets: WidgetStore;
  favorites: Favorites;
  /** In a spread, the side a tapped page is placed on; null when it should open on its own. */
  pageTarget(): SpreadSide | null;
  /** Open a page: a saved one (its `id`) or a built-in (`id` null, read-only until copied). The open one is written first. */
  openPage(page: Page, id: string | null): void;
  openSpread(spread: Spread, id: string | null): void;
  /** Ask for a name in a small window; null if it was cancelled. */
  askName(title: string, initial: string): Promise<string | null>;
  /** A saved page or spread was renamed or removed here, in case it is the one open. */
  renamed(id: string, name: string): void;
  removed(id: string): void;
  /** Open a book: a saved one (its `id`) or a built-in, such as a template's (`id` null, read-only until copied). The open one is written first. */
  openBook(book: Book, id: string | null): void;
  /** A book made just now (from a template that asked questions): added to the Library under its name and opened, ready to edit. */
  addBook(book: Book): void;
  /** The printer profile in use, and a way to replace it (null if saved, or the reason the browser refused). */
  printer: { get(): PrintSettings; set(next: PrintSettings): Problem | null };
  placePage(page: Page, side: SpreadSide): void;
  /** Arm the widget tool, ready to be put on the page. */
  useWidget(widget: Widget): void;
  /** Arm the art tool: drag a rectangle on the page for the art to fill, or tap to put it down at its first size. */
  useArt(art: Widget): void;
  download(blob: Blob, filename: string): void;
  /** The window was closed; anything that lists the library can refresh. */
  closed?(): void;
}

/** A block's first page, for a thumbnail: a spread shows its two pages. */
const blockPages = (b: Block | undefined): Page[] => (!b || b.type === 'free' ? [{ ...emptyPage(), name: 'Blank' }] : b.type === 'spread' ? [b.left, b.right] : b.type === 'group' ? blockPages(b.children[0]) : [b.page ?? { ...emptyPage(), name: 'Blank' }]);

const itemThumb = (e: Entry): string =>
  (e.kind === 'book' || e.kind === 'section') && e.old ? thumbnailSvg([{ ...emptyPage(), name: 'Old format' }])
  : e.kind === 'page' ? thumbnailSvg([e.data])
    : e.kind === 'spread' ? thumbnailSvg([e.data.left, e.data.right])
      : e.kind === 'section' ? thumbnailSvg(blockPages(e.data.children[0]))
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

/** "4 blocks". */
const sectionMeta = (s: Section) => `${s.children.length} block${s.children.length === 1 ? '' : 's'}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const KIND_LABEL = { page: 'Page', spread: 'Spread', section: 'Section', book: 'Book', widget: 'Widget', art: 'Art', template: 'Book template' } as const;
/** Where the library opens: on pages (in a spread they are what you place), or on books when arranging one. */
const VIEW_TAB = { page: 'pages', spread: 'pages', book: 'books' } as const;
const KIND_TAB = { page: 'pages', spread: 'spreads', section: 'sections', book: 'books' } as const;
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
  private artRow = h('div', { class: 'lib-save', hidden: true });
  private search = h('input', { type: 'text', 'aria-label': 'Search by name', placeholder: 'Search by name', 'data-help': 'library-search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  private tabsBar = tabBar('Library sections', TABS.map((t) => [t, TAB_LABEL[t]] as [LibraryTab, string]), 'library-tab',
    (t) => { this.tab = t; this.menuFor = null; this.renderTabs(); void this.renderList(); });
  private tab: LibraryTab = 'pages';
  private templates = new TemplateDialog();
  private renaming: string | null = null;
  private menuFor: string | null = null;

  constructor(private library: Library, private host: LibraryHost) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-key': 'library-restore-file' });
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

  // ---- the list -------------------------------------------------------------

  private async entries(): Promise<Entry[]> {
    const saved = (await this.library.list()).map((i): Entry => {
      if (i.kind === 'widget') return { kind: 'widget', id: i.id, name: i.name, updated: i.updated, example: false, data: { id: i.id, name: i.name, elements: i.data.elements } };
      if (i.kind === 'art') return { kind: 'art', id: i.id, name: i.name, updated: i.updated, example: false, data: { id: i.id, name: i.name, elements: i.data.elements } };
      return { ...i, example: false, ...(isOldFormat(i) ? { old: true } : {}) } as Entry;
    });
    const examples = this.host.examples.map((data): Entry => ({ kind: 'page', id: exampleId(data), name: data.name, updated: null, example: true, data }));
    const spreads = BUILTIN_SPREADS.map((data): Entry => ({ kind: 'spread', id: spreadId(data), name: data.name, updated: null, example: true, data }));
    const sections = BUILTIN_SECTIONS.map((data): Entry => ({ kind: 'section', id: sectionId(data), name: data.name, updated: null, example: true, data }));
    const templates = TEMPLATES.map((data): Entry => ({ kind: 'template', id: templateId(data), name: data.name, updated: null, example: true, data }));
    const builtinWidgets = BUILTIN_WIDGETS.map((data): Entry => ({ kind: 'widget', id: widgetId(data), name: data.name, updated: null, example: true, data }));
    const art = BUILTIN_ART.map((data): Entry => ({ kind: 'art', id: artId(data), name: data.name, updated: null, example: true, data }));
    return [...saved, ...examples, ...spreads, ...sections, ...templates, ...builtinWidgets, ...art];
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
        pages: 'No pages yet. Draw on a page and it is kept here as you go.',
        spreads: 'No spreads yet. Draw on a spread and it is kept here as you go.',
        sections: 'No sections yet. In the Book view, More, Save pages as a section.',
        art: 'No art yet. Import an SVG file with the button above.',
        books: 'No books yet. In the Book view, New starts one, or build one from a template here.',
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
      // A template that asks for a year or a month makes a book of its own at once; one with no questions opens read-only.
      this.templates.open(e.data, (book) => (e.data.fields.length ? this.host.addBook(book) : this.host.openBook(book, null)));
      return;
    }
    if (e.kind === 'section') {
      if (e.old) this.say(`“${e.name}” is in the old format and can’t be opened. Export keeps a copy of the file; Delete removes it.`);
      else this.say(`“${e.name}” is a group of blocks. In the Book view, tap Add…, then Other, and pick it there.`);
      return;
    }
    if (e.kind === 'book' && e.old) {
      this.say(`“${e.name}” is in the old format and can’t be opened. Export keeps a copy of the file; Delete removes it.`);
      return;
    }
    // A built-in opens read-only; editing it asks for a name and makes a copy.
    if (e.kind === 'page') {
      const side = this.host.pageTarget();
      if (side) this.host.placePage(e.data, side); else this.host.openPage(e.data, e.example ? null : e.id);
    } else if (e.kind === 'spread') this.host.openSpread(e.data, e.example ? null : e.id);
    else if (e.kind === 'book') this.host.openBook(e.data, e.example ? null : e.id);
    else if (e.kind === 'art') this.host.useArt(e.data);
    else this.host.useWidget(e.data);
    this.close();
  }

  private card(e: Entry): HTMLElement {
    const thumb = h('div', { class: `thumb ${e.kind}`, role: 'img', 'aria-label': `Thumbnail of ${e.name}` });
    thumb.innerHTML = itemThumb(e);
    const starred = this.host.favorites.has(e.id);
    const title = this.renaming === e.id ? this.renameField(e) : h('strong', { class: 'lib-name', title: e.name }, e.name);
    const old = (e.kind === 'book' || e.kind === 'section') && e.old;
    const meta = [KIND_LABEL[e.kind], old ? 'Old format' : e.kind === 'section' ? sectionMeta(e.data) : '', e.example && e.kind !== 'template' ? 'example' : e.updated ? when(e.updated) : ''].filter(Boolean).join(' · ');
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
    return e.kind === 'section' || ((e.kind === 'book') && e.old) ? 'About' : e.kind === 'widget' ? 'Use widget' : e.kind === 'art' ? 'Place art' : e.kind === 'template' ? 'Build a book from' : e.kind === 'page' && this.host.pageTarget() ? `Place on the ${this.host.pageTarget()} page:` : 'Open';
  }

  /** Rename, duplicate and delete; the built-in examples can only be copied. A section can also be exported. */
  private menu(e: Entry): HTMLElement {
    const item = (help: string, label: string, fn: () => void | Promise<void>) =>
      h('button', { type: 'button', role: 'menuitem', 'data-key': `library-${help}`, 'data-help': `library-${help}`, onclick: () => { this.menuFor = null; void fn(); } }, label);
    const items: HTMLElement[] = [];
    if ((e.kind === 'book' || e.kind === 'section') && e.old) {
      items.push(item('export-file', 'Export', () => this.exportFile(e.name, e.kind, e.data)), item('delete', 'Delete', () => this.remove(e)));
      return h('div', { class: 'menu-list lib-menu', role: 'menu', 'aria-label': `${e.name} menu` }, ...items);
    }
    if (!e.example) items.push(item('rename', 'Rename', () => { this.renaming = e.id; return this.renderList(); }));
    items.push(item('duplicate', 'Duplicate', () => this.duplicate(e)));
    if (e.kind === 'section') items.push(item('export-file', 'Export', () => this.exportFile(e.name, 'section', e.data)));
    if (!e.example) items.push(item('delete', 'Delete', () => this.remove(e)));
    return h('div', { class: 'menu-list lib-menu', role: 'menu', 'aria-label': `${e.name} menu` }, ...items);
  }

  private async duplicate(e: Entry) {
    try { await this.copy(e); } catch (err) { this.say(errorProblem('Not duplicated.', err)); return; }
    await this.renderList();
  }

  /** Download a section, or a book in the old format, as its own file. */
  private exportFile(name: string, kind: string, data: unknown) {
    this.host.download(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }), `${slug(name, kind)}.json`);
  }

  private async remove(e: Entry) {
    if (!confirm(`Delete the saved ${e.kind} “${e.name}”? This can’t be undone.`)) { await this.renderList(); return; }
    try { await this.library.remove(e.id); } catch (err) { this.say(errorProblem('Not deleted.', err)); return; }
    if (isWidgetKind(e)) await this.host.widgets.refresh(); else this.host.removed(e.id);
    await this.renderList();
  }

  private async copy(e: Entry) {
    if (e.kind === 'template') return;
    if (isWidgetKind(e)) {
      // A widget or art, saved or built in: the copy is a document of its own, named like the original plus “copy”.
      const copy = await this.host.widgets.add(`${e.name} copy`, e.data.elements);
      this.tab = e.kind === 'art' ? 'art' : 'widgets';
      this.renderTabs();
      this.say(`Saved a copy of “${e.name}” as “${copy.name}”.`);
      return;
    }
    // A page, spread, book or section, built-in or saved: ask for a name, prefilled, and keep the copy as a document of its own.
    const name = await this.host.askName(`Name the copy of “${e.name}”`, `${e.name} copy`);
    if (name === null) return;
    const saved = await this.library.create(e.kind, name, e.data);
    this.tab = KIND_TAB[e.kind];
    this.renderTabs();
    this.say(`Saved a copy of “${e.name}” as “${saved.name}”.`);
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
          const name = await this.library.rename(e.id, input.value);
          if (name) { this.host.renamed(e.id, name); if (isWidgetKind(e)) await this.host.widgets.refresh(); }
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
    const file = await this.library.exportAll({ favorites: this.host.favorites.list(), printer: this.host.printer.get() });
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
    let r: Awaited<ReturnType<typeof restoreBackup>>;
    try {
      r = await restoreBackup(this.library, this.host.favorites, parsed, this.host.printer.get());
    } catch (err) {
      this.say(errorProblem(`Not restored: the library couldn’t be read from ${f.name}.`, err));
      return;
    }
    if (!r.ok) {
      this.say(issuesProblem(`Not restored: ${f.name} breaks the library format. Nothing was added.`, r.issues));
      return;
    }
    await this.host.widgets.refresh();
    this.say(summaryProblem(f.name, r.summary));
    if (r.summary.printer) this.msgEl.append(this.printerQuestion(r.summary.printer));
    await this.renderList();
  }

  /** "Replace your printer settings with the backup's?" with both sets of values. The default is No. */
  private printerQuestion(theirs: PrintSettings): HTMLElement {
    const mine = this.host.printer.get();
    const rows = printerRows(mine, theirs);
    const answer = (replace: boolean) => {
      const problem = replace ? this.host.printer.set(theirs) : null;
      box.replaceWith(h('p', { class: 'hint', 'data-key': 'restore-printer-answer' }, replace ? (problem ? 'The settings are in use for this visit only; the browser would not keep them.' : 'Your printer settings are now the backup’s.') : 'Your printer settings were kept.'));
    };
    const keep = h('button', { type: 'button', class: 'primary', 'data-key': 'restore-printer-keep', 'data-help': 'restore-printer-keep', onclick: () => answer(false) }, 'No, keep mine');
    const box = h('div', { class: 'restore-printer', role: 'group', 'aria-label': 'Printer settings in the backup', 'data-key': 'restore-printer' },
      h('p', { class: 'problem-title' }, 'Replace your printer settings with the backup’s?'),
      h('div', { class: 'restore-rows' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Yours'), h('th', {}, 'Backup'))),
          h('tbody', {}, ...rows.map((r) => h('tr', { class: r.mine === r.theirs ? '' : 'differs' }, h('td', {}, r.label), h('td', {}, r.mine), h('td', {}, r.theirs)))))),
      h('div', { class: 'problem-actions' },
        keep,
        h('button', { type: 'button', 'data-key': 'restore-printer-replace', 'data-help': 'restore-printer-replace', onclick: () => answer(true) }, 'Yes, replace')));
    return box;
  }
}

export type { LibraryItem };
