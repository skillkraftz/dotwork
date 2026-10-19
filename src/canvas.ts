import { GRID_X_MM, GRID_Y_MM, PITCH_MM as P, type Area, type PageElement } from './format/types';
import { validateElement } from './format/validate';
import {
  cellPoint, elementFromDrag, boundsOf, HANDLE_CURSOR, hitElement, hitHandle, hitHandlePoint, moveGroup, resizeElement, snapPoint, snapStep,
  tapCandidates, touchedBy, cycleHit, type Handle, type Pt,
} from './geometry';
import { membersOf } from './groups';
import { placeWidget } from './widgets';
import { addElement, addElements } from './actions';
import { LongPress } from './longpress';
import { EDIT_BOX, EDIT_VIEWBOX, FIT_BOX, pageContent } from './render';
import type { Store } from './store';
import { compactQuery } from './sheet';
import { keyboardOpen } from './keyboard';
import { fitView, panBy, pinchOf, revealRect, scaleOf, viewRect, zoomAt, type View } from './viewport';

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt }
  | { kind: 'text'; at: Pt }
  | { kind: 'move'; indices: number[]; origins: PageElement[]; startCells: Pt; last: PageElement[]; moved: boolean; clickSelect?: number }
  | { kind: 'marquee'; start: Pt; cur: Pt; add: boolean }
  | { kind: 'resize'; index: number; handle: Handle; origin: PageElement; last: PageElement };

/** Tolerances in screen px. Fingers are fat and imprecise, so touch gets more room than a mouse. */
const MOUSE = { handle: 8, hit: 5, dragStart: 3, handleDraw: 8 };
/** `reach` is how far a finger can miss and still select the nearest element: about 6 mm of screen. */
const TOUCH = { handle: 20, hit: 14, dragStart: 8, handleDraw: 16, reach: 23 };
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

/** What the screen around the canvas does with touch gestures the canvas recognises. */
export interface CanvasHooks {
  /** An element was long-pressed (or right-clicked); `hits` are all the elements under that point, topmost first. */
  contextMenu?(index: number, hits: number[], at: { x: number; y: number }): void;
  /** An element was double-tapped (or double-clicked): show its properties. A group is entered instead (see `Store.enterGroup`). */
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
  /** Everything under the last press, best first (touch: the nearest within reach), for the More button's "select underneath". */
  lastHits: number[] = [];
  /** The view before the properties drawer pushed the page aside, to put back when it closes. */
  private beforeReveal: { view: View; fitted: boolean } | null = null;
  private lastTap: { at: number; px: Pt; index: number } | null = null;
  private openedAt = 0;
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
      this.observer = new ResizeObserver(() => { if (keyboardOpen()) return; if (this.fitted) this.fit(); else this.applyView(); });
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

  /** Move the page so the selection is on screen above `inset` px of drawer (the view returns when `restoreView` is called). */
  revealSelection(inset: number) {
    const { store } = this;
    const size = this.size();
    if (!store.selection.length || size.w < 1) return;
    const a = boundsOf(store.selection.map((i) => store.page.elements[i]));
    const target = { x: GRID_X_MM + a.x * P, y: GRID_Y_MM + a.y * P, w: a.w * P, h: a.h * P };
    const next = revealRect(this.view, target, EDIT_BOX, size, inset);
    if (next === this.view) return;
    this.beforeReveal ??= { view: this.view, fitted: this.fitted };
    this.view = next;
    this.fitted = false;
    this.applyView();
  }

