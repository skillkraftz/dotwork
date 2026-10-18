import './style.css';
import { emptyPage, type Page } from './format/types';
import { formatIssue, validatePage } from './format/validate';
import { readPage } from './format/read';
import { Canvas } from './canvas';
import { deleteElement, duplicateElement, nudgeElement } from './actions';
import { Panel } from './panel';
import { pageToPng } from './png';
import { Store, type Tool } from './store';
import oflUrl from './fonts/OFL.txt?url';

const STORAGE_KEY = 'dotwork.page';

const examples = Object.entries(import.meta.glob<unknown>('../examples/*.json', { eager: true, import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, raw]) => {
    const r = readPage(raw);
    return r.ok ? [r.page] : [];
  });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSaved(): Page {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const r = readPage(JSON.parse(raw));
      if (r.ok) return r.page;
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
  $('tools').hidden = preview;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool));
  }
  ($('half-cells') as HTMLInputElement).checked = store.halfCells;
  const credit = `Courier Prime © The Courier Prime Project Authors, <a href="${oflUrl}">SIL OFL 1.1</a>.`;
  $('status').innerHTML = preview
    ? `Preview: the page as it prints, with sample values for tokens. ${credit}`
    : `${HINTS[store.tool]} Hold Shift (or tick Half cells) to snap to half cells. ${credit}`;
}

const HINTS: Record<Tool, string> = {
  select: 'Click to select (Alt-click to reach what’s underneath); drag to move; drag handles to resize; arrow keys nudge a cell; Ctrl/Cmd+D duplicates; Delete removes.',
  shade: 'Drag on the page to shade an area.',
  pattern: 'Drag on the page to fill an area with lines, a grid or dots.',
  box: 'Drag on the page to draw a box.',
  rule: 'Drag along a grid line to draw a rule.',
  checkboxes: 'Drag down or across to lay out a strip of checkboxes.',
  text: 'Click where the text should sit, then type it in the panel.',
};

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
  store.replace(structuredClone(page));
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  b.onclick = () => store.setTool(b.dataset.tool as Tool);
}
$<HTMLInputElement>('half-cells').onchange = (e) => store.setHalfCells((e.target as HTMLInputElement).checked);

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
  const result = readPage(parsed);
  if (!result.ok) {
    notify([`Not imported: ${file.name} breaks the page format.`, ...result.issues.map(formatIssue)]);
    return;
  }
  notify(result.converted ? `${file.name} was a version 1 file and has been converted to version 2.` : null);
  replacePage(result.page);
};

// ---- keyboard ------------------------------------------------------------

const TOOL_KEYS: Record<string, Tool> = { v: 'select', s: 'shade', p: 'pattern', b: 'box', r: 'rule', c: 'checkboxes', t: 'text' };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

addEventListener('keydown', (e) => {
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
  } else if (e.key.toLowerCase() in TOOL_KEYS && !e.shiftKey) {
    store.setTool(TOOL_KEYS[e.key.toLowerCase()]);
  }
  if (e.key === 'Escape') {
    canvas.cancel();
    store.setTool('select');
    store.select(null);
  }
});
