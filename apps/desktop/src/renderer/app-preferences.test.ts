import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAppPreferences,
  appearanceThemeDefaults,
  colorContrast,
  defaultAppearancePreferences,
  defaultAppPreferences,
  defaultAgentResourceBudget,
  normalizeAgentResourceBudget,
  normalizeAppPreferences,
  readAppPreferences,
  resolveAppearance,
  resolveMaterial,
  resolveReducedMotion,
  resolveTitlebarCaption,
  resolveUiLocale,
  writeAppPreferences,
  type AppPreferences,
} from './app-preferences.ts';

test('task budgets migrate with legacy preferences and round-trip independently', () => {
  const storage = memoryStorage({ 'fielora.ui.preferences.v2': JSON.stringify({ version: 2, languagePreference: 'EN' }) });
  const before = readAppPreferences(storage);
  assert.deepEqual(before.agentResourceBudget, defaultAgentResourceBudget);
  const budget = { max_execution_ms: 14_400_000, max_input_tokens: 10_000_000, max_output_tokens: 262_144 };
  writeAppPreferences(storage, { ...before, agentResourceBudget: budget });
  assert.deepEqual(readAppPreferences(storage).agentResourceBudget, { ...budget, max_input_tokens: 0, max_output_tokens: 0 });
  assert.equal(readAppPreferences(storage).languagePreference, 'EN');
  assert.deepEqual(normalizeAgentResourceBudget({ max_execution_ms: -1, max_input_tokens: '5000000', max_output_tokens: Infinity }), defaultAgentResourceBudget);
  assert.deepEqual(normalizeAgentResourceBudget({ max_execution_ms: 86_400_001, max_input_tokens: 50_000_001, max_output_tokens: 1_000_001 }), defaultAgentResourceBudget);
});

function memoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    entries,
  };
}

function freshPreferences(): AppPreferences {
  return { version: 2, agentResourceBudget: { ...defaultAgentResourceBudget }, agentDisplayMode: 'COMPACT', startupDestination: 'PROJECTS', languagePreference: 'SYSTEM', appearance: { ...defaultAppearancePreferences, advancedColorOverrides: {} } };
}

test('execution display defaults safely and persists independently of appearance', () => {
  const storage = memoryStorage({ 'fielora.ui.preferences.v2': JSON.stringify({ version: 2, languagePreference: 'EN' }) });
  const legacy = readAppPreferences(storage);
  assert.equal(legacy.agentDisplayMode, 'COMPACT');
  writeAppPreferences(storage, { ...legacy, agentDisplayMode: 'DETAILED' });
  const restored = readAppPreferences(storage);
  assert.equal(restored.agentDisplayMode, 'DETAILED');
  assert.equal(restored.languagePreference, 'EN');
  assert.deepEqual(restored.appearance, legacy.appearance);
  assert.equal(normalizeAppPreferences({ agentDisplayMode: 'UNKNOWN' }).agentDisplayMode, 'COMPACT');
});

test('appearance preferences use fresh safe defaults and tolerate corrupt storage', () => {
  assert.deepEqual(readAppPreferences(memoryStorage()), freshPreferences());
  assert.deepEqual(readAppPreferences(memoryStorage({ 'fielora.ui.preferences.v2': '{invalid' })), freshPreferences());
  const invalid = JSON.stringify({ version: 2, startupDestination: 'UNKNOWN', appearance: { themePreference: 'NEON', density: 'TINY', customAccent: 'purple' } });
  assert.deepEqual(readAppPreferences(memoryStorage({ 'fielora.ui.preferences.v2': invalid })), freshPreferences());
  assert.notEqual(readAppPreferences(memoryStorage()).appearance.advancedColorOverrides, defaultAppPreferences.appearance.advancedColorOverrides);
});

test('legacy v1 preferences migrate into the unified appearance model', () => {
  const legacy = JSON.stringify({ startupDestination: 'BROWSE', density: 'COMPACT', reduceMotion: true });
  const preferences = readAppPreferences(memoryStorage({ 'fielora.ui.preferences.v1': legacy }));
  assert.equal(preferences.version, 2);
  assert.equal(preferences.startupDestination, 'BROWSE');
  assert.equal(preferences.appearance.density, 'COMPACT');
  assert.equal(preferences.appearance.reducedMotionPreference, 'REDUCE');
  assert.equal(preferences.appearance.themePreference, 'LIGHT');
});

