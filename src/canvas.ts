import { GRID_X_MM, GRID_Y_MM, PITCH_MM as P, type PageElement } from './format/types';
import { elementArea } from './format/bounds';
import { validateElement } from './format/validate';
import {
  cycleHit, elementFromDrag, HANDLE_CURSOR, hitElement, hitHandle, hitHandlePoint, moveElement, resizeElement, snapPoint, snapStep,
  type Handle, type Pt,
} from './geometry';
import { addElement } from './actions';
import { LongPress } from './longpress';
import { EDIT_BOX, EDIT_VIEWBOX, FIT_BOX, pageContent } from './render';
import type { Store } from './store';
import { compactQuery } from './sheet';
import { fitView, panBy, pinchOf, revealRect, scaleOf, viewRect, zoomAt, type Rect, type View } from './viewport';

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt }
  | { kind: 'text'; at: Pt }
  | { kind: 'swipe'; x: number; y: number }
  | { kind: 'move'; index: number; origin: PageElement; startCells: Pt; last: PageElement; moved: boolean; clickSelect?: number }
  | { kind: 'resize'; index: number; handle: Handle; origin: PageElement; last: PageElement };

/** Tolerances in screen px. Fingers are fat and imprecise, so touch gets more room than a mouse. */
const MOUSE = { handle: 8, hit: 5, dragStart: 3, handleDraw: 8 };
const TOUCH = { handle: 20, hit: 14, dragStart: 8, handleDraw: 16 };
const SWIPE_PX = 70;

/** What the screen around the canvas does with touch gestures the canvas recognises. */
export interface CanvasHooks {
  /** An element was long-pressed (or right-clicked); `hits` are all the elements under that point, topmost first. */
  contextMenu?(index: number, hits: number[], at: { x: number; y: number }): void;
  /** A swipe sideways over empty page: -1 for rightwards (previous page), 1 for leftwards (next page). */
  swipe?(direction: -1 | 1): void;
}

/** Draws the page into the SVG and turns pointer input into element edits, pinch-zoom and pan. */
export class Canvas {
  private drag: Drag | null = null;
  private content: SVGGElement;
  private downPx: Pt = { x: 0, y: 0 };
  private downType = 'mouse';

  /** Zoom and pan. While `fitted` the page is kept fitted to the element as it resizes. */
  view: View = { zoom: 1, cx: EDIT_BOX.x + EDIT_BOX.w / 2, cy: EDIT_BOX.y + EDIT_BOX.h / 2 };
  fitted = true;
  /** The view was only moved by `revealSelection`, to clear the sheet; `restore` puts it back. */
  private autoPanned = false;
  /** Pixels at the bottom of the canvas covered by the bottom sheet. */
  inset: () => number = () => 0;
  /** Draw as printed and ignore input (the view of both pages of a spread). */
  readOnly = false;

  private pointers = new Map<number, Pt>();
  private pinch: { dist: number; mid: Pt; view: View } | null = null;
  private press = new LongPress(TOUCH.dragStart);
  private observer: ResizeObserver | null = null;

