import './style.css';
import { keyboardOpen } from './keyboard';
import { emptyPage, type Page } from './format/types';
import { buildSpread, emptySpread, readSpread, withSide, type Spread, type SpreadSide } from './format/spread';
import { formatIssue, validatePage } from './format/validate';
import { readPage } from './format/read';
import { Canvas, type CanvasHooks } from './canvas';
import { contextActions, deleteElement, duplicateElement, nudgeElement } from './actions';
import { Panel } from './panel';
import { closeContextMenu, showContextMenu } from './ctxmenu';
import { isCompact, Sheet } from './sheet';
import { ActionBar } from './actionbar';
import { pageToPng } from './png';
import { Store, type Tool } from './store';
import { Library, MemoryBackend } from './library/library';
import { idbBackend } from './library/idb';
import { LibraryDialog, type SaveOption, type SaveWhat } from './library/dialog';
import { Arranger } from './book/arranger';
import { emptyBook, readBook, type Book } from './book/book';
import { ExportDialog } from './book/export-dialog';
import { HelpMode } from './helpmode';
import { AdvancedPicker, type AdvancedChoice } from './advanced';
import { NameDialog } from './namedialog';
import { WidgetStore } from './widgets';

const KEYS = { page: 'dotwork.page', left: 'dotwork.spread.left', right: 'dotwork.spread.right' } as const;
const VIEW_KEY = 'dotwork.view';
const BOOK_KEY = 'dotwork.book';
const SPREAD_NAME_KEY = 'dotwork.spread.name';

const examples = Object.entries(import.meta.glob<unknown>('../examples/*.json', { eager: true, import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, raw]) => {
    const r = readPage(raw);
    return r.ok ? [r.page] : [];
  });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type View = 'page' | 'spread' | 'book';
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

