import { shortcutLabel } from './platform';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AppView } from './view-state';
import { BrowsePanel } from './BrowseScreen';
import { AppIcon } from './ui';
import { ResizableDivider } from './ResizableDivider';
import { ToolbarAction } from './UiPrimitives';
import { useUiLocale } from './ui-locale';

type ChromeMenu = 'FILE' | 'EDIT' | 'VIEW' | 'HELP';
type WorkspaceTool = 'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER';
type UtilityView = 'HOME' | 'BROWSER';

interface RouteState {
  route: AppView;
  canBack: boolean;
  canForward: boolean;
}

interface TerminalLayoutState {
  open: boolean;
  height: number;
}

const initialRoute: RouteState = { route: 'PROJECTS', canBack: false, canForward: false };
const utilityWidthKey = 'fielora:utility-panel-width-v2';
const utilityMin = 340;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readUtilityWidth(): number {
  const value = Number.parseFloat(window.localStorage.getItem(utilityWidthKey) ?? '480');
  return Number.isFinite(value) ? clamp(value, utilityMin, 960) : 480;
}

function emit<T>(name: string, detail?: T): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function DesktopChrome({ children }: { children: ReactNode }) {
  const { t } = useUiLocale();
  const [menu, setMenu] = useState<ChromeMenu | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [renderTools, setRenderTools] = useState(false);
  const [utilityView, setUtilityView] = useState<UtilityView>('HOME');
  const [utilityWidth, setUtilityWidth] = useState(readUtilityWidth);
  const [route, setRoute] = useState<RouteState>(initialRoute);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [projectDockOpen, setProjectDockOpen] = useState(false);
  const [projectDockFocus, setProjectDockFocus] = useState(false);
  const [terminalLayout, setTerminalLayout] = useState<TerminalLayoutState>({ open: false, height: 250 });
  const chromeRef = useRef<HTMLElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);
  const utilityOpenFrameRef = useRef<number | null>(null);
  const previousRouteRef = useRef<AppView>(initialRoute.route);

  const openWorkspace = (tool: WorkspaceTool) => {
    if (toolsOpen) closeUtility();
    emit('fielora:open-workspace', tool);
  };
  const toggleSidebar = () => setSidebarCollapsed((value) => !value);
  const settingsRoute = route.route === 'SETTINGS';
  const globalPageRoute = route.route === 'NOW' || route.route === 'LIBRARY' || settingsRoute;
  const workspaceControlsVisible = !globalPageRoute || toolsOpen;

  function openUtility(view: UtilityView) {
    if (settingsRoute) return;
    if (route.route === 'PROJECTS') {
      if (view === 'BROWSER') openWorkspace('BROWSER');
      else emit('fielora:open-workspace-launcher');
      return;
    }
    setUtilityWidth((current) => clamp(current, utilityMin, utilityMaximum()));
    setUtilityView(view);
    if (toolsOpen) return;
    if (utilityOpenFrameRef.current !== null) window.cancelAnimationFrame(utilityOpenFrameRef.current);
    setRenderTools(true);
    utilityOpenFrameRef.current = window.requestAnimationFrame(() => {
      utilityOpenFrameRef.current = null;
      setToolsOpen(true);
    });
  }

  function closeUtility() {
    if (utilityOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(utilityOpenFrameRef.current);
      utilityOpenFrameRef.current = null;
    }
    setToolsOpen(false);
    setFocusMode(false);
  }

  function toggleFocus() {
    if (settingsRoute) return;
    if (focusMode) {
      setFocusMode(false);
      return;
    }
    if (!toolsOpen) openUtility('HOME');
    setFocusMode(true);
  }

  function utilityMaximum(): number {
    const width = workAreaRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    return Math.max(utilityMin, width - 360 - 4);
  }

  function resizeUtility(clientX: number) {
    const rect = workAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clamp(rect.right - clientX, utilityMin, utilityMaximum());
    setUtilityWidth(next);
    window.localStorage.setItem(utilityWidthKey, String(Math.round(next)));
  }

  function resizeUtilityBy(delta: number) {
    setUtilityWidth((current) => {
      const next = clamp(current - delta, utilityMin, utilityMaximum());
      window.localStorage.setItem(utilityWidthKey, String(Math.round(next)));
      return next;
    });
  }

  useEffect(() => {
    document.body.dataset.sidebarCollapsed = String(sidebarCollapsed);
    return () => { delete document.body.dataset.sidebarCollapsed; };
  }, [sidebarCollapsed]);

  useEffect(() => {
    const setCollapsed = (event: Event) => setSidebarCollapsed(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('fielora:set-sidebar-collapsed', setCollapsed);
    return () => window.removeEventListener('fielora:set-sidebar-collapsed', setCollapsed);
  }, []);

  useEffect(() => {
    document.body.dataset.focusMode = String(focusMode);
    return () => { delete document.body.dataset.focusMode; };
  }, [focusMode]);

  useEffect(() => {
    document.body.dataset.utilityView = toolsOpen ? utilityView : 'CLOSED';
    document.body.dataset.utilityOpen = String(toolsOpen);
    emit('fielora:utility-state', { open: toolsOpen, view: utilityView });
    return () => { delete document.body.dataset.utilityView; delete document.body.dataset.utilityOpen; };
  }, [toolsOpen, utilityView]);

  useEffect(() => {
    if (toolsOpen) { setRenderTools(true); return; }
    setFocusMode(false);
    const timer = window.setTimeout(() => setRenderTools(false), 300);
    return () => window.clearTimeout(timer);
  }, [toolsOpen]);

  useEffect(() => () => {
    if (utilityOpenFrameRef.current !== null) window.cancelAnimationFrame(utilityOpenFrameRef.current);
  }, []);

  useEffect(() => {
    const area = workAreaRef.current;
    if (!area) return;
    const observer = new ResizeObserver(() => setUtilityWidth((current) => clamp(current, utilityMin, utilityMaximum())));
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const routeChanged = previousRouteRef.current !== route.route;
    if (settingsRoute || (routeChanged && toolsOpen && utilityView === 'BROWSER')) closeUtility();
    previousRouteRef.current = route.route;
  }, [route.route, settingsRoute, toolsOpen, utilityView]);

  useEffect(() => {
    const updateRoute = (event: Event) => setRoute((event as CustomEvent<RouteState>).detail);
    const openRequestedUtility = (event: Event) => {
      const view = (event as CustomEvent<UtilityView>).detail;
      if (view === 'HOME' || view === 'BROWSER') openUtility(view);
    };
    const closeRequestedUtility = () => closeUtility();
    const updateProjectDock = (event: Event) => setProjectDockOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    const updateProjectFocus = (event: Event) => setProjectDockFocus(Boolean((event as CustomEvent<{ focused?: boolean }>).detail?.focused));
    const updateTerminal = (event: Event) => {
      const detail = (event as CustomEvent<TerminalLayoutState>).detail;
      if (detail && typeof detail.open === 'boolean' && Number.isFinite(detail.height)) setTerminalLayout(detail);
    };
    const closeMenus = (event: PointerEvent) => {
      if (chromeRef.current && !chromeRef.current.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('fielora:route-state', updateRoute);
    window.addEventListener('fielora:open-utility', openRequestedUtility);
    window.addEventListener('fielora:close-utility', closeRequestedUtility);
    window.addEventListener('fielora:workspace-dock-state', updateProjectDock);
    window.addEventListener('fielora:workspace-focus-state', updateProjectFocus);
    window.addEventListener('fielora:terminal-state', updateTerminal);
    window.addEventListener('pointerdown', closeMenus);
    return () => {
      window.removeEventListener('fielora:route-state', updateRoute);
      window.removeEventListener('fielora:open-utility', openRequestedUtility);
      window.removeEventListener('fielora:close-utility', closeRequestedUtility);
      window.removeEventListener('fielora:workspace-dock-state', updateProjectDock);
      window.removeEventListener('fielora:workspace-focus-state', updateProjectFocus);
      window.removeEventListener('fielora:terminal-state', updateTerminal);
      window.removeEventListener('pointerdown', closeMenus);
    };
  });

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'n') { event.preventDefault(); emit('fielora:new-conversation'); return; }
      if (command && event.key.toLowerCase() === 'o') { event.preventDefault(); emit('fielora:add-project'); return; }
      if (command && event.key === ',') { event.preventDefault(); emit('fielora:open-settings', 'GENERAL'); return; }
      if (command && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); return; }
      if (command && event.shiftKey && event.key.toLowerCase() === 'g') { event.preventDefault(); openWorkspace('DIFF'); return; }
      if (command && event.key === '`') { event.preventDefault(); emit('fielora:toggle-terminal'); return; }
      if (command && event.key.toLowerCase() === 'p') { event.preventDefault(); openWorkspace('FILES'); return; }
      if (command && event.key.toLowerCase() === 't' && !(toolsOpen && utilityView === 'BROWSER')) {
        event.preventDefault();
        if (route.route === 'PROJECTS') openWorkspace('BROWSER');
        else openUtility('BROWSER');
        return;
      }
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [route.route, settingsRoute, toolsOpen, utilityView]);

  const menuButton = (id: ChromeMenu, label: string, content: ReactNode) => <div className="chrome-menu-wrap">
    <button className={menu === id ? 'active' : ''} onClick={() => setMenu((current) => current === id ? null : id)}>{label}</button>
    {menu === id && <div className="chrome-menu" role="menu" data-surface="overlay" onClick={() => setMenu(null)}>{content}</div>}
  </div>;

  const layoutStyle = {
    '--utility-panel-width': `${utilityWidth}px`,
    '--desktop-terminal-height': `${terminalLayout.height}px`,
  } as CSSProperties;

  return <div className="desktop-frame" data-surface="canvas" data-testid="desktop-frame">
    <header className="desktop-chrome" ref={chromeRef} data-surface="chrome" data-chrome-plane="window" data-brand-chrome="top" data-testid="desktop-chrome">
      <div className="chrome-leading">
        <button className={sidebarCollapsed ? 'active' : ''} title={shortcutLabel(t('显示或隐藏侧栏 (Ctrl+B)', 'Show or hide sidebar (Ctrl+B)'))} onClick={toggleSidebar} data-testid="chrome-sidebar-toggle"><AppIcon name="sidebar"/></button>
        <button title={t('后退', 'Back')} disabled={!route.canBack} onClick={() => emit('fielora:navigation-back')} data-testid="chrome-back"><AppIcon name="back"/></button>
        <button title={t('前进', 'Forward')} disabled={!route.canForward} onClick={() => emit('fielora:navigation-forward')} data-testid="chrome-forward"><AppIcon name="forward"/></button>
      </div>
      <nav className="chrome-menus" aria-label={t('应用菜单', 'Application menu')}>
        {menuButton('FILE', t('文件', 'File'), <><button role="menuitem" onClick={() => emit('fielora:new-conversation')}><span>{t('新对话', 'New conversation')}</span><kbd>{shortcutLabel("Ctrl+N")}</kbd></button><button role="menuitem" onClick={() => emit('fielora:add-project')}><span>{t('打开文件夹…', 'Open folder…')}</span><kbd>{shortcutLabel("Ctrl+O")}</kbd></button><button role="menuitem" onClick={() => emit('fielora:open-settings', 'GENERAL')}><span>{t('设置', 'Settings')}</span><kbd>{shortcutLabel("Ctrl+,")}</kbd></button></>)}
        {menuButton('EDIT', t('编辑', 'Edit'), <><button role="menuitem" onClick={() => document.execCommand('undo')}><span>{t('撤销', 'Undo')}</span><kbd>{shortcutLabel("Ctrl+Z")}</kbd></button><button role="menuitem" onClick={() => document.execCommand('redo')}><span>{t('重做', 'Redo')}</span><kbd>{shortcutLabel("Ctrl+Y")}</kbd></button><button role="menuitem" onClick={() => document.execCommand('selectAll')}><span>{t('全选', 'Select all')}</span><kbd>{shortcutLabel("Ctrl+A")}</kbd></button></>)}
        {menuButton('VIEW', t('视图', 'View'), <><button role="menuitem" onClick={toggleSidebar}><span>{sidebarCollapsed ? t('显示侧栏', 'Show sidebar') : t('隐藏侧栏', 'Hide sidebar')}</span><kbd>{shortcutLabel("Ctrl+B")}</kbd></button><button role="menuitem" onClick={() => openUtility('HOME')}><span>{t('工作区工具', 'Workspace tools')}</span></button><button role="menuitem" onClick={toggleFocus}><span>{focusMode ? t('退出专注布局', 'Exit focus layout') : t('专注布局', 'Focus layout')}</span></button></>)}
        {menuButton('HELP', t('帮助', 'Help'), <><button role="menuitem" onClick={() => emit('fielora:open-settings', 'SHORTCUTS')}><span>{t('键盘快捷键', 'Keyboard shortcuts')}</span></button><button role="menuitem" onClick={() => emit('fielora:open-settings', 'ABOUT')}><span>{t('关于 Fielora', 'About Fielora')}</span></button></>)}
      </nav>
      <div className="chrome-drag-region" />
    </header>
    <div ref={workAreaRef} className={`desktop-work-area ${toolsOpen ? 'utility-open' : renderTools ? 'utility-closing' : ''} ${focusMode && toolsOpen ? 'utility-focus' : ''} ${terminalLayout.open ? 'terminal-open' : ''} ${settingsRoute ? 'settings-route' : ''}`} style={layoutStyle} data-testid="desktop-work-area" data-surface-context={workspaceControlsVisible ? 'workspace' : 'global'}>
      <div className="desktop-content">{children}</div>
      {renderTools && !settingsRoute && route.route !== 'PROJECTS' && <ResizableDivider label={t('调整右侧工具区宽度', 'Resize right tool area')} value={utilityWidth} min={utilityMin} max={utilityMaximum()} onResize={resizeUtility} onKeyboardResize={resizeUtilityBy} testId="utility-resizer" className="utility-resizer" />}
      {renderTools && !settingsRoute && route.route !== 'PROJECTS' && <aside className={`utility-launcher view-${utilityView.toLowerCase()}`} aria-hidden={!toolsOpen} data-testid="utility-launcher">
        <header><div>{utilityView !== 'HOME' && <button className="utility-back" aria-label={t('返回工具列表', 'Back to tools')} onClick={() => setUtilityView('HOME')}>←</button>}<strong>{utilityView === 'BROWSER' ? t('浏览器', 'Browser') : t('工作区工具', 'Workspace tools')}</strong></div></header>
        {utilityView === 'BROWSER' ? <BrowsePanel browser={window.fielora.browser} onSaveToLibrary={(input) => window.fielora.library.saveWeb(input)} onOpenBrowserSettings={() => emit('fielora:open-settings', 'BROWSER')} /> : <>
          <nav>
            <button onClick={() => openWorkspace('DIFF')} data-testid="utility-review"><AppIcon name="diff"/><span>{t('审阅', 'Review')}</span><kbd>{shortcutLabel("Ctrl+Shift+G")}</kbd></button>
            <button onClick={() => setUtilityView('BROWSER')} data-testid="utility-browser"><AppIcon name="browse"/><span>{t('浏览器', 'Browser')}</span><kbd>{shortcutLabel("Ctrl+T")}</kbd></button>
            <button onClick={() => openWorkspace('FILES')} data-testid="utility-files"><AppIcon name="folder"/><span>{t('文件', 'Files')}</span><kbd>{shortcutLabel("Ctrl+P")}</kbd></button>
          </nav>
          <p>{t('拖动左侧分隔线调整工具区宽度。', 'Drag the left divider to resize the tool area.')}</p>
        </>}
      </aside>}
      {/* Keep the portal host mounted while App and Chrome publish route changes independently. */}
      <aside className="project-context-controls" hidden={route.route !== 'PROJECTS'} aria-label={t('Project 控制', 'Project controls')} data-testid="project-context-controls"><div id="desktop-project-actions-layer" className="desktop-project-actions-layer" data-testid="desktop-project-actions-layer" /></aside>
      {!settingsRoute && workspaceControlsVisible && <aside className={`utility-control-dock ${toolsOpen || projectDockOpen ? 'in-utility' : 'floating'}`} aria-label={t('工作区控制', 'Workspace controls')} data-testid="utility-rail">
        {(toolsOpen || projectDockOpen) && <ToolbarAction active={route.route === 'PROJECTS' ? projectDockFocus : focusMode} label={(route.route === 'PROJECTS' ? projectDockFocus : focusMode) ? t('恢复左右工作区', 'Restore split workspace') : t('扩展右侧工具区', 'Expand right tool area')} icon={<AppIcon name={(route.route === 'PROJECTS' ? projectDockFocus : focusMode) ? 'unfocus' : 'focus'}/>} onClick={() => route.route === 'PROJECTS' ? emit('fielora:toggle-workspace-focus') : toggleFocus()} testId="rail-focus" />}
        {route.route === 'PROJECTS' && <ToolbarAction active={terminalLayout.open} label={terminalLayout.open ? t('关闭底部终端', 'Close bottom terminal') : t('打开底部终端', 'Open bottom terminal')} icon={<AppIcon name="terminalPanel"/>} onClick={() => emit('fielora:toggle-terminal')} testId="rail-terminal" />}
        <ToolbarAction active={route.route === 'PROJECTS' ? projectDockOpen : toolsOpen} label={(route.route === 'PROJECTS' ? projectDockOpen : toolsOpen) ? t('收起右侧工具区', 'Collapse right tool area') : t('展开右侧工具区', 'Expand right tool area')} icon={<AppIcon name="panelRight"/>} onClick={() => route.route === 'PROJECTS' ? (projectDockOpen ? emit('fielora:close-workspace-dock') : emit('fielora:open-workspace-launcher')) : (toolsOpen ? closeUtility() : openUtility('HOME'))} testId="chrome-tools" />
      </aside>}
      <div id="desktop-terminal-layer" className="desktop-terminal-layer" data-testid="desktop-terminal-layer" />
    </div>
  </div>;
}
