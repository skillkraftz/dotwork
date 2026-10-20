import './style.css';
import { keyboardOpen } from './keyboard';
import { emptyPage, type Page } from './format/types';
import { buildSpread, emptySpread, readSpread, withSide, type Spread, type SpreadSide } from './format/spread';
import { validatePage, type ValidationIssue } from './format/validate';
import { readPage } from './format/read';
import { Canvas, type CanvasHooks } from './canvas';
import { contextActions, deleteElement, duplicateElement, groupAction, moreActions, nudgeElement, selectAll, toggleGroup } from './actions';
import { h, Panel } from './panel';
import { closeContextMenu, showContextMenu } from './ctxmenu';
import { isCompact, Sheet } from './sheet';
import { Toolbar, modeOfTool, type BarMode } from './toolbar';
import { Store, type Tool } from './store';
import { Library, MemoryBackend } from './library/library';
import { Favorites } from './library/favorites';
import { idbBackend } from './library/idb';
import { LibraryDialog, type SaveOption, type SaveWhat } from './library/dialog';
import { Arranger } from './book/arranger';
import { emptyBook, readBook, type Book } from './book/book';
import { loadPrinter, printerOf, savePrinter, startingPrint, type PrinterSettings } from './printer';
import { ExportDialog } from './exporter';
import { SettingsDialog } from './settings';
import { checkItem, setupMenus } from './menus';
import { HelpMode } from './helpmode';
import { badDraftProblem, loadDraft as loadStored, saveDraft, type DraftLoad, type DraftStorage } from './drafts';
import { errorProblem, issuesProblem, problemView, type Problem } from './problems';
import { AdvancedPicker, type AdvancedChoice } from './advanced';
import { NameDialog } from './namedialog';
import { WidgetStore } from './widgets';
import { BUILTIN_PAGES, isBuiltinName } from './builtin/library';

const KEYS = { page: 'dotwork.page', left: 'dotwork.spread.left', right: 'dotwork.spread.right' } as const;
const VIEW_KEY = 'dotwork.view';
const BOOK_KEY = 'dotwork.book';
const SPREAD_NAME_KEY = 'dotwork.spread.name';

const examples = BUILTIN_PAGES;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type View = 'page' | 'spread' | 'book';
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

const draftStorage = (): DraftStorage | null => { try { return localStorage; } catch { return null; } };
/** Drafts that couldn't be read at start-up; shown (with the way to get them back) once the screen exists. */
const startupProblems: Problem[] = [];

/** The printer's saved settings (the Calibrate page keeps them), or null until there are some. */
let printerSettings: PrinterSettings | null = (() => {
  const loaded = loadPrinter(draftStorage());
  if (loaded.status === 'bad') startupProblems.push(loaded.problem);
  return loaded.status === 'ok' ? loaded.value : null;
})();

/** Offer a draft that couldn't be read as a download. It is already kept under a backup key. */
function badDraft(label: string, filename: string, d: Extract<DraftLoad<unknown>, { status: 'bad' }>) {
  startupProblems.push(badDraftProblem(label, d, [
    { label: 'Download the draft', help: 'draft-download', run: () => download(new Blob([d.raw], { type: 'application/json' }), filename) },
    { label: 'Start fresh', help: 'draft-fresh', run: () => dismissNotice() },
  ]));
}

function loadDraft(key: string, fallback: Page, label: string, side?: SpreadSide): Page {
  const d = loadStored<Page>(draftStorage(), key, (data) => { const r = readPage(data); return r.ok ? { ok: true, value: r.page } : r; });
  if (d.status === 'ok') return side ? withSide(d.value, side) : d.value;
  if (d.status === 'bad') badDraft(label, `${key.replace('dotwork.', 'dotwork-')}-draft.json`, d);
  return fallback;
}

