import { naturalSize } from '../format/week';
import type { Generated, Page } from '../format/types';
import type { Widget } from '../widgets';
import { builtinWidgets } from './widgets';
import { makePage } from './pages';

// The week block's built-in widgets (examples/widgets/week-*.json: the owner's week tracker checklist taken apart into goals, one day, and
// outcomes) and the page made of one block. They are read from the example files like any other widget, so editing a file changes them.

export const WEEK_WIDGET_NAMES = { goals: 'Week goals', day: 'Week day', outcomes: 'Week outcomes' } as const;

const widgets = builtinWidgets();
const part = (w: Widget) => ({ name: w.name, elements: structuredClone(w.elements) });

/** A week block made of the built-in Week goals, Week day and Week outcomes, at the top-left of the grid and as big as they need; null if a file has been taken out. */
export function weekBlock(): Generated | null {
  const found = (name: string) => widgets.find((w) => w.name === name);
  const [goals, day, outcomes] = [WEEK_WIDGET_NAMES.goals, WEEK_WIDGET_NAMES.day, WEEK_WIDGET_NAMES.outcomes].map(found);
  if (!goals || !day || !outcomes) return null;
  const parts = { goals: part(goals), day: part(day), outcomes: part(outcomes) };
  return { type: 'generated', kind: 'week', x: 0, y: 1, ...naturalSize(parts), ...parts };
}

/** The Week planner: one week block filling the page, with the week tracker checklist's header (none: the row is free but for the page number). */
export const weekPlanner = (): Page[] => {
  const block = weekBlock();
  return block ? [makePage('Week planner', 'left', '', [block])] : [];
};
