/** The icon set in the order the picker shows it. Every icon in icons.ts belongs to exactly one group (a test checks). */
export const ICON_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ['Rapid log', ['task', 'done', 'migrated', 'scheduled', 'note', 'event', 'priority', 'inspiration', 'explore']],
  ['Checkboxes', ['box', 'box-check', 'box-x']],
  ['Moods', ['angry', 'sad', 'neutral', 'happy', 'laugh']],
  ['Weather', ['sun', 'cloud', 'rain', 'snow', 'wind']],
  ['Moon', ['moon-new', 'moon-first', 'moon-full', 'moon-last']],
  ['Habits', ['water', 'exercise', 'sleep', 'pill', 'food', 'coffee']],
  ['Errands', ['home', 'work', 'phone', 'mail', 'cart', 'money', 'car', 'plane', 'pin', 'calendar', 'clock']],
  ['More', ['gift', 'cake', 'heart', 'star', 'lightbulb', 'flag', 'trophy', 'book', 'music', 'camera']],
  ['Arrows', ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right']],
];