const blank = emptySpread();
/** The page being edited alone, and the two pages of the spread being edited. Each has its own undo history. */
const stores = {
  page: new Store(loadDraft(KEYS.page, emptyPage(), 'page')),
  left: new Store(loadDraft(KEYS.left, blank.left, 'left page', 'left')),
  right: new Store(loadDraft(KEYS.right, blank.right, 'right page', 'right')),
};
const all = [stores.page, stores.left, stores.right];
const storedView = stored(VIEW_KEY);
let view: View = storedView === 'spread' || storedView === 'book' ? storedView : 'page';
let active: SpreadSide = 'left';
/** The book being arranged and its view; made the first time the book view is shown. */
let book: Book | null = null;
let arranger: Arranger | null = null;
let spreadName = stored(SPREAD_NAME_KEY) || blank.name;
/** The store that undo, the panel and the keyboard act on. */
const cur = () => (view === 'page' ? stores.page : stores[active]);

const widgets = new WidgetStore((() => { try { return localStorage; } catch { return null; } })());
const nameDialog = new NameDialog();

const library = new Library(typeof indexedDB === 'undefined' ? new MemoryBackend() : idbBackend, undefined, undefined, isBuiltinName);

// ---- notices -------------------------------------------------------------

const noticeEl = $('notice');
/** A notice with its own way out (a bad draft) stays until one of its buttons is used, whatever else asks to clear the notice. */
let stickyNotice = false;
function dismissNotice() {
  stickyNotice = false;
  noticeEl.hidden = true;
  noticeEl.replaceChildren();
}
function show(content: HTMLElement[], sticky: boolean) {
  const body = noticeEl.querySelector('.notice-body');
  if (stickyNotice && !sticky && body) { body.append(...content); return; } // keep the draft's way out beside the new message
  const close = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Dismiss' });
  close.dataset.help = 'notice-dismiss';
  close.onclick = dismissNotice;
  stickyNotice = sticky;
  noticeEl.classList.toggle('sticky', sticky);
  noticeEl.replaceChildren(h('div', { class: 'notice-body' }, ...content), close);
  noticeEl.hidden = false;
}
function notify(message: string | string[] | null) {
  if (message === null || (Array.isArray(message) && message.length === 0)) {
    if (!stickyNotice) dismissNotice();
    return;
  }
  show([Array.isArray(message)
    ? h('ul', {}, ...message.map((m) => h('li', {}, m)))
    : h('p', {}, message)], false);
}
/** Problems with their reasons and Copy details; sticky ones stay until dealt with. */
function notifyProblems(problems: Problem[], sticky = false) {
  if (problems.length) show(problems.map(problemView), sticky);
}
notifyProblems(startupProblems, true);

// ---- views ---------------------------------------------------------------

/** What a touch gesture on a page canvas asks of the screen around it. */
function hooksFor(store: () => Store): CanvasHooks {
  return {
    contextMenu: (index, hits, at) => showContextMenu(at, contextActions(store(), index, hits)),
    openProperties: (index) => { store().select(index); showProperties(); },
  };
}
const canvases = {
  page: new Canvas($('canvas') as unknown as SVGSVGElement, stores.page, notify, hooksFor(() => stores.page)),
  left: new Canvas($('canvas-left') as unknown as SVGSVGElement, stores.left, notify, hooksFor(() => stores.left)),
  right: new Canvas($('canvas-right') as unknown as SVGSVGElement, stores.right, notify, hooksFor(() => stores.right)),
};
/** Keep a draft; if it can't be kept, say why (once per reason, so typing doesn't repeat it). */
let lastDraftProblem = '';
function reportDraft(problem: Problem | null) {
  if (!problem) { lastDraftProblem = ''; return; }
  const id = problem.title + problem.lines.join('\n');
  if (id === lastDraftProblem) return;
  lastDraftProblem = id;
  notifyProblems([problem]);
}
function persist(key: string, page: Page) {
  reportDraft(saveDraft(draftStorage(), key, page, 'page', validatePage));
}
function persistSettings() {
  try {
    localStorage.setItem(VIEW_KEY, view);
    localStorage.setItem(SPREAD_NAME_KEY, spreadName);
  } catch { /* ignore */ }
}

/** On a narrow screen: show both pages of the spread side by side, read-only, instead of editing one. */
let showBoth = false;
const panel = new Panel($('panel'), cur());

