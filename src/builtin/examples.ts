// What ships in the package, found by looking in the folders rather than by name: add a file to examples/pages,
// examples/spreads, examples/widgets or examples/art and it shows up in the Library; take one out and it is gone. See examples/README.md.

/** A file's name without its folder or extension: examples/art/half-donut.svg is "half-donut". */
export const fileId = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

export const pageFiles = import.meta.glob<unknown>('../../examples/pages/*.json', { eager: true, import: 'default' });
export const spreadFiles = import.meta.glob<unknown>('../../examples/spreads/*.json', { eager: true, import: 'default' });
export const widgetFiles = import.meta.glob<unknown>('../../examples/widgets/*.json', { eager: true, import: 'default' });
export const artFiles = import.meta.glob<string>('../../examples/art/*.svg', { eager: true, query: '?raw', import: 'default' });
export const artPresetFiles = import.meta.glob<unknown>('../../examples/art/*.json', { eager: true, import: 'default' });

/** A file that can't be used is skipped and named in the console; the tests fail on it, so it is not missed. */
export const skipped = (path: string, why: string) => { console.warn(`Skipped ${path.replace('../../', '')}: ${why}`); };