function loadDraft(key: string, fallback: Page, side?: SpreadSide): Page {
  try {
    const raw = stored(key);
    if (raw) {
      const r = readPage(JSON.parse(raw));
      if (r.ok) return side ? withSide(r.page, side) : r.page;
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return fallback;
}

const blank = emptySpread();
/** The page being edited alone, and the two pages of the spread being edited. Each has its own undo history. */
const stores = {
  page: new Store(loadDraft(KEYS.page, emptyPage())),
  left: new Store(loadDraft(KEYS.left, blank.left, 'left')),
  right: new Store(loadDraft(KEYS.right, blank.right, 'right')),
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

const library = new Library(typeof indexedDB === 'undefined' ? new MemoryBackend() : idbBackend);
const exportDialog = new ExportDialog((blob, name) => download(blob, name));

// ---- notices -------------------------------------------------------------

const noticeEl = $('notice');
function notify(message: string | string[] | null) {
  if (message === null || (Array.isArray(message) && message.length === 0)) {
    noticeEl.hidden = true;
    noticeEl.replaceChildren();
    return;
  }
  const body = Array.isArray(message)
    ? Object.assign(document.createElement('ul'), {})
    : document.createElement('p');
  if (Array.isArray(message)) {
    for (const m of message) body.append(Object.assign(document.createElement('li'), { textContent: m }));
  } else {
    body.textContent = message;
  }
  const close = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Dismiss' });
  close.dataset.help = 'notice-dismiss';
  close.onclick = () => notify(null);
  noticeEl.replaceChildren(body, close);
  noticeEl.hidden = false;
}

// ---- views ---------------------------------------------------------------

/** What a touch gesture on a page canvas asks of the screen around it. */
function hooksFor(store: () => Store): CanvasHooks {
  return {
    contextMenu: (index, hits, at) => showContextMenu(at, contextActions(store(), index, hits)),
    openProperties: (index) => { store().select(index); showProperties(); },
    rendered: () => { if (store() === cur()) updateBar(); },
  };
}
const canvases = {
  page: new Canvas($('canvas') as unknown as SVGSVGElement, stores.page, notify, hooksFor(() => stores.page)),
  left: new Canvas($('canvas-left') as unknown as SVGSVGElement, stores.left, notify, hooksFor(() => stores.left)),
  right: new Canvas($('canvas-right') as unknown as SVGSVGElement, stores.right, notify, hooksFor(() => stores.right)),
};
function persist(key: string, page: Page) {
  if (validatePage(page).length > 0) return; // keep the last valid draft
  try { localStorage.setItem(key, JSON.stringify(page)); } catch { /* ignore */ }
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
  $('view-book').setAttribute('aria-pressed', String(book));
  for (const id of ['group-mode', 'tools', 'group-history', 'export-png', 'examples']) $(id).hidden = book || (id === 'tools' && preview);
  $('spread-bar').hidden = !spread || preview;
  $('layers-button').hidden = book || preview;
  if (book) {
    ensureArranger();
    $('sheet').hidden = true;
    $('view-page').setAttribute('aria-pressed', 'false');
    $('view-spread').setAttribute('aria-pressed', 'false');
    $<HTMLInputElement>('spread-name').hidden = true;
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
  panel.lockedSide = spread ? active : null;
  panel.render();
  $('view-page').setAttribute('aria-pressed', String(!spread));
  $('view-spread').setAttribute('aria-pressed', String(spread));
  $<HTMLInputElement>('spread-name').hidden = !spread;
  if (document.activeElement !== $('spread-name')) $<HTMLInputElement>('spread-name').value = spreadName;
  $('side-left').setAttribute('aria-pressed', String(!both && active === 'left'));
  $('side-right').setAttribute('aria-pressed', String(!both && active === 'right'));
  $('side-both').setAttribute('aria-pressed', String(both));
  $('mode-edit').setAttribute('aria-pressed', String(!preview));
  $('mode-preview').setAttribute('aria-pressed', String(preview));
  ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !store.canRedo;
  $('sheet').hidden = preview;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool));
  }
  $('advanced').setAttribute('aria-pressed', String(ADVANCED_TOOLS.includes(store.tool)));
  $('half-cells').setAttribute('aria-pressed', String(store.halfCells));
  updateBar();
}

const ADVANCED_TOOLS: Tool[] = ['sequence', 'icon', 'widget'];

const sheet = new Sheet($('sheet'), $('sheet-backdrop'), () => { if (sheet.state === 'closed') panel.flush(); updateBar(); });
panel.onTab = () => sheet.open();

/** Properties for the selection: the modal on a narrow screen, the side panel's fields on a wide one. */
function showProperties() {
  panel.tab = 'properties';
  panel.render();
  if (isCompact()) { sheet.open(); return; }
  if (!matchMedia('(pointer: coarse)').matches) $('panel').querySelector<HTMLElement>('section[data-tab="properties"] input, section[data-tab="properties"] select')?.focus();
}

// ---- the bar beside the selection ----

const bar = new ActionBar($('action-bar'), document.querySelector('main')!, {
  properties: showProperties,
  duplicate() { const s = cur(); if (s.selected !== null) duplicateElement(s, s.selected); },
  remove() { const s = cur(); if (s.selected !== null) deleteElement(s, s.selected); },
  selectMore() { const s = cur(); s.setMoreMode(!s.moreMode); },
  widget: () => void saveWidget(),
  more(at) { const s = cur(); if (s.selected !== null) showContextMenu(at, contextActions(s, s.selected, [s.selected])); },
});
const canvasOf = (store: Store) => (store === stores.page ? canvases.page : store === stores.left ? canvases.left : canvases.right);

/** Show the bar when something is selected on a touch-sized screen and no gesture, modal or menu is in the way. */
function updateBar() {
  const store = cur();
  const canvas = canvasOf(store);
  const wanted = (isCompact() || matchMedia('(pointer: coarse)').matches) && view !== 'book' && store.mode === 'edit' && store.tool === 'select'
    && store.selected !== null && !store.isLocked(store.selected) && !canvas.readOnly && !canvas.busy && sheet.state === 'closed';
  bar.place(wanted ? canvas.selectionRect() : null);
  bar.setMore(store.moreMode);
}

/** Ask for a name and keep the selected elements, positions relative to each other, as a widget. */
async function saveWidget() {
  const s = cur();
  const chosen = s.selection.map((i) => s.page.elements[i]);
  if (!chosen.length) return;
  const name = await nameDialog.ask('Save as widget', `Widget ${widgets.list().length + 1}`);
  if (!name) return;
  widgets.add(name, chosen);
  notify(`Saved “${name}”. Find it under Advanced.`);
}

// ---- Advanced: sequence, icon and saved widgets ----

const picker = new AdvancedPicker(widgets, nameDialog, (choice: AdvancedChoice) => {
  if (choice.kind === 'icon') all.forEach((s) => s.setIcon(choice.icon));
  if (choice.kind === 'widget') all.forEach((s) => s.setWidget(choice.widget));
  all.forEach((s) => s.setTool(choice.kind));
  notify(choice.kind === 'sequence' ? 'Drag along a run of cells on the page, or tap to put seven numbers down the page.'
    : choice.kind === 'icon' ? 'Tap a cell to place the icon, or drag along a run of cells to repeat it.'
      : `Tap the page to put “${choice.widget.name}” there; drag to choose the spot.`);
});
$('advanced').onclick = () => { closeContextMenu(); notify(null); picker.show(); };
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
  try {
    const raw = stored(BOOK_KEY);
    if (raw) {
      const r = readBook(JSON.parse(raw));
      if (r.ok) return r.book;
    }
  } catch { /* corrupt draft: start fresh */ }
  return emptyBook();
}