function refresh() {
  const spread = view === 'spread';
  const book = view === 'book';
  const store = cur();
  const preview = store.mode === 'preview';
  const both = spread && isCompact() && showBoth;
  $('book').hidden = !book;
  $('canvas-wrap').hidden = book;
  $('canvas').toggleAttribute('hidden', spread); // an SVG element has no `hidden` property, only the attribute
  $('spread').hidden = !spread;
  $('spread').classList.toggle('both', both);
  checkItem({ page: $('view-page'), spread: $('view-spread'), book: $('view-book') }, view);
  $('menu-page-label').textContent = { page: 'Page', spread: 'Spread', book: 'Book' }[view];
  for (const id of ['mode-edit', 'mode-preview', 'undo', 'redo']) $(id).hidden = book; // the book has its own undo, and nothing to preview
  $('tools').hidden = book || preview;
  $('spread-bar').hidden = !spread || preview;
  $('layers-button').hidden = book || preview;
  if (book) {
    ensureArranger();
    $('sheet').hidden = true;
    updateBar();
    return;
  }
  canvases.left.readOnly = canvases.right.readOnly = both;
  canvases.page.render();
  if (spread) { canvases.left.render(); canvases.right.render(); }
  for (const half of document.querySelectorAll<HTMLElement>('.half')) {
    half.classList.toggle('active', half.dataset.side === active);
  }
  panel.store = store;
  panel.render();
  $('side-left').setAttribute('aria-pressed', String(!both && active === 'left'));
  $('side-right').setAttribute('aria-pressed', String(!both && active === 'right'));
  $('side-both').setAttribute('aria-pressed', String(both));
  checkItem({ edit: $('mode-edit'), preview: $('mode-preview') }, preview ? 'preview' : 'edit');
  ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !store.canRedo;
  $('sheet').hidden = preview;
  updateBar();
}

const sheet = new Sheet($('sheet'), () => {
  if (sheet.state === 'closed') { panel.flush(); canvasOf(cur()).restoreView(); } else revealSelection();
  updateBar();
});
panel.onTab = () => sheet.open();
panel.openLayer = () => showProperties();

/** The drawer covers the bottom of the page: slide the page so the selection stays in view above it. */
function revealSelection() {
  const inset = sheet.height;
  if (inset > 0) canvasOf(cur()).revealSelection(inset);
}

/** Properties for the selection: the modal on a narrow screen, the side panel's fields on a wide one. */
function showProperties() {
  panel.tab = 'properties';
  panel.render();
  if (isCompact()) { sheet.open(); return; }
  if (!matchMedia('(pointer: coarse)').matches) $('panel').querySelector<HTMLElement>('section[data-tab="properties"] input, section[data-tab="properties"] select')?.focus();
}

// ---- the bottom bar: three modes, five buttons that follow the mode and the selection ----

/** Which of the three modes the bar shows. It follows the armed tool, and Select takes over again once something is drawn. */
let barMode: BarMode = 'select';
let lastTool: Tool = 'select';
const setTools = (tool: Tool) => all.forEach((s) => s.setTool(tool));

/** Show a mode's buttons. Leaving a mode drops its tool; the new mode waits for a choice (Select needs none). */
function setBarMode(mode: BarMode) {
  barMode = mode;
  lastTool = 'select'; // the tool dropping to Select here is not a finished drawing
  if (modeOfTool(cur().tool) !== mode) setTools('select');
  notify(null);
  refresh();
}

const toolbar = new Toolbar($('tools'), {
  mode: setBarMode,
  tool(tool) {
    notify(null);
    setTools(tool);
    if (tool === 'sequence') notify('Drag along a run of cells on the page, or tap to put seven numbers down the page.');
  },
  selectAll: () => selectAll(cur()),
  half() { const on = !cur().halfCells; all.forEach((s) => s.setHalfCells(on)); },
  properties: showProperties,
  duplicate() { const s = cur(); if (s.selected !== null) duplicateElement(s, s.selected); },
  remove() { const s = cur(); if (s.selected !== null) deleteElement(s, s.selected); },
  group: () => toggleGroup(cur()),
  more(at) {
    const s = cur();
    if (s.selected === null) return;
    const hits = canvasOf(s).lastHits.includes(s.selected) ? canvasOf(s).lastHits : [s.selected];
    showContextMenu(at, moreActions(s, s.selected, hits, () => void saveWidget()));
  },
  widgets() { closeContextMenu(); notify(null); picker.showWidgets(); },
  icons() { closeContextMenu(); notify(null); picker.showIconTool(); },
});
const canvasOf = (store: Store) => (store === stores.page ? canvases.page : store === stores.left ? canvases.left : canvases.right);

