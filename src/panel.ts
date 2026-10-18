import {
  ALIGNS, DEFAULTS, DIRECTIONS, PAGE_SIDES, PATTERNS, RULE_WEIGHTS, SIDES, STRIPES, TEXT_SIZES, TEXT_STYLES,
  TEXT_TONES, TONES, WEIGHTS, type BoxSide, type Page, type PageElement,
} from './format/types';
import { findUnknownTokens, TOKENS } from './format/tokens';
import { validateElement } from './format/validate';
import { canNudge, deleteElement, duplicateElement, nudgeButton, nudgeStep, reorderElement } from './actions';
import type { Store } from './store';

type Child = Node | string | null | false;

export function h<K extends keyof HTMLElementTagNameMap>(
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

const ICONS = {
  show: '<path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/>',
  hide: '<path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"/><path d="M2 14L14 2"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5"/><path d="M5.5 7V5a2.5 2.5 0 015-.5"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.5 9h6l.5-9"/>',
  left: '<path d="M10 3L5 8l5 5"/>',
  right: '<path d="M6 3l5 5-5 5"/>',
  nudgeUp: '<path d="M3 10l5-5 5 5"/>',
  nudgeDown: '<path d="M3 6l5 5 5-5"/>',
};

function icon(name: keyof typeof ICONS, label: string, onclick: () => void, opts: { disabled?: boolean; pressed?: boolean; key?: string; class?: string } = {}) {
  const b = h('button', { type: 'button', class: opts.class ? `icon ${opts.class}` : 'icon', title: label, 'aria-label': label, disabled: opts.disabled, 'data-key': opts.key, onclick });
  b.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
  return b;
}

const fmt = (v: number) => String(+v.toFixed(2));

/** A one-line description of an element for the layers list. */
export function describe(el: PageElement): string {
  switch (el.type) {
    case 'shade': return `shade ${el.tone ?? DEFAULTS.tone}${el.stripes && el.stripes !== 'none' ? ` ${el.stripes}` : ''} · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}`;
    case 'pattern': return `${el.pattern} · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}`;
    case 'box': return `box · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}`;
    case 'rule': return `rule · ${fmt(el.x1)},${fmt(el.y1)} → ${fmt(el.x2)},${fmt(el.y2)}`;
    case 'checkboxes': return `checkboxes · ${fmt(el.x)},${fmt(el.y)} ×${el.count}`;
    case 'text': return `text · “${el.text.length > 22 ? el.text.slice(0, 21) + '…' : el.text}”`;
  }
}

export type PanelTab = 'properties' | 'layers' | 'page';
const TABS: [PanelTab, string][] = [['properties', 'Properties'], ['layers', 'Layers'], ['page', 'Page']];

/**
 * The side panel: page settings, the layers list, and the selected element's properties. On a wide screen all
 * three show at once; on a narrow one (the bottom sheet) the tabs pick one.
 */
export class Panel {
  /** Which section the tabs show on a narrow screen. */
  tab: PanelTab = 'properties';
  /** Called when a tab is picked, so the sheet can open or grow. */
  onTab: ((tab: PanelTab) => void) | null = null;

  /** Where the reason the last typed value was refused is shown. */
  private problemEl: HTMLElement | null = null;

  /** In a spread the side belongs to the slot the page is in, so the field is replaced by a note. */
  lockedSide: 'left' | 'right' | null = null;

  constructor(private root: HTMLElement, public store: Store) {}

  render() {
    const { root } = this;
    // Rebuilding the panel must not steal focus from the field being typed in.
    const active = document.activeElement as HTMLInputElement | null;
    const focusKey = active && root.contains(active) ? active.dataset.key : undefined;
    const caret = focusKey ? [active!.selectionStart, active!.selectionEnd] : null;
    const scroll = root.querySelector('.layers')?.scrollTop ?? 0;

    root.dataset.tab = this.tab;
    root.replaceChildren(this.tabBar(), this.pageSection(), this.layersSection(), this.propertiesSection());
    const layers = root.querySelector('.layers');
    if (layers) layers.scrollTop = scroll;
    root.querySelector('.layer.selected')?.scrollIntoView({ block: 'nearest' });

    if (focusKey) {
      const el = root.querySelector<HTMLInputElement>(`[data-key="${focusKey}"]`);
      el?.focus();
      if (el && caret && el.type === 'text') el.setSelectionRange(caret[0], caret[1]);
    }
  }

  private tabBar(): HTMLElement {
    return h('div', { class: 'tabs', role: 'tablist' }, ...TABS.map(([id, label]) =>
      h('button', {
        type: 'button', role: 'tab', 'data-tab-button': id, 'aria-selected': this.tab === id, 'aria-pressed': this.tab === id, 'data-key': `tab-${id}`,
        onclick: () => { this.tab = id; this.onTab?.(id); this.render(); },
      }, label)));
  }

  // ---- page ---------------------------------------------------------------

  private editPage(key: string, fn: (p: Page) => void) {
    const next = structuredClone(this.store.page);
    fn(next);
    this.store.commit(next, key);
  }

  private pageSection(): HTMLElement {
    const page = this.store.page;
    return h('section', { 'data-tab': 'page' },
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
      warnUnknownTokens(page.identity ?? ''),
      this.lockedSide
        ? h('p', { class: 'hint' }, `This is the ${this.lockedSide} page of the spread.`)
        : h('label', {}, 'Side',
          this.select('page-side', PAGE_SIDES, page.side ?? DEFAULTS.side, (v) => this.editPage('page-side', (p) => {
            if (v === 'either') delete p.side; else p.side = v as Page['side'];
          }))),
      h('p', { class: 'hint' }, `Tokens: ${TOKENS.map((t) => `{${t}}`).join(' ')}`),
      h('p', { class: 'hint' }, 'The spine is right of a left page, left of a right page; “either” shows as a right page.'),
    );
  }

  // ---- layers -------------------------------------------------------------

  private layersSection(): HTMLElement {
    const { store } = this;
    const els = store.page.elements;
    const rows = els.map((el, i) => {
      const hidden = store.isHidden(i), locked = store.isLocked(i);
      const row = h('li', {
        class: `layer${store.selected === i ? ' selected' : ''}${hidden ? ' is-hidden' : ''}`,
        draggable: matchMedia('(pointer: fine)').matches ? 'true' : null, // drag and drop is a desktop shortcut; the arrows work everywhere
        ondragstart: (e: DragEvent) => { e.dataTransfer?.setData('text/plain', String(i)); e.dataTransfer!.effectAllowed = 'move'; },
        ondragover: (e: DragEvent) => { e.preventDefault(); row.classList.add('drop'); },
        ondragleave: () => row.classList.remove('drop'),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          const from = Number(e.dataTransfer?.getData('text/plain'));
          if (Number.isInteger(from)) reorderElement(store, from, i);
        },
      },
        h('button', { type: 'button', class: 'layer-name', 'aria-current': store.selected === i, onclick: () => store.select(i) }, describe(el)),
        icon(hidden ? 'hide' : 'show', hidden ? 'Show' : 'Hide', () => store.toggleHidden(i), { pressed: hidden }),
        icon(locked ? 'lock' : 'unlock', locked ? 'Unlock' : 'Lock', () => store.toggleLocked(i), { pressed: locked }),
        icon('up', 'Move up (toward the front)', () => reorderElement(store, i, i + 1), { disabled: i === els.length - 1 }),
        icon('down', 'Move down (toward the back)', () => reorderElement(store, i, i - 1), { disabled: i === 0 }),
        icon('trash', 'Delete', () => deleteElement(store, i), { disabled: locked }),
      );
      return row;
    });
    return h('section', { 'data-tab': 'layers' },
      h('h2', {}, 'Layers'),
      els.length
        ? h('div', {},
          h('p', { class: 'hint end' }, 'Top: drawn last'),
          h('ol', { class: 'layers' }, ...rows.reverse()),
          h('p', { class: 'hint end' }, 'Bottom: drawn first'))
        : h('p', { class: 'hint' }, 'Nothing on the page yet. Pick a tool and draw on the page.'),
      els.length ? h('p', { class: 'hint' }, 'Use the arrows to reorder (or drag a row). Hiding affects only this editor.') : null,
    );
  }

  // ---- properties ---------------------------------------------------------

  private select(key: string, options: readonly (string | number)[], value: string | number, onchange: (v: string) => void) {
    return h('select', { 'data-key': key, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
      ...options.map((o) => h('option', { value: o, selected: o === value }, String(o))));
  }

  /** Commit an edit of the selected element, unless it would make the element invalid (then say why). */
  private edit(key: string | null, fn: (el: PageElement) => void) {
    const { store } = this;
    const i = store.selected;
    if (i === null) return;
    const el = structuredClone(store.page.elements[i]);
    fn(el);
    const issues = validateElement(el);
    if (issues.length) {
      this.showProblem(issues[0].message);
      return;
    }
    const next = structuredClone(store.page);
    next.elements[i] = el;
    store.commit(next, key === null ? undefined : `${key}:${store.idAt(i)}`);
  }

  private showProblem(message: string) {
    if (this.problemEl) { this.problemEl.textContent = message; this.problemEl.hidden = false; }
  }

  private num(el: PageElement, key: string, label: string, opts: { step?: number; min?: number; max?: number } = {}) {
    const rec = el as unknown as Record<string, number | undefined>;
    return h('label', { class: 'field' }, label,
      h('input', {
        type: 'number', 'data-key': `prop-${key}`, step: opts.step ?? 0.5, min: opts.min, max: opts.max,
        value: rec[key] ?? (DEFAULTS as unknown as Record<string, number>)[key === 'size' ? 'checkSize' : key] ?? '',
        oninput: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) this.edit(key, (x) => { (x as unknown as Record<string, number>)[key] = v; });
        },
      }));
  }

  private choice<T extends string | number>(el: PageElement, key: string, label: string, options: readonly T[], dflt: T) {
    const rec = el as unknown as Record<string, T | undefined>;
    return h('label', { class: 'field' }, label,
      this.select(`prop-${key}`, options, rec[key] ?? dflt, (v) => this.edit(null, (x) => {
        (x as unknown as Record<string, T>)[key] = (typeof dflt === 'number' ? Number(v) : v) as T;
      })));
  }

  private fields(el: PageElement): Child[] {
    const area = [this.num(el, 'x', 'x'), this.num(el, 'y', 'y'), this.num(el, 'w', 'w', { min: 0.5 }), this.num(el, 'h', 'h', { min: 0.5 })];
    switch (el.type) {
      case 'shade':
        return [h('div', { class: 'grid2' }, ...area),
          this.choice(el, 'tone', 'Tone', TONES, DEFAULTS.tone),
          this.choice(el, 'stripes', 'Stripes', STRIPES, DEFAULTS.stripes)];
      case 'pattern':
        return [h('div', { class: 'grid2' }, ...area),
          this.choice(el, 'pattern', 'Pattern', PATTERNS, el.pattern),
          h('div', { class: 'grid2' }, this.num(el, 'every', 'Every (cells)', { min: 0.5 }))];
      case 'box': {
        const sides = h('div', { class: 'grid2' }, ...SIDES.map((s: BoxSide) =>
          h('label', { class: 'inline' },
            h('input', {
              type: 'checkbox', 'data-key': `prop-side-${s}`, checked: (el.sides ?? SIDES).includes(s),
              onchange: (e: Event) => this.edit(null, (x) => {
                const b = x as typeof el;
                const on = (e.target as HTMLInputElement).checked;
                const next = SIDES.filter((t) => (t === s ? on : (b.sides ?? SIDES).includes(t)));
                if (next.length === SIDES.length) delete b.sides; else b.sides = next;
              }),
            }), s)));
        return [h('div', { class: 'grid2' }, ...area), h('h3', {}, 'Sides'), sides,
          this.choice(el, 'weight', 'Weight', WEIGHTS, DEFAULTS.boxWeight)];
      }
      case 'rule':
        return [h('div', { class: 'grid2' }, this.num(el, 'x1', 'x1'), this.num(el, 'y1', 'y1'), this.num(el, 'x2', 'x2'), this.num(el, 'y2', 'y2')),
          this.choice(el, 'weight', 'Weight', RULE_WEIGHTS, DEFAULTS.ruleWeight)];
      case 'checkboxes':
        return [h('div', { class: 'grid2' }, this.num(el, 'x', 'x'), this.num(el, 'y', 'y'),
          this.num(el, 'count', 'Count', { step: 1, min: 1 }), this.num(el, 'every', 'Spacing (cells)', { min: 0.5 })),
        this.choice(el, 'direction', 'Direction', DIRECTIONS, DEFAULTS.direction),
        h('div', { class: 'grid2' }, this.num(el, 'size', 'Size (0.5–1)', { step: 0.05, min: 0.5, max: 1 })),
        this.choice(el, 'weight', 'Weight', WEIGHTS, DEFAULTS.boxWeight)];
      case 'text':
        return [
          h('label', { class: 'field' }, 'Text',
            h('input', {
              type: 'text', 'data-key': 'prop-text', value: el.text,
              oninput: (e: Event) => this.edit('text', (x) => { (x as typeof el).text = (e.target as HTMLInputElement).value; }),
            })),
          warnUnknownTokens(el.text),
          h('div', { class: 'grid2' }, this.num(el, 'x', 'x'), this.num(el, 'y', 'y')),
          this.choice(el, 'size', 'Size', TEXT_SIZES, DEFAULTS.textSize),
          this.choice(el, 'style', 'Style', TEXT_STYLES, DEFAULTS.style),
          this.choice(el, 'tone', 'Tone', TEXT_TONES, DEFAULTS.textTone),
          this.choice(el, 'align', 'Align', ALIGNS, DEFAULTS.align),
          this.choice(el, 'rotate', 'Rotate (°)', [0, 90, 270] as const, 0 as 0 | 90 | 270),
        ];
    }
  }

  /** Arrow buttons that move the selection by a cell, or half a cell with the half-cell toggle on. */
  private nudgePad(i: number): HTMLElement {
    const { store } = this;
    const arrow = (name: keyof typeof ICONS, label: string, dx: number, dy: number, area: string) =>
      icon(name, `Nudge ${label}`, () => nudgeButton(store, i, dx, dy), { disabled: !canNudge(store, i, dx, dy), key: `nudge-${label}`, class: `nudge ${area}` });
    const half = h('button', {
      type: 'button', class: 'nudge step', 'data-key': 'nudge-half', 'aria-pressed': store.halfCells,
      title: 'Nudge by half a cell instead of a whole cell', onclick: () => store.setHalfCells(!store.halfCells),
    }, nudgeStep(store) === 0.5 ? '½' : '1');
    return h('div', { class: 'nudge-pad', role: 'group', 'aria-label': 'Nudge' },
      arrow('nudgeUp', 'up', 0, -1, 'up'), arrow('left', 'left', -1, 0, 'left'), half, arrow('right', 'right', 1, 0, 'right'), arrow('nudgeDown', 'down', 0, 1, 'down'));
  }

  private propertiesSection(): HTMLElement {
    const { store } = this;
    const i = store.selected;
    if (i === null) {
      return h('section', { 'data-tab': 'properties' }, h('h2', {}, 'Properties'),
        h('p', { class: 'hint' }, 'Tap or click an element to select it. Long-press it (or Alt-click) to reach the ones underneath.'));
    }
    const el = store.page.elements[i];
    const locked = store.isLocked(i);
    const problemEl = h('p', { class: 'warn', hidden: true });
    this.problemEl = problemEl;
    return h('section', { 'data-tab': 'properties' },
      h('h2', {}, `Properties · ${el.type}`),
      locked ? h('p', { class: 'hint' }, 'Locked: unlock it in the layers list to edit.') : null,
      this.nudgePad(i),
      h('fieldset', { disabled: locked }, ...this.fields(el), problemEl),
      h('div', { class: 'row' },
        h('button', { type: 'button', disabled: locked, onclick: () => duplicateElement(store, i) }, 'Duplicate'),
        h('button', { type: 'button', class: 'danger', disabled: locked, onclick: () => deleteElement(store, i) }, 'Delete')),
    );
  }
}
