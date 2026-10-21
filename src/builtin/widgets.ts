import type { PageElement } from '../format/types';
import { validateElement } from '../format/validate';
import { makeWidget, type Widget } from '../widgets';
import { fileId, skipped, widgetFiles } from './examples';

/**
 * The starter widgets: every file in examples/widgets, `{ "name": "...", "elements": [...] }`. Positions in a file are
 * only relative to each other (a widget keeps its elements relative to its top-left corner), so the first row is row 1.
 */
export function builtinWidgets(files: Record<string, unknown> = widgetFiles): Widget[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    const f = raw as { name?: unknown; elements?: unknown } | null;
    if (!f || typeof f.name !== 'string' || !Array.isArray(f.elements) || !f.elements.length) { skipped(path, 'a widget file is { "name", "elements": [...] }.'); return []; }
    const bad = f.elements.flatMap((el) => validateElement(el));
    if (bad.length) { skipped(path, bad[0].message); return []; }
    return [makeWidget(`builtin-${fileId(path)}`, f.name, f.elements as PageElement[])];
  });
}
