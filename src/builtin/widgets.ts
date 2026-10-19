import type { PageElement } from '../format/types';
import { makeWidget, type Widget } from '../widgets';

/**
 * The starter widgets: small groups to drop on a page. Positions here are only relative to each other (a widget keeps
 * its elements relative to its top-left corner), so the first row is row 1.
 */
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const defs: [id: string, name: string, elements: PageElement[]][] = [
  ['week-header', 'S M T W T F S header', [
    { type: 'sequence', x: 0, y: 1, count: 7, direction: 'across', every: 3, values: 'list', list: DAYS },
  ]],
  ['habit-row', 'Habit row', [
    { type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 27, h: 1 },
    { type: 'text', x: 0, y: 1, text: 'habit' },
    { type: 'checkboxes', x: 8, y: 1, count: 7, every: 3, direction: 'across' },
  ]],
  ['mood-scale', 'Mood scale', [
    { type: 'text', x: 0, y: 1, text: 'mood' },
    { type: 'sequence', x: 6, y: 1, count: 5, direction: 'across', every: 3, values: 'icons', icons: ['angry', 'sad', 'neutral', 'happy', 'laugh'], size: 2 },
  ]],
  ['weather-row', 'Weather row', [
    { type: 'text', x: 0, y: 1, text: 'weather' },
    { type: 'sequence', x: 8, y: 1, count: 5, direction: 'across', every: 3, values: 'icons', icons: ['sun', 'cloud', 'rain', 'snow', 'wind'], size: 2 },
  ]],
  ['rapid-log-key', 'Rapid-log key', [
    { type: 'sequence', x: 0, y: 1, count: 7, direction: 'down', values: 'icons', icons: ['task', 'done', 'migrated', 'scheduled', 'note', 'event', 'priority'], tone: 'black' },
    ...['task', 'done', 'migrated', 'scheduled', 'note', 'event', 'priority'].map((t, i): PageElement => ({ type: 'text', x: 1, y: 1 + i, text: t })),
  ]],
  ['day-block', 'Day block', [
    { type: 'pattern', pattern: 'lines', x: 0, y: 1, w: 27, h: 5 },
    { type: 'rule', x1: 0, y1: 1, x2: 27, y2: 1 },
    { type: 'text', x: 0, y: 1, text: '{weekday} {month} {day}', style: 'bold', tone: 'black' },
  ]],
  ['dial', 'Dial placeholder', [
    { type: 'box', x: 0, y: 1, w: 6, h: 3 },
    { type: 'text', x: 3, y: 1, text: 'dial', align: 'center' },
    { type: 'text', x: 0, y: 4, text: 'LO' },
    { type: 'text', x: 6, y: 4, text: 'HI', align: 'right' },
  ]],
];

export const builtinWidgets = (): Widget[] => defs.map(([id, name, elements]) => makeWidget(`builtin-${id}`, name, elements));
