import {
  ALIGNS, ALONGS, DEFAULTS, DIRECTIONS, DOT_SIZES, ICON_SIZES, PAGE_SIDES, PATTERNS, RULE_WEIGHTS, SEQUENCE_VALUES, SIDES, TEXT_SIZES, TEXT_STYLES,
  TEXT_TONES, WEIGHTS, type BoxSide, type Page, type PageElement, type Pattern, type Sequence, type SequenceValues, type Shade,
} from './format/types';
import { cleanTones, toneAt } from './format/shade';
import { SHADE_TONES } from './render';
import { iconGlyph } from './icons/glyph';
import { findUnknownTokens, TOKENS } from './format/tokens';
import { validateElement } from './format/validate';
import { canNudge, deleteElement, deleteElements, duplicateElement, nudgeButton, nudgeStep, reorderElement } from './actions';
import type { Store } from './store';
import type { ValidationIssue } from './format/validate';

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

const warnNodes = (text: string): HTMLElement[] => {
  const bad = findUnknownTokens(text);
  return bad.length ? [h('p', { class: 'warn' }, `Unknown token ${bad.map((b) => `{${b}}`).join(' ')} – the page can’t be exported until it is fixed.`)] : [];
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

function icon(name: keyof typeof ICONS, label: string, onclick: () => void, opts: { disabled?: boolean; pressed?: boolean; key?: string; class?: string; help?: string } = {}) {
  const b = h('button', { type: 'button', class: opts.class ? `icon ${opts.class}` : 'icon', title: label, 'aria-label': label, disabled: opts.disabled, 'data-key': opts.key, 'data-help': opts.help, onclick });
  b.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
  return b;
}

const fmt = (v: number) => String(+v.toFixed(2));

/** Change what a sequence is made of, giving the new kind what it needs and dropping what it doesn't use. */
function switchValues(x: Sequence, to: SequenceValues) {
  x.values = to;
  delete x.start; delete x.step;
  if (to === 'list') x.list ??= ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  if (to === 'icons') x.icons ??= ['star'];
  if (to !== 'icons') { delete x.size; if (x.every !== undefined && x.every < 1) x.every = 1; }
}

/** A one-line description of an element for the layers list. */
export function describe(el: PageElement): string {
  const group = el.group === undefined ? '' : ` · ${el.group}`;
  switch (el.type) {
    case 'pattern': return `${el.pattern} · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}${group}`;
    case 'shade': return `shade ${el.tones}${el.along && el.along !== 'rows' ? ` ${el.along}` : ''} · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}${group}`;
    case 'sequence': return `${el.values === 'icons' ? 'icons' : `sequence ${el.values ?? DEFAULTS.values}`} · ${fmt(el.x)},${fmt(el.y)} ×${el.count}${group}`;
    case 'box': return `box · ${fmt(el.x)},${fmt(el.y)} ${fmt(el.w)}×${fmt(el.h)}${group}`;
    case 'rule': return `rule · ${fmt(el.x1)},${fmt(el.y1)} → ${fmt(el.x2)},${fmt(el.y2)}${group}`;
    case 'checkboxes': return `checkboxes · ${fmt(el.x)},${fmt(el.y)} ×${el.count}${group}`;
    case 'text': return `text · “${el.text.length > 22 ? el.text.slice(0, 21) + '…' : el.text}”${group}`;
  }
}

/** Read a typed number: a decimal point or comma, optional sign; null for anything that isn't one (yet). */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

/** The reason a refused edit gives, short enough for the line under a field. */
export function shortProblem(issue: ValidationIssue): string {
  const key = issue.path.split('.').pop() ?? '';
  switch (issue.rule) {
    case 'half-cell': return `${key} must be a multiple of 0.5.`;
    case 'every': return 'Spacing must be a positive multiple of 0.5.';
    case 'count': return 'Count must be a whole number, 1 or more.';
    case 'size': return key === 'size' ? 'Size must be from 0.5 to 1.' : 'It needs a width, a height or a length above 0.';
    case 'bounds':
    case 'header-row': return 'That doesn’t fit on the grid, below the header row.';
    case 'diagonal': return 'A rule must be horizontal or vertical.';
    case 'sequence': return issue.message;
    default: return issue.message;
  }
}

export type PanelTab = 'properties' | 'layers' | 'page';
const TABS: [PanelTab, string][] = [['properties', 'Properties'], ['layers', 'Layers'], ['page', 'Page']];

/** How long after the last keystroke a typed number is taken as meant. */
const PAUSE_MS = 900;
/** Holding a stepper: wait this long, then repeat at this rate. */
const HOLD_MS = 420;
const REPEAT_MS = 90;

/** A control in the panel that follows the page: `sync` brings it up to date without replacing it. */
interface Ctl { sync(): void; flush(): void }
interface Built { node: HTMLElement; ctl: Ctl }

/** How far a stepper moves a number: a cell (or half a cell with Half on), or a fixed amount. */
type StepBy = 'cell' | number;

/**
 * The side panel: page settings, the layers list, and the selected element's properties. On a wide screen all
 * three show at once; on a narrow one (the bottom sheet) the tabs pick one.
 *
 * The panel is built once and then updated in place. A field being typed in is never replaced (a phone drops its
 * keyboard when that happens): only the properties section is rebuilt, and only when the selection changes to a
 * different element.
 */
export class Panel {
  /** Which section the tabs show on a narrow screen. */
  tab: PanelTab = 'properties';
  /** Called when a tab is picked, so the sheet can open or grow. */
  onTab: ((tab: PanelTab) => void) | null = null;
  /** Save the selected elements as a widget. */
  saveWidget: (() => void) | null = null;
  /** Open the icon grid and call back with the icon picked. */
  pickIcon: ((pick: (name: string) => void) => void) | null = null;

  /** In a spread the side belongs to the slot the page is in, so the field is replaced by a note. */
  lockedSide: 'left' | 'right' | null = null;

  private tabButtons = new Map<PanelTab, HTMLElement>();
  private pageEl = h('section', { 'data-tab': 'page' });
  private layersEl = h('section', { 'data-tab': 'layers' });
  private propsEl = h('section', { 'data-tab': 'properties' });
  private pageCtls: Ctl[] = [];
  private sideSlot = h('div');
  private sideKey = '';
  private identityWarn = h('div');
  private layersSig = '';
  private layersFor: { store: Store; selected: number | null } | null = null;
  private propsKey = '';
  private propCtls: Ctl[] = [];
  private lockedHint = h('p', { class: 'hint', hidden: true }, 'Locked: unlock it in the layers list to edit.');
  private fieldset: HTMLFieldSetElement | null = null;
  private stepId = 0;

  constructor(private root: HTMLElement, public store: Store) {
    this.buildPage();
    root.replaceChildren(this.tabBar(), this.pageEl, this.layersEl, this.propsEl);
  }

  render() {
    this.root.dataset.tab = this.tab;
    for (const [id, b] of this.tabButtons) { b.setAttribute('aria-selected', String(this.tab === id)); b.setAttribute('aria-pressed', String(this.tab === id)); }
    this.syncPage();
    this.syncLayers();
    this.syncProps();
  }

  /** Take whatever has been typed but not yet applied (when the modal closes, say). */
  flush() {
    for (const c of [...this.pageCtls, ...this.propCtls]) c.flush();
  }

  private tabBar(): HTMLElement {
    return h('div', { class: 'tabs', role: 'tablist' }, ...TABS.map(([id, label]) => {
      const b = h('button', {
        type: 'button', role: 'tab', 'data-tab-button': id, 'data-key': `tab-${id}`, 'data-help': `tab-${id}`,
        onclick: () => { this.tab = id; this.onTab?.(id); this.render(); },
      }, label);
      this.tabButtons.set(id, b);
      return b;
    }));
  }

  // ---- fields ---------------------------------------------------------------

  private select(key: string, help: string, options: readonly (string | number)[], value: string | number, onchange: (v: string) => void) {
    return h('select', { 'data-key': key, 'data-help': help, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
      ...options.map((o) => h('option', { value: o, selected: o === value }, String(o))));
  }

  /** The small line under a field that says why a value was refused. */
  private message() {
    const el = h('span', { class: 'fmsg', role: 'status', hidden: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      el,
      show(text: string) { el.textContent = text; el.hidden = false; clearTimeout(timer); timer = setTimeout(() => { el.hidden = true; }, 5000); },
      hide() { el.hidden = true; clearTimeout(timer); },
    };
  }

  /**
   * A text field that applies what is typed as it is typed, without ever being replaced. A value the page refuses
   * stays in the field, with the reason beside it, until the field is left; then it reverts.
   */
  private textField(o: { label: string; key: string; help: string; read: () => string; write: (v: string) => string | null }): Built {
    const msg = this.message();
    let dirty = false;
    const input = h('input', {
      type: 'text', id: o.key, 'data-key': o.key, 'data-help': o.help, value: o.read(), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
      oninput: () => {
        dirty = true;
        const problem = o.write(input.value);
        if (problem) msg.show(problem); else { msg.hide(); dirty = false; }
      },
      onblur: () => flush(),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && matchMedia('(pointer: coarse)').matches) input.blur(); },
    });
    const flush = () => { if (dirty) { dirty = false; input.value = o.read(); } };
    const sync = () => { if (!dirty && input.value !== o.read()) input.value = o.read(); };
    return { node: h('div', { class: 'field' }, h('label', { for: o.key }, o.label), input, msg.el), ctl: { sync, flush } };
  }

  /** Commit an edit of the element at `i` (which must still be the one with `id`); returns why it was refused, if it was. */
  private edit(store: Store, i: number, id: number, key: string | null, fn: (el: PageElement) => void): string | null {
    if (store.idAt(i) !== id) return null; // that element is gone; there is nothing to change
    if (store.isLocked(i)) return 'Locked: unlock it in the layers list to edit.';
    const el = structuredClone(store.page.elements[i]);
    fn(el);
    const issues = validateElement(el);
    if (issues.length) return shortProblem(issues[0]);
    const next = structuredClone(store.page);
    next.elements[i] = el;
    store.commit(next, key === null ? undefined : `${key}:${id}`);
    return null;
  }

  /**
   * A number: a − button, the value, a + button. Typing in the value applies it on Enter, on leaving the field or
   * after a pause, never mid-keystroke; a value the page can't take reverts with a message. Each tap of a stepper is
   * one undo step; holding one repeats, and the whole hold is one undo step.
   */
  private numberField(store: Store, i: number, id: number, o: { key: string; label: string; help: string; by: StepBy }): Built {
    const { key } = o;
    const read = (): number | undefined => {
      if (store.idAt(i) !== id) return undefined;
      const rec = store.page.elements[i] as unknown as Record<string, number | undefined>;
      return rec[key] ?? (key === 'size' ? DEFAULTS.checkSize : key === 'every' ? DEFAULTS.every : key === 'start' ? DEFAULTS.start : key === 'step' ? DEFAULTS.step : undefined);
    };
    const stepSize = () => (o.by === 'cell' ? nudgeStep(store) : o.by);
    const apply = (v: number, group: string | null): string | null => this.edit(store, i, id, group ?? key, (x) => { (x as unknown as Record<string, number>)[key] = v; });
    const msg = this.message();
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const revert = (problem: string | null) => {
      dirty = false;
      const v = read();
      input.value = v === undefined ? '' : fmt(v);
      if (problem) msg.show(problem);
    };
    /** Apply what is typed. While typing (`pause`), half-typed text is left alone; leaving the field settles it. */
    const settle = (how: 'pause' | 'done') => {
      clearTimeout(timer);
      if (!dirty) return;
      const v = parseNumber(input.value);
      if (v === null) { if (how === 'done') revert('Type a number, like 1.5.'); return; }
      const problem = apply(v, null);
      if (problem) { revert(problem); return; }
      dirty = false;
      msg.hide();
      if (how === 'done') input.value = fmt(v);
    };

    const input = h('input', {
      type: 'text', id: `prop-${key}`, inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'data-key': `prop-${key}`, 'data-help': o.help, value: fmt(read() ?? 0),
      oninput: () => { dirty = true; msg.hide(); clearTimeout(timer); timer = setTimeout(() => settle('pause'), PAUSE_MS); },
      onblur: () => settle('done'),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { settle('done'); if (matchMedia('(pointer: coarse)').matches) input.blur(); else input.select(); } },
    });

    const step = (dir: 1 | -1, group: string): boolean => {
      settle('done'); // a typed value goes in first
      const v = read();
      if (v === undefined) return false;
      const problem = apply(Math.round((v + dir * stepSize()) * 100) / 100, group);
      if (problem) { msg.show(problem); return false; }
      msg.hide();
      return true;
    };
    const canStep = (dir: 1 | -1) => {
      const v = read();
      if (v === undefined || store.idAt(i) !== id) return false;
      const el = structuredClone(store.page.elements[i]) as unknown as Record<string, number>;
      el[key] = Math.round((v + dir * stepSize()) * 100) / 100;
      return validateElement(el).length === 0;
    };
    const stepper = (dir: 1 | -1) => {
      let held = false, swallow = false;
      let delay: ReturnType<typeof setTimeout> | undefined, every: ReturnType<typeof setInterval> | undefined;
      const stop = (e: Event) => {
        clearTimeout(delay); clearInterval(every);
        document.removeEventListener('pointerup', stop); document.removeEventListener('pointercancel', stop);
        swallow = held && e.type === 'pointerup'; // the click that follows a hold is not a tap
      };
      const sign = dir > 0 ? '+' : '−';
      const b = h('button', {
        type: 'button', class: 'step', 'data-help': dir > 0 ? 'step-inc' : 'step-dec', 'data-key': `step-${dir > 0 ? 'inc' : 'dec'}-${key}`,
        'aria-label': `${dir > 0 ? 'Increase' : 'Decrease'} ${o.label}`,
        onpointerdown: (e: PointerEvent) => {
          if (e.button !== 0) return;
          held = false; swallow = false;
          const group = `step${++this.stepId}`;
          delay = setTimeout(() => {
            held = true;
            if (!step(dir, group)) return stop(e);
            every = setInterval(() => { if (!step(dir, group)) stop(e); }, REPEAT_MS);
          }, HOLD_MS);
          document.addEventListener('pointerup', stop); document.addEventListener('pointercancel', stop);
        },
        onclick: () => { if (swallow) { swallow = false; return; } step(dir, `step${++this.stepId}`); },
        // Keep the field's focus (and the keyboard) where it is; and a long press is not a context menu.
        onmousedown: (e: Event) => e.preventDefault(),
        oncontextmenu: (e: Event) => e.preventDefault(),
      }, sign);
      return b;
    };
    const dec = stepper(-1), inc = stepper(1);

    const sync = () => {
      const v = read();
      // Compare as numbers: "1." is already 1, and writing "1" over it would eat the point being typed.
      if (!dirty && v !== undefined && parseNumber(input.value) !== v) input.value = fmt(v);
      dec.disabled = !canStep(-1);
      inc.disabled = !canStep(1);
      dec.setAttribute('title', `− ${fmt(stepSize())}`);
      inc.setAttribute('title', `+ ${fmt(stepSize())}`);
    };
    sync();
    return {
      node: h('div', { class: 'field num' }, h('label', { for: `prop-${key}` }, o.label), h('div', { class: 'stepper' }, dec, input, inc), msg.el),
      ctl: { sync, flush: () => settle('done') },
    };
  }

  private choice<T extends string | number>(store: Store, i: number, id: number, el: PageElement, o: { key: string; label: string; help: string; options: readonly T[]; dflt: T; also?: (x: PageElement) => void }): Built {
    const rec = (e: PageElement) => e as unknown as Record<string, T | undefined>;
    const select = this.select(`prop-${o.key}`, o.help, o.options, rec(el)[o.key] ?? o.dflt, (v) => {
      const problem = this.edit(store, i, id, null, (x) => { (x as unknown as Record<string, T>)[o.key] = (typeof o.dflt === 'number' ? Number(v) : v) as T; o.also?.(x); });
      if (problem) sync();
    });
    const sync = () => {
      if (store.idAt(i) !== id) return;
      const v = String(rec(store.page.elements[i])[o.key] ?? o.dflt);
      if (select.value !== v) select.value = v;
    };
    return { node: h('label', { class: 'field' }, o.label, select), ctl: { sync, flush() {} } };
  }

  // ---- page ---------------------------------------------------------------

  private editPage(key: string, fn: (p: Page) => void) {
    const next = structuredClone(this.store.page);
    fn(next);
    this.store.commit(next, key);
    return null;
  }

  private buildPage() {
    const name = this.textField({
      label: 'Name', key: 'page-name', help: 'page-name', read: () => this.store.page.name,
      write: (v) => this.editPage('page-name', (p) => { p.name = v; }),
    });
    const identity = this.textField({
      label: 'Identity', key: 'page-identity', help: 'page-identity', read: () => this.store.page.identity ?? '',
      write: (v) => this.editPage('page-identity', (p) => { if (v) p.identity = v; else delete p.identity; }),
    });
    this.pageCtls = [name.ctl, identity.ctl];
    this.pageEl.replaceChildren(
      h('h2', {}, 'Page'), name.node, identity.node, this.identityWarn, this.sideSlot,
      h('p', { class: 'hint' }, `Tokens: ${TOKENS.map((t) => `{${t}}`).join(' ')}`),
      h('p', { class: 'hint' }, 'The spine is right of a left page, left of a right page; “either” shows as a right page.'),
    );
  }

  private syncPage() {
    const { store } = this;
    for (const c of this.pageCtls) c.sync();
    this.identityWarn.replaceChildren(...warnNodes(store.page.identity ?? ''));
    const side = store.page.side ?? DEFAULTS.side;
    const key = `${this.lockedSide ?? 'free'}`;
    if (key !== this.sideKey) {
      this.sideKey = key;
      this.sideSlot.replaceChildren(this.lockedSide
        ? h('p', { class: 'hint' }, `This is the ${this.lockedSide} page of the spread.`)
        : h('label', {}, 'Side',
          this.select('page-side', 'page-side', PAGE_SIDES, side, (v) => this.editPage('page-side', (p) => {
            if (v === 'either') delete p.side; else p.side = v as Page['side'];
          }))));
    }
    const sel = this.sideSlot.querySelector('select');
    if (sel && sel.value !== side) sel.value = side;
  }

  // ---- layers -------------------------------------------------------------

  private syncLayers() {
    const { store } = this;
    const els = store.page.elements;
    const rows = els.map((el, i) => [describe(el), store.isHidden(i), store.isLocked(i)]);
    const sig = JSON.stringify([rows, store.selection]);
    const same = this.layersFor?.store === store;
    if (same && sig === this.layersSig) return;
    this.layersSig = sig;

    const old = this.layersEl.querySelector('.layers');
    const scroll = old?.scrollTop ?? 0;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && this.layersEl.contains(active) ? active.dataset.key : undefined;

    const list = els.map((el, i) => {
      const hidden = store.isHidden(i), locked = store.isLocked(i);
      const row = h('li', {
        class: `layer${store.isSelected(i) ? ' selected' : ''}${hidden ? ' is-hidden' : ''}`,
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
        h('button', { type: 'button', class: 'layer-name', 'data-key': `layer-${i}-name`, 'data-help': 'layer-select', 'aria-current': store.isSelected(i), onclick: () => store.select(i) }, describe(el)),
        icon(hidden ? 'hide' : 'show', hidden ? 'Show' : 'Hide', () => store.toggleHidden(i), { pressed: hidden, key: `layer-${i}-hide`, help: 'layer-hide' }),
        icon(locked ? 'lock' : 'unlock', locked ? 'Unlock' : 'Lock', () => store.toggleLocked(i), { pressed: locked, key: `layer-${i}-lock`, help: 'layer-lock' }),
        icon('up', 'Move up (toward the front)', () => reorderElement(store, i, i + 1), { disabled: i === els.length - 1, key: `layer-${i}-up`, help: 'layer-up' }),
        icon('down', 'Move down (toward the back)', () => reorderElement(store, i, i - 1), { disabled: i === 0, key: `layer-${i}-down`, help: 'layer-down' }),
        icon('trash', 'Delete', () => deleteElements(store, [i]), { disabled: locked, key: `layer-${i}-delete`, help: 'layer-delete' }),
      );
      return row;
    });
    this.layersEl.replaceChildren(
      h('h2', {}, 'Layers'),
      els.length
        ? h('div', {},
          h('p', { class: 'hint end' }, 'Top: drawn last'),
          h('ol', { class: 'layers' }, ...list.reverse()),
          h('p', { class: 'hint end' }, 'Bottom: drawn first'))
        : h('p', { class: 'hint' }, 'Nothing on the page yet. Pick a tool and draw on the page.'),
      ...(els.length ? [h('p', { class: 'hint' }, 'Use the arrows to reorder (or drag a row). Hiding affects only this editor.')] : []),
    );
    const layers = this.layersEl.querySelector<HTMLElement>('.layers');
    if (layers) {
      layers.scrollTop = scroll;
      const row = layers.querySelector<HTMLElement>('.layer.selected');
      // Only when the selection moved: bring its row into the list, without scrolling the panel around it.
      if (row && (!same || this.layersFor?.selected !== store.selected)) {
        if (row.offsetTop < layers.scrollTop) layers.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > layers.scrollTop + layers.clientHeight) layers.scrollTop = row.offsetTop + row.offsetHeight - layers.clientHeight;
      }
    }
    this.layersFor = { store, selected: store.selected };
    if (focusKey) this.layersEl.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  // ---- properties ---------------------------------------------------------

  private syncProps() {
    const { store } = this;
    const i = store.selected;
    const many = store.selection.length > 1;
    const kind = i === null ? '' : (store.page.elements[i] as { values?: string; pattern?: string }).values ?? (store.page.elements[i] as { pattern?: string }).pattern ?? '';
    const key = i === null ? 'none'
      : many ? `many:${store.selection.map((k) => store.idAt(k)).join(',')}:${this.storeNo(store)}`
        : `${i}:${store.idAt(i)}:${store.page.elements[i].type}:${kind}:${this.storeNo(store)}`;
    if (key !== this.propsKey) {
      // A different element: whatever was typed for the last one goes in first, then the section is built anew.
      const old = this.propCtls;
      this.propCtls = [];
      this.propsKey = key;
      for (const c of old) c.flush();
      this.buildProps();
      return;
    }
    for (const c of this.propCtls) c.sync();
    if (i !== null) {
      const locked = store.isLocked(i);
      if (this.fieldset) this.fieldset.disabled = locked;
      this.lockedHint.hidden = !locked;
      for (const b of this.propsEl.querySelectorAll<HTMLButtonElement>('[data-lock-aware]')) b.disabled = locked;
    }
  }

  /** A number per store the panel has shown, so that switching page or spread side counts as a different element. */
  private stores = new Map<Store, number>();
  private storeNo(store: Store): number {
    if (!this.stores.has(store)) this.stores.set(store, this.stores.size + 1);
    return this.stores.get(store)!;
  }

  private buildProps() {
    const { store } = this;
    const i = store.selected;
    this.fieldset = null;
    if (i === null) {
      this.propsEl.replaceChildren(h('h2', {}, 'Properties'),
        h('p', { class: 'hint' }, 'Tap or click an element to select it. Long-press it (or Alt-click) to reach the ones underneath.'));
      return;
    }
    if (store.selection.length > 1) { this.buildMany(); return; }
    const el = store.page.elements[i];
    const id = store.idAt(i);
    const locked = store.isLocked(i);
    const ctls: Ctl[] = [];
    const add = (b: Built) => { ctls.push(b.ctl); return b.node; };
    const num = (key: string, label: string, by: StepBy = 'cell', help = `prop-${key}`) => add(this.numberField(store, i, id, { key, label, help, by }));
    const choice = <T extends string | number>(key: string, label: string, options: readonly T[], dflt: T, help = `prop-${key}`, also?: (x: PageElement) => void) =>
      add(this.choice(store, i, id, el, { key, label, help, options, dflt, also }));

    const area = () => [num('x', 'x'), num('y', 'y'), num('w', 'w'), num('h', 'h')];
    let fields: Child[];
    switch (el.type) {
      case 'pattern': {
        const dots = el.pattern === 'dots';
        // Each kind keeps only the fields it uses.
        const tidy = (x: PageElement) => {
          const q = x as Pattern;
          if (q.pattern === 'dots') { delete q.weight; delete q.first; } else delete q.dots;
          if (q.pattern !== 'lines' && q.pattern !== 'vlines') delete q.first;
        };
        fields = [h('div', { class: 'grid2' }, ...area()), choice('pattern', 'Pattern', PATTERNS, el.pattern, 'prop-pattern', tidy),
          dots ? choice('dots', 'Dots', DOT_SIZES, DEFAULTS.dots, 'prop-dots') : choice('weight', 'Line weight', RULE_WEIGHTS, DEFAULTS.patternWeight, 'prop-line-weight'),
          el.pattern === 'lines' || el.pattern === 'vlines'
            ? this.flag(store, i, id, ctls, 'first', el.pattern === 'lines' ? 'Include the top line' : 'Include the left line', 'prop-first')
            : null,
          h('div', { class: 'grid2' }, num('every', 'Every (cells)'))];
        break;
      }
      case 'shade':
        fields = this.shadeFields(store, i, id, el, { num, choice, add, ctls, area });
        break;
      case 'sequence':
        fields = this.sequenceFields(store, i, id, el, { num, choice, add, ctls });
        break;
      case 'box': {
        const side = (s: BoxSide) => {
          const input = h('input', {
            type: 'checkbox', 'data-key': `prop-side-${s}`, 'data-help': 'prop-side', checked: (el.sides ?? SIDES).includes(s),
            onchange: () => {
              const problem = this.edit(store, i, id, null, (x) => {
                const b = x as typeof el;
                const on = input.checked;
                const next = SIDES.filter((t) => (t === s ? on : (b.sides ?? SIDES).includes(t)));
                if (next.length === SIDES.length) delete b.sides; else b.sides = next;
              });
              if (problem) sync();
            },
          });
          const sync = () => {
            if (store.idAt(i) !== id) return;
            const now = (store.page.elements[i] as typeof el).sides ?? SIDES;
            input.checked = now.includes(s);
          };
          ctls.push({ sync, flush() {} });
          return h('label', { class: 'inline' }, input, s);
        };
        fields = [h('div', { class: 'grid2' }, ...area()), h('h3', {}, 'Sides'), h('div', { class: 'grid2' }, ...SIDES.map(side)),
          choice('weight', 'Weight', WEIGHTS, DEFAULTS.boxWeight)];
        break;
      }
      case 'rule':
        fields = [h('div', { class: 'grid2' }, num('x1', 'x1'), num('y1', 'y1'), num('x2', 'x2'), num('y2', 'y2')),
          choice('weight', 'Weight', RULE_WEIGHTS, DEFAULTS.ruleWeight)];
        break;
      case 'checkboxes':
        fields = [h('div', { class: 'grid2' }, num('x', 'x'), num('y', 'y'), num('count', 'Count', 1), num('every', 'Spacing (cells)')),
          choice('direction', 'Direction', DIRECTIONS, DEFAULTS.direction),
          h('div', { class: 'grid2' }, num('size', 'Size (0.5–1)', 0.05, 'prop-check-size')),
          choice('weight', 'Weight', WEIGHTS, DEFAULTS.boxWeight)];
        break;
      case 'text': {
        const warn = h('div');
        const text = this.textField({
          label: 'Text', key: 'prop-text', help: 'prop-text',
          read: () => (store.idAt(i) === id ? (store.page.elements[i] as typeof el).text : ''),
          write: (v) => this.edit(store, i, id, 'text', (x) => { (x as typeof el).text = v; }),
        });
        ctls.push(text.ctl, { sync: () => warn.replaceChildren(...warnNodes(store.idAt(i) === id ? (store.page.elements[i] as typeof el).text : '')), flush() {} });
        fields = [text.node, warn,
          h('div', { class: 'grid2' }, num('x', 'x'), num('y', 'y')),
          choice('size', 'Size', TEXT_SIZES, DEFAULTS.textSize, 'prop-text-size'),
          choice('style', 'Style', TEXT_STYLES, DEFAULTS.style),
          choice('tone', 'Tone', TEXT_TONES, DEFAULTS.textTone, 'prop-text-tone'),
          choice('align', 'Align', ALIGNS, DEFAULTS.align),
          choice('rotate', 'Rotate (°)', [0, 90, 270] as const, 0 as 0 | 90 | 270)];
        break;
      }
    }

    const fieldset = h('fieldset', { disabled: locked }, ...fields);
    this.fieldset = fieldset;
    const pad = this.nudgePad(i);
    ctls.push(pad);
    this.propsEl.replaceChildren(
      h('h2', {}, `Properties · ${el.type}`),
      this.lockedHint,
      pad.node,
      fieldset,
      h('div', { class: 'row' },
        h('button', { type: 'button', 'data-lock-aware': true, 'data-help': 'prop-duplicate', disabled: locked, onclick: () => duplicateElement(store, i) }, 'Duplicate'),
        h('button', { type: 'button', class: 'danger', 'data-lock-aware': true, 'data-help': 'prop-delete', disabled: locked, onclick: () => deleteElement(store, i) }, 'Delete')),
      this.widgetButton(),
    );
    this.lockedHint.hidden = !locked;
    this.propCtls = ctls;
    for (const c of ctls) c.sync();
  }

  private widgetButton() {
    return h('div', { class: 'row' }, h('button', { type: 'button', 'data-key': 'prop-widget', 'data-help': 'prop-widget', onclick: () => this.saveWidget?.() }, 'Save as widget'));
  }

  /** What the properties show when several elements are selected: they can be moved, copied, deleted or saved together. */
  private buildMany() {
    const { store } = this;
    const i = store.selected!;
    const count = store.selection.length;
    const pad = this.nudgePad(i);
    this.propCtls = [pad];
    this.propsEl.replaceChildren(
      h('h2', {}, `Properties · ${count} elements`),
      h('p', { class: 'hint' }, 'Drag any of them to move them all, or use the arrows. Group ties them together; tap one in the layers list to select just that one.'),
      pad.node,
      h('div', { class: 'row' },
        h('button', { type: 'button', 'data-help': 'prop-duplicate', onclick: () => duplicateElement(store, i) }, 'Duplicate'),
        h('button', { type: 'button', class: 'danger', 'data-help': 'prop-delete', onclick: () => deleteElement(store, i) }, 'Delete')),
      this.widgetButton(),
    );
    this.fieldset = null;
    this.lockedHint.hidden = true;
    pad.sync();
  }

  /** A tick box for a yes/no field: ticked writes `true`, unticked takes the field out (its default is off). */
  private flag(store: Store, i: number, id: number, ctls: Ctl[], key: string, label: string, help: string): HTMLElement {
    const input = h('input', {
      type: 'checkbox', 'data-key': `prop-${key}`, 'data-help': help,
      onchange: () => {
        const problem = this.edit(store, i, id, null, (x) => {
          const rec = x as unknown as Record<string, boolean | undefined>;
          if (input.checked) rec[key] = true; else delete rec[key];
        });
        if (problem) sync();
      },
    });
    const sync = () => {
      if (store.idAt(i) !== id) return;
      input.checked = (store.page.elements[i] as unknown as Record<string, boolean | undefined>)[key] === true;
    };
    ctls.push({ sync, flush() {} });
    sync();
    return h('label', { class: 'inline' }, input, label);
  }

  /** The fields of a shade: where it is, the tones it repeats, which way, and how many cells each step covers; with a strip that shows the pattern as it is typed. */
  private shadeFields(
    store: Store, i: number, id: number, el: Shade,
    f: {
      num: (key: string, label: string, by?: StepBy, help?: string) => HTMLElement;
      choice: <T extends string | number>(key: string, label: string, options: readonly T[], dflt: T, help?: string) => HTMLElement;
      add: (b: Built) => HTMLElement;
      ctls: Ctl[];
      area: () => HTMLElement[];
    },
  ): Child[] {
    const current = () => (store.idAt(i) === id ? (store.page.elements[i] as Shade) : el);
    const tones = this.textField({
      label: 'Tones: L light, M medium, D dark, B blank', key: 'prop-tones', help: 'prop-tones',
      read: () => current().tones,
      write: (typed) => {
        const clean = cleanTones(typed);
        if (!clean) return 'Use the letters L, M, D and B.';
        // Small letters become capitals and a letter that isn't a tone is dropped, as it is typed.
        if (clean !== typed) input.value = clean;
        if (clean === current().tones) return null;
        return this.edit(store, i, id, 'tones', (x) => { (x as Shade).tones = clean; });
      },
    });
    const input = tones.node.querySelector('input')!;
    // The strip shows what is typed even before it is applied, so a half-typed pattern can be seen.
    const strip = h('div', { class: 'tone-strip', role: 'img', 'aria-label': 'Preview of the tones', 'data-help': 'prop-tone-strip' });
    const draw = () => {
      const shade = current();
      const typed = cleanTones(input.value) || shade.tones;
      const along = shade.along ?? DEFAULTS.along;
      const rows = along === 'checker' ? 3 : 1, cols = 12;
      let cells = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Rows and columns both read left to right here; a checker shifts by one each row.
          const tone = toneAt({ tones: typed, along: 'checker' }, along === 'checker' ? r : 0, c);
          cells += `<rect x="${c}" y="${r}" width="1" height="1" fill="${tone === 'B' ? '#fff' : SHADE_TONES[tone]}" stroke="#bbb" stroke-width="0.04"/>`;
        }
      }
      strip.innerHTML = `<svg viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none" aria-hidden="true">${cells}</svg>`;
    };
    input.addEventListener('input', draw);
    f.ctls.push(tones.ctl, { sync: draw, flush() {} });
    draw();
    return [
      h('div', { class: 'grid2' }, ...f.area()),
      tones.node,
      strip,
      f.choice('along', 'Along', ALONGS, DEFAULTS.along, 'prop-along'),
      h('div', { class: 'grid2' }, f.num('every', 'Every (cells per step)', 0.5, 'prop-shade-every')),
    ];
  }

  /** The fields of a sequence: where it runs, what it says, and how it looks. */
  private sequenceFields(
    store: Store, i: number, id: number, el: Sequence,
    f: {
      num: (key: string, label: string, by?: StepBy, help?: string) => HTMLElement;
      choice: <T extends string | number>(key: string, label: string, options: readonly T[], dflt: T, help?: string, also?: (x: PageElement) => void) => HTMLElement;
      add: (b: Built) => HTMLElement;
      ctls: Ctl[];
    },
  ): Child[] {
    const kind = el.values ?? DEFAULTS.values;
    const current = () => (store.idAt(i) === id ? (store.page.elements[i] as Sequence) : el);
    const values = this.select('prop-values', 'prop-values', SEQUENCE_VALUES, kind, (v) => {
      const problem = this.edit(store, i, id, null, (x) => switchValues(x as Sequence, v as SequenceValues));
      if (problem) values.value = kind;
    });
    const out: Child[] = [
      h('div', { class: 'grid2' }, f.num('x', 'x'), f.num('y', 'y'), f.num('count', 'Count', 1), f.num('every', 'Spacing (cells)')),
      f.choice('direction', 'Direction', DIRECTIONS, DEFAULTS.direction),
      h('label', { class: 'field' }, 'Values', values),
    ];
    if (kind === 'numbers') out.push(h('div', { class: 'grid2' }, f.num('start', 'Start', 1), f.num('step', 'Step', 1)));
    if (kind === 'letters') {
      out.push(f.add(this.textField({
        label: 'Start letter', key: 'prop-letter', help: 'prop-letter',
        read: () => (typeof current().start === 'string' ? (current().start as string) : DEFAULTS.letter),
        write: (v) => this.edit(store, i, id, 'start', (x) => { (x as Sequence).start = v; }),
      })));
    }
    if (kind === 'list') {
      out.push(f.add(this.textField({
        label: 'Items (separated by spaces, up to 2 characters each)', key: 'prop-list', help: 'prop-list',
        read: () => (current().list ?? []).join(' '),
        write: (v) => this.edit(store, i, id, 'list', (x) => { (x as Sequence).list = v.split(/\s+/).filter(Boolean); }),
      })));
    }
    if (kind === 'icons') {
      const chips = h('div', { class: 'icon-chips' });
      const drawChips = () => {
        chips.replaceChildren(...(current().icons ?? []).map((name, at) => {
          const b = h('button', {
            type: 'button', class: 'chip', title: `Remove ${name}`, 'aria-label': `Remove ${name}`, 'data-key': `prop-icon-remove-${at}`, 'data-help': 'prop-icon-remove',
            onclick: () => this.edit(store, i, id, null, (x) => { (x as Sequence).icons = (x as Sequence).icons!.filter((_, k) => k !== at); }),
          });
          b.innerHTML = iconGlyph(name);
          return b;
        }));
      };
      let shown = '';
      const sync = () => { const now = JSON.stringify(current().icons); if (now !== shown) { shown = now; drawChips(); } };
      f.ctls.push({ sync, flush() {} });
      out.push(h('div', { class: 'field' }, h('label', {}, 'Icons (repeat in this order)'), chips,
        h('button', {
          type: 'button', 'data-key': 'prop-icon-add', 'data-help': 'prop-icon-add',
          onclick: () => this.pickIcon?.((name) => { this.edit(store, i, id, null, (x) => { (x as Sequence).icons = [...((x as Sequence).icons ?? []), name]; }); }),
        }, 'Add an icon…')));
      // Bigger icons need more room between them, or they overlap.
      out.push(f.choice('size', 'Icon size (cells)', ICON_SIZES, DEFAULTS.iconSize, 'prop-icon-size', (x) => {
        const q = x as Sequence;
        if ((q.every ?? DEFAULTS.every) < (q.size ?? DEFAULTS.iconSize)) q.every = q.size;
      }));
    }
    out.push(f.choice('tone', 'Tone', TEXT_TONES, DEFAULTS.sequenceTone, 'prop-text-tone'));
    return out;
  }

  /** Arrow buttons that move the selection by a cell, or half a cell with the half-cell toggle on. */
  private nudgePad(i: number): Ctl & { node: HTMLElement } {
    const { store } = this;
    const arrows: [HTMLButtonElement, number, number][] = [];
    const arrow = (name: keyof typeof ICONS, label: string, dx: number, dy: number, area: string) => {
      const b = icon(name, `Nudge ${label}`, () => nudgeButton(store, i, dx, dy), { key: `nudge-${label}`, class: `nudge ${area}`, help: `nudge-${label}` });
      arrows.push([b, dx, dy]);
      return b;
    };
    const half = h('button', {
      type: 'button', class: 'nudge step', 'data-key': 'nudge-half', 'data-help': 'nudge-half', 'aria-pressed': store.halfCells,
      title: 'Nudge by half a cell instead of a whole cell', onclick: () => store.setHalfCells(!store.halfCells),
    });
    const node = h('div', { class: 'nudge-pad', role: 'group', 'aria-label': 'Nudge' },
      arrow('nudgeUp', 'up', 0, -1, 'up'), arrow('left', 'left', -1, 0, 'left'), half, arrow('right', 'right', 1, 0, 'right'), arrow('nudgeDown', 'down', 0, 1, 'down'));
    const sync = () => {
      if (store.idAt(i) === undefined) return;
      for (const [b, dx, dy] of arrows) b.disabled = !canNudge(store, i, dx, dy);
      half.setAttribute('aria-pressed', String(store.halfCells));
      half.textContent = nudgeStep(store) === 0.5 ? '½' : '1';
    };
    sync();
    return { node, sync, flush() {} };
  }
}