function ensureArranger() {
  if (arranger) { void arranger.refreshDesigns(); return; }
  book ??= loadBook();
  arranger = new Arranger($('book'), {
    library,
    examples,
    changed(b) {
      book = b;
      try { localStorage.setItem(BOOK_KEY, JSON.stringify(b)); } catch {
        notify('This browser can’t keep a draft of the book (storage is full or blocked). Save it to the Library or export it as JSON.');
      }
    },
    exportFiles: (b) => void exportDialog.show(b),
  }, book);
  void arranger.refreshDesigns();
}

const currentBook = (): Book => arranger?.current ?? (book ??= loadBook());

function openBook(next: Book) {
  notify(null);
  book = structuredClone(next);
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(book)); } catch { /* ignore */ }
  arranger?.setBook(book);
  view = 'book';
  persistSettings();
  refresh();
}

$('view-page').onclick = () => setView('page');
$('view-spread').onclick = () => setView('spread');
$('view-book').onclick = () => setView('book');
$<HTMLInputElement>('spread-name').oninput = (e) => {
  spreadName = (e.target as HTMLInputElement).value;
  persistSettings();
};

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

// On a narrow screen the top bar's extras live in a menu; on a wide one the same controls sit in the bar.
const menu = $('menu');
const menuButton = $('menu-button');
function setMenu(open: boolean) {
  menu.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
}
menuButton.onclick = () => { closeContextMenu(); setMenu(!menu.classList.contains('open')); };
menu.addEventListener('click', (e) => {
  // Choosing something closes the menu; the fields in it (example list, spread name) keep it open while used.
  const t = e.target as HTMLElement;
  if (t.closest('button')) setMenu(false);
});
document.addEventListener('pointerdown', (e) => {
  if (menu.classList.contains('open') && !menu.contains(e.target as Node) && !menuButton.contains(e.target as Node)) setMenu(false);
}, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
// Leaving the narrow layout (rotating, resizing) must not leave the menu stuck open or the spread read-only.
// The on-screen keyboard also resizes the window; that changes nothing here (see keyboard.ts).
addEventListener('resize', () => { if (keyboardOpen()) return; if (!isCompact()) setMenu(false); refresh(); });

const setMode = (m: 'edit' | 'preview') => all.forEach((s) => s.setMode(m));
$('mode-edit').onclick = () => setMode('edit');
$('mode-preview').onclick = () => { notify(null); setMode('preview'); };
$('undo').onclick = () => cur().undo();
$('redo').onclick = () => cur().redo();

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  b.onclick = () => all.forEach((s) => s.setTool(b.dataset.tool as Tool));
}
$('half-cells').onclick = () => { const on = !cur().halfCells; all.forEach((s) => s.setHalfCells(on)); };

$('new').onclick = () => {
  notify(null);
  if (view === 'book') {
    if (currentBook().pages.some(Boolean) && !confirm('Start a new book? The current draft is replaced (save it to the Library first to keep it).')) return;
    openBook(emptyBook());
    return;
  }
  if (view === 'page') { replacePage(emptyPage()); return; }
  const fresh = emptySpread();
  spreadName = fresh.name;
  stores.left.replace(fresh.left);
  stores.right.replace(fresh.right);
  persistSettings();
};

