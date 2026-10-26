import { Menu } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';

const activeMenus = new WeakMap<BrowserWindow, Menu>();

// Chromium input does not dismiss an OS menu (notably on macOS). Keep the
// native lifetime explicit so a closing page cannot leave a tracking menu open.
// This requests dismissal; callers must verify their resulting native state.
export function dismissNativeContextMenu(window: BrowserWindow): boolean {
  const active = activeMenus.get(window);
  if (!active) return false;
  active.closePopup(window);
  activeMenus.delete(window);
  return true;
}

export function showNativeContextMenu(window: BrowserWindow, template: MenuItemConstructorOptions[]): void {
  dismissNativeContextMenu(window);
  const menu = Menu.buildFromTemplate(template);
  activeMenus.set(window, menu);
  menu.popup({ window, callback: () => {
    if (activeMenus.get(window) === menu) activeMenus.delete(window);
  } });
}
