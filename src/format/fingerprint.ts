import type { Page } from './types';

/**
 * A short hash of a page design: its `identity`, `grid` and `elements`, in the order stored. The name, `side` and
 * `page_number` are left out, because placing a page in a book turns those to fit the slot. The same function describes
 * a design and a copy of it in a book, so two equal fingerprints mean the same design. `mirror_left` is part of the design, and counts only when on.
 */
export function fingerprint(page: Page): string {
  const text = JSON.stringify([page.identity ?? null, page.grid ?? null, page.elements, ...(page.mirror_left ? [true] : []), ...(page.cover ? ['cover'] : [])]);
  // cyrb53: a small, well-spread 53-bit hash; this is a change marker, not security.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
