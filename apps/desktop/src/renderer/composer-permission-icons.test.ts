import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rendererRoot = import.meta.dirname;
const workspace = readFileSync(path.join(rendererRoot, 'ProjectWorkspace.tsx'), 'utf8');
const icons = readFileSync(path.join(rendererRoot, 'ui', 'Icon.tsx'), 'utf8');
const primitives = readFileSync(path.join(rendererRoot, 'UiPrimitives.tsx'), 'utf8');
const styles = readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
const layout = readFileSync(path.join(rendererRoot, 'styles', 'layout.css'), 'utf8');
const controls = readFileSync(path.join(rendererRoot, 'styles/controls.css'), 'utf8');
const tokens = readFileSync(path.join(rendererRoot, 'styles/tokens.css'), 'utf8');

test('composer permission uses three semantic icons without a trigger chevron', () => {
  for (const permission of ['READ_ONLY', 'REVIEW_CHANGES', 'FULL_CONTROL']) {
    assert.match(workspace, new RegExp(`PermissionIcon permission=["{]${permission}`));
  }
  assert.match(workspace, /data-permission-icon=\{permission\}/);
  assert.match(workspace, /testId="composer-permission"[^>]*hideChevron/);
  assert.match(primitives, /!hideChevron && <ChevronIcon/);
  assert.match(primitives, /option\.icon/);
  assert.match(primitives, /option\.tone/);
  assert.match(workspace, /<AppIcon name=\{icons\[permission\]\}/);
  assert.match(icons, /permissionAsk: HandPalm/);
  assert.match(icons, /permissionReview: ChatCircleDots/);
  assert.match(icons, /permissionFull: WarningOctagon/);
  assert.doesNotMatch(icons, /permissionFull: Shield/);
  assert.doesNotMatch(workspace, /function PermissionIcon[\s\S]*?<svg/);
  assert.match(styles, /permission-icon\[data-permission-icon="READ_ONLY"\]/);
  assert.match(styles, /permission-icon\[data-permission-icon="REVIEW_CHANGES"\]/);
  assert.match(styles, /permission-icon\[data-permission-icon="FULL_CONTROL"\]/);
});

test('permission copy distinguishes approval and actual command isolation', () => {
  assert.match(workspace, /label: '请求批准', description: '读取自动进行；修改文件、运行命令和联网前询问'/);
  assert.match(workspace, /label: '帮我批准', description: '自动修改项目；支持时隔离执行普通命令，安装和风险操作仍需批准'/);
  assert.match(workspace, /label: '完全访问权限', triggerLabel: '完全访问', description: '符合条件的项目依赖可自动安装，其他安装仍需批准；普通命令不使用沙箱'/);
  assert.match(primitives, /selected\?\.triggerLabel \?\? selected\?\.label \?\? ariaLabel/);
});

test('narrow permission trigger is icon-only and full control retains its warning signal', () => {
  assert.match(controls, /@container \(max-width: 560px\)[\s\S]*?\.permission-picker \{ width: 30px; flex: 0 0 30px; \}/);
  assert.doesNotMatch(styles, /\.permission-picker \{ width: 34px; flex: 0 0 34px; \}/);
  assert.match(styles, /\.permission-picker \.ui-select-value \{ display: none; \}/);
  assert.match(controls, /permission-picker\[data-value="FULL_CONTROL"\][\s\S]*?var\(--fl-color-permission-warning\)/);
  assert.match(controls, /permission-icon\[data-permission-icon="FULL_CONTROL"\][\s\S]*?currentColor/);
  assert.match(workspace, /value: 'FULL_CONTROL'[\s\S]{0,260}tone: 'warning'/);
});

test('permission typography follows the shared system type hierarchy', () => {
  assert.match(controls, /\.permission-picker button \{ font-family: var\(--fl-font-sans\); \}/);
  assert.match(controls, /\.select-menu\.permission-picker > button \{[\s\S]*?font-size: 13\.5px;[\s\S]*?font-weight: 500;/);
  assert.match(controls, /\.permission-picker \.ui-select-popover strong \{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 500;/);
  assert.match(controls, /\.permission-picker \.ui-select-popover small \{[\s\S]*?font-size: 13px;[\s\S]*?font-weight: 400;/);
  assert.match(tokens, /--fl-color-permission-warning: #e95016;/);
});

test('permission option icons and selected rows stay visually quiet', () => {
  assert.match(controls, /\.permission-picker \.ui-select-popover \{[\s\S]*?width: min\(440px, calc\(100vw - 28px\)\);/);
  assert.match(controls, /\.permission-picker \.ui-select-option-icon \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;/);
  assert.match(controls, /\.permission-picker \.ui-select-popover > button\[aria-selected="true"\] \{[\s\S]*?background: transparent;/);
  assert.doesNotMatch(styles, /\.permission-picker \.ui-select-option-icon \{[^}]*background:/);
});

test('empty conversation keeps the Composer bottom anchored with quiet permission and circular send controls', () => {
  assert.match(layout, /\.conversation-composer \{[\s\S]*?bottom: 0;/);
  assert.doesNotMatch(layout, /\.conversation-column\.is-empty-conversation \.conversation-composer/);
  assert.match(controls, /\.select-menu\.permission-picker > button \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(controls, /\.permission-picker \.ui-select-popover \{[\s\S]*?animation: permission-popover-enter/);
  assert.match(controls, /\.conversation-composer \.composer-submit \{[\s\S]*?border-radius: 50%;[\s\S]*?background: var\(--fl-action-primary\);/);
  assert.match(controls, /\.conversation-composer \.composer-submit \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
  assert.doesNotMatch(readFileSync(path.join(rendererRoot, 'styles', 'appearance.css'), 'utf8'), /\.conversation-composer \.composer-submit \{[^}]*\b(?:width|height|border-radius|transform):/);
  assert.match(controls, /\.conversation-composer \.composer-submit:active:not\(:disabled\) \{[\s\S]*?transform: scale\(0\.94\);/);
  assert.match(workspace, /<AppIcon name="send" weight="bold"\/>/);
});