  /** Put the view back where it was before `revealSelection` moved it. */
  restoreView() {
    const saved = this.beforeReveal;
    if (!saved) return;
    this.beforeReveal = null;
    this.view = saved.view;
    this.fitted = saved.fitted;
    this.applyView();
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
    let draft: PageElement | PageElement[] | null = null;
    let marquee: Area | undefined;
    if (d?.kind === 'move') {
      page = { ...page, elements: page.elements.map((e, i) => d.last[d.indices.indexOf(i)] ?? e) };
    } else if (d?.kind === 'resize') {
      page = { ...page, elements: page.elements.map((e, i) => (i === d.index ? d.last : e)) };
    } else if (d?.kind === 'marquee') {
      marquee = { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) };
    } else if (d?.kind === 'draw' && store.tool !== 'select' && store.tool !== 'text') {
      draft = this.placed(d);
    }
    const preview = store.mode === 'preview' || this.readOnly;
    this.content.innerHTML = pageContent(page, {
      mode: preview ? 'preview' : 'edit',
      selected: store.selected,
      selection: store.selection,
      hidden: store.hiddenIndexes,
      inside: store.editingGroup !== null && !preview ? membersOf(page.elements, store.editingGroup) : undefined,
      draft,
      marquee,
      handleMm: this.handlePx() * this.mmPerPx(),
    });
    if (preview) this.svg.style.cursor = 'default';
    else if (!d) this.svg.style.cursor = store.tool === 'select' ? 'default' : 'crosshair';
    this.hooks.rendered?.();
  }

  /** Where a drawing tool's press lands: sequences and icons start in the cell under the pointer, the rest at the nearest dot. */
  private pointFor(p: Pt, e: { shiftKey: boolean }): Pt {
    const cells = this.store.tool === 'sequence' || this.store.tool === 'icon';
    return cells ? cellPoint(p, this.half(e)) : snapPoint(p, this.half(e));
  }

  /** What a press-and-drag with the current drawing tool would add to the page, if anything. */
  private placed(d: { start: Pt; cur: Pt }): PageElement[] {
    const { store } = this;
    if (store.tool === 'widget') return store.widget ? placeWidget(store.widget, d.cur) : [];
    if (store.tool === 'select' || store.tool === 'text') return [];
    const el = elementFromDrag(store.tool, d.start, d.cur, store.icon);
    return el ? [el] : [];
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

  /** What a finger at `p` could mean, best first: the nearest elements within about 6 mm (see `tapCandidates`). */
  private fingerHits(p: Pt, cellsPerPx: number): number[] {
    const { store } = this;
    return tapCandidates(store.page.elements, p, TOUCH.reach * cellsPerPx, (i) => !store.isHidden(i) && !store.isLocked(i));
  }

  /** Nothing is selected, and no group is being edited from inside. */
  private clear() {
    this.store.select(null);
    this.store.leaveGroup();
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
      const at = this.pointFor(p, e);
      this.drag = { kind: 'draw', start: at, cur: at };
    } else if (touch) {
      // Nothing happens yet: a tap, a drag (of the selection or the view) or a pinch is told apart by what comes next.
      const sel = store.selected;
      const canHandle = sel !== null && store.selection.length === 1 && !store.isLocked(sel) && !store.isHidden(sel);
      const handle = canHandle ? hitHandlePoint(store.page.elements[sel], p, tol.handle * cellsPerPx) : null;
      const hits = this.fingerHits(p, cellsPerPx);
      this.lastHits = hits;
      this.pending = { id: e.pointerId, at: Date.now(), px: this.downPx, p, hits, handle, wasSelected: hits.some((i) => store.isSelected(i)) };
      if (hits.length) {
        const at = { x: e.clientX, y: e.clientY };
        this.press.start(e.clientX, e.clientY, () => this.longPressed(hits[0], hits, at));
      }
    } else {
      const sel = store.selected;
      const canHandle = sel !== null && store.selection.length === 1 && !store.isLocked(sel) && !store.isHidden(sel);
      const handle = canHandle ? hitHandle(store.page.elements[sel], p, tol.handle * cellsPerPx) : null;
      if (handle && sel !== null) {
        const origin = store.page.elements[sel];
        this.drag = { kind: 'resize', index: sel, handle, origin, last: origin };
      } else {
        const hits = this.hits(p, tol.hit * cellsPerPx);
        this.lastHits = hits;
        let hit = hits[0];
        let clickSelect: number | undefined;
        if (e.shiftKey && hit !== undefined) {
          // Shift-click adds the element (or its group) to the selection, or takes it out (touch has drag-select).
          const set = store.pickSet(hit);
          const now = store.selection;
          store.selectMany(store.isSelected(hit) ? now.filter((i) => !set.includes(i)) : [...new Set([...now, ...set])]);
          return;
        }
        const selectedUnder = hits.find((i) => store.isSelected(i));
        if (e.altKey && hits.length > 1) {
          // Alt-click steps down through the stack (More has "select underneath" on touch).
          hit = cycleHit(hits, store.selected)!;
        } else if (selectedUnder !== undefined && hit !== selectedUnder) {
          // Pressing on a selected element drags it (so an element reached from the menu can be moved);
          // letting go without dragging selects the topmost one, as a plain click does.
          clickSelect = hit;
          hit = selectedUnder;
        }
        if (hit === undefined) {
          if (!e.shiftKey) this.clear();
          // A mouse drag from empty space draws a box that selects what it touches.
          if (!touch) this.drag = { kind: 'marquee', start: p, cur: p, add: e.shiftKey };
        } else {
          // Pressing on part of a multiple selection drags all of it; a click without a drag selects just that one.
          const keep = store.isSelected(hit) && store.selection.length > 1;
          if (keep) clickSelect ??= hit; else store.pick(hit);
          const indices = store.selection;
          const origins = indices.map((i) => store.page.elements[i]);
          this.drag = { kind: 'move', indices, origins, startCells: p, last: origins, moved: false, clickSelect };
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
    this.store.pick(index);
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
    store.pick(hits[0]);
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
      // Far enough to be a drag. What is already selected moves or resizes; a drag anywhere else draws a selection box.
      if (Math.hypot(e.clientX - pd.px.x, e.clientY - pd.px.y) < TOUCH.dragStart) return;
      this.pending = null;
      this.press.cancel();
      const sel = store.selected;
      const origin = sel === null ? undefined : store.page.elements[sel];
      if (sel !== null && origin && pd.handle) this.drag = { kind: 'resize', index: sel, handle: pd.handle, origin, last: origin };
      else if (sel !== null && origin && pd.wasSelected) {
        const origins = store.selection.map((i) => store.page.elements[i]);
        this.drag = { kind: 'move', indices: store.selection, origins, startCells: pd.p, last: origins, moved: false };
      } else this.drag = { kind: 'marquee', start: pd.p, cur: pd.p, add: false };
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
      d.cur = this.pointFor(p, e);
    } else if (d.kind === 'marquee') {
      d.cur = p;
    } else if (d.kind === 'move') {
      const slop = (this.downType === 'touch' ? TOUCH : MOUSE).dragStart;
      if (!d.moved && Math.hypot(e.clientX - this.downPx.x, e.clientY - this.downPx.y) < slop) return;
      d.moved = true;
      const dx = Math.round((p.x - d.startCells.x) / step) * step, dy = Math.round((p.y - d.startCells.y) / step) * step;
      d.last = moveGroup(d.origins, dx, dy);
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

    if (d.kind === 'text') {
      addElement(store, { type: 'text', x: d.at.x, y: Math.min(d.at.y, 43), text: 'Text' });
      return;
    } else if (d.kind === 'draw') {
      const els = this.placed(d);
      const bad = els.find((el) => validateElement(el).length > 0);
      if (els.length && !bad) { addElements(store, els); return; }
      if (bad) this.notify(`Not created: ${validateElement(bad)[0].message}`);
    } else if (d.kind === 'marquee') {
      this.finishMarquee(d);
      return;
    } else if (d.kind === 'move' && !d.moved && d.clickSelect !== undefined) {
      store.pick(d.clickSelect);
      return;
    } else if (d.kind === 'move' && JSON.stringify(d.last) !== JSON.stringify(d.origins)) {
      const next = structuredClone(store.page);
      d.indices.forEach((index, k) => { next.elements[index] = d.last[k]; });
      store.commit(next);
      return;
    } else if (d.kind === 'resize' && JSON.stringify(d.last) !== JSON.stringify(d.origin)) {
      const next = structuredClone(store.page);
      next.elements[d.index] = d.last;
      store.commit(next);
      return;
    }
    this.render();
  };

  /** The box dragged on empty space selects the visible, unlocked elements it touches, with the rest of any group they are in. */
  private finishMarquee(d: Extract<Drag, { kind: 'marquee' }>) {
    const { store } = this;
    const box = { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) };
    // Inside a group only its pieces count; outside, touching one piece of a group takes the whole group.
    const inGroup = store.editingGroup === null ? null : new Set(membersOf(store.page.elements, store.editingGroup));
    const touched = store.page.elements.flatMap((el, i) =>
      !store.isHidden(i) && !store.isLocked(i) && (!inGroup || inGroup.has(i)) && touchedBy(el, box) ? [i] : []);
    const inside = [...new Set(touched.flatMap((i) => store.pickSet(i)))].sort((a, b) => a - b);
    const chosen = d.add ? [...new Set([...store.selection, ...inside])].sort((a, b) => a - b) : inside;
    if (chosen.length) store.selectMany(chosen); else if (!inGroup) this.clear(); else store.select(null);
    this.render();
  }

  /** A finger went down and came up without moving: select the nearest element, or clear the selection. A second tap on the same element opens its properties, or enters it if it is a group. */
  private tapped(pd: NonNullable<Canvas['pending']>) {
    const { store } = this;
    const hit = pd.handle ? undefined : pd.hits[0];
    if (pd.handle) { this.render(); return; }
    if (hit === undefined) {
      this.lastTap = null;
      this.clear();
    } else {
      const last = this.lastTap;
      const again = last && last.index === hit && Date.now() - last.at < DOUBLE_TAP_MS && Math.hypot(pd.px.x - last.px.x, pd.px.y - last.px.y) < DOUBLE_TAP_PX;
      this.lastTap = again ? null : { at: Date.now(), px: pd.px, index: hit };
      if (again) this.open(hit);
      else store.pick(hit);
    }
    this.render();
  }

  /**
   * A double-tap or double-click: go inside a group, or show an element's properties. A double-tap on a touch screen also
   * arrives as a double-click (the browser's own mouse events), so the second arrival of the same gesture is ignored.
   */
  private open(index: number) {
    const { store } = this;
    if (Date.now() - this.openedAt < DOUBLE_TAP_MS * 2) return;
    this.openedAt = Date.now();
    const group = store.page.elements[index].group;
    if (group !== undefined && store.editingGroup === null) {
      store.enterGroup(group);
      store.select(index);
    } else {
      store.pick(index);
      this.hooks.openProperties?.(index);
    }
  }

  /** Double-click with a mouse: the same as a double-tap. */
  private onDoubleClick = (e: MouseEvent) => {
    const { store } = this;
    if (e.detail !== 2 || e.button !== 0 || e.shiftKey || this.readOnly || store.mode !== 'edit' || store.tool !== 'select') return;
    const { p, cellsPerPx } = this.toCells(e);
    const hit = this.hits(p, MOUSE.hit * cellsPerPx)[0];
    if (hit === undefined) return;
    e.preventDefault(); // or the press would take the focus back from the field that is about to get it
    this.open(hit);
  };
}
