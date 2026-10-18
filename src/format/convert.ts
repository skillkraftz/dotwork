import { emptyPage, type Box, type BoxSide, type Page, type PageElement, type Weight } from './types';
import type { PageV1, Region } from './v1';

/** A version 1 region as version 2 elements: its fill, then its borders, then its labels. */
function convertRegion(r: Region): PageElement[] {
  const out: PageElement[] = [];
  const area = { x: r.x, y: r.y, w: r.w, h: r.h };

  switch (r.fill) {
    case 'blank':
      break;
    case 'checkboxes':
      // One box every second row in the first column, a writing line under every row beside them.
      out.push({ type: 'checkboxes', x: r.x, y: r.y, count: Math.ceil(r.h / 2), every: 2, size: 0.6 });
      if (r.w > 1) out.push({ type: 'pattern', pattern: 'lines', x: r.x + 1, y: r.y, w: r.w - 1, h: r.h });
      break;
    default:
      out.push({ type: 'pattern', pattern: r.fill, ...area });
  }

  const byWeight = new Map<Weight, BoxSide[]>();
  for (const [side, weight] of Object.entries(r.border ?? {}) as [BoxSide, Weight][]) {
    byWeight.set(weight, [...(byWeight.get(weight) ?? []), side]);
  }
  for (const [weight, sides] of byWeight) {
    const box: Box = { type: 'box', ...area, weight };
    if (sides.length < 4) box.sides = sides;
    out.push(box);
  }

  for (const l of r.labels ?? []) {
    if (l.vertical) {
      // Version 1 started vertical labels at the region's bottom and read upward.
      out.push({ type: 'text', x: r.x, y: r.y + r.h, text: l.text, rotate: 90 });
    } else if (l.align === 'right') {
      out.push({ type: 'text', x: r.x + r.w, y: r.y + (l.row ?? 0), text: l.text, align: 'right' });
    } else {
      out.push({ type: 'text', x: r.x, y: r.y + (l.row ?? 0), text: l.text });
    }
  }
  return out;
}

/** Convert a valid version 1 page to version 2. */
export function convertV1(old: PageV1): Page {
  const page = emptyPage();
  page.name = old.name;
  if (old.identity !== undefined) page.identity = old.identity; else delete page.identity;
  page.elements = old.regions.flatMap(convertRegion);
  return page;
}