test('v2 appearance preferences round-trip through the canonical storage key', () => {
  const storage = memoryStorage();
  const preferences: AppPreferences = {
    version: 2,
    agentResourceBudget: { ...defaultAgentResourceBudget },
    agentDisplayMode: 'COMPACT',
    startupDestination: 'NOW',
    languagePreference: 'EN',
    appearance: {
      ...defaultAppearancePreferences,
      themePreference: 'DARK', accentPreset: 'CUSTOM', customAccent: '#137F88', density: 'COMPACT', radius: 'LARGE', uiFontScale: 110,
      uiFontSize: 17, codeFontSize: 15, sidebarBackgroundOverride: '#E8DEFA', workspaceBackgroundOverride: '#FCFDFE', surfaceContrast: 60, actionColorOverride: '#6847D8',
      advancedColorOverrides: { sidebar: '#20242A' },
    },
  };
  writeAppPreferences(storage, preferences);
  assert.ok(storage.entries.has('fielora.ui.preferences.v2'));
  assert.deepEqual(readAppPreferences(storage), { ...preferences, appearance: { ...preferences.appearance, themePreference: 'LIGHT' } });
});

test('legacy appearance modes resolve to light while reduced motion follows the environment', () => {
  assert.equal(resolveAppearance('SYSTEM', false), 'LIGHT');
  assert.equal(resolveAppearance('SYSTEM', true), 'LIGHT');
  assert.equal(resolveAppearance('LIGHT', true), 'LIGHT');
  assert.equal(resolveAppearance('DARK', true), 'LIGHT');
  assert.equal(resolveMaterial(true), 'GLASS');
  assert.equal(resolveMaterial(false), 'SOLID');
  assert.equal(resolveReducedMotion('SYSTEM', true), true);
  assert.equal(resolveReducedMotion('FULL', true), false);
  assert.equal(resolveReducedMotion('REDUCE', false), true);
  assert.deepEqual(appearanceThemeDefaults('LIGHT'), { sidebar: '#F7EFFB', workspace: '#FFFFFF', action: '#6847D8' });
  assert.deepEqual(appearanceThemeDefaults('DARK'), { sidebar: '#1B1820', workspace: '#181B23', action: '#9680FF' });
});

