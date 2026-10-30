import { h } from './panel';
import { iconGlyph } from './icons/glyph';
import { ICON_GROUPS } from './icons/groups';
import { ICON_SIZES, type IconSize, type TextTone } from './format/types';
import type { IconChoice } from './geometry';
import { makeWidget, type Widget, type WidgetStore } from './widgets';
import type { NameDialog } from './namedialog';
import { isArtWidget } from './art/widget';
import { importArtFile } from './art/report';
import { BUILTIN_ART } from './builtin/library';
import { weekBlock } from './builtin/week';
import { widgetThumbnail } from './library/dialog';
import { problemView, type Problem } from './problems';

/** What the picker can hand back: a tool to arm, ready for a tap or drag on the page. */
export type AdvancedChoice =
  | { kind: 'icon'; icon: IconChoice }
  | { kind: 'widget'; widget: Widget }
  /** Art to draw into a rectangle; `problem` is what an import left out of its file, if it was just imported. */
  | { kind: 'art'; widget: Widget; problem?: Problem | null };

/**
 * The window behind three of Advanced's buttons: the saved widgets (Widgets), the art that comes with Dotwork and what was
 * imported (Art, with a button to import an SVG file), and the icon grid (Icon). The same grid also picks a single icon
 * for a sequence's properties.
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

  /** Open the list of art, built in and imported, with the import button. */
  showArt() {
    this.onPick = null;
    this.open();
    this.showArtList();
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
    this.unsubscribe = this.widgets.subscribe(() => {
      if (!this.dialog.open) return;
      if (this.view === 'menu') this.showMenu();
      else if (this.view === 'art') this.showArtList(this.problem);
    });
  }

  private view: 'menu' | 'icons' | 'art' = 'menu';
  private problem: Problem | null = null;

  private done(choice: AdvancedChoice) {
    this.dialog.close();
    this.choose(choice);
  }

  // ---- the list ---------------------------------------------------------------

  private showMenu() {
    this.view = 'menu';
    this.title.textContent = 'Widgets';
    const saved = this.widgets.list().filter((w) => !isArtWidget(w));
    const block = weekBlock();
    this.body.replaceChildren(
      ...(block ? [
        h('h3', {}, 'Generated'),
        h('ul', { class: 'widget-list' }, h('li', { class: 'generated-row', 'data-name': 'Week block' },
          h('button', {
            type: 'button', class: 'generated-use widget-btn', 'data-key': 'generated-use', 'data-help': 'advanced-generated',
            onclick: () => this.done({ kind: 'widget', widget: makeWidget('generated-week', 'Week block', [block]) }),
          }, h('strong', {}, 'Week block'), h('small', {}, 'goals, a row for each day of the week, outcomes'))))] : []),
      ...(block ? [h('h3', {}, 'Saved')] : []),
      saved.length
        ? h('ul', { class: 'widget-list' }, ...saved.map((w) => this.widgetRow(w)))
        : h('p', { class: 'hint' }, 'Nothing saved yet. Select one or more elements on the page, then tap More and Save as widget to keep them here for other pages.'));
  }

  private widgetRow(w: Widget): HTMLElement {
    return h('li', { class: 'widget-row', 'data-name': w.name },
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

  // ---- the art ----------------------------------------------------------------

  private showArtList(problem: Problem | null = null) {
    this.view = 'art';
    this.problem = problem;
    this.title.textContent = 'Art';
    const file = h('input', { type: 'file', accept: '.svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg', hidden: true, 'data-key': 'art-file' });
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const r = await importArtFile(f, this.widgets);
      if (r.ok) this.done({ kind: 'art', widget: r.widget, problem: r.problem });
      else this.showArtList(r.problem);
    };
    const saved = this.widgets.list().filter(isArtWidget);
    this.body.replaceChildren(
      h('div', { class: 'lib-save' },
        h('button', { type: 'button', class: 'primary', 'data-key': 'art-import', 'data-help': 'library-art-import', onclick: () => file.click() }, 'Import art or image'),
        h('span', { class: 'hint' }, 'Pick art, then drag a rectangle on the page for it to fill.'),
        file),
      ...(problem ? [problemView(problem)] : []),
      h('ul', { class: 'widget-list' }, ...BUILTIN_ART.map((w) => this.artRow(w, false)), ...saved.map((w) => this.artRow(w, true))));
  }

  private artRow(w: Widget, own: boolean): HTMLElement {
    const thumb = h('span', { class: 'art-thumb', role: 'img', 'aria-label': `Thumbnail of ${w.name}` });
    thumb.innerHTML = widgetThumbnail(w);
    return h('li', { class: 'widget-row', 'data-name': w.name },
      h('button', { type: 'button', class: 'widget-use art-use', 'data-key': 'art-use', 'data-help': 'advanced-art', onclick: () => this.done({ kind: 'art', widget: w }) },
        thumb, h('span', { class: 'art-text' }, h('strong', {}, w.name), h('small', {}, own ? 'imported' : 'example'))),
      ...(own ? [
        h('button', {
          type: 'button', 'data-key': 'art-rename', 'data-help': 'advanced-art-rename',
          onclick: async () => { const name = await this.ask.ask('Rename art', w.name); if (name) this.widgets.rename(w.id, name); },
        }, 'Rename'),
        h('button', {
          type: 'button', class: 'danger', 'data-key': 'art-delete', 'data-help': 'advanced-art-delete',
          onclick: () => { if (confirm(`Delete the art “${w.name}”? Pages that used it keep their copies.`)) this.widgets.remove(w.id); },
        }, 'Delete')] : []));
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
