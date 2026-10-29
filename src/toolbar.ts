import { h } from './panel';
import type { Tool } from './store';

/** The three modes of the bottom bar; the five buttons beside them change with the mode and the selection. */
export type BarMode = 'select' | 'draw' | 'advanced';

/** The tools each mode can arm. */
export const DRAW_TOOLS: readonly Tool[] = ['pattern', 'shade', 'box', 'rule', 'text'];
export const ADVANCED_TOOLS: readonly Tool[] = ['sequence', 'icon', 'checkboxes', 'widget', 'art'];

/** Which mode a tool belongs to (null for Select, which is no tool at all). */
export function modeOfTool(tool: Tool): BarMode {
  return DRAW_TOOLS.includes(tool) ? 'draw' : ADVANCED_TOOLS.includes(tool) ? 'advanced' : 'select';
}

export interface BarState {
  mode: BarMode;
  tool: Tool;
  /** How many elements are selected. */
  count: number;
  /** Any selected element is locked, so it can't be copied or deleted. */
  locked: boolean;
  half: boolean;
  /** What the Group button does now, if anything. */
  group: 'group' | 'ungroup' | 'convert' | null;
}

export interface BarHandlers {
  mode(mode: BarMode): void;
  tool(tool: Tool): void;
  selectAll(): void;
  half(): void;
  properties(): void;
  duplicate(): void;
  remove(): void;
  group(): void;
  /** Turn the selected generated block into plain elements. */
  convert(): void;
  /** The More menu, opened above the button (client px). */
  more(at: { x: number; y: number }): void;
  /** Open the saved widgets / the icon grid. */
  widgets(): void;
  icons(): void;
  /** Open the saved art, to pick one or import an SVG file. */
  art(): void;
}

const ICON = {
  selectAll: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/><path d="M9 12l2 2 4-4"/>',
  half: '<text x="12" y="17" text-anchor="middle" font-size="17" fill="currentColor" stroke="none">½</text>',
  properties: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
  remove: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  group: '<rect x="3" y="3" width="18" height="18" stroke-dasharray="3 2"/><rect x="6.5" y="6.5" width="5" height="5"/><rect x="12.5" y="12.5" width="5" height="5"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><path d="M13 7h4M7 13v4"/>',
  convert: '<rect x="3" y="3" width="18" height="18" stroke-dasharray="3 2"/><path d="M7 9h10M7 15h10M14 6l3 3-3 3M10 12l-3 3 3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  pattern: '<rect x="4" y="4" width="16" height="16"/><path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16"/>',
  shade: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12L12 4M4 19L19 4M10 20L20 10M16 20l4-4"/>',
  box: '<rect x="4" y="6" width="16" height="12"/>',
  rule: '<path d="M3 12h18M3 9v6M21 9v6"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  sequence: '<path d="M4 6h3M4 12h3M4 18h3M11 6h9M11 12h9M11 18h9"/>',
  icon: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  checkboxes: '<rect x="4" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><path d="M14 7.5h6M14 16.5h6"/>',
  art: '<path d="M4 17a8 8 0 0116 0z"/><path d="M8 17a4 4 0 018 0"/><path d="M12 17l3-5"/>',
  widgets: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
} as const;
type IconName = keyof typeof ICON;

/** `label` is what the button shows (short, so five fit across a phone); `name` is what it is called when it differs. */
interface Slot { id: string; domId?: string; label: string; name?: string; icon: IconName; help: string; run(): void; tool?: Tool; pressed?: boolean; disabled?: boolean }

/**
 * The bottom bar: three fixed mode buttons (Select, Draw, Advanced) and, beside them, five buttons that depend on the
 * mode and the selection. Nothing here opens by itself; it only offers.
 */
export class Toolbar {
  private context: HTMLElement;
  private sig = '';

