import type { AgentResourceBudget } from '@fielora/contracts';

export const defaultAgentResourceBudget: AgentResourceBudget = {
  max_execution_ms: 3_600_000, max_input_tokens: 0, max_output_tokens: 0,
};

export function normalizeAgentResourceBudget(value: unknown): AgentResourceBudget {
  const input = record(value) ?? {};
  const limit = (key: keyof AgentResourceBudget, min: number, max: number) => {
    const number = input[key];
    return typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max ? number : defaultAgentResourceBudget[key];
  };
  return { max_execution_ms: limit('max_execution_ms', 60_000, 86_400_000), max_input_tokens: 0, max_output_tokens: 0 };
}

export type StartupDestination = 'PROJECTS' | 'NOW' | 'BROWSE';
export type AgentDisplayMode = 'COMPACT' | 'DETAILED';
export type UiLanguagePreference = 'SYSTEM' | 'ZH_CN' | 'EN';
export type UiLocale = 'zh-CN' | 'en';
export type AppearanceMode = 'SYSTEM' | 'LIGHT' | 'DARK';
export type EffectiveAppearance = 'LIGHT' | 'DARK';
export type MaterialMode = 'GLASS' | 'SOLID';
export type AccentPreset = 'FIELORA' | 'BLUE' | 'TEAL' | 'ORANGE' | 'CUSTOM';
export type InterfaceDensity = 'COMFORTABLE' | 'STANDARD' | 'COMPACT';
export type InterfaceContrast = 'SOFT' | 'STANDARD' | 'HIGH';
export type InterfaceRadius = 'SMALL' | 'STANDARD' | 'LARGE';
export type UiFont = 'SYSTEM' | 'INTER' | 'SEGOE_UI' | 'PINGFANG_SC' | 'MICROSOFT_YAHEI' | `LOCAL:${string}`;
export type CodeFont = 'SYSTEM_MONO' | 'CONSOLAS' | 'CASCADIA_CODE' | 'JETBRAINS_MONO' | `LOCAL:${string}`;
export type UiFontScale = 90 | 95 | 100 | 105 | 110 | 115 | 120;
export type UiFontSize = 12 | 13 | 14 | 15 | 16 | 17 | 18;
export type CodeFontSize = 11 | 12 | 13 | 14 | 15 | 16 | 17;
export type ReducedMotionPreference = 'SYSTEM' | 'REDUCE' | 'FULL';
export type AdvancedColorKey = 'accent' | 'canvas' | 'sidebar' | 'surface' | 'foreground' | 'border';
export type AdvancedColorOverrides = Partial<Record<AdvancedColorKey, string>>;
// Legacy from/to remain top-left/top-right; missing bottomLeft inherits from.
export interface BackgroundGradientOverride { from: string; to: string; bottomLeft?: string }

export function threeCenterGradient({ from, to, bottomLeft = from }: BackgroundGradientOverride): string {
  // Chrome consumes this token as background-image, so every layer must be an image.
  return `radial-gradient(ellipse 80% 75% at 0% 100%, ${bottomLeft} 0%, transparent 100%), radial-gradient(ellipse 80% 75% at 0% 0%, ${from} 0%, transparent 100%), radial-gradient(ellipse 80% 75% at 100% 0%, ${to} 0%, transparent 100%), linear-gradient(112deg, ${from}, ${to})`;
}

export interface AppearancePreferences {
  /** Persisted field name retained for UI preference compatibility. This is an appearance mode, not a Theme ID. */
  themePreference: AppearanceMode;
  accentPreset: AccentPreset;
  customAccent: string;
  density: InterfaceDensity;
  contrast: InterfaceContrast;
  radius: InterfaceRadius;
  uiFont: UiFont;
  codeFont: CodeFont;
  uiFontSize: UiFontSize;
  codeFontSize: CodeFontSize;
  sidebarBackgroundOverride: string | null;
  sidebarBackgroundGradientOverride: BackgroundGradientOverride | null;
  workspaceBackgroundOverride: string | null;
  workspaceBackgroundGradientOverride: BackgroundGradientOverride | null;
  surfaceContrast: number;
  actionColorOverride: string | null;
  /** Retained only for persisted v2 compatibility. New UI uses uiFontSize. */
  uiFontScale: UiFontScale;
  translucentSidebar: boolean;
  softElevation: boolean;
  reducedMotionPreference: ReducedMotionPreference;
  smoothScrolling: boolean;
  pointerCursor: boolean;
  highContrast: boolean;
  advancedColorOverrides: AdvancedColorOverrides;
}