  constructor(
    private svg: SVGSVGElement,
    public store: Store,
    /** Show a message under the canvas (null clears it). */
    private notify: (message: string | null) => void,
    private hooks: CanvasHooks = {},
  ) {
    svg.setAttribute('viewBox', EDIT_VIEWBOX);
    svg.innerHTML = '<g id="content"></g>';
    this.content = svg.querySelector('#content')!;
    svg.addEventListener('pointerdown', this.onDown);
    svg.addEventListener('pointermove', this.onMove);
    svg.addEventListener('pointerup', this.onUp);
    svg.addEventListener('pointercancel', (e) => this.onCancel(e));
    svg.addEventListener('wheel', this.onWheel, { passive: false });
    svg.addEventListener('contextmenu', this.onContextMenu);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { if (this.fitted) this.fit(); else this.applyView(); });
      this.observer.observe(svg);
    }
  }

  // ---- zoom and pan ---------------------------------------------------------

  private size() {
    const r = this.svg.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  private applyView() {
    const size = this.size();
    if (size.w < 1 || size.h < 1) return;
    const r = viewRect(this.view, EDIT_BOX, size);
    this.svg.setAttribute('viewBox', `${r.x} ${r.y} ${r.w} ${r.h}`);
    this.render();
  }

  /** Put the whole page on screen, above whatever covers the bottom. */
  fit() {
    const size = this.size();
    if (size.w < 1 || size.h < 1) return;
    // On a narrow screen every pixel counts, so the page nearly fills the width; on a wide one it sits in its margin.
    this.view = fitView(EDIT_BOX, size, this.inset(), compactQuery?.matches ? FIT_BOX : EDIT_BOX);
    this.fitted = true;
    this.autoPanned = false;
    this.applyView();
  }

  /** After the sheet closes: if the view was moved only to clear it, fit the page again. */
  restore() {
    if (this.autoPanned) this.fit();
  }

  /** Whether the user has zoomed or panned away from the fitted view. */
  get userMoved() { return !this.fitted && !this.autoPanned; }

  private setView(view: View, automatic = false) {
    this.autoPanned = automatic && (this.fitted || this.autoPanned);
    this.view = view;
    this.fitted = false;
    this.applyView();
  }

  /** mm per screen px at the current view. */
  private mmPerPx() {
    const size = this.size();
    return size.w < 1 || size.h < 1 ? 0.27 : scaleOf(this.view, EDIT_BOX, size);
  }

  /** Scroll (and if need be shrink) the page so the selected element is fully visible above the bottom sheet. */
  revealSelection() {
    const { store } = this;
    const size = this.size();
    if (store.selected === null || size.w < 1 || size.h < 1) return;
    const el = store.page.elements[store.selected];
    if (!el) return;
    const a = elementArea(el);
    const pad = (this.handlePx() / 2) * this.mmPerPx();
    const target: Rect = { x: GRID_X_MM + a.x * P - pad, y: GRID_Y_MM + a.y * P - pad, w: a.w * P + 2 * pad, h: a.h * P + 2 * pad };
    const next = revealRect(this.view, target, EDIT_BOX, size, this.inset());
    if (next !== this.view) this.setView(next, true);
  }

  private onWheel = (e: WheelEvent) => {
    if (this.readOnly) return;
    e.preventDefault();
    const size = this.size();
    if (size.w < 1) return;
    if (e.ctrlKey || e.metaKey) {
      const rect = this.svg.getBoundingClientRect();
      this.setView(zoomAt(this.view, Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top }, EDIT_BOX, size));
    } else {
      this.setView(panBy(this.view, -e.deltaX, -e.deltaY, EDIT_BOX, size));
    }
  };

  // ---- drawing --------------------------------------------------------------

  private handlePx() {
    return (matchMedia('(pointer: coarse)').matches ? TOUCH : MOUSE).handleDraw;
  }

  cancel() {
    this.drag = null;
    this.press.cancel();
    this.render();
  }

  render() {
    const { store } = this;
    const d = this.drag;
    let page = store.page;
    let draft: PageElement | null = null;
    if (d && (d.kind === 'move' || d.kind === 'resize')) {
      page = { ...page, elements: page.elements.map((e, i) => (i === d.index ? d.last : e)) };
    } else if (d?.kind === 'draw' && store.tool !== 'select' && store.tool !== 'text') {
      draft = elementFromDrag(store.tool, d.start, d.cur);
    }
    const preview = store.mode === 'preview' || this.readOnly;
    this.content.innerHTML = pageContent(page, {
      mode: preview ? 'preview' : 'edit',
      selected: store.selected,
      hidden: store.hiddenIndexes,
      draft,
      handleMm: this.handlePx() * this.mmPerPx(),
    });
    if (preview) this.svg.style.cursor = 'default';
    else if (!d) this.svg.style.cursor = store.tool === 'select' ? 'default' : 'crosshair';
  }

  /** Pointer position in grid cells (fractional), plus cells-per-pixel for tolerances. */
  private toCells(e: PointerEvent | MouseEvent): { p: Pt; cellsPerPx: number } {
    const m = this.svg.getScreenCTM()!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { p: { x: (pt.x - GRID_X_MM) / P, y: (pt.y - GRID_Y_MM) / P }, cellsPerPx: 1 / m.a / P };
  }

  /** Indexes of visible, unlocked elements under the pointer, topmost first. */
  private hits(p: Pt, tol: number): number[] {
    const out: number[] = [];
    this.store.page.elements.forEach((el, i) => {
      if (!this.store.isHidden(i) && !this.store.isLocked(i) && hitElement(el, p, tol)) out.push(i);
    });
    return out.reverse();
  }

  private half(e: { shiftKey: boolean }) {
    return e.shiftKey || this.store.halfCells;
  }

  // ---- pointers -------------------------------------------------------------

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    const rect = this.svg.getBoundingClientRect();
    const { dist, mid } = pinchOf(a, b);
    this.pinch = { dist: Math.max(dist, 1), mid: { x: mid.x - rect.left, y: mid.y - rect.top }, view: this.view };
  }

  private onDown = (e: PointerEvent) => {
    const { store } = this;
    if (this.readOnly) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary) this.pointers.clear(); // a first finger means any earlier ones are gone, whatever events were missed
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      // A second finger turns whatever the first one started into a pinch and pan.
      this.drag = null;
      this.press.cancel();
      this.render();
      if (this.pointers.size === 2) this.startPinch();
      return;
    }
    if (store.mode !== 'edit') return;
    const touch = e.pointerType === 'touch';
    const tol = touch ? TOUCH : MOUSE;
    this.downType = e.pointerType;
    const { p, cellsPerPx } = this.toCells(e);
    this.downPx = { x: e.clientX, y: e.clientY };
    this.notify(null);

    if (store.tool === 'text') {
      // Placed on release, so a pinch that starts with this finger doesn't leave text behind.
      this.drag = { kind: 'text', at: snapPoint(p, this.half(e)) };
    } else if (store.tool !== 'select') {
      const at = snapPoint(p, this.half(e));
      this.drag = { kind: 'draw', start: at, cur: at };
    } else {
      const sel = store.selected;
      const canHandle = sel !== null && !store.isLocked(sel) && !store.isHidden(sel);
      const handle = !canHandle ? null : touch
        ? hitHandlePoint(store.page.elements[sel], p, tol.handle * cellsPerPx)
        : hitHandle(store.page.elements[sel], p, tol.handle * cellsPerPx);
      if (handle && sel !== null) {
        const origin = store.page.elements[sel];
        this.drag = { kind: 'resize', index: sel, handle, origin, last: origin };
      } else {
        const hits = this.hits(p, tol.hit * cellsPerPx);
        let hit = hits[0];
        let clickSelect: number | undefined;
        if (e.altKey && hits.length > 1) {
          // Alt-click steps down through the stack (long-press offers the same on touch).
          hit = cycleHit(hits, store.selected)!;
        } else if (store.selected !== null && hits.includes(store.selected) && hit !== store.selected) {
          // Pressing on the selected element drags it (so an element reached from the menu can be moved);
          // letting go without dragging selects the topmost one, as a plain click does.
          clickSelect = hit;
          hit = store.selected;
        }
        if (hit === undefined) {
          store.select(null);
          if (touch) this.drag = { kind: 'swipe', x: e.clientX, y: e.clientY };
        } else {
          store.select(hit);
          const origin = store.page.elements[hit];
          this.drag = { kind: 'move', index: hit, origin, startCells: p, last: origin, moved: false, clickSelect };
          if (e.pointerType !== 'mouse') {
            const at = { x: e.clientX, y: e.clientY };
            this.press.start(e.clientX, e.clientY, () => this.longPressed(hit, hits, at));
          }
        }
      }
    }
    this.svg.setPointerCapture(e.pointerId);
    this.render();
  };

  private longPressed(index: number, hits: number[], at: { x: number; y: number }) {
    const d = this.drag;
    if (!d || d.kind !== 'move' || d.moved) return;
    this.drag = null;
    this.render();
    this.hooks.contextMenu?.(index, hits.includes(index) ? hits : [index, ...hits], at);
  }

  /** Right-click: the same menu as a long press, for a mouse. */
  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault(); // also stops the browser's own menu appearing on a touch long press
    const { store } = this;
    if (this.readOnly || store.mode !== 'edit' || store.tool !== 'select' || !this.hooks.contextMenu || this.press.pending) return;
    const { p, cellsPerPx } = this.toCells(e);
    const hits = this.hits(p, MOUSE.hit * cellsPerPx);
    if (!hits.length) return;
    store.select(hits[0]);
    this.hooks.contextMenu(hits[0], hits, { x: e.clientX, y: e.clientY });
  };

  private onMove = (e: PointerEvent) => {
    const { store } = this;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) {
      if (this.pointers.size >= 2) this.pinchMove();
      return;
    }
    const tol = e.pointerType === 'touch' ? TOUCH : MOUSE;
    const { p, cellsPerPx } = this.toCells(e);
    const d = this.drag;
    if (!d) {
      if (e.pointerType !== 'mouse' || store.mode !== 'edit' || store.tool !== 'select') return;
      const sel = store.selected;
      const h = sel !== null && !store.isLocked(sel) ? hitHandle(store.page.elements[sel], p, tol.handle * cellsPerPx) : null;
      this.svg.style.cursor = h ? HANDLE_CURSOR[h] : this.hits(p, tol.hit * cellsPerPx).length ? 'move' : 'default';
      return;
    }
    this.press.move(e.clientX, e.clientY);

    const step = snapStep(this.half(e));
    if (d.kind === 'draw') {
      d.cur = snapPoint(p, this.half(e));
    } else if (d.kind === 'move') {
      const slop = (this.downType === 'touch' ? TOUCH : MOUSE).dragStart;
      if (!d.moved && Math.hypot(e.clientX - this.downPx.x, e.clientY - this.downPx.y) < slop) return;
      d.moved = true;
      const dx = Math.round((p.x - d.startCells.x) / step) * step, dy = Math.round((p.y - d.startCells.y) / step) * step;
      d.last = moveElement(d.origin, dx, dy);
    } else if (d.kind === 'resize') {
      const next = resizeElement(d.origin, d.handle, snapPoint(p, this.half(e)));
      // Hold the last good shape when the drag would leave nothing, and say why.
      if (!next) this.notify('An element can’t be resized down to nothing.');
      else if (validateElement(next).length) this.notify(validateElement(next)[0].message);
      else { this.notify(null); d.last = next; }
    } else {
      return;
    }
    this.render();
  };

  /** Two fingers: zoom by the change in distance, pan by the movement of the midpoint. */
  private pinchMove() {
    const pinch = this.pinch;
    const size = this.size();
    if (!pinch || size.w < 1) return;
    const [a, b] = [...this.pointers.values()];
    const rect = this.svg.getBoundingClientRect();
    const now = pinchOf(a, b);
    const mid = { x: now.mid.x - rect.left, y: now.mid.y - rect.top };
    // Zoom about where the fingers started, then slide by how far their midpoint has travelled.
    let v = zoomAt(pinch.view, now.dist / pinch.dist, pinch.mid, EDIT_BOX, size);
    v = panBy(v, mid.x - pinch.mid.x, mid.y - pinch.mid.y, EDIT_BOX, size);
    this.setView(v);
  }

  private onCancel(e: PointerEvent) {
    this.forget(e);
    this.drag = null;
    this.press.cancel();
    this.render();
  }

  /** Stop tracking a finger; the pinch ends when fewer than two remain. */
  private forget(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }

  private onUp = (e: PointerEvent) => {
    const wasPinching = this.pinch !== null;
    this.forget(e);
    this.press.cancel();
    if (wasPinching) return;
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    const { store } = this;

    if (d.kind === 'swipe') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!this.userMoved && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) this.hooks.swipe?.(dx < 0 ? 1 : -1);
    } else if (d.kind === 'text') {
      addElement(store, { type: 'text', x: d.at.x, y: Math.min(d.at.y, 43), text: 'Text' });
      return;
    } else if (d.kind === 'draw') {
      if (store.tool !== 'select' && store.tool !== 'text') {
        const el = elementFromDrag(store.tool, d.start, d.cur);
        if (el && validateElement(el).length === 0) { addElement(store, el); return; }
        if (el) this.notify(`Not created: ${validateElement(el)[0].message}`);
      }
    } else if (d.kind === 'move' && !d.moved && d.clickSelect !== undefined) {
      store.select(d.clickSelect);
      return;
    } else if ((d.kind === 'move' || d.kind === 'resize') && JSON.stringify(d.last) !== JSON.stringify(d.origin)) {
      const next = structuredClone(store.page);
      next.elements[d.index] = d.last;
      store.commit(next);
      return;
    }
    this.render();
  };
}
