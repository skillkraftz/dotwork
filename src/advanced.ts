import { h } from './panel';
import { iconGlyph } from './icons/glyph';
import { ICON_GROUPS } from './icons/groups';
import { ICON_SIZES, type IconSize, type TextTone } from './format/types';
import type { IconChoice } from './geometry';
import type { Widget, WidgetStore } from './widgets';
import type { NameDialog } from './namedialog';

/** What the picker can hand back: a tool to arm, ready for a tap or drag on the page. */
export type AdvancedChoice =
  | { kind: 'icon'; icon: IconChoice }
  | { kind: 'widget'; widget: Widget };

/**
 * The window behind two of Advanced's buttons: the saved widgets (Widgets) and the icon grid (Icon). The same grid
 * also picks a single icon for a sequence's properties.
 */
export class AdvancedPicker {
  private dialog: HTMLDialogElement;
  private title = h('h2', {});
  private body = h('div', { class: 'picker-body' });
  private icon: IconChoice = { name: 'star', size: 1, tone: 'black' };
  private onPick: ((name: string) => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private widgets: WidgetStore,
    private ask: NameDialog,
    private choose: (choice: AdvancedChoice) => void,
  ) {
    this.dialog = h('dialog', { class: 'library advanced', 'aria-label': 'Advanced' },
      h('header', {}, this.title, h('button', { type: 'button', 'data-help': 'advanced-close', onclick: () => this.dialog.close() }, 'Close')),
      this.body) as HTMLDialogElement;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
  }

  get isOpen() { return this.dialog.open; }

  /** The icon, size and colour last chosen (the icon tool places this). */
  setIcon(icon: IconChoice) { this.icon = icon; }

  /** Open at the list of saved widgets. */
  showWidgets() {
    this.onPick = null;
    this.open();
    this.showMenu();
  }

  /** Open the icon grid to choose the icon the icon tool places. */
  showIconTool() {
    this.onPick = null;
    this.open();
    this.showIcons();
  }

  /** Open the icon grid to pick one icon for something else (a sequence's list); `pick` is called with its name. */
  pickIcon(pick: (name: string) => void) {
    this.onPick = pick;
    this.open();
    this.showIcons();
  }

  private open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.unsubscribe?.();
    this.unsubscribe = this.widgets.subscribe(() => { if (this.dialog.open && this.view === 'menu') this.showMenu(); });
  }

  private view: 'menu' | 'icons' = 'menu';

  private done(choice: AdvancedChoice) {
    this.dialog.close();
    this.choose(choice);
  }

  // ---- the list ---------------------------------------------------------------

  private showMenu() {
    this.view = 'menu';
    this.title.textContent = 'Widgets';
    const saved = this.widgets.list();
    this.body.replaceChildren(
      saved.length
        ? h('ul', { class: 'widget-list' }, ...saved.map((w) => this.widgetRow(w)))
        : h('p', { class: 'hint' }, 'Nothing saved yet. Select one or more elements on the page, then tap More and Save as widget to keep them here for other pages.'));
  }

  private widgetRow(w: Widget): HTMLElement {
    return h('li', { class: 'widget-row' },
      h('button', { type: 'button', class: 'widget-use', 'data-key': 'widget-use', 'data-help': 'advanced-widget', onclick: () => this.done({ kind: 'widget', widget: w }) },
        h('strong', {}, w.name), h('small', {}, `${w.elements.length} element${w.elements.length === 1 ? '' : 's'}`)),
      h('button', {
        type: 'button', 'data-key': 'widget-rename', 'data-help': 'advanced-widget-rename',
        onclick: async () => { const name = await this.ask.ask('Rename widget', w.name); if (name) this.widgets.rename(w.id, name); },
      }, 'Rename'),
      h('button', {
        type: 'button', class: 'danger', 'data-key': 'widget-delete', 'data-help': 'advanced-widget-delete',
        onclick: () => { if (confirm(`Delete the widget “${w.name}”? Pages that used it keep their copies.`)) this.widgets.remove(w.id); },
      }, 'Delete'));
  }

  // ---- the icon grid ------------------------------------------------------------

  private showIcons() {
    this.view = 'icons';
    const picking = this.onPick !== null;
    this.title.textContent = picking ? 'Choose an icon' : 'Icon';
    const choice = (name: string) => () => {
      if (this.onPick) { const pick = this.onPick; this.onPick = null; this.dialog.close(); pick(name); return; }
      this.icon = { ...this.icon, name };
      this.done({ kind: 'icon', icon: this.icon });
    };
    const segment = <T extends string | number>(key: string, help: string, label: string, options: readonly T[], value: T, set: (v: T) => void) =>
      h('div', { class: 'seg', role: 'group', 'aria-label': label },
        ...options.map((o) => h('button', {
          type: 'button', 'data-key': `${key}-${o}`, 'data-help': help, 'aria-pressed': String(o === value),
          onclick: (e: Event) => {
            set(o);
            for (const b of (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          },
        }, String(o))));
    this.body.replaceChildren(
      ...(picking ? [] : [h('div', { class: 'icon-options' },
        h('span', {}, 'Size (cells)'), segment<IconSize>('icon-size', 'icon-size', 'Icon size in cells', ICON_SIZES, this.icon.size, (size) => { this.icon = { ...this.icon, size }; }),
        h('span', {}, 'Color'), segment<TextTone>('icon-tone', 'icon-tone', 'Icon color', ['black', 'gray'], this.icon.tone, (tone) => { this.icon = { ...this.icon, tone }; }))]),
      ...ICON_GROUPS.flatMap(([group, names]) => [
        h('h3', {}, group),
        h('div', { class: 'icon-grid' }, ...names.map((name) => {
          const b = h('button', { type: 'button', class: 'icon-cell', 'data-icon': name, 'data-help': 'icon-cell', 'aria-label': name, onclick: choice(name) });
          b.innerHTML = `${iconGlyph(name)}<span>${name}</span>`;
          return b;
        })),
      ]));
  }
}
