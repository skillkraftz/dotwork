import { HELP, type HelpEntry } from './help';

export type InputType = 'touch' | 'desktop';

/** What the last pointer event was: a finger or pen, or a mouse. A touchscreen laptop answers whichever was used last. */
let last: InputType | null = null;
const typeOf = (e: PointerEvent): InputType => (e.pointerType === 'mouse' ? 'desktop' : 'touch');

/** Which kind of input the person is using now: the last pointer seen, else whether the screen's main pointer is coarse. */
export function inputType(): InputType {
  return last ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop');
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'pointermove'] as const) {
    window.addEventListener(type, (e) => { last = typeOf(e); }, { capture: true, passive: true });
  }
}

/** Events that would make a control act; help mode keeps them from reaching it. */
const BLOCKED = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel'] as const;
/** A press that moves farther than this is a drag or a scroll, not a tap. */
const TAP_SLOP = 10;
/** These still work in help mode, so that what they reveal can be asked about (the menu's items, each mode's buttons); they are explained too. */
const OPENS_ITSELF = ['menu-button', 'mode-select', 'mode-draw', 'mode-advanced'];

export interface HelpHost {
  /** The key of the help entry for the page itself, for the current tool. */
  pageKey(): string;
  /** Where the card goes: it is put right after this element. */
  after: HTMLElement;
}

/**
 * Help mode: a card says it is on; while it is, tapping or clicking any control explains it instead of using it, and
 * tapping the page explains the gestures of the current tool. Closing the card ends it.
 */
export class HelpMode {
  private card: HTMLElement;
  private cardText = document.createElement('span');
  private pop: HTMLElement;
  private down: { x: number; y: number } | null = null;
  active = false;

  constructor(private host: HelpHost) {
    const close = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Close', ariaLabel: 'Close help mode' });
    close.dataset.help = 'help-close';
    close.addEventListener('click', () => this.stop());
    this.card = Object.assign(document.createElement('div'), { id: 'help-card', hidden: true });
    this.card.setAttribute('role', 'status');
    this.card.append(this.cardText, close);
    this.pop = Object.assign(document.createElement('div'), { id: 'help-pop', hidden: true });
    this.pop.setAttribute('role', 'status');
    host.after.after(this.card);
    document.body.append(this.pop);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.card.hidden = false;
    this.showCardText();
    document.body.classList.add('help-mode');
    for (const t of BLOCKED) window.addEventListener(t, this.onEvent, true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.card.hidden = true;
    this.hide();
    document.body.classList.remove('help-mode');
    for (const t of BLOCKED) window.removeEventListener(t, this.onEvent, true);
  }

  private showCardText() {
    this.cardText.textContent = `Help mode: ${inputType() === 'touch' ? 'tap' : 'click'} anything to see what it does.`;
  }

  /** What is under (or in) the event's target that has help: the nearest control, or the page. */
  private keyAt(target: Element | null): { key: string; el: Element } | null {
    const ctl = target?.closest<HTMLElement>('[data-help]') ?? target?.closest('label')?.control?.closest<HTMLElement>('[data-help]');
    if (ctl) return { key: ctl.dataset.help!, el: ctl };
    const page = target?.closest('#canvas, #canvas-left, #canvas-right');
    return page ? { key: this.host.pageKey(), el: page } : null;
  }

  private inside = (el: Element | null) => !!el?.closest('#help-card');

  private onEvent = (e: Event) => {
    const target = e.target instanceof Element ? e.target : null;
    if (this.inside(target)) return; // the card's own button works
    const anywhere = e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress';

    if (anywhere) {
      const k = e as KeyboardEvent;
      if (k.key === 'Escape') { if (e.type === 'keydown') { e.stopPropagation(); if (this.pop.hidden) this.stop(); else this.hide(); } return; }
      // Tab moves around; Enter and Space on a control are clicks, which are explained below.
      if (k.key === 'Tab' || ((k.key === 'Enter' || k.key === ' ') && this.keyAt(target)?.el === target)) return;
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    const opens = target?.closest<HTMLElement>('[data-help]')?.dataset.help;
    const passes = !!opens && OPENS_ITSELF.includes(opens);

    if (e.type === 'pointerdown') {
      const p = e as PointerEvent;
      if (p.isPrimary) this.down = { x: p.clientX, y: p.clientY };
    }
    if (e.type === 'pointerup') {
      const p = e as PointerEvent;
      const tapped = p.isPrimary && this.down && Math.hypot(p.clientX - this.down.x, p.clientY - this.down.y) < TAP_SLOP && (p.pointerType !== 'mouse' || p.button === 0);
      this.down = null;
      // Found by position, not by target: a disabled button gets no click, but it can still be asked about.
      if (tapped) this.explainAt(p.clientX, p.clientY);
    } else if (e.type === 'click' && (e as MouseEvent).detail === 0) {
      // From the keyboard (Enter or Space on a focused control).
      const hit = this.keyAt(target);
      if (hit) this.explain(hit.key, hit.el.getBoundingClientRect());
    }
    if (passes) return;
    e.stopPropagation();
    // Presses and clicks are kept from acting; moves and releases must stay free of that, so scrolling still works.
    if (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'click' || e.type === 'dblclick' || e.type === 'contextmenu') e.preventDefault();
  };

  private explainAt(x: number, y: number) {
    const top = document.elementsFromPoint(x, y)[0] ?? null;
    const hit = this.inside(top) ? null : this.keyAt(top);
    if (!hit) { this.hide(); return; }
    this.explain(hit.key, hit.el.matches('#canvas, #canvas-left, #canvas-right') ? new DOMRect(x, y, 0, 0) : hit.el.getBoundingClientRect());
  }

  private explain(key: string, near: DOMRect) {
    const entry: HelpEntry | undefined = HELP[key];
    const type = inputType();
    this.showCardText();
    const body = entry
      ? [this.line('strong', entry.name), this.line('p', entry.what), this.line('p', entry[type === 'touch' ? 'touch' : 'desktop'], 'how')]
      : [this.line('strong', key), this.line('p', 'No help written for this yet.')];
    this.pop.replaceChildren(...body);
    this.pop.hidden = false;
    this.place(near);
  }

  private line(tag: 'strong' | 'p', text: string, cls = '') {
    return Object.assign(document.createElement(tag), { textContent: text, className: cls });
  }

  /** Below the thing asked about, or above it when there is no room; always inside the screen. */
  private place(near: DOMRect) {
    const pad = 8, gap = 10;
    const vw = innerWidth, vh = innerHeight;
    this.pop.style.left = '0px';
    this.pop.style.top = '0px';
    const w = this.pop.offsetWidth, h = this.pop.offsetHeight;
    const left = Math.max(pad, Math.min(vw - w - pad, near.left + near.width / 2 - w / 2));
    let top = near.bottom + gap;
    if (top + h > vh - pad) top = near.top - gap - h;
    this.pop.style.left = `${Math.round(left)}px`;
    this.pop.style.top = `${Math.round(Math.max(pad, Math.min(vh - h - pad, top)))}px`;
  }

  private hide() {
    this.pop.hidden = true;
  }
}
