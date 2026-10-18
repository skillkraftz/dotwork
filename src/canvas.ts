import { GRID_X_MM, GRID_Y_MM, PITCH_MM as P, type PageElement } from './format/types';
import { validateElement } from './format/validate';
import {
  elementFromDrag, HANDLE_CURSOR, hitElement, hitHandle, moveElement, resizeElement, snapPoint, snapStep,
  type Handle, type Pt,
} from './geometry';
import { addElement } from './actions';
import { EDIT_VIEWBOX, pageContent } from './render';
import type { Store } from './store';

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt }
  | { kind: 'move'; index: number; origin: PageElement; startCells: Pt; last: PageElement; moved: boolean; clickSelect?: number }
  | { kind: 'resize'; index: number; handle: Handle; origin: PageElement; last: PageElement };

const HANDLE_TOLERANCE_PX = 8;
const HIT_TOLERANCE_PX = 5;
const DRAG_START_PX = 3;

/** Draws the page into the SVG and turns pointer input into element edits. */
export class Canvas {
  private drag: Drag | null = null;
  private content: SVGGElement;
  private downPx: Pt = { x: 0, y: 0 };

  constructor(
    private svg: SVGSVGElement,
    private store: Store,
    /** Show a message under the canvas (null clears it). */
    private notify: (message: string | null) => void,
  ) {
    svg.setAttribute('viewBox', EDIT_VIEWBOX);
    svg.innerHTML = '<g id="content"></g>';
    this.content = svg.querySelector('#content')!;
    svg.addEventListener('pointerdown', this.onDown);
    svg.addEventListener('pointermove', this.onMove);
    svg.addEventListener('pointerup', this.onUp);
    svg.addEventListener('pointercancel', () => this.cancel());
  }

  cancel() {
    this.drag = null;
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
    this.content.innerHTML = pageContent(page, {
      mode: store.mode === 'preview' ? 'preview' : 'edit',
      selected: store.selected,
      hidden: store.hiddenIndexes,
      draft,
    });
    if (store.mode === 'preview') this.svg.style.cursor = 'default';
    else if (!d) this.svg.style.cursor = store.tool === 'select' ? 'default' : 'crosshair';
  }

  /** Pointer position in grid cells (fractional), plus mm-per-pixel for tolerances. */
  private toCells(e: PointerEvent): { p: Pt; cellsPerPx: number } {
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

  private onDown = (e: PointerEvent) => {
    const { store } = this;
    if (store.mode !== 'edit' || e.button !== 0) return;
    const { p, cellsPerPx } = this.toCells(e);
    this.downPx = { x: e.clientX, y: e.clientY };
    this.notify(null);

    if (store.tool === 'text') {
      const at = snapPoint(p, this.half(e));
      addElement(store, { type: 'text', x: at.x, y: Math.min(at.y, 43), text: 'Text' });
      return;
    }
    if (store.tool !== 'select') {
      const at = snapPoint(p, this.half(e));
      this.drag = { kind: 'draw', start: at, cur: at };
    } else {
      const sel = store.selected;
      const handle = sel !== null && !store.isLocked(sel) && !store.isHidden(sel)
        ? hitHandle(store.page.elements[sel], p, HANDLE_TOLERANCE_PX * cellsPerPx) : null;
      if (handle && sel !== null) {
        const origin = store.page.elements[sel];
        this.drag = { kind: 'resize', index: sel, handle, origin, last: origin };
      } else {
        const hits = this.hits(p, HIT_TOLERANCE_PX * cellsPerPx);
        let hit = hits[0];
        let clickSelect: number | undefined;
        if (e.altKey && hits.length > 1) {
          // Alt-click steps down through the stack: the element beneath the selected one, wrapping around.
          const at = store.selected === null ? -1 : hits.indexOf(store.selected);
          hit = hits[(at + 1) % hits.length];
        } else if (store.selected !== null && hits.includes(store.selected) && hit !== store.selected) {
          // Pressing on the selected element drags it (so an element reached with Alt-click can be moved);
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
        }
      }
    }
    this.svg.setPointerCapture(e.pointerId);
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    const { store } = this;
    const { p, cellsPerPx } = this.toCells(e);
    const d = this.drag;
    if (!d) {
      if (store.mode !== 'edit' || store.tool !== 'select') return;
      const sel = store.selected;
      const h = sel !== null && !store.isLocked(sel) ? hitHandle(store.page.elements[sel], p, HANDLE_TOLERANCE_PX * cellsPerPx) : null;
      this.svg.style.cursor = h ? HANDLE_CURSOR[h] : this.hits(p, HIT_TOLERANCE_PX * cellsPerPx).length ? 'move' : 'default';
      return;
    }

    const step = snapStep(this.half(e));
    if (d.kind === 'draw') {
      d.cur = snapPoint(p, this.half(e));
    } else if (d.kind === 'move') {
      if (!d.moved && Math.hypot(e.clientX - this.downPx.x, e.clientY - this.downPx.y) < DRAG_START_PX) return;
      d.moved = true;
      const dx = Math.round((p.x - d.startCells.x) / step) * step, dy = Math.round((p.y - d.startCells.y) / step) * step;
      d.last = moveElement(d.origin, dx, dy);
    } else {
      const next = resizeElement(d.origin, d.handle, snapPoint(p, this.half(e)));
      // Hold the last good shape when the drag would leave nothing, and say why.
      if (!next) this.notify('An element can’t be resized down to nothing.');
      else if (validateElement(next).length) this.notify(validateElement(next)[0].message);
      else { this.notify(null); d.last = next; }
    }
    this.render();
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    const { store } = this;

    if (d.kind === 'draw') {
      if (store.tool !== 'select' && store.tool !== 'text') {
        const el = elementFromDrag(store.tool, d.start, d.cur);
        if (el && validateElement(el).length === 0) { addElement(store, el); return; }
        if (el) this.notify(`Not created: ${validateElement(el)[0].message}`);
      }
    } else if (d.kind === 'move' && !d.moved && d.clickSelect !== undefined) {
      store.select(d.clickSelect);
      return;
    } else if (JSON.stringify(d.last) !== JSON.stringify(d.origin)) {
      const next = structuredClone(store.page);
      next.elements[d.index] = d.last;
      store.commit(next);
      return;
    }
    this.render();
  };
}
