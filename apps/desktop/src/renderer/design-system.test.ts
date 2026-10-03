import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rendererRoot = import.meta.dirname;
const read = (relativePath: string) => readFileSync(path.join(rendererRoot, relativePath), 'utf8');

test('renderer loads one canonical cascade entry with explicit ownership layers', () => {
  const source = read('index.tsx');
  const cascade = read('styles/index.css');
  assert.match(source, /import '\.\/styles\/index\.css';/);
  assert.doesNotMatch(source, /import '\.\/styles\/(?:tokens|foundation|appearance|controls|materials)\.css';/);
  assert.match(cascade, /@layer reset, tokens, legacy, foundation, features, layout, typography, components, materials, utilities, overrides;/);
  const layerImports: ReadonlyArray<readonly [string, string]> = [['./tokens.css', 'tokens'], ['../styles.css', 'legacy'], ['./foundation.css', 'foundation'], ['./appearance.css', 'features'], ['./layout.css', 'layout'], ['./typography.css', 'typography'], ['./controls.css', 'components'], ['./materials.css', 'materials']];
  for (const [file, layer] of layerImports) {
    assert.match(cascade, new RegExp(`@import url\\("${file.replaceAll('.', '\\.')}"\\) layer\\(${layer}\\);`), `missing ${file} in ${layer}`);
  }
});

test('semantic token contract covers five surfaces, effects, type, geometry and motion', () => {
  const tokens = read('styles/tokens.css');
  for (const token of [
    '--fl-surface-canvas', '--fl-surface-content', '--fl-surface-chrome', '--fl-surface-floating', '--fl-surface-overlay',
    '--fl-color-text', '--fl-color-border', '--fl-effect-backdrop-chrome', '--fl-effect-edge-highlight',
    '--fl-font-size-body', '--fl-space-4', '--fl-radius-surface', '--fl-radius-work-surface', '--fl-control-md',
    '--fl-layout-navigation-default', '--fl-layout-navigation-min', '--fl-layout-conversation-reading',
    '--fl-layout-composer-width', '--fl-layout-workspace-dock-default', '--fl-layout-workspace-dock-min',
    '--fl-type-title-size', '--fl-type-body-size', '--fl-type-label-size', '--fl-type-meta-size',
    '--fl-shadow-overlay', '--fl-duration-fast', '--fl-duration-normal', '--fl-ease-enter', '--fl-ease-exit', '--fl-layer-dialog',
  ]) assert.match(tokens, new RegExp(`${token.replaceAll('-', '\\-')}\\s*:`), `missing ${token}`);
});

test('visual golden metrics keep the measured desktop calibration', () => {
  const tokens = read('styles/tokens.css');
  const legacy = read('styles.css');
  const appearance = read('styles/appearance.css');
  const materials = read('styles/materials.css');
  for (const [token, value] of [
    ['--fl-layout-navigation-default', '304px'],
    ['--fl-layout-conversation-reading', '1040px'],
    ['--fl-layout-conversation-message', '900px'],
    ['--fl-layout-composer-width', 'var\\(--fl-layout-conversation-reading\\)'],
    ['--fl-layout-workspace-dock-default', '635px'],
    ['--fl-layout-workspace-dock-min', '360px'],
    ['--fl-layout-conversation-min', '340px'],
    ['--fl-icon-md', '16px'],
    ['--fl-font-size-meta', 'calc\\(13px \\* var\\(--fl-ui-font-scale\\)\\)'],
    ['--fl-font-size-label', 'calc\\(14px \\* var\\(--fl-ui-font-scale\\)\\)'],
  ]) assert.match(tokens, new RegExp(`${token}: ${value};`), `${token} drifted from the visual golden`);
  assert.match(legacy, /\.desktop-frame \{[^}]*grid-template-rows: 44px minmax\(0,1fr\)/);
  assert.match(appearance, /\.project-item-row\.active \{ background: transparent; \}/);
  assert.match(materials, /\.conversation-composer\[data-surface="floating"\] \{[^}]*var\(--fl-shadow-surface\)/);
});

