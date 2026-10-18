import type { Page } from './format/types';
import {
  cellAt, containsCell, dotAt, HANDLE_CURSOR, hitHandle, moveRect, P, placementProblem,
  rectFromDots, resizeRect, type Dot, type Handle, type Rect,
} from './geometry';
import { EDIT_VIEWBOX, pageContent } from './render';
import type { Store } from './store';

type Drag =
  | { kind: 'draw'; start: Dot; cur: Dot }
  | { kind: 'move'; index: number; origin: Rect; startMm: Dot; last: Rect }
  | { kind: 'resize'; index: number; handle: Handle; origin: Rect; last: Rect };

const HANDLE_TOLERANCE_PX = 8;

/** Draws the page into the SVG and turns pointer input into region edits. */
export class Canvas {
  private drag: Drag | null = null;
  private content: SVGGElement;

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
    let page: Page = store.page;
    let draft = null;
    if (d && (d.kind === 'move' || d.kind === 'resize')) {
      page = { ...page, regions: page.regions.map((r, i) => (i === d.index ? { ...r, ...d.last } : r)) };
    } else if (d?.kind === 'draw') {
      const rect = rectFromDots(d.start, d.cur);
      draft = { rect, valid: placementProblem(rect, page.regions) === null };
    }
    this.content.innerHTML = pageContent(page, {
      mode: store.mode === 'preview' ? 'preview' : 'edit',
      selected: store.selected,
      draft,
    });
    this.svg.style.cursor = store.mode === 'preview' ? 'default' : this.svg.style.cursor || 'crosshair';
  }

  private toMm(e: PointerEvent): { x: number; y: number; scale: number } {
    const m = this.svg.getScreenCTM()!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y, scale: m.a };
  }

  private others(except: number | null): Rect[] {
    return this.store.page.regions.filter((_, i) => i !== except);
  }

  private handleAt(p: { x: number; y: number; scale: number }): Handle | null {
    const sel = this.store.selected;
    if (sel === null) return null;
    return hitHandle(this.store.page.regions[sel], p.x, p.y, HANDLE_TOLERANCE_PX / p.scale);
  }

  private regionAt(x: number, y: number): number {
    const c = cellAt(x, y);
    return this.store.page.regions.findIndex((r) => containsCell(r, c));
  }

  private onDown = (e: PointerEvent) => {
    if (this.store.mode !== 'edit' || e.button !== 0) return;
    const p = this.toMm(e);
    this.notify(null);
    const { store } = this;

    const handle = this.handleAt(p);
    if (handle && store.selected !== null) {
      const origin = { ...store.page.regions[store.selected] };
      this.drag = { kind: 'resize', index: store.selected, handle, origin, last: origin };
    } else {
      const hit = this.regionAt(p.x, p.y);
      if (hit >= 0) {
        store.select(hit);
        const origin = { ...store.page.regions[hit] };
        this.drag = { kind: 'move', index: hit, origin, startMm: p, last: origin };
      } else {
        store.select(null);
        const dot = dotAt(p.x, p.y);
        this.drag = { kind: 'draw', start: dot, cur: dot };
      }
    }
    this.svg.setPointerCapture(e.pointerId);
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.toMm(e);
    const d = this.drag;
    if (!d) {
      if (this.store.mode !== 'edit') return;
      const h = this.handleAt(p);
      this.svg.style.cursor = h ? HANDLE_CURSOR[h] : this.regionAt(p.x, p.y) >= 0 ? 'move' : 'crosshair';
      return;
    }

    if (d.kind === 'draw') {
      d.cur = dotAt(p.x, p.y);
    } else {
      let candidate: Rect;
      if (d.kind === 'move') {
        candidate = moveRect(d.origin, Math.round((p.x - d.startMm.x) / P), Math.round((p.y - d.startMm.y) / P));
      } else {
        candidate = resizeRect(d.origin, d.handle, dotAt(p.x, p.y));
      }
      const problem = placementProblem(candidate, this.others(d.index));
      if (problem) {
        // Hold at the last allowed position and say why.
        this.notify(problem);
      } else {
        this.notify(null);
        d.last = candidate;
      }
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
      const same = d.start.x === d.cur.x && d.start.y === d.cur.y;
      if (!same) {
        const rect = rectFromDots(d.start, d.cur);
        const problem = placementProblem(rect, store.page.regions);
        if (problem) {
          this.notify(`Not created: ${problem}`);
        } else {
          const next = structuredClone(store.page);
          next.regions.push({ ...rect, fill: 'lines' });
          store.selected = next.regions.length - 1;
          store.commit(next);
          return;
        }
      }
    } else if (d.last.x !== d.origin.x || d.last.y !== d.origin.y || d.last.w !== d.origin.w || d.last.h !== d.origin.h) {
      const next = structuredClone(store.page);
      Object.assign(next.regions[d.index], d.last);
      store.commit(next);
      return;
    }
    this.render();
  };
}
