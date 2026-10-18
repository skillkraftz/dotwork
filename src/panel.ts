import { BORDER_STYLES, EDGES, FILLS, type Edge, type Label, type Page, type Region } from './format/types';
import { findUnknownTokens, TOKENS } from './format/tokens';
import type { Store } from './store';

type Child = Node | string | null | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = v as string;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  if (tag === 'input' || tag === 'select') {
    // `value` / `checked` must be set as properties, after options exist.
    if ('value' in props) (el as HTMLInputElement).value = String(props.value);
    if ('checked' in props) (el as HTMLInputElement).checked = !!props.checked;
  }
  return el;
}

const warnUnknownTokens = (text: string) => {
  const bad = findUnknownTokens(text);
  return bad.length ? h('p', { class: 'warn' }, `Unknown token ${bad.map((b) => `{${b}}`).join(' ')} – the page can’t be exported until it is fixed.`) : null;
};

/** The side panel: page fields, plus the selected region's fill, borders and labels. */
export class Panel {
  constructor(private root: HTMLElement, private store: Store) {}

  render() {
    const { root } = this;
    // Rebuilding the panel must not steal focus from the field being typed in.
    const active = document.activeElement as HTMLInputElement | null;
    const focusKey = active && root.contains(active) ? active.dataset.key : undefined;
    const caret = focusKey ? [active!.selectionStart, active!.selectionEnd] : null;

    root.replaceChildren(this.pageSection(), ...this.regionSection());

    if (focusKey) {
      const el = root.querySelector<HTMLInputElement>(`[data-key="${focusKey}"]`);
      el?.focus();
      if (el && caret && el.type === 'text') el.setSelectionRange(caret[0], caret[1]);
    }
  }

  private editPage(key: string, fn: (p: Page) => void) {
    const next = structuredClone(this.store.page);
    fn(next);
    this.store.commit(next, key);
  }

  /** `key` null means a discrete action that always gets its own undo step. */
  private editRegion(key: string | null, fn: (r: Region) => void) {
    const i = this.store.selected;
    if (i === null) return;
    const next = structuredClone(this.store.page);
    fn(next.regions[i]);
    this.store.commit(next, key === null ? undefined : `${key}:${i}`);
  }

  private pageSection(): HTMLElement {
    const page = this.store.page;
    return h('section', {},
      h('h2', {}, 'Page'),
      h('label', {}, 'Name',
        h('input', {
          type: 'text', 'data-key': 'page-name', value: page.name,
          oninput: (e: Event) => this.editPage('page-name', (p) => { p.name = (e.target as HTMLInputElement).value; }),
        })),
      h('label', {}, 'Identity',
        h('input', {
          type: 'text', 'data-key': 'page-identity', value: page.identity ?? '',
          oninput: (e: Event) => this.editPage('page-identity', (p) => {
            const v = (e.target as HTMLInputElement).value;
            if (v) p.identity = v; else delete p.identity;
          }),
        })),
      h('p', { class: 'hint' }, `Tokens: ${TOKENS.map((t) => `{${t}}`).join(' ')}`),
      warnUnknownTokens(page.identity ?? ''),
    );
  }

  private regionSection(): Node[] {
    const { store } = this;
    const i = store.selected;
    if (i === null) {
      return [h('section', {}, h('h2', {}, 'Region'),
        h('p', { class: 'hint' }, 'Drag from dot to dot on the page to draw a region, or click a region to edit it.'))];
    }
    const r = store.page.regions[i];

    const select = (key: string, options: readonly string[], value: string, onchange: (v: string) => void) =>
      h('select', { 'data-key': key, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
        ...options.map((o) => h('option', { value: o, selected: o === value }, o)));

    const borders = EDGES.map((edge: Edge) =>
      h('label', { class: 'inline' }, edge,
        select(`border-${edge}`, ['none', ...BORDER_STYLES], r.border?.[edge] ?? 'none', (v) =>
          this.editRegion(null, (rg) => {
            if (v === 'none') { if (rg.border) delete rg.border[edge]; }
            else (rg.border ??= {})[edge] = v as 'thin' | 'thick';
          }))));

    const labels = (r.labels ?? []).map((l, j) => this.labelEditor(l, j, r));

    return [h('section', {},
      h('h2', {}, `Region ${i + 1}`),
      h('p', { class: 'hint' }, `x ${r.x}, y ${r.y}, ${r.w} × ${r.h} cells`),
      h('label', {}, 'Fill',
        select('fill', FILLS, r.fill, (v) => this.editRegion(null, (rg) => { rg.fill = v as Region['fill']; }))),
      h('h3', {}, 'Borders'),
      h('div', { class: 'grid2' }, ...borders),
      h('h3', {}, 'Labels'),
      ...labels,
      h('button', {
        type: 'button',
        onclick: () => this.editRegion(null, (rg) => { (rg.labels ??= []).push({ text: 'Label:', row: 0 }); }),
      }, 'Add label'),
      h('button', { type: 'button', class: 'danger', onclick: () => deleteSelected(store) }, 'Delete region'),
    )];
  }

  private labelEditor(l: Label, j: number, r: Region): HTMLElement {
    const edit = (key: string, fn: (l: Label) => void) =>
      this.editRegion(`${key}-${j}`, (rg) => fn(rg.labels![j]));
    return h('div', { class: 'label-box' },
      h('input', {
        type: 'text', 'data-key': `label-text-${j}`, value: l.text, 'aria-label': 'Label text',
        oninput: (e: Event) => edit('label-text', (lb) => { lb.text = (e.target as HTMLInputElement).value; }),
      }),
      warnUnknownTokens(l.text),
      h('div', { class: 'row' },
        h('label', { class: 'inline' }, 'row',
          h('input', {
            type: 'number', min: 0, max: r.h - 1, step: 1, 'data-key': `label-row-${j}`, value: l.row ?? 0,
            oninput: (e: Event) => {
              const v = parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isInteger(v)) edit('label-row', (lb) => { lb.row = Math.max(0, Math.min(r.h - 1, v)); });
            },
          })),
        h('label', { class: 'inline' }, 'align',
          h('select', {
            'data-key': `label-align-${j}`,
            onchange: (e: Event) => edit('label-align', (lb) => { lb.align = (e.target as HTMLSelectElement).value as 'left' | 'right'; }),
          }, h('option', { value: 'left', selected: l.align !== 'right' }, 'left'),
             h('option', { value: 'right', selected: l.align === 'right' }, 'right'))),
        h('label', { class: 'inline' },
          h('input', {
            type: 'checkbox', 'data-key': `label-vertical-${j}`, checked: !!l.vertical,
            onchange: (e: Event) => edit('label-vertical', (lb) => { lb.vertical = (e.target as HTMLInputElement).checked; }),
          }), 'vertical'),
        h('button', {
          type: 'button', 'aria-label': 'Remove label', title: 'Remove label',
          onclick: () => this.editRegion(null, (rg) => { rg.labels!.splice(j, 1); }),
        }, '×')),
    );
  }
}

export function deleteSelected(store: Store) {
  const i = store.selected;
  if (i === null) return;
  const next = structuredClone(store.page);
  next.regions.splice(i, 1);
  store.selected = null;
  store.commit(next);
}
