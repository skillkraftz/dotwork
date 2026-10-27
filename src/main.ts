import './style.css';
import { keyboardOpen } from './keyboard';
import { emptyPage, type Page } from './format/types';
import { buildSpread, emptySpread, readSpread, withSide, type Spread, type SpreadSide } from './format/spread';
import { validatePage, type ValidationIssue } from './format/validate';
import { readPage } from './format/read';
import { DocSession, statusText, type Adapter } from './documents';
import { Canvas, type CanvasHooks } from './canvas';
import { contextActions, deleteElement, duplicateElement, groupAction, moreActions, nudgeElement, selectAll, toggleGroup } from './actions';
import { h, Panel } from './panel';
import { closeContextMenu, showContextMenu } from './ctxmenu';
import { isCompact, Sheet } from './sheet';
import { Toolbar, modeOfTool, type BarMode } from './toolbar';
import { Store, type Tool } from './store';
import { Library } from './library/library';
import { CANT_KEEP, Keeper } from './library/keeper';
import { Favorites } from './library/favorites';
import { idbBackend } from './library/idb';
import { LibraryDialog } from './library/dialog';
import { Arranger } from './book/arranger';
import { emptyBook, readBook, type Book } from './book/book';
import { readSection } from './book/sections';
import { DEFAULT_PRINT, clonePrint, type PrintSettings } from './book/impose';
import { loadPrinter, savePrinter } from './printer';
import { changedTokensProblem, findChangedTokens } from './library/tokennotice'; // removed in phase 5
import { ExportDialog } from './exporter';
import { SettingsDialog } from './settings';
import { checkItem, setupMenus } from './menus';
import { HelpMode } from './helpmode';
import type { DraftStorage } from './drafts';
import { errorProblem, issuesProblem, problemView, type Problem } from './problems';
import { AdvancedPicker, type AdvancedChoice } from './advanced';
import { NameDialog } from './namedialog';
import { WidgetStore, type Widget } from './widgets';
import { BUILTIN_PAGES, BUILTIN_SPREADS, isBuiltinName } from './builtin/library';
import { exampleId, spreadId } from './library/browse';
import { isBuiltinSection } from './builtin/sections';

const VIEW_KEY = 'dotwork.view';
/** The page and the spread that are open, by Library id (or built-in id), so a reload comes back to them. The old draft keys are no longer read or written. */
const OPEN_KEY = 'dotwork.open';

const examples = BUILTIN_PAGES;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type View = 'page' | 'spread' | 'book';
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

const draftStorage = (): DraftStorage | null => { try { return localStorage; } catch { return null; } };
/** Problems found at start-up (a printer profile that couldn't be read); shown once the screen exists. */
const startupProblems: Problem[] = [];

/** The printer profile (the Calibrate page and the PDF tab change it): what every book prints with. The defaults until there are saved settings. */
let printerSettings: PrintSettings = (() => {
  const loaded = loadPrinter(draftStorage());
  if (loaded.status === 'bad') startupProblems.push(loaded.problem);
  return loaded.status === 'ok' ? loaded.value : clonePrint(DEFAULT_PRINT);
})();

const blank = emptySpread();
/** The page being edited alone, and the two pages of the spread being edited. Each has its own undo history, kept in memory. */
const stores = {
  page: new Store(emptyPage()),
  left: new Store(blank.left),
  right: new Store(blank.right),
};
const all = [stores.page, stores.left, stores.right];
const storedView = stored(VIEW_KEY);
let view: View = storedView === 'spread' || storedView === 'book' ? storedView : 'page';
let active: SpreadSide = 'left';
/** The book view; made the first time it is shown. */
let arranger: Arranger | null = null;
/** The store that undo, the panel and the keyboard act on. */
const cur = () => (view === 'page' ? stores.page : stores[active]);

const nameDialog = new NameDialog();

const keeper = new Keeper(typeof indexedDB === 'undefined' ? null : idbBackend);
const library = new Library(keeper, undefined, undefined, (kind, name) => (kind === 'section' ? isBuiltinSection(name) : isBuiltinName(kind, name)));
/** Saved widgets and art are Library documents; this keeps them as a list the pickers can read at once. */
const widgets = new WidgetStore(library);