/** Bring the bottom bar, the group banner and the properties drawer up to date with the page. */
function updateBar() {
  const store = cur();
  if (store.tool !== lastTool) {
    // Arming a tool puts the bar in its mode; finishing one (the element is drawn, the tool is spent) returns to Select.
    barMode = store.tool === 'select' ? 'select' : modeOfTool(store.tool);
    lastTool = store.tool;
  }
  const book = view === 'book';
  const preview = store.mode === 'preview';
  $('tools').hidden = book || preview;
  toolbar.render({
    mode: barMode, tool: store.tool, count: store.selection.length, half: store.halfCells,
    locked: store.selection.some((i) => store.isLocked(i)), group: groupAction(store),
  });
  $('group-banner').hidden = book || preview || store.editingGroup === null;
}

// The drawer keeps the selection in view when what is selected changes.
let revealedFor = '';
function followSelection() {
  const store = cur();
  const key = `${view}:${active}:${store.selection.join(',')}`;
  if (key === revealedFor) return;
  revealedFor = key;
  if (sheet.state === 'open') revealSelection();
}
$('group-done').onclick = () => cur().leaveGroup();

/** Ask for a name and keep the selected elements, positions relative to each other, as a widget. */
async function saveWidget() {
  const s = cur();
  const chosen = s.selection.map((i) => s.page.elements[i]);
  if (!chosen.length) return;
  const name = await nameDialog.ask('Save as widget', '', `Widget ${widgets.list().length + 1}`);
  if (!name) return;
  widgets.add(name, chosen);
  notify(`Saved “${name}”. Find it under Advanced.`);
}

// ---- Advanced: sequence, icon and saved widgets ----

const picker = new AdvancedPicker(widgets, nameDialog, (choice: AdvancedChoice) => {
  if (choice.kind === 'icon') all.forEach((s) => s.setIcon(choice.icon));
  if (choice.kind === 'widget') all.forEach((s) => s.setWidget(choice.widget));
  setTools(choice.kind);
  notify(choice.kind === 'icon' ? 'Tap a cell to place the icon, or drag along a run of cells to repeat it.'
    : `Tap the page to put “${choice.widget.name}” there; drag to choose the spot.`);
});
panel.saveWidget = () => void saveWidget();
panel.pickIcon = (pick) => picker.pickIcon(pick);

for (const key of ['page', 'left', 'right'] as const) {
  let last = stores[key].page;
  let lastSelected = stores[key].selected;
  stores[key].subscribe(() => {
    const store = stores[key];
    if (store.page !== last) {
      last = store.page;
      persist(KEYS[key], last);
    }
    if (store.selected !== lastSelected) {
      lastSelected = store.selected;
      // Selecting never opens anything; but a properties modal has nothing left to show once the selection is gone.
      if (store === cur() && store.selected === null && panel.tab === 'properties' && sheet.state !== 'closed') sheet.set('closed');
    }
    refresh();
    followSelection();
  });
}
refresh();

// ---- view: one page or a spread --------------------------------------------

function setView(next: View) {
  if (next === view) return;
  notify(null);
  view = next;
  persistSettings();
  refresh();
}

function setActive(side: SpreadSide) {
  const wasBoth = showBoth;
  showBoth = false;
  if (side === active) { if (wasBoth) refresh(); return; }
  active = side;
  stores[side === 'left' ? 'right' : 'left'].select(null);
  refresh();
}
$('side-left').onclick = () => setActive('left');
$('side-right').onclick = () => setActive('right');
$('side-both').onclick = () => {
  showBoth = !showBoth;
  stores[active].select(null);
  refresh();
  if (showBoth) for (const c of [canvases.left, canvases.right]) c.fit(); // each page whole in its half
};
for (const half of document.querySelectorAll<HTMLElement>('.half')) {
  // Capture, so the page is active before its canvas handles the same press.
  half.addEventListener('pointerdown', () => setActive(half.dataset.side as SpreadSide), true);
}

