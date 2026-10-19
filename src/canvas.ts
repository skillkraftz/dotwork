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
import { fitView, panBy, pinchOf, scaleOf, viewRect, zoomAt, type View } from './viewport';

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt }
  | { kind: 'text'; at: Pt }
  | { kind: 'pan'; last: Pt }
  | { kind: 'move'; index: number; origin: PageElement; startCells: Pt; last: PageElement; moved: boolean; clickSelect?: number }
  | { kind: 'resize'; index: number; handle: Handle; origin: PageElement; last: PageElement };

/** Tolerances in screen px. Fingers are fat and imprecise, so touch gets more room than a mouse. */
const MOUSE = { handle: 8, hit: 5, dragStart: 3, handleDraw: 8 };
const TOUCH = { handle: 20, hit: 14, dragStart: 8, handleDraw: 16 };
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

/** What the screen around the canvas does with touch gestures the canvas recognises. */
export interface CanvasHooks {
  /** An element was long-pressed (or right-clicked); `hits` are all the elements under that point, topmost first. */
  contextMenu?(index: number, hits: number[], at: { x: number; y: number }): void;
  /** An element was double-tapped (or double-clicked): show its properties. */
  openProperties?(index: number): void;
  /** The page was drawn again: the view, the selection or the element may have moved. */
  rendered?(): void;
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
  /** A finger is down on the page and it is not yet clear what it means: a tap, a drag, or the start of a pinch. */
  private pending: { id: number; at: number; px: Pt; p: Pt; hits: number[]; handle: Handle | null; wasSelected: boolean } | null = null;
  private lastTap: { at: number; px: Pt; index: number } | null = null;
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
    // `detail` counts the clicks; the dblclick event itself is lost when the first click redraws what was under the mouse.
    svg.addEventListener('mousedown', this.onDoubleClick);
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
    this.view = fitView(EDIT_BOX, size, 0, compactQuery?.matches ? FIT_BOX : EDIT_BOX);
    this.fitted = true;
    this.applyView();
  }

  private setView(view: View) {
    this.view = view;
    this.fitted = false;
    this.applyView();
  }

  /** mm per screen px at the current view. */
  private mmPerPx() {
    const size = this.size();
    return size.w < 1 || size.h < 1 ? 0.27 : scaleOf(this.view, EDIT_BOX, size);
  }

  /** The selected element's box on screen, in client px (null when nothing is selected). */
  selectionRect(): { x: number; y: number; w: number; h: number } | null {
    const { store } = this;
    const el = store.selected === null ? undefined : store.page.elements[store.selected];
    const m = this.svg.getScreenCTM();
    if (!el || !m) return null;
    const a = elementArea(el);
    const p0 = new DOMPoint(GRID_X_MM + a.x * P, GRID_Y_MM + a.y * P).matrixTransform(m);
    const p1 = new DOMPoint(GRID_X_MM + (a.x + a.w) * P, GRID_Y_MM + (a.y + a.h) * P).matrixTransform(m);
    return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
  }

  /** Whether a finger or the mouse is in the middle of moving something or the view (so the action bar steps aside). */
  get busy() {
    return this.pinch !== null || (this.drag !== null && this.drag.kind !== 'text' && this.drag.kind !== 'draw');
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
    this.pending = null;
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
    this.hooks.rendered?.();
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
      this.pending = null;
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
    } else if (touch) {
      // Nothing happens yet: a tap, a drag (of the selection or the view) or a pinch is told apart by what comes next.
      const sel = store.selected;
      const canHandle = sel !== null && !store.isLocked(sel) && !store.isHidden(sel);
      const handle = canHandle ? hitHandlePoint(store.page.elements[sel], p, tol.handle * cellsPerPx) : null;
      const hits = this.hits(p, tol.hit * cellsPerPx);
      this.pending = { id: e.pointerId, at: Date.now(), px: this.downPx, p, hits, handle, wasSelected: sel !== null && hits.includes(sel) };
      if (hits.length) {
        const at = { x: e.clientX, y: e.clientY };
        this.press.start(e.clientX, e.clientY, () => this.longPressed(hits[0], hits, at));
      }
    } else {
      const sel = store.selected;
      const canHandle = sel !== null && !store.isLocked(sel) && !store.isHidden(sel);
      const handle = canHandle ? hitHandle(store.page.elements[sel], p, tol.handle * cellsPerPx) : null;
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
    if (this.pending) this.pending = null;
    else if (d?.kind === 'move' && !d.moved) this.drag = null;
    else return;
    this.store.select(index);
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
    const pd = this.pending;
    if (pd && pd.id === e.pointerId) {
      // Far enough to be a drag. Only what is already selected can be moved or resized; anything else pans the view.
      if (Math.hypot(e.clientX - pd.px.x, e.clientY - pd.px.y) < TOUCH.dragStart) return;
      this.pending = null;
      this.press.cancel();
      const sel = store.selected;
      const origin = sel === null ? undefined : store.page.elements[sel];
      if (sel !== null && origin && pd.handle) this.drag = { kind: 'resize', index: sel, handle: pd.handle, origin, last: origin };
      else if (sel !== null && origin && pd.wasSelected) this.drag = { kind: 'move', index: sel, origin, startCells: pd.p, last: origin, moved: false };
      else this.drag = { kind: 'pan', last: pd.px };
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
    } else if (d.kind === 'pan') {
      const size = this.size();
      if (size.w >= 1) this.setView(panBy(this.view, e.clientX - d.last.x, e.clientY - d.last.y, EDIT_BOX, size));
      d.last = { x: e.clientX, y: e.clientY };
      return;
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
    this.pending = null;
    this.press.cancel();
    this.render();
  }

  /** Stop tracking a finger; the pinch ends when fewer than two remain. */
  private forget(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) { this.pinch = null; this.render(); }
  }

  private onUp = (e: PointerEvent) => {
    const wasPinching = this.pinch !== null;
    this.forget(e);
    this.press.cancel();
    if (wasPinching) return;
    const pd = this.pending;
    const d = this.drag;
    if (pd && pd.id === e.pointerId) this.pending = null;
    else if (!d) return;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (pd && pd.id === e.pointerId) { this.tapped(pd); return; }
    if (!d) return;
    this.drag = null;
    const { store } = this;

    if (d.kind === 'pan') {
      // the view already moved
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

  /** A finger went down and came up without moving: select what is under it, or clear the selection. A second tap on the same element opens its properties. */
  private tapped(pd: NonNullable<Canvas['pending']>) {
    const { store } = this;
    const hit = pd.handle ? undefined : pd.hits[0];
    if (pd.handle) { this.render(); return; }
    if (hit === undefined) {
      this.lastTap = null;
      store.select(null);
    } else {
      const last = this.lastTap;
      const again = last && last.index === hit && Date.now() - last.at < DOUBLE_TAP_MS && Math.hypot(pd.px.x - last.px.x, pd.px.y - last.px.y) < DOUBLE_TAP_PX;
      store.select(hit);
      this.lastTap = again ? null : { at: Date.now(), px: pd.px, index: hit };
      if (again) this.hooks.openProperties?.(hit);
    }
    this.render();
  }

  /** Double-click with a mouse: the same as a double-tap. */
  private onDoubleClick = (e: MouseEvent) => {
    const { store } = this;
    if (e.detail !== 2 || e.button !== 0 || this.readOnly || store.mode !== 'edit' || store.tool !== 'select') return;
    const { p, cellsPerPx } = this.toCells(e);
    const hit = this.hits(p, MOUSE.hit * cellsPerPx)[0];
    if (hit === undefined) return;
    e.preventDefault(); // or the press would take the focus back from the field that is about to get it
    store.select(hit);
    this.hooks.openProperties?.(hit);
  };
}
