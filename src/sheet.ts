/** Whether the screen is narrow enough for the phone/tablet layout (keep in step with the media query in style.css). */
export const compactQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 999px)') : null;
export const isCompact = () => !!compactQuery?.matches;

export type SheetState = 'closed' | 'peek' | 'full';
const ORDER: SheetState[] = ['closed', 'peek', 'full'];
const FLICK_PX = 40;
const TAP_PX = 6;

/**
 * The bottom sheet that holds properties and layers on a narrow screen. It has three heights: closed, a peek
 * that leaves most of the page showing, and nearly full. The grip at its top is dragged (or tapped) to change it.
 * On a wide screen the same element is the side panel and this does nothing.
 */
export class Sheet {
  state: SheetState = 'closed';
  private grip: HTMLElement;
  private dragging: { startY: number; startH: number; moved: number } | null = null;

  constructor(private root: HTMLElement, private changed: () => void) {
    this.grip = root.querySelector<HTMLElement>('.grip')!;
    this.grip.addEventListener('pointerdown', this.onDown);
    this.grip.addEventListener('pointermove', this.onMove);
    this.grip.addEventListener('pointerup', this.onUp);
    this.grip.addEventListener('pointercancel', () => this.finish(0));
    this.grip.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') this.set(ORDER[Math.min(2, ORDER.indexOf(this.state) + 1)]);
      else if (e.key === 'ArrowDown') this.set(ORDER[Math.max(0, ORDER.indexOf(this.state) - 1)]);
    });
    root.querySelector('.sheet-close')?.addEventListener('click', () => this.set('closed'));
    addEventListener('resize', () => this.apply());
    compactQuery?.addEventListener('change', () => { this.apply(); this.changed(); });
    this.apply();
  }

  private get parentHeight() { return this.root.parentElement?.clientHeight ?? 600; }
  private heightOf(state: SheetState) {
    const parent = this.parentHeight;
    // Even pulled right up, the sheet leaves a strip of page showing: the selection is zoomed to fit there.
    const full = Math.max(0, Math.min(parent - 200, parent * 0.75));
    return state === 'closed' ? 0 : state === 'full' ? Math.round(full) : Math.round(Math.min(full, Math.max(240, Math.min(parent * 0.42, 400))));
  }

  /** Pixels of the canvas the sheet covers (0 when it is closed, or a side panel). */
  get inset() { return isCompact() ? this.heightOf(this.state) : 0; }

  set(state: SheetState) {
    if (state === this.state) return;
    this.state = state;
    this.apply();
    this.changed();
  }

  open(state: SheetState = 'peek') { this.set(state); }

  private apply() {
    this.root.dataset.state = this.state;
    this.root.style.height = isCompact() ? `${this.heightOf(this.state)}px` : '';
    this.grip.setAttribute('aria-expanded', String(this.state !== 'closed'));
  }

  // ---- dragging the grip -------------------------------------------------------

  private onDown = (e: PointerEvent) => {
    if (!isCompact() || (e.target as HTMLElement).closest('button')) return;
    this.dragging = { startY: e.clientY, startH: this.root.getBoundingClientRect().height, moved: 0 };
    this.root.classList.add('dragging');
    this.grip.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.dragging;
    if (!d) return;
    d.moved = d.startY - e.clientY; // positive: pulled up
    this.root.style.height = `${Math.max(0, Math.min(this.heightOf('full'), d.startH + d.moved))}px`;
  };

  private onUp = (e: PointerEvent) => {
    if (this.dragging && this.grip.hasPointerCapture(e.pointerId)) this.grip.releasePointerCapture(e.pointerId);
    this.finish(this.dragging?.moved ?? 0);
  };

  private finish(moved: number) {
    if (!this.dragging) return;
    this.dragging = null;
    this.root.classList.remove('dragging');
    const at = ORDER.indexOf(this.state);
    if (Math.abs(moved) < TAP_PX) this.set(this.state === 'peek' ? 'full' : 'peek'); // a tap on the grip toggles
    else if (moved > FLICK_PX) this.set(ORDER[Math.min(2, at + 1)]);
    else if (moved < -FLICK_PX) this.set(ORDER[Math.max(0, at - 1)]); // swiped down
    this.apply();
  }
}