test('work-content emphasis stays limited while branded purple remains Chrome-scoped', () => {
  const tokens = read('styles/tokens.css');
  const controls = read('styles/controls.css');
  const appearance = read('styles/appearance.css');
  assert.match(tokens, /--fl-color-accent: #505761;/);
  assert.match(tokens, /--fl-color-emphasis: #7657ef;/);
  assert.match(controls, /\.ui-select-check \{[^}]*color: var\(--fl-color-emphasis\)/s);
  assert.match(appearance, /\.conversation-composer \.composer-submit,[\s\S]*?background: var\(--fl-action-primary\)/);
  assert.doesNotMatch(appearance, /\.right-dock-tab\.active::after/);
  assert.match(appearance, /\.project-global-nav button\.active::before,[\s\S]*?content: none;/);
});

test('shared design-system CSS consumes tokens instead of raw colors', () => {
  for (const file of ['styles/foundation.css', 'styles/layout.css', 'styles/typography.css', 'styles/appearance.css', 'styles/controls.css', 'styles/materials.css']) {
    const source = read(file);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i, `${file} contains a raw color`);
  }
});

test('the material resolver owns Glass recipes and degrades the same five surfaces to solid', () => {
  const materials = read('styles/materials.css');
  for (const surface of ['canvas', 'content', 'chrome', 'floating', 'overlay']) assert.match(materials, new RegExp(`data-surface="${surface}"`));
  assert.match(materials, /data-material="solid"/);
  assert.match(materials, /@supports not \(backdrop-filter: blur\(1px\)\)/);
  assert.match(materials, /data-effect="backdrop-dim"/);
  for (const file of ['styles.css', 'styles/appearance.css', 'styles/controls.css']) assert.doesNotMatch(read(file), /backdrop-filter\s*:/, `${file} defines a direct Glass recipe`);
});

test('app shell owns Canvas while the workspace uses one continuous Content plane', () => {
  const chrome = read('DesktopChrome.tsx');
  const workspaceSurface = read('WorkspaceSurface.tsx');
  const workspace = read('ProjectWorkspace.tsx');
  const dock = read('RightWorkspaceDock.tsx');
  const browser = read('BrowseScreen.tsx');
  const legacy = read('styles.css');
  const appearance = read('styles/appearance.css');
  const layout = read('styles/layout.css');
  assert.match(chrome, /className="desktop-frame" data-surface="canvas"/);
  assert.match(chrome, /data-surface="chrome" data-chrome-plane="window"/);
  assert.doesNotMatch(workspaceSurface, /data-surface="canvas"/);
  assert.match(workspaceSurface, /data-layout-owner="app-workspace"/);
  assert.doesNotMatch(workspace, /conversation-header conversation-context-header" data-surface="chrome"/);
  assert.match(workspace, /className="conversation-heading"><AppIcon name="folder"\/>/);
  assert.doesNotMatch(dock, /right-dock-(?:tab-strip|toolbar)" data-surface="chrome"/);
  assert.doesNotMatch(read('ArtifactWorkingSurface.tsx'), /artifact-surface-header" data-surface="chrome"/);
  assert.doesNotMatch(browser, /browser-object-chrome/);
  assert.doesNotMatch(browser, /className="browser-page-strip" data-surface|className="browser-toolbar" data-surface/);
  assert.match(legacy, /\.project-root \{[^}]*background: transparent;/);
  assert.match(legacy, /\.workspace-surface \{[^}]*background: var\(--fl-surface-content\);/);
  assert.match(legacy, /\.conversation-column \{[^}]*background: var\(--fl-surface-content\);/);
  assert.match(layout, /\.conversation-column,[\s\S]*?\.settings-content,[\s\S]*?\.library-content \{[\s\S]*?border-radius: var\(--fl-radius-work-surface\) 0 0 0;/);
  assert.match(layout, /\.conversation-column \{[\s\S]*?border-radius: var\(--fl-radius-conversation-surface\) 0 0 0;/);
  assert.match(layout, /\.project-navigation-resizer:hover span,[\s\S]*?opacity: \.38;[\s\S]*?background: var\(--fl-color-divider\);/);
  assert.match(appearance, /\.right-workspace-dock \{[^}]*background: var\(--fl-surface-content\)/);
  assert.doesNotMatch(legacy, /\.project-layout\.workspace-open \.right-workspace-dock \{ position: absolute/);
});

test('product icons use the managed Phosphor entry instead of component-owned svg paths', () => {
  const registry = read('ui/Icon.tsx');
  const fileTypes = read('ui/FileTypeIcon.tsx');
  assert.match(registry, /from '@phosphor-icons\/react'/);
  assert.match(registry, /export function FieloraIcon/);
  assert.match(registry, /export const AppIcon = FieloraIcon/);
  assert.match(registry, /objects: Shapes/);
  assert.match(registry, /focus: ArrowsOutSimple/);
  assert.match(registry, /diff: PlusMinus/);
  assert.match(read('styles/controls.css'), /\.app-icon\[data-icon="diff"\] \{[\s\S]*?border: 1\.5px solid currentColor;[\s\S]*?border-radius: 4px;/);
  assert.match(registry, /terminalPanel: TerminalWindow/);
  assert.match(fileTypes, /data-file-icon-source="material-icon-theme"/);
  assert.doesNotMatch(fileTypes, /https?:|<svg/);
  for (const file of ['DesktopChrome.tsx', 'ProjectWorkspace.tsx', 'SettingsScreen.tsx', 'RightWorkspaceDock.tsx', 'AgentTurn.tsx']) {
    const source = read(file);
    assert.match(source, /AppIcon/);
    assert.doesNotMatch(source, /AppIcon[^\n]*from '\.\/PrimaryNav'/);
    assert.doesNotMatch(source, /\bShellIcon\b|\bChromeGlyph\b|\bComposerIcon\b/);
  }
  for (const file of ['PrimaryNav.tsx', 'WorkspaceFileTree.tsx', 'ProjectWorkspace.tsx', 'AgenticUXPrototype.tsx']) {
    assert.doesNotMatch(read(file), /<svg\b|APP_ICON_REGISTRY|const glyphs\b/, `${file} contains a hand-drawn icon`);
  }
  assert.match(read('ProjectWorkspace.tsx'), /data-icon-source="native"/);
  assert.match(read('ProjectWorkspace.tsx'), /data-icon-source="fallback"/);
});

test('Phosphor owns glyph paint and product CSS cannot erase fill-based icons', () => {
  const appearance = read('styles/appearance.css');
  const controls = read('styles/controls.css');
  const legacy = read('styles.css');
  assert.doesNotMatch(appearance, /\.app-icon\s*\{[^}]*(?:fill|stroke(?:-width)?):/s);
  assert.doesNotMatch(controls, /\.ui-select-popover\s+svg\s*\{/);
  assert.doesNotMatch(controls, /\.permission-icon\s+\.app-icon\s*\{[^}]*stroke/s);
  assert.doesNotMatch(legacy, /\.composer-icon\s*\{[^}]*(?:fill|stroke(?:-width)?):/s);
  assert.doesNotMatch(legacy, /\.file-type-icon\s*\{[^}]*stroke/s);
  assert.match(read('../../../../docs/architecture/FIELORA_UI_UX_SYSTEM_V0.1.md'), /Phosphor 组件独占 glyph/);
});

test('renderer keeps React singleton resolution for hook-based shared UI dependencies', () => {
  const webpack = read('../../webpack.renderer.ts');
  assert.match(webpack, /react: path\.resolve\(__dirname, '\.\.\/\.\.\/node_modules\/react'\)/);
  assert.match(webpack, /'react-dom': path\.resolve\(__dirname, '\.\.\/\.\.\/node_modules\/react-dom'\)/);
});

test('shared renderer primitives expose canonical controls', () => {
  const source = read('UiPrimitives.tsx');
  for (const primitive of ['Button', 'IconButton', 'ToolbarAction', 'TooltipButton', 'Menu', 'MenuItem', 'SelectMenu', 'TabStrip', 'Tab', 'TextActionDialog']) {
    assert.match(source, new RegExp(`export function ${primitive}\\b`), `missing ${primitive}`);
  }
  for (const className of ['ui-button', 'ui-icon-button', 'ui-toolbar-action', 'ui-menu', 'ui-select', 'ui-tab', 'ui-dialog']) {
    assert.match(source, new RegExp(className), `missing canonical class ${className}`);
  }
});

test('shared icon controls use the managed desktop tooltip instead of native title chrome', () => {
  const source = read('UiPrimitives.tsx');
  const controls = read('styles/controls.css');
  assert.match(source, /createPortal/);
  assert.match(source, /className=\{`ui-tooltip\$\{variant !== 'default'/);
  assert.match(source, /export function TimestampHover/);
  assert.match(source, /data-testid="ui-tooltip"/);
  assert.match(source, /\[data-testid="desktop-chrome"\]/);
  assert.match(source, /const safeTop = Math\.max\(viewportInset, chromeBottom \+ viewportInset\)/);
  assert.match(source, /placement === 'right'/);
  assert.match(source, /export function TooltipButton/);
  const iconButton = source.match(/export function IconButton[\s\S]*?\n}\n\nexport function ToolbarAction/)?.[0] ?? '';
  const toolbarAction = source.match(/export function ToolbarAction[\s\S]*?\n}\n\nexport function Menu/)?.[0] ?? '';
  assert.doesNotMatch(iconButton, /\btitle=/);
  assert.doesNotMatch(toolbarAction, /\btitle=/);
  assert.match(controls, /\.ui-tooltip\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?--fl-color-tooltip-background/);
  assert.match(controls, /\.ui-tooltip--card\s*\{[\s\S]*?--fl-surface-overlay[\s\S]*?var\(--fl-shadow-floating\)/);
});

test('layout and typography ownership are explicit and documented', () => {
  const layout = read('styles/layout.css');
  const appearance = read('styles/appearance.css');
  const type = read('styles/typography.css');
  const doc = read('../../../../docs/architecture/FIELORA_UI_UX_SYSTEM_V0.1.md');
  assert.match(layout, /Conversation and right tools are two views on one continuous Content plane/);
  assert.match(layout, /The work canvas rounds into the shared app chrome/);
  assert.match(layout, /\.workspace-surface,[\s\S]*?\.right-workspace-dock,[\s\S]*?background: var\(--fl-surface-content\)/);
  assert.match(layout, /\.project-layout\.workspace-open \{[\s\S]*?--fl-project-workspace-track: var\(--project-workspace-width, var\(--fl-layout-workspace-dock-default\)\)/);
  assert.match(layout, /\.project-layout\.workspace-open\.dock-focused \{[\s\S]*?--fl-project-workspace-track: calc\(100%/);
  assert.match(layout, /\.right-workspace-dock,[\s\S]*?\.right-dock-view-browser \.browse-panel,[\s\S]*?\.right-terminal-view \.terminal-session \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: none;/);
  assert.doesNotMatch(read('ProjectWorkspace.tsx'), /PROJECT_WORKSPACE_MAX_WIDTH/);
  assert.match(layout, /\.conversation-composer \{[\s\S]*?--fl-layout-conversation-gutter[\s\S]*?--fl-layout-conversation-reading/);
  for (const block of appearance.matchAll(/\.conversation-composer\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(block[1] ?? '', /\b(?:width|margin-bottom|padding)\s*:/, 'appearance.css cannot own Composer geometry');
  }
  assert.doesNotMatch(appearance, /\.project-layout[^{}]*\{[^}]*grid-template-columns/s);
  for (const role of ['title', 'section', 'body', 'label', 'meta']) assert.match(type, new RegExp(`--fl-type-${role}-`));
  assert.match(doc, /CURRENT \/ CANONICAL \/ CHANGE-SYNCHRONIZED/);
  assert.match(doc, /pnpm verify:ui-ux/);
  assert.match(read('../../../../scripts/check-ui-ux-doc-sync.mjs'), /UI_UX_DOC_SYNC/);
});

test('shared navigation resize, collapse and Settings content behavior stay canonical', () => {
  const surface = read('WorkspaceSurface.tsx');
  const project = read('ProjectWorkspace.tsx');
  const settings = read('SettingsScreen.tsx');
  const scheduled = read('ScheduledTasksScreen.tsx');
  const rightDock = read('RightWorkspaceDock.tsx');
  const appearance = read('AppearanceSettings.tsx');
  const layout = read('styles/layout.css');
  const main = read('../main.ts');
  const doc = read('../../../../docs/architecture/FIELORA_UI_UX_SYSTEM_V0.1.md');

  assert.match(surface, /WORKSPACE_NAVIGATION_DEFAULT_WIDTH = 304/);
  assert.match(surface, /WORKSPACE_NAVIGATION_MIN_WIDTH = 220/);
  assert.match(surface, /WORKSPACE_NAVIGATION_MAX_WIDTH = 560/);
  assert.match(surface, /style\.setProperty\('--workspace-navigation-width'/);
  assert.match(project, /navigationMax=\{navigationMaximumWidth\(\)\}/);
  assert.match(settings, /<WorkspaceSurface className="settings-root"/);
  assert.match(scheduled, /<WorkspaceSurface[\s\S]*?className="scheduled-root"/);
  assert.match(scheduled, /readWorkspaceNavigationWidth\(WORKSPACE_NAVIGATION_DEFAULT_WIDTH, 'fielora:scheduled-navigation-width'\)/);
  assert.match(scheduled, /navigationResizerTestId="scheduled-navigation-resizer"/);
  assert.match(settings, /WORKSPACE_NAVIGATION_MIN_WIDTH/);
  assert.match(settings, /WORKSPACE_NAVIGATION_MAX_WIDTH/);
  assert.match(layout, /body\[data-sidebar-collapsed="true"\] \.workspace-surface \{[\s\S]*?grid-template-columns: 0 0 minmax\(0, 1fr\);/);
  assert.match(layout, /body\[data-sidebar-collapsed="true"\] \.project-navigation[\s\S]*?width: 100%;[\s\S]*?padding-inline: 0;[\s\S]*?overflow: hidden;/);
  assert.match(layout, /@property --workspace-navigation-width\s*\{[^}]*inherits: false;/);
  assert.match(layout, /\.settings-content \{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/);
  assert.match(read('styles/tokens.css'), /--fl-layout-page-width: 1040px;[\s\S]*?--fl-layout-settings-content: 920px;/);
  assert.match(read('styles/appearance.css'), /\.settings-section,[\s\S]*?\.appearance-settings \{ width: min\(var\(--fl-layout-settings-content\), 100%\); margin-inline: auto; \}/);
  assert.match(layout, /\.library-content > \*,[\s\S]*?\.scheduled-page > \* \{[\s\S]*?width: 100%;/);
  assert.match(layout, /\.conversation-context-header \{[\s\S]*?calc\(\(100% - var\(--fl-layout-page-width\)\) \/ 2\)/);
  assert.match(layout, /\.conversation-column,[\s\S]*?\.scheduled-page,[\s\S]*?\.settings-content,[\s\S]*?\.library-content \{[\s\S]*?border-radius: var\(--fl-radius-work-surface\) 0 0 0;/);
  assert.match(read('styles/tokens.css'), /--fl-radius-conversation-surface: 16px;/);
  assert.match(layout, /@property --fl-project-workspace-track[\s\S]*?syntax: "<length-percentage>"/);
  assert.match(layout, /transition: grid-template-columns var\(--fl-duration-panel\) var\(--fl-ease-panel\);/);
  assert.doesNotMatch(layout, /--fl-project-workspace-track var\(--fl-duration-panel\)/);
  assert.match(rightDock, /\{tabs\.length > 0 && <div className="right-dock-add-wrap"/);
  assert.match(main, /width: 1180,[\s\S]*?height: 560,[\s\S]*?minWidth: 900,[\s\S]*?minHeight: 560,/);

  assert.doesNotMatch(appearance, /AppearanceModeControl|appearance-theme-|appearance-mode-section/);
  for (const control of ['appearance-sidebar-background', 'appearance-workspace-background', 'appearance-ui-font', 'appearance-ui-font-size', 'appearance-code-font', 'appearance-code-font-size', 'appearance-surface-contrast', 'appearance-action-color', 'appearance-reduced-motion', 'appearance-high-contrast', 'appearance-smooth-scrolling', 'appearance-reset']) {
    assert.match(appearance, new RegExp(control), `missing useful Appearance control ${control}`);
  }
  assert.match(appearance, /恢复当前主题默认值/);
  assert.match(appearance, /value: 'GRADIENT', label: t\('渐变', 'Gradient'\)/);
  assert.match(appearance, /createPortal\(<div ref=\{popoverRef\} className="appearance-color-popover"/);
  assert.doesNotMatch(appearance, /type="color"/);
  assert.doesNotMatch(appearance, /filter:\s*contrast/);
  assert.doesNotMatch(appearance, /Fielora Glass|官方设计语言|Glass 不是一个主题选项|高级颜色|导入主题/);
  assert.match(doc, /220–560px/);
  assert.match(doc, /Settings 与 Scheduled Content 自身纵向滚动/);
  assert.match(doc, /初始窗口高度等于允许的最小高度 `560px`/);
});

test('replaceable Brand Chrome is scoped to the top bar and left navigation', () => {
  const chrome = read('DesktopChrome.tsx');
  const primary = read('PrimaryNav.tsx');
  const settings = read('SettingsScreen.tsx');
  const app = read('App.tsx');
  const webpack = read('../../webpack.renderer.ts');
  const tokens = read('styles/tokens.css');
  const appearance = read('styles/appearance.css');
  const materials = read('styles/materials.css');

  assert.match(chrome, /data-chrome-plane="window" data-brand-chrome="top"/);
  assert.match(primary, /data-surface="chrome"[\s\S]*?data-brand-chrome="navigation"/);
  assert.match(settings, /className="settings-navigation" data-surface="chrome" data-brand-chrome="navigation"/);
  for (const source of [app, primary, settings]) assert.match(source, /fielora-brand-mark\.svg/);
  const brandSvg = readFileSync(path.join(rendererRoot, '..', '..', 'assets', 'fielora-brand-mark.svg'), 'utf8');
  assert.match(brandSvg, /fill="#5840C8"/);
  assert.equal(brandSvg.match(/<path\b/g)?.length, 3);
  assert.doesNotMatch(brandSvg, /<circle\b/);
  const brandPng = readFileSync(path.join(rendererRoot, '..', '..', 'assets', 'fielora-brand-mark.png'));
  assert.equal(brandPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(webpack, /test: \/\\\.\(\?:png\|svg\)\$\/i/);

  for (const token of ['top', 'navigation', 'caption', 'foreground', 'hover', 'active']) {
    assert.match(tokens, new RegExp(`--fl-brand-chrome-${token}:`));
  }
  assert.match(tokens, /--fl-brand-logo-opacity: 0\.72;/);
  assert.match(materials, /data-brand-chrome="top"\]::after \{[\s\S]*?right: calc\(100vw - env\(titlebar-area-x,[\s\S]*?env\(titlebar-area-width,[\s\S]*?width: 96px;[\s\S]*?var\(--fl-brand-chrome-caption\)/);
  assert.match(appearance, /\.desktop-chrome\[data-brand-chrome="top"\]/);
  assert.match(appearance, /\.project-navigation\[data-brand-chrome="navigation"\]/);
  assert.match(appearance, /\.settings-navigation\[data-brand-chrome="navigation"\]/);
  assert.match(appearance, /\.project-navigation\[data-brand-chrome="navigation"\] \.project-brand-button img,[\s\S]*?opacity: var\(--fl-brand-logo-opacity\);/);

  for (const stylesheet of [appearance, materials]) {
    for (const block of stylesheet.matchAll(/([^{}]+)\{[^{}]*var\(--fl-brand-chrome-[^)]+\)[^{}]*\}/g)) {
      assert.doesNotMatch(block[1] ?? '', /conversation-(?:column|header|composer)|message-|right-workspace-dock|right-dock-|utility-launcher/, 'Brand Chrome leaked into a Content or right-side owner');
    }
  }
  assert.match(appearance, /\.right-workspace-dock \{[^}]*background: var\(--fl-surface-content\)/);
});

test('project navigation keeps the section label clear of scrolling and selects only the conversation', () => {
  const layout = read('styles/layout.css');
  const appearance = read('styles/appearance.css');
  assert.match(layout, /\.project-tree:has\(> \.project-list\) \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(layout, /\.project-tree > \.project-list \{[\s\S]*?margin: var\(--fl-space-2\) var\(--fl-space-1\) var\(--fl-space-2\) 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(appearance, /\.project-navigation\[data-brand-chrome="navigation"\] \.project-item-row\.active \{[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/);
  assert.match(appearance, /\.project-navigation\[data-brand-chrome="navigation"\] \.conversation-item\.active,[\s\S]*?background: var\(--fl-brand-chrome-active\);/);
});

test('legacy compatibility stylesheet cannot grow its raw color budget', () => {
  const legacy = read('styles.css');
  const rawColors = legacy.match(/#[0-9a-f]{3,8}\b|rgba?\s*\([^)]*\)/gi) ?? [];
  // Migration baseline after extracting foundations, shared controls and the window-right dock.
  // The budget may move downward as touched legacy Surfaces migrate, never upward.
  assert.ok(rawColors.length <= 408, `legacy raw color budget grew to ${rawColors.length}`);
});
