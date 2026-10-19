/**
 * The on-screen keyboard. Opening it resizes the window on many phones, and nothing should be refitted or rebuilt
 * for that: the page and the panel stay as they are, the bottom tool bar steps aside, and the field being typed in
 * stays in view. A resize counts as the keyboard when a text field has focus on a touch screen, the width is the
 * same and the height has shrunk by a keyboard's worth (a rotation changes the width; a window drag has no touch).
 */

/** Less than this is the browser's own bars coming and going, not a keyboard. */
const MIN_SHRINK = 80;
/** Let the keyboard finish sliding before looking for the field. */
const REVEAL_MS = 300;

const NOT_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'];
export const isEditable = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NOT_TEXT.includes(el.type));

const hasWindow = typeof window !== 'undefined';
const viewportHeight = () => Math.min(innerHeight, window.visualViewport?.height ?? innerHeight);
const touch = () => matchMedia('(pointer: coarse)').matches;

/** The window as it was before any keyboard. */
let base = hasWindow ? { w: innerWidth, h: viewportHeight() } : { w: 0, h: 0 };

/** Whether the keyboard is up right now. */
export function keyboardOpen(): boolean {
  return hasWindow && touch() && isEditable(document.activeElement) && innerWidth === base.w && viewportHeight() < base.h - MIN_SHRINK;
}

let wasOpen = false;
let revealTimer: ReturnType<typeof setTimeout> | undefined;

/** Keep the field being typed in on screen inside the properties modal. */
function reveal() {
  const a = document.activeElement;
  if (isEditable(a) && a.closest('#sheet')) a.scrollIntoView({ block: 'center' });
}

function update() {
  const open = keyboardOpen();
  if (!open) base = { w: innerWidth, h: viewportHeight() };
  // Where the window itself doesn't shrink (iOS), only the visual viewport does: lift the modal clear of the keyboard.
  const vv = window.visualViewport;
  const lift = open && vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--kb', `${Math.round(lift)}px`);
  if (open !== wasOpen) {
    wasOpen = open;
    document.body.classList.toggle('keyboard-open', open);
  }
  if (open) {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, REVEAL_MS);
  }
}

if (hasWindow) {
  // Registered first, so the state is settled before any other resize listener looks at it.
  addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  document.addEventListener('focusin', () => { update(); if (touch() && isEditable(document.activeElement)) { clearTimeout(revealTimer); revealTimer = setTimeout(reveal, REVEAL_MS); } });
  document.addEventListener('focusout', () => setTimeout(update, 0));
}