// ---- the open documents ----------------------------------------------------

/** Above zero while a document is being put on screen: that is not an edit, and it is not written. */
let loading = 0;
const showing = (fn: () => void) => { loading++; try { fn(); } finally { loading--; } };
/** Whether a document is the empty one a new document starts as (its name aside). */
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pageAdapter: Adapter<Page> = {
  read: (name) => ({ ...stores.page.page, name }),
  show: (data) => showing(() => stores.page.load(structuredClone(data))),
  blank: emptyPage,
  isBlank: () => sameJson({ ...stores.page.page, name: '' }, { ...emptyPage(), name: '' }),
};
const spreadAdapter: Adapter<Spread> = {
  read: (name) => buildSpread(name, stores.left.page, stores.right.page),
  show: (data) => showing(() => { stores.left.load(withSide(data.left, 'left')); stores.right.load(withSide(data.right, 'right')); }),
  blank: emptySpread,
  isBlank: () => { const b = emptySpread(); return sameJson(buildSpread('', stores.left.page, stores.right.page), buildSpread('', withSide(b.left, 'left'), withSide(b.right, 'right'))); },
};
/** The book being arranged, before the arranger exists and after (it keeps its own copy in step through `changed`). */
let book: Book | null = null;
const bookAdapter: Adapter<Book> = {
  read: (name) => ({ ...currentBook(), name }),
  // the book carries the document's name, so exports and the PDFs read the right one
  show: (data) => showing(() => { book = { ...structuredClone(data), name: sessions.book.name }; arranger?.setBook(book); }),
  blank: emptyBook,
  isBlank: () => sameJson({ ...currentBook(), name: '' }, { ...emptyBook(), name: '' }),
};
/** The open page, spread and book, each a Library document (or a built-in, read-only) that every change is written to. */
const sessions = { page: new DocSession('page', library, pageAdapter), spread: new DocSession('spread', library, spreadAdapter), book: new DocSession('book', library, bookAdapter) };
type Session = typeof sessions.page | typeof sessions.spread | typeof sessions.book;
const allSessions: Session[] = [sessions.page, sessions.spread, sessions.book];
const sessionOf = (key: 'page' | 'left' | 'right') => (key === 'page' ? sessions.page : sessions.spread);
/** Redraws the document bar (set below, once it exists). */
let renderDocbarHook: () => void = () => {};
/** The document on screen. */
const docSession = (): Session => sessions[view];

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
function persistSettings() {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
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
  renderDocbarHook();
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
  art() { closeContextMenu(); notify(null); picker.showArt(); },
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
  try {
    const saved = await widgets.add(name, chosen);
    notify(`Saved “${saved.name}”. Find it under Advanced.`);
  } catch (err) { notifyProblems([errorProblem('The widget wasn’t saved.', err)]); }
}

// ---- Advanced: sequence, icon, saved widgets and art ----

const picker = new AdvancedPicker(widgets, nameDialog, (choice: AdvancedChoice) => {
  if (choice.kind === 'icon') all.forEach((s) => s.setIcon(choice.icon));
  if (choice.kind === 'widget') all.forEach((s) => s.setWidget(choice.widget));
  if (choice.kind === 'art') { armArt(choice.widget, choice.problem); return; }
  setTools(choice.kind);
  notify(choice.kind === 'icon' ? 'Tap a cell to place the icon, or drag along a run of cells to repeat it.'
    : `Tap the page to put “${choice.widget.name}” there; drag to choose the spot.`);
});

/** Arm the art tool, and say how to use it (with what an import left out, if it came from a file). */
function armArt(art: Widget, problem: Problem | null = null) {
  all.forEach((s) => s.setArt(art));
  setTools('art');
  const how = `Drag a rectangle on the page for “${art.name}” to fill, or tap to put it down at its first size.`;
  if (problem) show([problemView(problem), h('p', {}, how)], false); else notify(how);
}
panel.saveWidget = () => void saveWidget();
panel.pickIcon = (pick) => picker.pickIcon(pick);