  constructor(private root: HTMLElement, private handlers: BarHandlers) {
    this.context = root.querySelector('#bar-context')!;
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-bar-mode]')) {
      b.addEventListener('click', () => handlers.mode(b.dataset.barMode as BarMode));
    }
  }

  private slots(s: BarState): Slot[] {
    const k = this.handlers;
    if (s.mode === 'draw') {
      const tool = (t: Tool, label: string, icon: IconName): Slot => ({ id: t, label, icon, help: `tool-${t}`, tool: t, pressed: s.tool === t, run: () => k.tool(t) });
      return [tool('pattern', 'Pattern', 'pattern'), tool('shade', 'Shade', 'shade'), tool('box', 'Box', 'box'), tool('rule', 'Rule', 'rule'), tool('text', 'Text', 'text')];
    }
    if (s.mode === 'advanced') {
      const tool = (t: Tool, label: string, icon: IconName, run: () => void = () => k.tool(t)): Slot => ({ id: t, label, icon, help: `tool-${t}`, tool: t, pressed: s.tool === t, run });
      return [tool('sequence', 'Sequence', 'sequence'), tool('icon', 'Icon', 'icon', () => k.icons()), tool('checkboxes', 'Checks', 'checkboxes'), tool('widget', 'Widgets', 'widgets', () => k.widgets()),
        tool('art', 'Art', 'art', () => k.art())];
    }
    if (s.count === 0) {
      return [
        { id: 'selectAll', label: 'Select all', icon: 'selectAll', help: 'bar-selectAll', run: () => k.selectAll() },
        { id: 'half', domId: 'half-cells', label: 'Half', icon: 'half', help: 'half-cells', pressed: s.half, run: () => k.half() },
      ];
    }
    const grouped = s.group === 'ungroup';
    const group: Slot = s.group === 'convert'
      ? { id: 'convert', label: 'Convert', name: 'Convert to elements', icon: 'convert', help: 'bar-convert', run: () => k.convert() }
      : { id: 'group', label: grouped ? 'Ungroup' : 'Group', icon: grouped ? 'ungroup' : 'group', help: grouped ? 'bar-ungroup' : 'bar-group', disabled: s.group === null, run: () => k.group() };
    return [
      { id: 'properties', label: 'Props', name: 'Properties', icon: 'properties', help: 'bar-properties', run: () => k.properties() },
      { id: 'duplicate', label: 'Copy', name: 'Duplicate', icon: 'duplicate', help: 'bar-duplicate', disabled: s.locked, run: () => k.duplicate() },
      { id: 'remove', label: 'Delete', icon: 'remove', help: 'bar-remove', disabled: s.locked, run: () => k.remove() },
      group,
      { id: 'more', label: 'More', icon: 'more', help: 'bar-more', run: () => {} },
    ];
  }

  /** Show the bar for this state: the modes pressed or not, and the five buttons for the mode. */
  render(s: BarState) {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-bar-mode]')) b.setAttribute('aria-pressed', String(b.dataset.barMode === s.mode));
    const slots = this.slots(s);
    const sig = JSON.stringify(slots.map((x) => [x.id, x.label, x.name, x.help, !!x.disabled]));
    if (sig !== this.sig) {
      this.sig = sig;
      this.context.replaceChildren(...slots.map((x) => {
        const b = h('button', {
          type: 'button', id: x.domId, 'data-action': x.id, 'data-tool': x.tool, 'data-help': x.help, title: x.name ?? x.label, 'aria-label': x.name ?? x.label,
          onclick: () => {
            if (x.id === 'more') {
              const r = b.getBoundingClientRect();
              this.handlers.more({ x: r.left + r.width / 2, y: r.top });
            } else x.run();
          },
        });
        b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[x.icon]}</svg><span class="label">${x.label}</span>`;
        b.disabled = !!x.disabled;
        return b;
      }));
    }
    // The pressed look follows the state without rebuilding the buttons.
    slots.forEach((x, i) => {
      const b = this.context.children[i] as HTMLButtonElement;
      if (x.pressed === undefined) b.removeAttribute('aria-pressed'); else b.setAttribute('aria-pressed', String(x.pressed));
    });
  }
}
