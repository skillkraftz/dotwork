import { h } from './panel';

export interface BarHandlers {
  properties(): void;
  duplicate(): void;
  remove(): void;
  /** The long-press menu, opened from the point given (client px). */
  more(at: { x: number; y: number }): void;
}

const ACTIONS = [
  { id: 'properties', label: 'Properties', icon: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' },
  { id: 'duplicate', label: 'Duplicate', icon: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>' },
  { id: 'remove', label: 'Delete', icon: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>' },
  { id: 'more', label: 'More', icon: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>' },
] as const;

/** Clear of the element's resize handles, which a fingertip can grab from about 20 px away. */
const GAP = 28;
const EDGE = 4;

/**
 * The small bar beside the selected element on a touch screen: Properties, Duplicate, Delete and More.
 * It never opens anything by itself; it only offers.
 */
export class ActionBar {
  constructor(private root: HTMLElement, private host: HTMLElement, handlers: BarHandlers) {
    for (const a of ACTIONS) {
      const b = h('button', {
        type: 'button', 'data-action': a.id, 'aria-label': a.label,
        onclick: () => {
          if (a.id === 'more') {
            const r = b.getBoundingClientRect();
            handlers.more({ x: r.left + r.width / 2, y: r.top });
          } else handlers[a.id]();
        },
      });
      b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${a.icon}</svg><span>${a.label}</span>`;
      root.append(b);
    }
  }

  /** Show the bar beside `target` (a box in client px), below it if there is room, else above, else inside the page; null hides it. */
  place(target: { x: number; y: number; w: number; h: number } | null) {
    if (!target) { this.root.hidden = true; return; }
    const host = this.host.getBoundingClientRect();
    this.root.hidden = false;
    const w = this.root.offsetWidth, hgt = this.root.offsetHeight;
    // Only the part of the element that is on screen counts.
    const left = Math.max(target.x - host.left, 0), right = Math.min(target.x + target.w - host.left, host.width);
    const top = Math.max(target.y - host.top, 0), bottom = Math.min(target.y + target.h - host.top, host.height);
    const x = Math.max(EDGE, Math.min(host.width - w - EDGE, (left + right) / 2 - w / 2));
    let y = bottom + GAP;
    if (y + hgt > host.height - EDGE) y = top - GAP - hgt;
    if (y < EDGE) y = host.height - hgt - EDGE - GAP; // fills the screen: sit at the bottom edge, over the element
    this.root.style.left = `${Math.round(x)}px`;
    this.root.style.top = `${Math.round(y)}px`;
  }
}