// ---- view: the book ----------------------------------------------------------

function loadBook(): Book {
  const d = loadStored<Book>(draftStorage(), BOOK_KEY, (data) => { const r = readBook(data); return r.ok ? { ok: true, value: r.book } : r; });
  if (d.status === 'ok') return d.value;
  if (d.status === 'bad') {
    badDraft('book', 'dotwork-book-draft.json', d);
    notifyProblems(startupProblems.slice(-1), true);
  }
  return emptyBook(undefined, startingPrint(printerSettings));
}

/** Keep the book draft, or say why not. A book that breaks the format is never written over the last good draft. */
const keepBook = (b: Book) => reportDraft(saveDraft(draftStorage(), BOOK_KEY, b, 'book', (x) => { const r = readBook(x); return r.ok ? [] : r.issues; }));


function ensureArranger() {
  if (arranger) { void arranger.refreshDesigns(); return; }
  book ??= loadBook();
  arranger = new Arranger($('book'), {
    library,
    examples,
    changed(b) {
      book = b;
      keepBook(b);
    },
    exportFiles: () => exportDialog.show('pdf'),
  }, book);
  void arranger.refreshDesigns();
}

const currentBook = (): Book => arranger?.current ?? (book ??= loadBook());

/** `fresh` for a book that is just being made (a template): it starts from the printer's saved settings, not the defaults. */
function openBook(next: Book, fresh = false) {
  notify(null);
  book = structuredClone(next);
  if (fresh) book.print = { ...book.print, ...printerSettings };
  keepBook(book);
  arranger?.setBook(book);
  view = 'book';
  persistSettings();
  refresh();
}

$('view-page').onclick = () => setView('page');
$('view-spread').onclick = () => setView('spread');
$('view-book').onclick = () => setView('book');

const currentSpread = (): Spread => buildSpread(spreadName.trim() || 'Untitled spread', stores.left.page, stores.right.page);

function openPage(page: Page) {
  notify(null);
  stores.page.replace(structuredClone(page));
  setView('page');
}

function openSpread(spread: Spread) {
  notify(null);
  spreadName = spread.name;
  stores.left.replace(structuredClone(spread.left));
  stores.right.replace(structuredClone(spread.right));
  view = 'spread';
  persistSettings();
  refresh();
}

function placePage(page: Page, side: SpreadSide) {
  notify(null);
  stores[side].replace(withSide(page, side));
  active = side;
  view = 'spread';
  persistSettings();
  refresh();
}

/** New, imported or example page: it goes to the single page, or into the spread page being edited. */
function replacePage(page: Page) {
  if (view === 'page') stores.page.replace(structuredClone(page));
  else stores[active].replace(withSide(page, active));
}

// ---- toolbar and menu ------------------------------------------------------

/** The canvases showing the page(s) being edited. */
const visibleCanvases = () => (view === 'page' ? [canvases.page] : [canvases.left, canvases.right]);
$('fit').onclick = () => visibleCanvases().forEach((c) => c.fit());
$('layers-button').onclick = () => {
  panel.tab = 'layers';
  panel.render();
  if (sheet.state === 'closed') sheet.open(); else sheet.set('closed');
};

// The top bar's three menus: at most one open; choosing an item, tapping outside or Escape closes it.
const menus = setupMenus();
for (const id of ['menu-page', 'menu-edit']) $(id).addEventListener('click', closeContextMenu);
// The on-screen keyboard also resizes the window; that changes nothing here (see keyboard.ts).
addEventListener('resize', () => { if (keyboardOpen()) return; menus.closeAll(); refresh(); });

const setMode = (m: 'edit' | 'preview') => all.forEach((s) => s.setMode(m));
$('mode-edit').onclick = () => setMode('edit');
$('mode-preview').onclick = () => { notify(null); setMode('preview'); };
$('undo').onclick = () => cur().undo();
$('redo').onclick = () => cur().redo();


