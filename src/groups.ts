import type { PageElement } from './format/types';

/** A group name no element of the page uses yet: g1, g2 and on. */
export function newGroupId(elements: readonly PageElement[]): string {
  const used = new Set(elements.map((e) => e.group));
  let n = 1;
  while (used.has(`g${n}`)) n++;
  return `g${n}`;
}

/** Indexes of the elements in a group, in drawing order. */
export function membersOf(elements: readonly PageElement[], group: string): number[] {
  return elements.flatMap((e, i) => (e.group === group ? [i] : []));
}

/**
 * Copies of elements that can join `existing` without joining its groups: each group among the copies gets a new
 * name, shared by its copies, so a copy of a group is a group of its own.
 */
export function regroup<T extends PageElement>(copies: readonly T[], existing: readonly PageElement[]): T[] {
  const renamed = new Map<string, string>();
  const taken = [...existing];
  return copies.map((el) => {
    if (el.group === undefined) return el;
    if (!renamed.has(el.group)) {
      const id = newGroupId(taken);
      renamed.set(el.group, id);
      taken.push({ ...el, group: id });
    }
    return { ...el, group: renamed.get(el.group)! };
  });
}

/** The elements with the `group` of any element that is alone in its group taken off: a group needs at least two. */
export function dropLoneGroups<T extends PageElement>(elements: readonly T[]): T[] {
  const count = new Map<string, number>();
  for (const e of elements) if (e.group !== undefined) count.set(e.group, (count.get(e.group) ?? 0) + 1);
  return elements.map((e) => {
    if (e.group === undefined || (count.get(e.group) ?? 0) > 1) return e;
    const { group: _gone, ...rest } = e;
    return rest as T;
  });
}
