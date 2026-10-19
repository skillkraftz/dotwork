/**
 * The top bar's drop-down menus. Each `.dropdown` holds a button and a `.menu-list` of buttons. At most one list is
 * open; choosing an item, tapping anywhere outside it, or pressing Escape closes it.
 */
export function setupMenus(root: ParentNode = document): { closeAll(): void } {
  const drops = [...root.querySelectorAll<HTMLElement>('.dropdown')];
  const button = (d: HTMLElement) => d.querySelector<HTMLButtonElement>(':scope > button')!;
  const list = (d: HTMLElement) => d.querySelector<HTMLElement>(':scope > .menu-list')!;

  const set = (d: HTMLElement, open: boolean) => {
    list(d).hidden = !open;
    button(d).setAttribute('aria-expanded', String(open));
  };
  const closeAll = () => drops.forEach((d) => set(d, false));

  for (const d of drops) {
    button(d).addEventListener('click', () => {
      const open = list(d).hidden === true;
      closeAll();
      set(d, open);
    });
    list(d).addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) set(d, false); });
  }
  document.addEventListener('pointerdown', (e) => {
    for (const d of drops) if (!list(d).hidden && !d.contains(e.target as Node)) set(d, false);
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  return { closeAll };
}

/** Mark which item of a radio-style menu is the current one. */
export function checkItem(items: Record<string, HTMLElement>, current: string) {
  for (const [key, el] of Object.entries(items)) el.setAttribute('aria-checked', String(key === current));
}
