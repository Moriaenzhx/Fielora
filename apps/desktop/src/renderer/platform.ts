export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const terminalName = isMac ? 'zsh' : 'PowerShell';
export function shortcutLabel(value: string): string {
  return isMac ? value.replaceAll('Ctrl+Y', '⇧⌘Z').replaceAll('Ctrl+Shift+', '⇧⌘').replaceAll('Ctrl+', '⌘') : value;
}
