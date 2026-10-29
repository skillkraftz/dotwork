import { h } from '../panel';
import { FIRST_SLOT, lastSlot, type Book } from './book';

const SPEED_KEY = 'dotwork.book.flip-ms';
export const FLIP_MS = { min: 250, max: 3000, step: 250, default: 1000 };

/** 250 ms to 3 s: "0.25 s", "1 s", "2.5 s". */
const seconds = (ms: number) => `${ms / 1000} s per opening`;

const savedSpeed = () => {
  try { const v = Number(localStorage.getItem(SPEED_KEY)); if (v >= FLIP_MS.min && v <= FLIP_MS.max) return v; } catch { /* ignore */ }
  return FLIP_MS.default;
};

/** The openings of a book as slots, left and right (null for nothing there): the outside front cover alone if it is designed, then the inside front cover facing page 1, 2 facing 3, … the last page facing the inside back cover, then the outside back cover alone if it is designed. */
export function openings(book: Book): [number | null, number | null][] {
  return [
    ...(book.cover.outside_front ? [[null, FIRST_SLOT] as [number | null, number | null]] : []),
    ...Array.from({ length: openingCount(book) }, (_, i): [number, number] => [i * 2, i * 2 + 1]),
    ...(book.cover.outside_back ? [[lastSlot(book), null] as [number | null, number | null]] : []),
  ];
}

/** The openings of a book in order: the inside front cover facing page 1, 2 facing 3, … the last page facing the inside back cover. Each is its left slot. */
export const openingCount = (book: Book) => book.page_count / 2 + 1;

/** "Edit this page": which slots can be edited where they sit, and how to open one. */
export interface FlipEdit { can(slot: number): boolean; open(slot: number): void }

/**
 * Play the book as a flip-book: every opening in order, dates filled. Tap or Space pauses, then a tap on the opening (or Stop here, or
 * Escape) closes at that opening and calls `onStop` with its left slot. `render` draws one slot as an SVG string.
 */
export function flipThrough(book: Book, render: (slot: number, align: string) => string, onStop: (leftSlot: number) => void, edit?: FlipEdit): void {
  const all = openings(book), last = all.length - 1;
  let at = 0, playing = true, ms = savedSpeed(), timer = 0;

  const stage = h('div', { class: 'book-stage spreads flip-stage', 'data-help': 'flip-stage' });
  const where = h('strong', {});
  const speedLabel = h('span', { class: 'hint' });
  const prev = h('button', { type: 'button', class: 'nav-step', 'data-help': 'flip-prev', 'aria-label': 'Previous opening', onclick: () => step(-1) }, '‹');
  const next = h('button', { type: 'button', class: 'nav-step', 'data-help': 'flip-next', 'aria-label': 'Next opening', onclick: () => step(1) }, '›');
  const play = h('button', { type: 'button', 'data-help': 'flip-play', onclick: () => toggle() });
  const speed = h('input', { type: 'range', min: FLIP_MS.min, max: FLIP_MS.max, step: FLIP_MS.step, value: ms, 'aria-label': 'Time per opening', 'data-help': 'flip-speed' });
  const stop = h('button', { type: 'button', class: 'primary', 'data-help': 'flip-stop', onclick: () => dialog.close() }, 'Stop here');
  const editBar = h('div', { class: 'flip-bar flip-edit' });
  let editing: number | null = null;
  const dialog = h('dialog', { class: 'library flip', 'aria-label': 'Flip through' },
    h('header', {}, h('h2', {}, 'Flip through'), stop),
    stage,
    editBar,
    h('div', { class: 'flip-bar' }, prev, h('div', { class: 'where', 'aria-live': 'off' }, where), next),
    h('div', { class: 'flip-bar' }, play, h('label', { class: 'flip-speed' }, speedLabel, speed))) as HTMLDialogElement;

  const show = () => {
    const [left, right] = all[at];
    stage.replaceChildren(...[left, right].map((slot, i) => {
      const page = h('div', { class: 'stage-page' });
      if (slot !== null) page.innerHTML = render(slot, i === 0 ? 'xMaxYMid' : 'xMinYMid');
      return page;
    }));
    where.textContent = left === null ? 'Outside front cover' : right === null ? 'Outside back cover' : left === 0 ? 'Inside front cover and page 1'
      : left === book.page_count ? `Page ${book.page_count} and inside back cover` : `Pages ${left} and ${left + 1}`;
    const editable = edit ? [left, right].filter((n): n is number => n !== null && edit.can(n)) : [];
    editBar.hidden = !editable.length;
    editBar.replaceChildren(...editable.map((n) => h('button', {
      type: 'button', 'data-help': 'flip-edit', 'data-key': 'flip-edit',
      onclick: () => { editing = n; dialog.close(); },
    }, editable.length === 1 ? 'Edit this page' : `Edit the ${n === left ? 'left' : 'right'} page`)));
    prev.disabled = at <= 0;
    next.disabled = at >= last;
    play.textContent = playing ? 'Pause' : at >= last ? 'Play again' : 'Play';
    speedLabel.textContent = seconds(ms);
  };
  const tick = () => {
    clearTimeout(timer);
    if (!playing) return;
    timer = window.setTimeout(() => {
      if (at >= last) { playing = false; show(); return; }
      at++;
      show();
      tick();
    }, ms);
  };
  const pause = () => { playing = false; clearTimeout(timer); show(); };
  const toggle = () => {
    if (playing) return pause();
    if (at >= last) at = 0;
    playing = true;
    show();
    tick();
  };
  function step(direction: -1 | 1) { at = Math.max(0, Math.min(last, at + direction)); pause(); }

  speed.oninput = () => { ms = Number(speed.value); try { localStorage.setItem(SPEED_KEY, String(ms)); } catch { /* ignore */ } speedLabel.textContent = seconds(ms); tick(); };
  // A tap pauses while it plays; a tap on a paused opening stops there.
  stage.onclick = () => { if (playing) pause(); else dialog.close(); };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  dialog.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); }); // a focused button must not also click on Space
  dialog.addEventListener('close', () => { clearTimeout(timer); dialog.remove(); onStop(all[at][0] ?? all[at][1]!); if (editing !== null) edit?.open(editing); });

  document.body.append(dialog);
  show();
  dialog.showModal();
  tick();
}
