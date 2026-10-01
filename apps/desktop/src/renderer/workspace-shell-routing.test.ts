import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rendererRoot = import.meta.dirname;
const workspace = readFileSync(path.join(rendererRoot, 'ProjectWorkspace.tsx'), 'utf8');
const main = readFileSync(path.join(rendererRoot, '..', 'main.ts'), 'utf8');
const chrome = readFileSync(path.join(rendererRoot, 'DesktopChrome.tsx'), 'utf8');
const dock = readFileSync(path.join(rendererRoot, 'RightWorkspaceDock.tsx'), 'utf8');
const desktopChrome = readFileSync(path.join(rendererRoot, 'DesktopChrome.tsx'), 'utf8');
const styles = readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
const layout = readFileSync(path.join(rendererRoot, 'styles', 'layout.css'), 'utf8');
const primaryNav = readFileSync(path.join(rendererRoot, 'PrimaryNav.tsx'), 'utf8');
const iconSystem = readFileSync(path.join(rendererRoot, 'ui', 'Icon.tsx'), 'utf8');
const fileTypeIcons = readFileSync(path.join(rendererRoot, 'ui', 'FileTypeIcon.tsx'), 'utf8');

test('conversation uses one natural header instead of a duplicate workspace tab strip', () => {
  assert.match(workspace, /className="conversation-header conversation-context-header"/);
  assert.match(workspace, /className="conversation-heading"><AppIcon name="folder"\/><div className="conversation-title-line"><h2 title=\{conversation\?\.title \?\? '新对话'\}>\{conversation\?\.title \?\? '新对话'\}<\/h2>\{conversation && <ConversationActionsMenu/);
  assert.doesNotMatch(workspace, /<small title=\{project\.root_path\}>/);
  assert.doesNotMatch(workspace, /conversation-tab-strip|conversation-workspace-tab|closeConversationTab/);
  assert.doesNotMatch(styles, /\.conversation-tab-strip|\.conversation-workspace-tab/);
});

test('the global workspace toggle uses the right-side panel icon', () => {
  assert.match(desktopChrome, /testId="chrome-tools"/);
  assert.match(desktopChrome, /icon=\{<AppIcon name="panelRight"\/>\}/);
  assert.match(layout, /\.app-icon\[data-icon="panelRight"\] \{[\s\S]*?transform: scaleX\(-1\)/);
});

test('right resource view has animated opening, a resizable collapsible tree, and shared project launcher targets', () => {
  assert.match(styles, /\.project-layout \{[\s\S]*?transition: grid-template-columns var\(--fl-duration-panel\)/);
  assert.match(workspace, /testId="dock-file-tree-resizer"/);
  assert.match(workspace, /testId="dock-file-tree-toggle"/);
  assert.match(workspace, /setDockFileTreeCollapsed\(\(current\) => !current\)/);
  assert.match(workspace, /fielora:dock-file-tree-width/);
  assert.match(styles, /\.dock-resource-layout \{[\s\S]*?var\(--dock-file-tree-width,270px\)/);
  assert.match(styles, /\.dock-resource-layout\.file-tree-collapsed \{[\s\S]*?0 0/);
  assert.match(workspace, /data-testid="dock-project-open-default"><WorkspaceAppBadge target="FILE_EXPLORER" iconDataUrl=/);
  assert.match(workspace, /data-testid="dock-project-open-menu"/);
  assert.match(workspace, /projectOpenTargets\.filter\(\(target\) => target\.target !== 'FILE_EXPLORER'\)\.map/);
  assert.doesNotMatch(workspace, /<span>Fielora (文件|终端)<\/span>/);
  assert.match(styles, /\.right-dock-toolbar \.project-launcher-popover > button \{[\s\S]*?width: 100%[\s\S]*?grid-template-columns: 25px minmax\(0,1fr\)/);
  assert.equal(workspace.match(/testId="dock-file-tree-toggle"/g)?.length, 1);
  assert.match(main, /app\.getFileIcon\(executable, \{ size: 'normal' \}\)/);
  assert.match(workspace, /data-icon-source="native"/);
  assert.doesNotMatch(workspace, /<footer><span>\{session\.content === session\.file\.content/);
  assert.match(styles, /\.dock-resource-file-tree \{[\s\S]*?contain: layout paint[\s\S]*?animation: dock-file-tree-enter/);
  assert.doesNotMatch(styles, /\.dock-resource-layout \{[^}]*transition: grid-template-columns/);
});

test('review, local environment, and installed applications use recognizable semantic icons', () => {
  assert.match(iconSystem, /diff: PlusMinus/);
  assert.match(workspace, /<AppIcon name="changes"\/><span><strong>工作区改动<\/strong>/);
  for (const target of ['FILE_EXPLORER', 'VISUAL_STUDIO_CODE', 'CURSOR', 'VISUAL_STUDIO', 'GIT_BASH', 'INTELLIJ_IDEA', 'PYCHARM', 'WEBSTORM']) {
    assert.match(workspace, new RegExp(`${target}:`));
  }
  assert.match(workspace, /className=\{`workspace-app-icon target-\$\{target\.toLowerCase\(\)\}`\}/);
  assert.match(workspace, /data-icon-source="native"/);
  assert.match(workspace, /data-icon-source="fallback"/);
  assert.doesNotMatch(workspace, /const glyphs\b|<svg\b/);
  assert.doesNotMatch(workspace, /FILE_EXPLORER: 'F'|VISUAL_STUDIO_CODE: '<\/>'|INTELLIJ_IDEA: 'IJ'/);
});

test('right dock plus follows the last soft-edged tab only when tabs exist', () => {
  assert.match(dock, /<TabStrip innerRef=\{tabsRef\} className="right-dock-tabs"[\s\S]*?tabs\.map[\s\S]*?<\/TabStrip>\s*\{tabs\.length > 0 && <div className="right-dock-add-wrap"/);
  assert.match(dock, /<Tab[\s\S]*?className="right-dock-tab"/);
  assert.match(layout, /\.right-dock-tab-strip \{[\s\S]*?overflow: visible;[\s\S]*?padding-right: 126px/);
  assert.match(layout, /\.right-dock-tabs \{[\s\S]*?width: max-content;[\s\S]*?max-width: calc\(100% - 32px\);[\s\S]*?flex: 0 1 auto;[\s\S]*?scrollbar-width: none/);
  assert.match(layout, /\.right-dock-tabs \.right-dock-tab,[\s\S]*?flex: 0 0 132px/);
  assert.match(dock, /new ResizeObserver\(scheduleReveal\)/);
  assert.match(dock, /tabRect\.right > stripRect\.right[\s\S]*?strip\.scrollLeft/);
  assert.match(dock, /onContextMenu=\{\(event\) => \{ event\.preventDefault\(\); openTabMenu/);
  for (const action of ['重新加载', '复制标签页', '重命名', '关闭其他标签页', '关闭右侧标签页']) assert.match(dock, new RegExp(action));
  assert.match(dock, /data-testid="right-dock-tab-context-menu"/);
  assert.doesNotMatch(workspace, /id: 'artifacts', label: '工作对象'/);
  assert.match(styles, /\.right-dock-tab \{[\s\S]*?border-radius: 9px/);
  assert.match(styles, /\.right-dock-tab\.active \{[\s\S]*?background: var\(--fl-color-surface-subtle\)/);
});

test('closing all dock tabs hides the dock and reopening restores the dock-owned launcher', () => {
  assert.match(workspace, /if \(next\.length === 0\) \{[\s\S]*?setWorkspaceOpen\(false\)/);
  assert.match(chrome, /emit\('fielora:open-workspace-launcher'\)/);
  assert.match(workspace, /const openLauncher = \(\) => setWorkspaceOpen\(true\)/);
  assert.match(workspace, /showLauncher=\{workspaceOpen && dockTabs\.length === 0\}/);
  assert.match(workspace, /\{project && <RightWorkspaceDock/);
  assert.match(dock, /data-testid="right-dock-home"/);
  assert.match(dock, /data-testid="right-dock-tool-menu"/);
  assert.match(dock, /menuAnchorRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(dock, /createPortal\(<div ref=\{toolMenuRef\} className="right-dock-tool-menu-layer"[\s\S]*?document\.body\)/);
  assert.match(styles, /\.right-dock-tool-menu-layer \{ position: fixed;[\s\S]*?width: 184px;/);
  assert.match(dock, /event\.key === 'Escape'/);
  assert.doesNotMatch(dock, /WorkspaceObjectPicker/);
  assert.match(dock, /createPortal\(<div ref=\{contextMenuRef\}[\s\S]*?document\.body\)/);
  assert.match(styles, /\.workspace-panel \{[\s\S]*?opacity: 0; visibility: hidden;[\s\S]*?translateX\(var\(--fl-motion-distance-panel\)\)/);
  assert.doesNotMatch(styles, /\.workspace-object-picker-layer/);
  assert.doesNotMatch(styles, /\.project-layout\.workspace-open \.right-workspace-dock \{ position: absolute/);
});

test('top rail terminal and right launcher terminal use separate presentations', () => {
  assert.match(chrome, /testId="rail-terminal"/);
  assert.match(chrome, /onClick=\{\(\) => emit\('fielora:toggle-terminal'\)\}/);
  assert.match(workspace, /id: 'terminal'/);
  assert.match(workspace, /onRun=\{\(\) => void runTerminal\(terminalCommand, 'BOTTOM'\)\}/);
  assert.match(workspace, /onRun=\{\(\) => void runTerminal\(terminalCommand, 'RIGHT'\)\}/);
  assert.match(chrome, /testId="rail-terminal"[\s\S]*?name="terminalPanel"|name="terminalPanel"[\s\S]*?testId="rail-terminal"/);
  assert.match(workspace, /bottom-terminal-dock[\s\S]*?<AppIcon name="terminalPanel"\/>/);
  assert.match(workspace, /TERMINAL: \{[^\n]*icon: 'terminal'/);
});

test('both terminals use platform shell transcripts and prompts without legacy action chrome', () => {
  assert.match(workspace, /Windows PowerShell/);
  assert.match(workspace, /className="terminal-transcript"[\s\S]*?<form className="terminal-prompt" data-terminal-inline-prompt="true"/);
  assert.match(workspace, /isMac \? '' : 'PS '/);
  assert.match(workspace, /isMac \? 'zsh' : 'Windows PowerShell'/);
  assert.match(workspace, /working_directory: workingDirectory/);
  assert.match(workspace, /terminalRef\.current = \{ runId: 'pending', command: nextCommand, output: '' \}/);
  assert.match(workspace, /if \(active\.runId === 'pending'\) active\.runId = event\.run_id/);
  assert.match(workspace, /setTerminalCommand\(nextCommand\)/);
  assert.match(workspace, /setTerminalWorkingDirectory\(started\.working_directory\)/);
  assert.match(workspace, /isLegacyTerminalMessage\(message\.content\)/);
  assert.doesNotMatch(workspace, /role: 'ASSISTANT', content: transcript/);
  assert.match(workspace, /active=\{bottomTerminalOpen\}/);
  assert.match(workspace, /active=\{workspaceOpen && tab\.id === activeDockTabId\}/);
  assert.doesNotMatch(workspace, /terminal-toolbar|data-testid="run-tests"|data-testid="bottom-terminal-tests"/);
  assert.match(styles, /\.terminal-session \{[\s\S]*?display: block;[\s\S]*?background: transparent;[\s\S]*?var\(--fl-font-agent-mono\)/);
  assert.match(styles, /\.terminal-transcript \{[\s\S]*?height: 100%;[\s\S]*?overflow: auto/);
  assert.match(styles, /\.terminal-prompt input \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none/);
  assert.match(styles, /\.right-terminal-view \{[\s\S]*?background: inherit/);
  assert.match(iconSystem, /terminal: Terminal/);
  assert.match(iconSystem, /terminalPanel: TerminalWindow/);
});

test('file types use local semantic artwork while product controls keep the shared registry', () => {
  assert.match(iconSystem, /files: Files/);
  assert.match(iconSystem, /source: FileText/);
  assert.match(fileTypeIcons, /return \{ kind: 'file', asset: document \}/);
  assert.match(fileTypeIcons, /data-file-icon-source="material-icon-theme"/);
  assert.doesNotMatch(primaryNav, /<svg\b|APP_ICON_REGISTRY/);
});
