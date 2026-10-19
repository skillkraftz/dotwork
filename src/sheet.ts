/** Whether the screen is narrow enough for the phone/tablet layout (keep in step with the media query in style.css). */
export const compactQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 999px)') : null;
export const isCompact = () => !!compactQuery?.matches;

export type SheetState = 'closed' | 'open';

/**
 * Properties and layers on a narrow screen: a modal over the page with a Close button, opened only by a person
 * asking for it (the action bar's Properties button, a double-tap, or the Layers button). On a wide screen the same
 * element is the side panel and this does nothing.
 */
export class Sheet {
  state: SheetState = 'closed';

  constructor(private root: HTMLElement, private backdrop: HTMLElement, private changed: () => void) {
    root.querySelector('.sheet-close')?.addEventListener('click', () => this.set('closed'));
    backdrop.addEventListener('click', () => this.set('closed'));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.state !== 'closed' && isCompact()) this.set('closed'); });
    compactQuery?.addEventListener('change', () => { this.apply(); this.changed(); });
    this.apply();
  }

  set(state: SheetState) {
    if (state === this.state) return;
    this.state = state;
    this.apply();
    this.changed();
  }

  open() { this.set('open'); }

  private apply() {
    this.root.dataset.state = this.state;
    this.backdrop.dataset.state = this.state;
    if (this.state === 'open' && isCompact()) this.root.querySelector<HTMLElement>('.sheet-close')?.focus({ preventScroll: true });
  }
}
