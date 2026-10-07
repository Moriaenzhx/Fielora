import type { FontCatalog } from '../types';
import type { CodeFont, UiFont } from './app-preferences';

// Compatibility identifiers are resolved against the live catalog; they are
// never injected into the menu as a list of supposedly installed fonts.
const legacyFamilies: Record<string, string[]> = {
  INTER: ['Inter'], SEGOE_UI: ['Segoe UI Variable', 'Segoe UI'],
  PINGFANG_SC: ['PingFang SC'], MICROSOFT_YAHEI: ['Microsoft YaHei UI', 'Microsoft YaHei'],
  CASCADIA_CODE: ['Cascadia Code'], JETBRAINS_MONO: ['JetBrains Mono'], CONSOLAS: ['Consolas'],
};

export function installedFontMenu(catalog: FontCatalog | null, current: UiFont | CodeFont, code: boolean, systemLabel: string) {
  const system = code ? 'SYSTEM_MONO' : 'SYSTEM';
  const families = (catalog?.families ?? []).filter(font => !code || font.monospace)
    .slice().sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base', numeric: true }));
  const candidates = current.startsWith('LOCAL:') ? [current.slice(6)] : legacyFamilies[current] ?? [];
  const family = candidates.map(name => families.find(font => font.family.toLowerCase() === name.toLowerCase())).find(Boolean);
  return {
    value: family ? `LOCAL:${family.family}` : system,
    missing: catalog !== null && current !== system && !family,
    options: [{ value: system, label: systemLabel }, ...families.map(font => ({ value: `LOCAL:${font.family}`, label: font.family }))],
  };
}
