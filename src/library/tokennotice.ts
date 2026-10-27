// REMOVE IN PHASE 5 (docs/product-model.md): phase 4 changed what {month+N}, {year+N} and {week+N} mean (they count in their
// own unit now). Saved documents are not changed; this finds the ones that use them so the owner can look.
import { TOKENS } from '../format/tokens';
import type { Page } from '../format/types';
import type { Problem } from '../problems';
import type { LibraryItem } from './library';

/** Tokens whose offset used to count days and now counts their own unit. */
const MOVED = new Set<string>(['month', 'monthname', 'year', 'week']);
const FOUND_RE = /\{(month|monthname|year|week)([+-]\d{1,4})\}/g;

export interface ChangedToken { document: string; kind: string; page: string | null; element: string; text: string }

const inText = (text: string) => [...text.matchAll(FOUND_RE)].filter((m) => Number(m[2]) !== 0 && MOVED.has(m[1])).map((m) => m[0]);

function inPage(page: Page, where: string | null, document: string, kind: string): ChangedToken[] {
  const found = (element: string, text: string) => inText(text).map((t) => ({ document, kind, page: where, element, text: t }));
  return [
    ...found('identity', page.identity ?? ''),
    ...page.elements.flatMap((el, i) => (el.type === 'text' ? found(`element ${i + 1} (text “${el.text}”)`, el.text) : [])),
  ];
}

/** Every use of a changed token in the Library documents, with where it is. Reads only; nothing is changed. */
export function findChangedTokens(items: readonly LibraryItem[]): ChangedToken[] {
  return items.flatMap((item): ChangedToken[] => {
    const name = item.name, kind = item.kind;
    switch (item.kind) {
      case 'page': return inPage(item.data, null, name, kind);
      case 'spread': return [...inPage(item.data.left, 'left page', name, kind), ...inPage(item.data.right, 'right page', name, kind)];
      case 'section': return item.data.pages.flatMap((p, i) => (p ? inPage(p, `page ${i + 1}`, name, kind) : []));
      case 'book': {
        const b = item.data, c = b.cover;
        return [
          ...b.pages.flatMap((p, i) => (p ? inPage(p, `page ${i + 1}`, name, kind) : [])),
          ...([['inside front cover', c.front], ['inside back cover', c.back], ['outside front cover', c.outside_front], ['outside back cover', c.outside_back]] as const)
            .flatMap(([where, p]) => (p ? inPage(p, where, name, kind) : [])),
        ];
      }
      case 'widget': case 'art':
        return item.data.elements.flatMap((el, i) => (el.type === 'text' ? inText(el.text).map((t) => ({ document: name, kind, page: null, element: `element ${i + 1} (text “${el.text}”)`, text: t })) : []));
    }
  });
}

const line = (c: ChangedToken) => `${c.document} (${c.kind})${c.page ? `, ${c.page}` : ''}, ${c.element}: ${c.text}`;
const SHOWN = 5;

/** The notice, or null when nothing uses a changed token. */
export function changedTokensProblem(found: readonly ChangedToken[]): Problem | null {
  if (!found.length) return null;
  const docs = new Set(found.map((c) => `${c.kind}:${c.document}`)).size;
  const title = `${docs === 1 ? 'A saved document uses' : `${docs} saved documents use`} {month±N}, {year±N} or {week±N}, whose meaning changed.`;
  const note = 'These offsets now count months, years and weeks (they counted days before). Nothing was changed: look at the places below and edit them if the dates are wrong.';
  const lines = [note, ...found.slice(0, SHOWN).map(line)];
  if (found.length > SHOWN) lines.push(`…and ${found.length - SHOWN} more (Copy details has them all).`);
  return { title, lines, details: [title, note, `Tokens: ${TOKENS.join(', ')}`, '', ...found.map(line)].join('\n') };
}