for (const key of ['page', 'left', 'right'] as const) {
  let last = stores[key].page;
  let lastSelected = stores[key].selected;
  stores[key].subscribe(() => {
    const store = stores[key];
    if (store.page !== last) {
      last = store.page;
      if (!loading) sessionOf(key).changed(); // every committed change is written, after a pause
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
  void ensureOpen(next);
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

function ensureArranger() {
  if (arranger) { void arranger.refreshDesigns(); return; }
  book ??= emptyBook();
  arranger = new Arranger($('book'), {
    library,
    examples,
    changed(b) {
      book = b;
      if (sessions.book.name) b.name = sessions.book.name; // an undo brings back the name it had; the document's name wins
      if (!loading) sessions.book.changed(); // every committed change is written, after a pause
    },
    editing(apply) {
      const session = sessions.book;
      if (started && session.name && !session.readOnly) return true;
      if (started && session.readOnly) void askCopy(session, apply); // the copy is asked for, and the change is made in it
      return false;
    },
    exportFiles: () => exportDialog.show('pdf'),
    async nameSaved(id, name, kind) {
      const asked = await nameDialog.ask(`Name this ${kind} before it goes in the book`, name);
      if (asked === null) return null;
      const final = (await library.rename(id, asked)) ?? name;
      for (const x of allSessions) x.renamedElsewhere(id, final);
      return final;
    },
    printer: () => printerSettings,
  }, book);
  void arranger.refreshDesigns();
}

const currentBook = (): Book => arranger?.current ?? (book ??= emptyBook());

$('view-page').onclick = () => setView('page');
$('view-spread').onclick = () => setView('spread');
$('view-book').onclick = () => setView('book');

const currentSpread = (): Spread => spreadAdapter.read(sessions.spread.name);
/** The open page as a file: the Library document's name goes into it. */
const currentPage = (): Page => pageAdapter.read(sessions.page.name);

/**
 * Open a document, writing the one open before it. If that write fails nothing is switched (the page on screen would
 * be lost), and the notice says why.
 */
async function switchDocument(session: Session, open: () => Promise<boolean>): Promise<boolean> {
  let ok = false;
  try { ok = await open(); } catch (err) {
    notifyProblems([errorProblem(`Couldn’t open it: the ${session.kind} that is open couldn’t be written first.`, err)]);
    return false;
  }
  if (!ok) notifyProblems([errorProblem(`The ${session.kind} that is open couldn’t be written, so nothing was switched. Retry, or export it first.`, session.autosave.error)]);
  return ok;
}

async function openPage(page: Page, id: string | null) {
  notify(null);
  const ok = await switchDocument(sessions.page, () => (id ? sessions.page.open({ id, kind: 'page', name: page.name, updated: '', data: page }) : sessions.page.openBuiltin(page)));
  if (ok) setView('page');
}

async function openBook(next: Book, id: string | null) {
  notify(null);
  const ok = await switchDocument(sessions.book, () => (id ? sessions.book.open({ id, kind: 'book', name: next.name, updated: '', data: next }) : sessions.book.openBuiltin(next)));
  if (ok) setView('book');
}

/** A book made just now from a template that asked questions: a document of its own at once, named from the template. */
async function addBook(next: Book) {
  notify(null);
  const ok = await switchDocument(sessions.book, () => sessions.book.importAs(next));
  if (ok) setView('book');
}

async function openSpread(spread: Spread, id: string | null) {
  notify(null);
  const ok = await switchDocument(sessions.spread, () => (id ? sessions.spread.open({ id, kind: 'spread', name: spread.name, updated: '', data: spread }) : sessions.spread.openBuiltin(spread)));
  if (ok) setView('spread');
}

/** A page from the Library put on one side of the open spread: a change to the spread, undone with Undo. */
function placePage(page: Page, side: SpreadSide) {
  notify(null);
  if (view !== 'spread') setView('spread');
  stores[side].replace(withSide(page, side));
  active = side;
  refresh();
}

/** The document that was open at the last visit, or a new one named Untitled: the start of each view. */
async function ensureOpen(kind: View) {
  const session = sessions[kind];
  if (session.name) return;
  let ids: Record<string, string> = {};
  try { ids = JSON.parse(stored(OPEN_KEY) ?? '{}') ?? {}; } catch { /* start fresh */ }
  const id = ids[kind];
  try {
    if (id?.startsWith('example:') && kind !== 'book') {
      const found = kind === 'page' ? BUILTIN_PAGES.find((p) => exampleId(p) === id) : BUILTIN_SPREADS.find((x) => spreadId(x) === id);
      if (found) { await (kind === 'page' ? sessions.page.openBuiltin(found as Page) : sessions.spread.openBuiltin(found as Spread)); return; }
    } else if (id) {
      const item = await library.get(id);
      if (item?.kind === kind) { await session.open(item as never); return; }
    }
  } catch (err) { notifyProblems([errorProblem('Your saved documents couldn’t be read.', err)]); }
  await session.startNew();
  renderDocbar();
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
  const session = docSession();
  void switchDocument(session, () => session.startNew());
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
    const page = currentPage();
    const issues = validatePage(page);
    return issues.length ? { ok: false, problem: issuesProblem('Can’t export: the page breaks the format.', issues) } : { ok: true, data: page, name: page.name };
  }
  const spread = currentSpread();
  const r = readSpread(spread);
  return r.ok ? { ok: true, data: spread, name: spread.name } : { ok: false, problem: issuesProblem('Can’t export: the spread breaks the format.', r.issues) };
}

/** Add a chosen file as a new page, spread, book or section (the first three are opened). Says why not, in plain words, if it can't be. */
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
    if (!(await switchDocument(sessions.book, () => sessions.book.importAs(r.book)))) return { ok: false, problem: errorProblem('The book was not added.', sessions.book.autosave.error) };
    setView('book');
    if (r.converted) notify(converted);
    return { ok: true };
  }
  if (format === 'dotwork-section') {
    const r = readSection(parsed);
    if (!r.ok) return refuse('section', r.issues);
    try {
      const saved = await library.create('section', r.section.name, r.section);
      notify(`Added the section “${saved.name}”. Find it in Library, Sections.`);
    } catch (err) { return { ok: false, problem: errorProblem('The section was not added.', err) }; }
    return { ok: true };
  }
  if (format === 'dotwork-spread') {
    const r = readSpread(parsed);
    if (!r.ok) return refuse('spread', r.issues);
    if (!(await switchDocument(sessions.spread, () => sessions.spread.importAs(r.spread)))) return { ok: false, problem: errorProblem('The spread was not added.', sessions.spread.autosave.error) };
    setView('spread');
    if (r.converted) notify(converted);
    return { ok: true };
  }
  const result = readPage(parsed);
  if (!result.ok) return refuse('page', result.issues);
  notify(result.converted ? `${file.name} was a version 1 file and has been converted to version 2.` : null);
  if (!(await switchDocument(sessions.page, () => sessions.page.importAs(result.page)))) return { ok: false, problem: errorProblem('The page was not added.', sessions.page.autosave.error) };
  setView('page');
  return { ok: true };
}

/** Use these printer settings, and keep them. Returns what to tell the owner if the browser refuses. */
function setPrinter(next: PrintSettings): Problem | null {
  printerSettings = clonePrint(next); // used for this visit even if the browser refuses to store it
  return savePrinter(draftStorage(), printerSettings);
}

const exportDialog = new ExportDialog({
  view: () => view,
  json: jsonToExport,
  png: () => (view === 'book' ? null
    : view === 'page' ? { page: currentPage() }
      : { page: cur().page, spread: { left: stores.left.page, right: stores.right.page, name: sessions.spread.name } }),
  beforeExport: nameBeforeExport,
  book: currentBook,
  savedBooks: async () => (await library.list()).filter((i) => i.kind === 'book').map((i) => ({ id: i.id, name: i.name, book: i.data as Book })),
  editBook: (change) => { ensureArranger(); arranger!.edit(() => change(arranger!.current)); },
  printer: {
    get: () => printerSettings,
    edit(change) {
      const next = clonePrint(printerSettings);
      change(next);
      return setPrinter(next);
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
  pageName: () => sessions.page.name,
  setPageName: (name) => renameOpen(sessions.page, name),
  spreadName: () => sessions.spread.name,
  setSpreadName: (name) => renameOpen(sessions.spread, name),
  nameLocked: () => docSession().readOnly,
  setBookName: (name) => renameOpen(sessions.book, name),
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
  useArt(art) {
    if (view === 'book') setView('page');
    armArt(art);
  },
  useWidget(widget) {
    if (view === 'book') setView('page');
    all.forEach((s) => s.setWidget(widget));
    setTools('widget');
    notify(`Tap the page to put “${widget.name}” there; drag to choose the spot.`);
  },
  openPage,
  openSpread,
  askName: (title, initial) => nameDialog.ask(title, initial),
  renamed(id, name) { for (const s of allSessions) s.renamedElsewhere(id, name); },
  removed(id) {
    // The open document was deleted in the Library: carry on in a new one rather than quietly writing it back.
    for (const s of allSessions) if (s.id === id) void switchDocument(s, () => s.startNew());
  },
  openBook,
  addBook,
  printer: { get: () => printerSettings, set: (next) => setPrinter(next) },
  placePage,
  download,
  closed: () => void arranger?.refreshDesigns(),
});
$('library').onclick = () => { notify(null); void libraryDialog.show(); };

// ---- the document bar: name, saved mark, built-in bar ---------------------------

/** Renames are applied one after another, so typing a name can't land out of order. */
let renaming: Promise<unknown> = Promise.resolve();
function renameOpen(session: Session, name: string) {
  renaming = renaming.then(() => session.rename(name)).catch((err) => notifyProblems([errorProblem('Couldn’t rename it.', err)]));
}

const docName = $('doc-name');
const docStatus = $('doc-status');
/** The notice that says why a write failed, so that it goes away when the next write works. */
let failureShown = false;

function renderDocbar() {
  const session = docSession();
  $('docbar').hidden = !session.name;
  $('keep-warning').hidden = keeper.keeping;
  $('export').classList.toggle('attention', !keeper.keeping);
  const untitled = session.untitled;
  docName.classList.toggle('untitled', untitled);
  docName.replaceChildren(untitled ? h('span', { class: 'doc-chip' }, `${session.name}: name it`) : session.name);
  docName.title = session.readOnly ? session.name : 'Tap to rename';
  docName.toggleAttribute('disabled', session.readOnly);
  $('builtin-bar').hidden = !session.readOnly;
  docStatus.hidden = session.readOnly;
  const status = session.status;
  docStatus.textContent = statusText(status, keeper.keeping);
  docStatus.classList.toggle('failed', status === 'failed' || !keeper.keeping);
  $('doc-retry').hidden = status !== 'failed' || !keeper.keeping;
  if (status === 'failed' && keeper.keeping && !failureShown) {
    failureShown = true;
    notifyProblems([errorProblem(`This ${session.kind} is not saved: the browser refused the write. Your changes are still on screen; Retry, or export it.`, session.autosave.error)]);
  } else if (status === 'saved' && failureShown) {
    failureShown = false;
    dismissNotice();
  }
}

/** Tap the name (or the "name it" chip) to rename in place. */
docName.onclick = () => {
  const session = docSession();
  if (session.readOnly) return;
  const input = h('input', { type: 'text', id: 'doc-name-field', value: session.name, maxlength: 80, autocomplete: 'off', 'aria-label': 'Name', 'data-help': 'doc-name-field', enterkeyhint: 'done' });
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) renameOpen(session, input.value);
    input.replaceWith(docName);
    renderDocbar();
    void renaming.then(renderDocbar);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
  input.onblur = () => finish(true);
  docName.replaceWith(input);
  input.focus();
  input.select();
};
renderDocbarHook = renderDocbar;
$('keep-text').textContent = CANT_KEEP;
$('doc-retry').onclick = () => { void docSession().flush(); };

/** A built-in is open: an edit isn't made; the name of a copy is asked for, and the edit is made in the copy. */
let copying: { edit: (() => void) | null } | null = null;
async function askCopy(session: Session, edit: (() => void) | null) {
  if (copying) { copying.edit = edit ?? copying.edit; return; } // more edits while the question is open: the latest one counts
  const pending = copying = { edit };
  const name = await nameDialog.ask('Name your copy', `${session.name} copy`);
  copying = null;
  if (name === null) return; // cancelled: the built-in is as it was
  try { await session.makeCopy(name, () => pending.edit?.()); } catch (err) { notifyProblems([errorProblem('The copy couldn’t be made.', err)]); }
}
$('doc-copy').onclick = () => { const s = docSession(); if (s.readOnly) void askCopy(s, null); };

/** Stores of a built-in are guarded; until the first document is open every edit is ignored. */
let started = false;
function applyGuards() {
  const guard = (session: Session) => (apply: () => void) => { if (started) void askCopy(session, apply); };
  for (const [session, keys] of [[sessions.page, ['page']], [sessions.spread, ['left', 'right']]] as const) {
    for (const key of keys) stores[key].guard = !started || session.readOnly ? guard(session) : null;
  }
  // The book's edits go through the arranger, which asks `editing` first.
}

/** What to say on the open key: saved documents by id, built-ins by their example id. */
function rememberOpen() {
  const idOf = (s: Session, example: (name: string) => string) => (s.builtin ? example(s.builtin) : s.id);
  let ids: Record<string, string | null> = {};
  try { ids = JSON.parse(stored(OPEN_KEY) ?? '{}') ?? {}; } catch { /* start again */ }
  // a view not opened yet in this visit keeps what it had
  if (sessions.page.name) ids.page = idOf(sessions.page, (n) => `example:${n}`);
  if (sessions.spread.name) ids.spread = idOf(sessions.spread, (n) => `example:spread:${n}`);
  if (sessions.book.id) ids.book = sessions.book.id; // a built-in book (a template's) is not remembered: the last saved one comes back
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* the document is in the Library; only the reopen is lost */ }
}

for (const session of allSessions) {
  session.subscribe(() => {
    if (session === sessions.book && book && session.name) book.name = session.name;
    applyGuards(); rememberOpen(); renderDocbar();
  });
}
keeper.subscribe(renderDocbar);
$('keep-export').onclick = () => { notify(null); exportDialog.show('export'); };

/** Before the first export of an Untitled page or spread: a small window asks for a name (keeping Untitled is allowed). */
const askedBeforeExport = new Set<string>();
async function nameBeforeExport(what?: 'book'): Promise<boolean> {
  const session = what === 'book' ? sessions.book : docSession();
  if (!session.untitled) return true;
  const key = `${session.kind}:${session.id ?? session.name}`;
  if (askedBeforeExport.has(key)) return true;
  const name = await nameDialog.ask(`Name this ${session.kind} before you export it`, session.name);
  if (name === null) return false;
  askedBeforeExport.add(key);
  await session.rename(name);
  renderDocbar();
  return true;
}

/** Every committed change is written after a short pause; leaving the tab writes it at once. */
const flushAll = () => { for (const s of allSessions) void s.flush(); };
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
// Closing the tab: an Untitled document nobody drew on is not kept.
addEventListener('pagehide', () => { flushAll(); for (const s of allSessions) void s.discardIfPristine(); });

applyGuards();
void (async () => {
  await keeper.start(); // does the browser keep documents? If not, the notice says so before anything is opened
  widgets.onError = (problem) => notifyProblems([problem]);
  try { // removed in phase 5 (docs/product-model.md): once per start, the documents whose tokens changed meaning in phase 4
    const changed = changedTokensProblem(findChangedTokens(await library.list()));
    if (changed) notifyProblems([changed], true);
  } catch { /* the notice is a courtesy; reading the Library failing is reported below */ }
  try { await widgets.refresh(); } catch (err) { notifyProblems([errorProblem('Your saved widgets and art couldn’t be read.', err)]); }
  await ensureOpen(view);
  started = true;
  applyGuards();
  renderDocbar();
  refresh();
  document.body.dataset.ready = '1';
})();

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