$('new').onclick = () => {
  notify(null);
  if (view === 'book') {
    if (currentBook().pages.some(Boolean) && !confirm('Start a new book? The current draft is replaced (save it to the Library first to keep it).')) return;
    openBook(emptyBook(undefined, startingPrint(printerSettings)));
    return;
  }
  if (view === 'page') { replacePage(emptyPage()); return; }
  const fresh = emptySpread();
  spreadName = fresh.name;
  stores.left.replace(fresh.left);
  stores.right.replace(fresh.right);
  persistSettings();
};

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- import and export ---------------------------------------------------

/** The current page, spread or book as JSON data, checked against the format first. */
function jsonToExport(): { ok: true; data: unknown; name: string } | { ok: false; problem: Problem } {
  if (view === 'book') {
    const b = currentBook();
    const r = readBook(b);
    return r.ok ? { ok: true, data: b, name: b.name || 'book' } : { ok: false, problem: issuesProblem('Can’t export: the book breaks the format.', r.issues) };
  }
  if (view === 'page') {
    const issues = validatePage(stores.page.page);
    return issues.length ? { ok: false, problem: issuesProblem('Can’t export: the page breaks the format.', issues) } : { ok: true, data: stores.page.page, name: stores.page.page.name };
  }
  const spread = currentSpread();
  const r = readSpread(spread);
  return r.ok ? { ok: true, data: spread, name: spread.name } : { ok: false, problem: issuesProblem('Can’t export: the spread breaks the format.', r.issues) };
}

/** Open a chosen file as a page, spread or book. Says why not, in plain words, if it can't be. */
async function importFromFile(file: File): Promise<{ ok: true } | { ok: false; problem: Problem }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    return { ok: false, problem: errorProblem(`${file.name} is not valid JSON.`, err) };
  }
  const format = (parsed as { format?: unknown } | null)?.format;
  const refuse = (what: string, issues: ValidationIssue[]) => ({ ok: false as const, problem: issuesProblem(`Not imported: ${file.name} breaks the ${what} format.`, issues) });
  if (format === 'dotwork-library') return { ok: false, problem: { title: `${file.name} is a library backup.`, lines: ['Use Library, then Restore backup.'], details: `${file.name} is a library backup.` } };
  const converted = `${file.name} contained version 1 pages and they have been converted to version 2.`;
  if (format === 'dotwork-book') {
    const r = readBook(parsed);
    if (!r.ok) return refuse('book', r.issues);
    openBook(r.book);
    if (r.converted) notify(converted);
    return { ok: true };
  }
  if (format === 'dotwork-spread') {
    const r = readSpread(parsed);
    if (!r.ok) return refuse('spread', r.issues);
    openSpread(r.spread);
    if (r.converted) notify(converted);
    return { ok: true };
  }
  const result = readPage(parsed);
  if (!result.ok) return refuse('page', result.issues);
  notify(result.converted ? `${file.name} was a version 1 file and has been converted to version 2.` : null);
  replacePage(result.page);
  return { ok: true };
}

const exportDialog = new ExportDialog({
  view: () => view,
  json: jsonToExport,
  png: () => (view === 'book' ? null
    : view === 'page' ? { page: stores.page.page }
      : { page: cur().page, spread: { left: stores.left.page, right: stores.right.page, name: spreadName.trim() || 'Untitled spread' } }),
  book: currentBook,
  editBook: (change) => { ensureArranger(); arranger!.edit(() => change(arranger!.current)); },
  printer: {
    saved: () => printerSettings,
    save(print) {
      printerSettings = printerOf(print); // kept for this visit even if the browser refuses to store it
      return savePrinter(draftStorage(), print);
    },
  },
  importFile: importFromFile,
  download,
});
$('export').onclick = () => { notify(null); exportDialog.show(); };

// ---- settings ----------------------------------------------------------------

const settingsDialog = new SettingsDialog({
  view: () => view,
  pages: () => (view === 'spread' ? [{ store: stores.left, side: 'left' as const }, { store: stores.right, side: 'right' as const }] : [{ store: stores.page, side: null }]),
  spreadName: () => spreadName,
  setSpreadName(name) { spreadName = name; persistSettings(); },
  book: currentBook,
  editBook: (change) => { ensureArranger(); arranger!.edit(() => change(arranger!.current)); },
});
$('settings').onclick = () => { notify(null); settingsDialog.show(); };

