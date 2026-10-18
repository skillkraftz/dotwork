export const LONG_PRESS_MS = 500;

/**
 * Recognises a long press: the finger stays down, hardly moving, for `delay` ms. Call `start` on the press,
 * `move` as it moves and `cancel` on release (or when another finger joins).
 */
export class LongPress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin = { x: 0, y: 0 };

  constructor(private slopPx: number, private delay = LONG_PRESS_MS) {}

  get pending() { return this.timer !== null; }

  start(x: number, y: number, fire: () => void) {
    this.cancel();
    this.origin = { x, y };
    this.timer = setTimeout(() => { this.timer = null; fire(); }, this.delay);
  }

  move(x: number, y: number) {
    if (this.timer !== null && Math.hypot(x - this.origin.x, y - this.origin.y) > this.slopPx) this.cancel();
  }

  cancel() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