export interface AppPreferences {
  version: 2;
  agentDisplayMode: AgentDisplayMode;
  agentResourceBudget: AgentResourceBudget;
  startupDestination: StartupDestination;
  languagePreference: UiLanguagePreference;
  appearance: AppearancePreferences;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AppearanceEnvironment {
  prefersDark: boolean;
  prefersReducedMotion: boolean;
  supportsBackdrop?: boolean;
}

const STORAGE_KEY = 'fielora.ui.preferences.v2';
const LEGACY_STORAGE_KEY = 'fielora.ui.preferences.v1';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ADVANCED_COLOR_KEYS: AdvancedColorKey[] = ['accent', 'canvas', 'sidebar', 'surface', 'foreground', 'border'];

export const defaultAppearancePreferences: AppearancePreferences = {
  themePreference: 'LIGHT', accentPreset: 'FIELORA', customAccent: '#6546C7', density: 'STANDARD', contrast: 'STANDARD', radius: 'STANDARD',
  uiFont: 'SYSTEM', codeFont: 'SYSTEM_MONO', uiFontSize: 15, codeFontSize: 13,
  sidebarBackgroundOverride: null, sidebarBackgroundGradientOverride: null,
  workspaceBackgroundOverride: null, workspaceBackgroundGradientOverride: null,
  surfaceContrast: 42, actionColorOverride: null,
  uiFontScale: 100, translucentSidebar: false, softElevation: true,
  reducedMotionPreference: 'SYSTEM', smoothScrolling: true, pointerCursor: true, highContrast: false, advancedColorOverrides: {},
};

export const defaultAppPreferences: AppPreferences = {
  version: 2, agentDisplayMode: 'COMPACT', agentResourceBudget: { ...defaultAgentResourceBudget }, startupDestination: 'PROJECTS', languagePreference: 'SYSTEM', appearance: defaultAppearancePreferences,
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberIn<T extends number>(value: unknown, values: readonly T[], fallback: T): T {
  const next = Number(value);
  return values.includes(next as T) ? next as T : fallback;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.min(maximum, Math.max(minimum, Math.round(next))) : fallback;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

function normalizeAdvancedColors(value: unknown): AdvancedColorOverrides {
  const input = record(value);
  if (!input) return {};
  return Object.fromEntries(ADVANCED_COLOR_KEYS.flatMap((key) => isHexColor(input[key]) ? [[key, String(input[key]).toUpperCase()]] : []));
}

function normalizeGradient(value: unknown): BackgroundGradientOverride | null {
  const input = record(value);
  if (!input || !isHexColor(input.from) || !isHexColor(input.to)) return null;
  return { from: input.from.toUpperCase(), to: input.to.toUpperCase(), bottomLeft: isHexColor(input.bottomLeft) ? input.bottomLeft.toUpperCase() : input.from.toUpperCase() };
}

function normalizeFont<T extends string>(value: unknown, values: readonly T[], fallback: T): T | `LOCAL:${string}` {
  if (typeof value === 'string' && value.startsWith('LOCAL:') && value.length > 6 && value.length <= 262 && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return value as `LOCAL:${string}`;
  return oneOf(value, values, fallback);
}

function normalizeAppearance(value: unknown, legacy?: Record<string, unknown>): AppearancePreferences {
  const input = record(value) ?? {};
  const legacyDensity = legacy?.density === 'COMPACT' ? 'COMPACT' : legacy?.density === 'COMFORTABLE' ? 'COMFORTABLE' : defaultAppearancePreferences.density;
  const legacyMotion = legacy?.reduceMotion === true ? 'REDUCE' : defaultAppearancePreferences.reducedMotionPreference;
  const persistedSidebar = isHexColor(input.sidebarBackgroundOverride) ? input.sidebarBackgroundOverride.toUpperCase() : null;
  const sidebarBackgroundOverride = persistedSidebar === '#EFEBFF' || persistedSidebar === '#F0ECFF' || persistedSidebar === '#F7EFFB' ? null : persistedSidebar;
  return {
    themePreference: 'LIGHT',
    accentPreset: oneOf(input.accentPreset, ['FIELORA', 'BLUE', 'TEAL', 'ORANGE', 'CUSTOM'], defaultAppearancePreferences.accentPreset),
    customAccent: isHexColor(input.customAccent) ? input.customAccent.toUpperCase() : defaultAppearancePreferences.customAccent,
    density: oneOf(input.density, ['COMFORTABLE', 'STANDARD', 'COMPACT'], legacyDensity),
    contrast: oneOf(input.contrast, ['SOFT', 'STANDARD', 'HIGH'], defaultAppearancePreferences.contrast),
    radius: oneOf(input.radius, ['SMALL', 'STANDARD', 'LARGE'], defaultAppearancePreferences.radius),
    uiFont: normalizeFont(input.uiFont, ['SYSTEM', 'INTER', 'SEGOE_UI', 'PINGFANG_SC', 'MICROSOFT_YAHEI'], defaultAppearancePreferences.uiFont),
    codeFont: normalizeFont(input.codeFont, ['SYSTEM_MONO', 'CONSOLAS', 'CASCADIA_CODE', 'JETBRAINS_MONO'], defaultAppearancePreferences.codeFont),
    uiFontSize: numberIn(input.uiFontSize, [12, 13, 14, 15, 16, 17, 18], defaultAppearancePreferences.uiFontSize),
    codeFontSize: numberIn(input.codeFontSize, [11, 12, 13, 14, 15, 16, 17], defaultAppearancePreferences.codeFontSize),
    sidebarBackgroundOverride,
    sidebarBackgroundGradientOverride: normalizeGradient(input.sidebarBackgroundGradientOverride),
    workspaceBackgroundOverride: isHexColor(input.workspaceBackgroundOverride) ? input.workspaceBackgroundOverride.toUpperCase() : null,
    workspaceBackgroundGradientOverride: normalizeGradient(input.workspaceBackgroundGradientOverride),
    surfaceContrast: boundedInteger(input.surfaceContrast, 0, 100, defaultAppearancePreferences.surfaceContrast),
    actionColorOverride: isHexColor(input.actionColorOverride) ? input.actionColorOverride.toUpperCase() : null,
    uiFontScale: [90, 95, 100, 105, 110, 115, 120].includes(Number(input.uiFontScale)) ? Number(input.uiFontScale) as UiFontScale : defaultAppearancePreferences.uiFontScale,
    translucentSidebar: booleanValue(input.translucentSidebar, defaultAppearancePreferences.translucentSidebar),
    softElevation: booleanValue(input.softElevation, defaultAppearancePreferences.softElevation),
    reducedMotionPreference: oneOf(input.reducedMotionPreference, ['SYSTEM', 'REDUCE', 'FULL'], legacyMotion),
    smoothScrolling: booleanValue(input.smoothScrolling, defaultAppearancePreferences.smoothScrolling),
    pointerCursor: booleanValue(input.pointerCursor, defaultAppearancePreferences.pointerCursor),
    highContrast: booleanValue(input.highContrast, defaultAppearancePreferences.highContrast),
    advancedColorOverrides: normalizeAdvancedColors(input.advancedColorOverrides),
  };
}

function freshDefaults(): AppPreferences {
  return { version: 2, agentDisplayMode: 'COMPACT', agentResourceBudget: { ...defaultAgentResourceBudget }, startupDestination: 'PROJECTS', languagePreference: 'SYSTEM', appearance: { ...defaultAppearancePreferences, advancedColorOverrides: {} } };
}

export function readAppPreferences(storage: Pick<PreferenceStorage, 'getItem'>): AppPreferences {
  try {
    const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return freshDefaults();
    return normalizeAppPreferences(JSON.parse(raw));
  } catch { return freshDefaults(); }
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  const parsed = record(value);
  if (!parsed) return freshDefaults();
  return {
    version: 2,
    agentDisplayMode: oneOf(parsed.agentDisplayMode, ['COMPACT', 'DETAILED'], 'COMPACT'),
    agentResourceBudget: normalizeAgentResourceBudget(parsed.agentResourceBudget),
    startupDestination: oneOf(parsed.startupDestination, ['PROJECTS', 'NOW', 'BROWSE'], defaultAppPreferences.startupDestination),
    languagePreference: oneOf(parsed.languagePreference, ['SYSTEM', 'ZH_CN', 'EN'], defaultAppPreferences.languagePreference),
    appearance: normalizeAppearance(parsed.appearance, parsed),
  };
}

export function writeAppPreferences(storage: Pick<PreferenceStorage, 'setItem'>, preferences: AppPreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, version: 2 }));
}

// Legacy DARK/SYSTEM values remain readable; the product now has one light appearance.
export function resolveAppearance(_preference: AppearanceMode, _prefersDark: boolean): EffectiveAppearance {
  void _preference;
  void _prefersDark;
  return 'LIGHT';
}

export function resolveUiLocale(preference: UiLanguagePreference, systemLocale: string): UiLocale {
  if (preference === 'ZH_CN') return 'zh-CN';
  if (preference === 'EN') return 'en';
  return /^zh(?:-|_|$)/i.test(systemLocale.trim()) ? 'zh-CN' : 'en';
}

export function resolveTitlebarCaption(appearance: AppearancePreferences, effectiveAppearance: EffectiveAppearance): string {
  return appearance.sidebarBackgroundGradientOverride?.to
    ?? appearance.sidebarBackgroundOverride
    ?? (effectiveAppearance === 'DARK' ? '#2B2229' : '#FFEFF2');
}

export function resolveMaterial(supportsBackdrop: boolean): MaterialMode {
  return supportsBackdrop ? 'GLASS' : 'SOLID';
}

export function resolveReducedMotion(preference: ReducedMotionPreference, prefersReducedMotion: boolean): boolean {
  return preference === 'SYSTEM' ? prefersReducedMotion : preference === 'REDUCE';
}

export function appearanceThemeDefaults(appearance: EffectiveAppearance): { sidebar: string; workspace: string; action: string } {
  return appearance === 'DARK'
    ? { sidebar: '#1B1820', workspace: '#181B23', action: '#9680FF' }
    : { sidebar: '#F7EFFB', workspace: '#FFFFFF', action: '#6847D8' };
}

const UI_FONT_FAMILIES: Record<UiFont, string | null> = {
  SYSTEM: null,
  INTER: 'Inter, "Segoe UI Variable", "Segoe UI", sans-serif',
  SEGOE_UI: '"Segoe UI Variable", "Segoe UI", sans-serif',
  PINGFANG_SC: '"PingFang SC", "Microsoft YaHei UI", sans-serif',
  MICROSOFT_YAHEI: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
};

const CODE_FONT_FAMILIES: Record<CodeFont, string | null> = {
  SYSTEM_MONO: null,
  CONSOLAS: 'Consolas, monospace',
  CASCADIA_CODE: '"Cascadia Code", Consolas, monospace',
  JETBRAINS_MONO: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
};

export function fontFamilyCss(font: UiFont | CodeFont, code: boolean): string | null {
  if (font.startsWith('LOCAL:')) return `${JSON.stringify(font.slice(6))}, ${code ? 'monospace' : 'sans-serif'}`;
  return (code ? CODE_FONT_FAMILIES[font as CodeFont] : UI_FONT_FAMILIES[font as UiFont]) ?? null;
}

function setOrRemove(target: HTMLElement, property: string, value: string | null): void {
  if (value === null) target.style.removeProperty(property);
  else target.style.setProperty(property, value);
}

function neutralMix(strength: number): string {
  return `color-mix(in srgb, var(--fl-color-text-strong) ${strength.toFixed(2)}%, var(--fl-color-surface))`;
}

export function applyAppPreferences(target: HTMLElement, preferences: AppPreferences, environment: AppearanceEnvironment = { prefersDark: false, prefersReducedMotion: false }): void {
  const appearance = preferences.appearance;
  const effectiveAppearance = resolveAppearance(appearance.themePreference, environment.prefersDark);
  const material = resolveMaterial(environment.supportsBackdrop ?? false);
  target.dataset.officialTheme = 'fielora';
  target.dataset.designLanguage = 'fielora-glass';
  target.dataset.appearanceMode = 'light';
  target.dataset.effectiveAppearance = effectiveAppearance.toLowerCase();
  target.dataset.material = material.toLowerCase();
  // Temporary compatibility markers for older non-visual E2E entry points.
  target.dataset.themePreference = 'light';
  target.dataset.resolvedTheme = effectiveAppearance.toLowerCase();
  target.dataset.uiDensity = 'standard';
  target.dataset.uiContrast = 'standard';
  target.dataset.uiRadius = 'standard';
  target.dataset.reduceMotion = String(resolveReducedMotion(appearance.reducedMotionPreference, environment.prefersReducedMotion));
  target.dataset.smoothScrolling = String(appearance.smoothScrolling);
  target.dataset.pointerCursor = String(appearance.pointerCursor);
  target.dataset.highContrast = String(appearance.highContrast);
  target.dataset.translucentSidebar = String(appearance.translucentSidebar && !appearance.highContrast);
  target.style.colorScheme = effectiveAppearance.toLowerCase();
  target.style.removeProperty('--fl-color-accent');
  const uiFamily = fontFamilyCss(appearance.uiFont, false);
  const codeFamily = fontFamilyCss(appearance.codeFont, true);
  setOrRemove(target, '--fl-font-sans', uiFamily);
  setOrRemove(target, '--fl-font-agent-sans', uiFamily);
  setOrRemove(target, '--fl-font-mono', codeFamily);
  setOrRemove(target, '--fl-font-agent-mono', codeFamily);
  target.style.setProperty('--fl-ui-font-scale', String(appearance.uiFontSize / 15));
  target.style.setProperty('--fl-code-font-size', `${appearance.codeFontSize}px`);

  const sidebar = appearance.sidebarBackgroundOverride;
  const sidebarGradient = appearance.sidebarBackgroundGradientOverride;
  const sidebarPaint = sidebarGradient
    ? threeCenterGradient(sidebarGradient)
    : sidebar;
  setOrRemove(target, '--fl-sidebar-background', null);
  setOrRemove(target, '--fl-brand-chrome-canvas', sidebarPaint);
  target.style.setProperty('--fl-brand-chrome-caption', resolveTitlebarCaption(appearance, effectiveAppearance));

  const workspace = appearance.workspaceBackgroundOverride;
  const workspaceGradient = appearance.workspaceBackgroundGradientOverride;
  const workspacePaint = workspaceGradient
    ? threeCenterGradient(workspaceGradient)
    : workspace;
  const workspaceBase = workspaceGradient
    ? `color-mix(in srgb, color-mix(in srgb, ${workspaceGradient.from} 50%, ${workspaceGradient.to}) 66.67%, ${workspaceGradient.bottomLeft ?? workspaceGradient.from})`
    : workspace;
  setOrRemove(target, '--fl-surface-content', workspacePaint);
  setOrRemove(target, '--fl-color-surface', workspaceBase);
  setOrRemove(target, '--fl-color-workbench', workspaceBase);
  const customContrast = appearance.surfaceContrast !== defaultAppearancePreferences.surfaceContrast;
  const customNeutrals = workspaceBase !== null || customContrast;
  const contrast = appearance.surfaceContrast;
  // 42 is the standard code fill; lower values approach the workspace,
  // higher values increase separation without recoloring other neutral controls.
  setOrRemove(target, '--fl-color-code-background', customContrast
    ? (contrast < defaultAppearancePreferences.surfaceContrast
      ? `color-mix(in srgb, var(--fl-color-code-background-base) ${(contrast / defaultAppearancePreferences.surfaceContrast * 100).toFixed(2)}%, var(--fl-color-surface))`
      : `color-mix(in srgb, var(--fl-color-text-strong) ${((contrast - defaultAppearancePreferences.surfaceContrast) / (100 - defaultAppearancePreferences.surfaceContrast) * 20).toFixed(2)}%, var(--fl-color-code-background-base))`)
    : null);
  const neutralProperties: Array<[string, number]> = [
    ['--fl-color-surface-raised', 1 + contrast * 0.015],
    ['--fl-color-surface-subtle', contrast * 0.11],
    ['--fl-color-surface-hover', 1 + contrast * 0.15],
    ['--fl-color-surface-hover-strong', 2 + contrast * 0.2],
    ['--fl-color-surface-active', 3 + contrast * 0.23],
    ['--fl-color-surface-selected', 1 + contrast * 0.14],
    ['--fl-color-border-subtle', 1 + contrast * 0.12],
    ['--fl-color-border', 2 + contrast * 0.16],
    ['--fl-color-border-soft', 1 + contrast * 0.12],
    ['--fl-color-border-strong', 3 + contrast * 0.2],
  ];
  for (const [property, strength] of neutralProperties) setOrRemove(target, property, customNeutrals ? neutralMix(strength) : null);
  setOrRemove(target, '--fl-effect-boundary', customNeutrals ? `color-mix(in srgb, var(--fl-color-text-strong) ${(1 + contrast * 0.15).toFixed(2)}%, transparent)` : null);
  setOrRemove(target, '--fl-surface-interactive', customNeutrals ? `color-mix(in srgb, var(--fl-color-text-strong) ${(contrast * 0.08).toFixed(2)}%, var(--fl-color-surface))` : null);
  setOrRemove(target, '--fl-brand-chrome-hover', customContrast ? `color-mix(in srgb, var(--fl-brand-chrome-foreground) ${(contrast * 0.17).toFixed(2)}%, transparent)` : null);
  setOrRemove(target, '--fl-brand-chrome-active', customContrast ? `color-mix(in srgb, var(--fl-brand-chrome-foreground) ${(contrast * 0.29).toFixed(2)}%, transparent)` : null);
  setOrRemove(target, '--fl-brand-chrome-edge', customContrast ? `color-mix(in srgb, var(--fl-brand-chrome-foreground) ${(contrast * 0.24).toFixed(2)}%, transparent)` : null);
  setOrRemove(target, '--fl-brand-chrome-input', customContrast ? `color-mix(in srgb, var(--fl-color-surface) ${(15 + contrast * 0.64).toFixed(2)}%, transparent)` : null);
  setOrRemove(target, '--fl-brand-chrome-selection-shadow', customContrast
    ? (contrast === 0 ? 'none' : `0 2px ${(1 + contrast * 0.04).toFixed(2)}px color-mix(in srgb, var(--fl-brand-chrome-shadow-color) ${(contrast * 0.12).toFixed(2)}%, transparent)`)
    : null);

  const action = appearance.actionColorOverride;
  setOrRemove(target, '--fl-action-primary', action);
  setOrRemove(target, '--fl-action-primary-foreground', action ? (colorContrast(action, '#FFFFFF') >= colorContrast(action, '#181A1F') ? '#FFFFFF' : '#181A1F') : null);
}

function linearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return 0.2126 * linearChannel(channels[0]!) + 0.7152 * linearChannel(channels[1]!) + 0.0722 * linearChannel(channels[2]!);
}

export function colorContrast(left: string, right: string): number {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}
