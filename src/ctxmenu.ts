import type { ContextAction } from './actions';
import { h } from './panel';

const GUARD_MS = 350;
let open: { el: HTMLElement; close: () => void } | null = null;

export function closeContextMenu() {
  open?.close();
}

/**
 * The menu a long press (or right-click) on an element opens, next to the finger but never under it.
 * It closes on any action, on a press elsewhere, and on Escape.
 */
export function showContextMenu(at: { x: number; y: number }, actions: ContextAction[]) {
  closeContextMenu();
  const shownAt = Date.now();
  const el = h('div', { class: 'ctx-menu', role: 'menu', 'aria-label': 'Element actions' },
    ...actions.map((a) => h('button', {
      type: 'button', role: 'menuitem', 'data-action': a.id, 'data-help': `ctx-${a.id}`, disabled: !a.enabled,
      // The finger that opened the menu may still be lifting off: ignore it.
      onclick: () => { if (Date.now() - shownAt < GUARD_MS) return; close(); a.run(); },
    }, a.label)));
  el.style.visibility = 'hidden';
  document.body.append(el);

  const w = el.offsetWidth, hgt = el.offsetHeight, vw = innerWidth, vh = innerHeight;
  const gap = 28; // clear of a fingertip
  const left = Math.max(8, Math.min(vw - w - 8, at.x - w / 2));
  const top = at.y - gap - hgt >= 8 ? at.y - gap - hgt : Math.min(vh - hgt - 8, at.y + gap);
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, top)}px`;
  el.style.visibility = '';

  const away = (e: Event) => { if (!el.contains(e.target as Node)) close(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
    el.remove();
    if (open?.el === el) open = null;
  }
  // Listen after this press has finished, so the one that opened the menu doesn't close it.
  setTimeout(() => { if (open?.el === el) document.addEventListener('pointerdown', away, true); }, 0);
  document.addEventListener('keydown', key, true);
  open = { el, close };
  el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