// ---- library -------------------------------------------------------------

const favorites = new Favorites((() => { try { return localStorage; } catch { return null; } })());
const libraryDialog = new LibraryDialog(library, {
  view: () => view,
  examples,
  widgets,
  favorites,
  pageTarget: () => (view === 'spread' ? active : null),
  useWidget(widget) {
    if (view === 'book') setView('page');
    all.forEach((s) => s.setWidget(widget));
    setTools('widget');
    notify(`Tap the page to put “${widget.name}” there; drag to choose the spot.`);
  },
  saveOptions(): SaveOption[] {
    if (view === 'book') return [{ what: 'book', label: 'This book', name: currentBook().name }];
    if (view === 'page') return [{ what: 'page', label: 'This page', name: stores.page.page.name }];
    return [
      { what: 'spread', label: 'The spread', name: spreadName },
      { what: 'left', label: 'Left page', name: stores.left.page.name },
      { what: 'right', label: 'Right page', name: stores.right.page.name },
    ];
  },
  data(what: SaveWhat) {
    if (what === 'book') return structuredClone(currentBook());
    if (what === 'spread') return currentSpread();
    return structuredClone(stores[what].page);
  },
  openPage,
  openSpread,
  openBook,
  placePage,
  download,
  closed: () => void arranger?.refreshDesigns(),
});
$('library').onclick = () => { notify(null); void libraryDialog.show(); };

// ---- help ------------------------------------------------------------------

/** The help entry for the page itself: its gestures depend on the tool, and on whether it can be changed at all. */
const pageHelpKey = () => (view === 'spread' && isCompact() && showBoth ? 'page-both' : cur().mode === 'preview' ? 'page-preview'
  : cur().tool === 'select' && barMode !== 'select' ? `page-${barMode}` : `page-${cur().tool}`);
const helpMode = new HelpMode({ pageKey: pageHelpKey, after: document.querySelector<HTMLElement>('.topbar')! });
$('help').onclick = () => { closeContextMenu(); menus.closeAll(); helpMode.start(); };

// ---- keyboard ------------------------------------------------------------

const TOOL_KEYS: Record<string, Tool> = { p: 'pattern', s: 'shade', b: 'box', r: 'rule', c: 'checkboxes', t: 'text' };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || view === 'book') return; // the library window has its own keys; the book view has none
  const store = cur();
  const t = e.target as HTMLElement;
  const typing = t instanceof HTMLInputElement && t.type === 'text';
  const inField = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
  const mod = e.ctrlKey || e.metaKey;
  const sel = store.selected;
  if (mod && e.key.toLowerCase() === 'z') {
    if (typing) return; // let the field undo its own text
    e.preventDefault();
    if (e.shiftKey) store.redo(); else store.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    if (typing) return;
    e.preventDefault();
    store.redo();
  } else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault(); // the browser would bookmark the page
    if (store.mode === 'edit' && sel !== null && !store.isLocked(sel)) duplicateElement(store, sel);
  } else if (store.mode !== 'edit' || inField || mod || e.altKey) {
    // Fields keep their own keys; nothing below applies in preview.
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (sel !== null && !store.isLocked(sel)) deleteElement(store, sel);
  } else if (e.key in ARROWS && sel !== null) {
    e.preventDefault();
    const step = e.shiftKey ? 0.5 : 1;
    nudgeElement(store, sel, ARROWS[e.key][0] * step, ARROWS[e.key][1] * step);
  } else if (e.key.toLowerCase() === 'v' && !e.shiftKey) {
    setBarMode('select');
  } else if (e.key.toLowerCase() === 'a' && !e.shiftKey) {
    setBarMode('advanced');
  } else if (e.key.toLowerCase() in TOOL_KEYS && !e.shiftKey) {
    setTools(TOOL_KEYS[e.key.toLowerCase()]);
  }
  if (e.key === 'Escape') {
    Object.values(canvases).forEach((c) => c.cancel());
    setTools('select');
    store.select(null);
    store.leaveGroup();
  }
});