test('UI language follows Chinese system locales and supports explicit overrides', () => {
  assert.equal(resolveUiLocale('SYSTEM', 'zh-CN'), 'zh-CN');
  assert.equal(resolveUiLocale('SYSTEM', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveUiLocale('SYSTEM', 'en-US'), 'en');
  assert.equal(resolveUiLocale('ZH_CN', 'en-US'), 'zh-CN');
  assert.equal(resolveUiLocale('EN', 'zh-CN'), 'en');
  assert.equal(normalizeAppPreferences({ version: 2, languagePreference: 'UNKNOWN' }).languagePreference, 'SYSTEM');
});

test('applying appearance fixes the official identity and resolves Glass material capability', () => {
  const properties = new Map<string, string>();
  const target = {
    dataset: {} as DOMStringMap,
    style: {
      colorScheme: '',
      setProperty: (name: string, value: string) => { properties.set(name, value); },
      removeProperty: (name: string) => { properties.delete(name); return ''; },
    },
  } as unknown as HTMLElement;
  const preferences: AppPreferences = {
    ...freshPreferences(),
    appearance: {
      ...defaultAppearancePreferences,
      themePreference: 'SYSTEM', accentPreset: 'BLUE', density: 'COMPACT', contrast: 'HIGH', radius: 'LARGE',
      uiFont: 'MICROSOFT_YAHEI', codeFont: 'CASCADIA_CODE', uiFontSize: 18, codeFontSize: 16,
      sidebarBackgroundOverride: '#E8DEFA', workspaceBackgroundOverride: '#FCFDFE', surfaceContrast: 67, actionColorOverride: '#6847D8',
      uiFontScale: 115, translucentSidebar: true,
      reducedMotionPreference: 'SYSTEM', pointerCursor: false, advancedColorOverrides: { canvas: '#101214', accent: '#A15AC7' },
    },
  };
  applyAppPreferences(target, preferences, { prefersDark: true, prefersReducedMotion: true, supportsBackdrop: true });
  assert.deepEqual({
    theme: target.dataset.officialTheme, language: target.dataset.designLanguage, mode: target.dataset.appearanceMode,
    effective: target.dataset.effectiveAppearance, material: target.dataset.material, density: target.dataset.uiDensity,
    contrast: target.dataset.uiContrast, radius: target.dataset.uiRadius,
    motion: target.dataset.reduceMotion, pointer: target.dataset.pointerCursor,
  }, { theme: 'fielora', language: 'fielora-glass', mode: 'light', effective: 'light', material: 'glass', density: 'standard', contrast: 'standard', radius: 'standard', motion: 'true', pointer: 'false' });
  assert.equal(target.style.colorScheme, 'light');
  assert.equal(properties.has('--fl-color-accent'), false);
  assert.equal(properties.has('--fl-color-canvas'), false);
  assert.match(properties.get('--fl-font-sans') ?? '', /Microsoft YaHei/);
  assert.match(properties.get('--fl-font-mono') ?? '', /Cascadia Code/);
  assert.equal(properties.get('--fl-ui-font-scale'), '1.2');
  assert.equal(properties.get('--fl-code-font-size'), '16px');
  assert.equal(properties.get('--fl-brand-chrome-canvas'), '#E8DEFA');
  assert.equal(properties.has('--fl-sidebar-background'), false);
  assert.equal(properties.get('--fl-surface-content'), '#FCFDFE');
  assert.match(properties.get('--fl-color-surface-subtle') ?? '', /color-mix/);
  assert.match(properties.get('--fl-brand-chrome-active') ?? '', /19\.43%/);
  assert.match(properties.get('--fl-brand-chrome-selection-shadow') ?? '', /8\.04%/);
  assert.equal(properties.get('--fl-action-primary'), '#6847D8');
  assert.equal(properties.get('--fl-action-primary-foreground'), '#FFFFFF');

  applyAppPreferences(target, preferences, { prefersDark: false, prefersReducedMotion: false, supportsBackdrop: false });
  assert.equal(target.dataset.material, 'solid');
  assert.equal(target.dataset.effectiveAppearance, 'light');
});

test('contrast helper remains deterministic', () => {
  assert.ok(colorContrast('#FFFFFF', '#181A1F') > 15);
  assert.equal(colorContrast('#FFFFFF', '#FFFFFF'), 1);
});

test('code fill follows contrast and resetting restores the theme baseline', () => {
  const properties = new Map<string, string>();
  const target = { dataset: {} as DOMStringMap, style: { colorScheme: '', setProperty: (name: string, value: string) => { properties.set(name, value); }, removeProperty: (name: string) => { properties.delete(name); return ''; } } } as unknown as HTMLElement;
  for (const themePreference of ['LIGHT', 'DARK'] as const) {
    const preferences = normalizeAppPreferences({ appearance: { ...defaultAppearancePreferences, themePreference, surfaceContrast: 0 } });
    applyAppPreferences(target, preferences);
    assert.equal(properties.get('--fl-color-code-background'), 'color-mix(in srgb, var(--fl-color-code-background-base) 0.00%, var(--fl-color-surface))');
    preferences.appearance.surfaceContrast = 100;
    applyAppPreferences(target, preferences);
    assert.equal(properties.get('--fl-color-code-background'), 'color-mix(in srgb, var(--fl-color-text-strong) 20.00%, var(--fl-color-code-background-base))');
    preferences.appearance.surfaceContrast = defaultAppearancePreferences.surfaceContrast;
    applyAppPreferences(target, preferences);
    assert.equal(properties.has('--fl-color-code-background'), false);
  }
});

test('legacy visual customization data remains readable but cannot replace the official design language', () => {
  const storage = memoryStorage({ 'fielora.ui.preferences.v2': JSON.stringify({
    version: 2,
    startupDestination: 'PROJECTS',
    appearance: { ...defaultAppearancePreferences, accentPreset: 'CUSTOM', customAccent: '#AABBCC', advancedColorOverrides: { canvas: '#101214' } },
  }) });
  const preferences = readAppPreferences(storage);
  assert.equal(preferences.appearance.customAccent, '#AABBCC');
  const properties = new Map<string, string>();
  const target = { dataset: {} as DOMStringMap, style: { colorScheme: '', setProperty: (name: string, value: string) => { properties.set(name, value); }, removeProperty: (name: string) => { properties.delete(name); return ''; } } } as unknown as HTMLElement;
  applyAppPreferences(target, preferences, { prefersDark: false, prefersReducedMotion: false, supportsBackdrop: true });
  assert.equal(properties.has('--fl-color-canvas'), false);
  assert.equal(target.dataset.officialTheme, 'fielora');
});

test('legacy flat sidebar defaults migrate back to the continuous Chrome surface', () => {
  for (const legacyColor of ['#EFEBFF', '#F0ECFF', '#F7EFFB']) {
    const preferences = readAppPreferences(memoryStorage({ 'fielora.ui.preferences.v2': JSON.stringify({
      version: 2,
      startupDestination: 'PROJECTS',
      appearance: { ...defaultAppearancePreferences, sidebarBackgroundOverride: legacyColor },
    }) }));
    assert.equal(preferences.appearance.sidebarBackgroundOverride, null);
  }
});

test('background gradients normalize and resolve without entering neutral color derivation as images', () => {
  const preferences = normalizeAppPreferences({
    version: 2,
    startupDestination: 'PROJECTS',
    appearance: {
      ...defaultAppearancePreferences,
      sidebarBackgroundGradientOverride: { from: '#e8defa', to: '#ffeef4' },
      workspaceBackgroundGradientOverride: { from: '#fcfdfe', to: '#eef7ff' },
    },
  });
  assert.deepEqual(preferences.appearance.sidebarBackgroundGradientOverride, { from: '#E8DEFA', to: '#FFEEF4', bottomLeft: '#E8DEFA' });
  assert.deepEqual(preferences.appearance.workspaceBackgroundGradientOverride, { from: '#FCFDFE', to: '#EEF7FF', bottomLeft: '#FCFDFE' });
  const properties = new Map<string, string>();
  const target = { dataset: {} as DOMStringMap, style: { colorScheme: '', setProperty: (name: string, value: string) => { properties.set(name, value); }, removeProperty: (name: string) => { properties.delete(name); return ''; } } } as unknown as HTMLElement;
  applyAppPreferences(target, preferences, { prefersDark: false, prefersReducedMotion: false, supportsBackdrop: true });
  assert.match(properties.get('--fl-brand-chrome-canvas') ?? '', /radial-gradient\(ellipse 80% 75% at 0% 100%, #E8DEFA/);
  assert.equal(properties.get('--fl-brand-chrome-caption'), '#FFEEF4');
  assert.match(properties.get('--fl-surface-content') ?? '', /radial-gradient\(ellipse 80% 75% at 0% 100%, #FCFDFE/);
  assert.match(properties.get('--fl-color-surface') ?? '', /color-mix\(in srgb, #FCFDFE 50%, #EEF7FF\)/);
  assert.equal(resolveTitlebarCaption(preferences.appearance, 'LIGHT'), '#FFEEF4');
  assert.equal(resolveTitlebarCaption(defaultAppearancePreferences, 'LIGHT'), '#FFEFF2');
  assert.equal(resolveTitlebarCaption(defaultAppearancePreferences, 'DARK'), '#2B2229');
});

test('three-center colors persist independently and invalid legacy additions fall back safely', () => {
  const appearance = { ...defaultAppearancePreferences, sidebarBackgroundGradientOverride: { from: '#e8defa', to: '#ffeef4', bottomLeft: '#d5ffee' } };
  const configured = normalizeAppPreferences({ appearance });
  assert.deepEqual(configured.appearance.sidebarBackgroundGradientOverride, { from: '#E8DEFA', to: '#FFEEF4', bottomLeft: '#D5FFEE' });
  assert.deepEqual(normalizeAppPreferences(JSON.parse(JSON.stringify(configured))), configured);
  const invalid = normalizeAppPreferences({ appearance: { ...appearance, sidebarBackgroundGradientOverride: { ...appearance.sidebarBackgroundGradientOverride, bottomLeft: 'url(https://invalid)' } } });
  assert.equal(invalid.appearance.sidebarBackgroundGradientOverride?.bottomLeft, '#E8DEFA');
});

test('resetting appearance can preserve non-appearance preferences', () => {
  const configured: AppPreferences = {
    version: 2,
    agentResourceBudget: { ...defaultAgentResourceBudget },
    agentDisplayMode: 'DETAILED',
    startupDestination: 'BROWSE',
    languagePreference: 'ZH_CN',
    appearance: { ...defaultAppearancePreferences, themePreference: 'DARK', density: 'COMPACT' },
  };
  const reset = { ...configured, appearance: { ...defaultAppearancePreferences, advancedColorOverrides: {} } };
  assert.equal(reset.startupDestination, 'BROWSE');
  assert.equal(reset.appearance.themePreference, 'LIGHT');
  assert.equal(reset.appearance.density, 'STANDARD');
});

test('installed font names persist safely and preserve legacy choices', () => {
  const custom = normalizeAppPreferences({ appearance: { uiFont: 'LOCAL:示例 "Font"', codeFont: 'LOCAL:Fielora Mono' } });
  assert.equal(custom.appearance.uiFont, 'LOCAL:示例 "Font"');
  const storage = memoryStorage(); writeAppPreferences(storage, custom);
  assert.equal(readAppPreferences(storage).appearance.codeFont, 'LOCAL:Fielora Mono');
  for (const invalid of ['LOCAL:', 'LOCAL:a\ncolor:red', 'LOCAL:' + 'a'.repeat(300), 'UNKNOWN']) {
    assert.equal(normalizeAppPreferences({ appearance: { uiFont: invalid } }).appearance.uiFont, 'SYSTEM');
  }
  assert.equal(normalizeAppPreferences({ appearance: { uiFont: 'PINGFANG_SC' } }).appearance.uiFont, 'PINGFANG_SC');
});