const exampleSelect = $<HTMLSelectElement>('examples');
exampleSelect.append(new Option('Load example…', ''));
examples.forEach((ex, i) => exampleSelect.append(new Option(ex.name, String(i))));
exampleSelect.onchange = () => {
  const ex = examples[Number(exampleSelect.value)];
  exampleSelect.value = '';
  if (ex) { notify(null); replacePage(ex); }
};

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (name: string, fallback: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;

$('export-json').onclick = () => {
  const json = (data: unknown, name: string) =>
    download(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }), `${slug(name, 'page')}.json`);
  if (view === 'book') {
    const b = currentBook();
    const r = readBook(b);
    if (!r.ok) { notify(['Can’t export: the book breaks the format.', ...r.issues.slice(0, 8).map(formatIssue)]); return; }
    notify(null);
    json(b, b.name || 'book');
    return;
  }
  if (view === 'page') {
    const issues = validatePage(stores.page.page);
    if (issues.length) { notify(['Can’t export: the page breaks the format.', ...issues.map(formatIssue)]); return; }
    notify(null);
    json(stores.page.page, stores.page.page.name);
    return;
  }
  const spread = currentSpread();
  const r = readSpread(spread);
  if (!r.ok) { notify(['Can’t export: the spread breaks the format.', ...r.issues.map(formatIssue)]); return; }
  notify(null);
  json(spread, spread.name);
};

$('export-png').onclick = async () => {
  try {
    notify(null);
    const page = cur().page;
    download(await pageToPng(page), `${slug(page.name, 'page')}.png`);
  } catch (err) {
    notify(`PNG export failed: ${(err as Error).message}`);
  }
};

const fileInput = $<HTMLInputElement>('import-file');
$('import').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    notify(`${file.name} is not valid JSON: ${(err as Error).message}`);
    return;
  }
  const format = (parsed as { format?: unknown } | null)?.format;
  if (format === 'dotwork-library') {
    notify(`${file.name} is a library backup. Use Library, then Import library.`);
    return;
  }
  if (format === 'dotwork-book') {
    const r = readBook(parsed);
    if (!r.ok) { notify([`Not imported: ${file.name} breaks the book format.`, ...r.issues.slice(0, 12).map(formatIssue)]); return; }
    openBook(r.book);
    if (r.converted) notify(`${file.name} contained version 1 pages and they have been converted to version 2.`);
    return;
  }
  if (format === 'dotwork-spread') {
    const r = readSpread(parsed);
    if (!r.ok) { notify([`Not imported: ${file.name} breaks the spread format.`, ...r.issues.map(formatIssue)]); return; }
    openSpread(r.spread);
    if (r.converted) notify(`${file.name} contained version 1 pages and they have been converted to version 2.`);
    return;
  }
  const result = readPage(parsed);
  if (!result.ok) {
    notify([`Not imported: ${file.name} breaks the page format.`, ...result.issues.map(formatIssue)]);
    return;
  }
  notify(result.converted ? `${file.name} was a version 1 file and has been converted to version 2.` : null);
  replacePage(result.page);
};

// ---- library -------------------------------------------------------------

const libraryDialog = new LibraryDialog(library, {
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
const pageHelpKey = () => (view === 'spread' && isCompact() && showBoth ? 'page-both' : cur().mode === 'preview' ? 'page-preview' : `page-${cur().tool}`);
const helpMode = new HelpMode({ pageKey: pageHelpKey, after: document.querySelector<HTMLElement>('.topbar')! });
$('help').onclick = () => { closeContextMenu(); helpMode.start(); };

// ---- keyboard ------------------------------------------------------------

const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pattern', b: 'box', r: 'rule', c: 'checkboxes', t: 'text' };
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
  } else if (e.key.toLowerCase() === 'a' && !e.shiftKey) {
    picker.show();
  } else if (e.key.toLowerCase() in TOOL_KEYS && !e.shiftKey) {
    all.forEach((s) => s.setTool(TOOL_KEYS[e.key.toLowerCase()]));
  }
  if (e.key === 'Escape') {
    Object.values(canvases).forEach((c) => c.cancel());
    all.forEach((s) => s.setTool('select'));
    store.select(null);
  }
});
