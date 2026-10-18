import './style.css';
import { emptyPage, type Page } from './format/types';
import { formatIssue, validatePage } from './format/validate';
import { Canvas } from './canvas';
import { deleteSelected, Panel } from './panel';
import { pageToPng } from './png';
import { Store } from './store';
import oflUrl from './fonts/OFL.txt?url';

const STORAGE_KEY = 'dotwork.page';

const examples = Object.entries(
  import.meta.glob<Page>('../examples/*.json', { eager: true, import: 'default' }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, page]) => page);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSaved(): Page {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validatePage(parsed).length === 0) return parsed;
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return emptyPage();
}

const store = new Store(loadSaved());

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
  close.onclick = () => notify(null);
  noticeEl.replaceChildren(body, close);
  noticeEl.hidden = false;
}

// ---- views ---------------------------------------------------------------

const canvas = new Canvas($('canvas') as unknown as SVGSVGElement, store, notify);
const panel = new Panel($('panel'), store);

function save() {
  if (validatePage(store.page).length > 0) return; // keep the last valid draft
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store.page)); } catch { /* ignore */ }
}

function refresh() {
  canvas.render();
  panel.render();
  const preview = store.mode === 'preview';
  $('mode-edit').setAttribute('aria-pressed', String(!preview));
  $('mode-preview').setAttribute('aria-pressed', String(preview));
  ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !store.canRedo;
  $('panel').hidden = preview;
  $('status').innerHTML = preview
    ? `Preview: the page as it prints, with sample values for tokens. Courier Prime © The Courier Prime Project Authors, <a href="${oflUrl}">SIL OFL 1.1</a>.`
    : `Drag from dot to dot to draw a region. Click to select; drag to move; drag edges or corners to resize; Delete removes. Courier Prime © The Courier Prime Project Authors, <a href="${oflUrl}">SIL OFL 1.1</a>.`;
}

let lastPage = store.page;
store.subscribe(() => {
  if (store.page !== lastPage) {
    lastPage = store.page;
    save();
  }
  refresh();
});
refresh();

// ---- toolbar -------------------------------------------------------------

$('mode-edit').onclick = () => store.setMode('edit');
$('mode-preview').onclick = () => { notify(null); store.setMode('preview'); };
$('undo').onclick = () => store.undo();
$('redo').onclick = () => store.redo();

function replacePage(page: Page) {
  store.selected = null;
  store.commit(structuredClone(page));
}

$('new').onclick = () => { notify(null); replacePage(emptyPage()); };

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
const slug = () => store.page.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';

$('export-json').onclick = () => {
  const issues = validatePage(store.page);
  if (issues.length) {
    notify(['Can’t export: the page breaks the format.', ...issues.map(formatIssue)]);
    return;
  }
  notify(null);
  download(new Blob([JSON.stringify(store.page, null, 2) + '\n'], { type: 'application/json' }), `${slug()}.json`);
};

$('export-png').onclick = async () => {
  try {
    notify(null);
    download(await pageToPng(store.page), `${slug()}.png`);
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
  const issues = validatePage(parsed);
  if (issues.length) {
    notify([`Not imported: ${file.name} breaks the page format.`, ...issues.map(formatIssue)]);
    return;
  }
  notify(null);
  replacePage(parsed as Page);
};

// ---- keyboard ------------------------------------------------------------

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t instanceof HTMLInputElement && t.type === 'text';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (typing) return; // let the field undo its own text
    e.preventDefault();
    if (e.shiftKey) store.redo(); else store.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    if (typing) return;
    e.preventDefault();
    store.redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.mode === 'edit' && !typing && !(t instanceof HTMLSelectElement) && !(t instanceof HTMLInputElement)) {
    e.preventDefault();
    deleteSelected(store);
  } else if (e.key === 'Escape') {
    canvas.cancel();
    store.select(null);
  }
});
