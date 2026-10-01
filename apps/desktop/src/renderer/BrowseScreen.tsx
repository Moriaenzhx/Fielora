import { shortcutLabel } from './platform';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toBrowserUserMessage } from '../browser-policy';
import type { BrowserPageState } from '../browser-types';
import type { FieloraBridge } from '../types';
import { PrimaryNav } from './PrimaryNav';
import { Tab, TabStrip } from './UiPrimitives';
import { AppIcon } from './ui';

const EMPTY_BROWSER: BrowserPageState = {
  active_page_id: '',
  pages: [],
  url: '',
  title: '新页面',
  favicon_data_url: null,
  can_go_back: false,
  can_go_forward: false,
  is_loading: false,
  error: null,
  surface: {
    app_view: 'NOT_BROWSE',
    attached: false,
    visible: false,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  },
};

interface BrowseScreenProps {
  browser: FieloraBridge['browser'];
  onSaveToLibrary: FieloraBridge['library']['saveWeb'];
  onOpenBrowserSettings: () => void;
  onProjects: () => void;
  onNow: () => void;
  onFields: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
}

interface BrowsePanelProps extends Pick<BrowseScreenProps, 'browser' | 'onSaveToLibrary' | 'onOpenBrowserSettings'> {
  workspaceTabHostId?: string;
  workspaceActive?: boolean;
  onRequestWorkspaceActivate?: () => void;
  onRequestWorkspaceClose?: () => void;
}

export function BrowsePanel({ browser, onSaveToLibrary, onOpenBrowserSettings, workspaceTabHostId, workspaceActive = false, onRequestWorkspaceActivate, onRequestWorkspaceClose }: BrowsePanelProps) {
  const [page, setPage] = useState<BrowserPageState>(EMPTY_BROWSER);
  const [address, setAddress] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceTabHost, setWorkspaceTabHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const editingAddress = useRef(false);
  const activePageIdRef = useRef('');
  const nativeViewVisibleRef = useRef(false);

  useLayoutEffect(() => {
    setWorkspaceTabHost(workspaceTabHostId ? document.getElementById(workspaceTabHostId) : null);
  }, [workspaceTabHostId]);

  useEffect(() => {
    void browser.getState().then((state) => {
      activePageIdRef.current = state.active_page_id;
      setPage(state);
      setAddress(state.url);
    }).catch((reason) => setActionError(toBrowserUserMessage(reason)));
    return browser.subscribe((state) => {
      activePageIdRef.current = state.active_page_id;
      setPage(state);
      if (!editingAddress.current) setAddress(state.url);
    });
  }, [browser]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hideNativeView = () => {
      if (!nativeViewVisibleRef.current) return;
      nativeViewVisibleRef.current = false;
      void browser.hide();
    };
    if (menuOpen || host.closest('[hidden]') || (workspaceTabHostId && !workspaceActive)) {
      hideNativeView();
      return;
    }
    let settleTimer = 0;
    let disposed = false;
    let showInFlight = false;
    let queuedBounds: BrowserPageState['surface']['bounds'] | null = null;
    let lastRequestedBounds = '';
    const flushBounds = () => {
      if (disposed || showInFlight || !queuedBounds) return;
      const bounds = queuedBounds;
      queuedBounds = null;
      showInFlight = true;
      nativeViewVisibleRef.current = true;
      void browser.show(bounds).catch((reason) => {
        if (!disposed) setActionError(toBrowserUserMessage(reason));
      }).finally(() => {
        showInFlight = false;
        flushBounds();
      });
    };
    const syncBounds = () => {
      if (host.closest('[hidden]')) {
        hideNativeView();
        return;
      }
      const rect = host.getBoundingClientRect();
      const bounds = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      };
      const boundsKey = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (boundsKey === lastRequestedBounds) return;
      lastRequestedBounds = boundsKey;
      queuedBounds = bounds;
      flushBounds();
    };
    const syncAfterWindowResize = () => {
      syncBounds();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(syncBounds, 50);
    };
    const transitionHost = host.closest<HTMLElement>('.project-layout, .utility-launcher');
    // Dock opening uses ancestor transforms: the viewport's size stays constant,
    // so ResizeObserver alone misses its movement from outside the window.
    const settleUntil = performance.now() + 600;
    let transitionFrame: number | null = null;
    const syncTransitionFrame = () => {
      syncBounds();
      if (performance.now() < settleUntil || transitionHost?.getAnimations().some((animation) => animation.playState === 'running')) {
        transitionFrame = window.requestAnimationFrame(syncTransitionFrame);
        return;
      }
      transitionFrame = null;
      syncBounds();
    };
    const beginTransitionSync = () => {
      if (transitionFrame === null) transitionFrame = window.requestAnimationFrame(syncTransitionFrame);
    };
    const finishTransitionSync = () => {
      if (transitionFrame !== null) window.cancelAnimationFrame(transitionFrame);
      transitionFrame = null;
      syncBounds();
    };
    const observer = new window.ResizeObserver(syncBounds);
    observer.observe(host);
    window.addEventListener('resize', syncAfterWindowResize);
    transitionHost?.addEventListener('transitionrun', beginTransitionSync);
    transitionHost?.addEventListener('transitionend', finishTransitionSync);
    transitionHost?.addEventListener('transitioncancel', finishTransitionSync);
    beginTransitionSync();
    syncBounds();
    return () => {
      disposed = true;
      queuedBounds = null;
      observer.disconnect();
      if (transitionFrame !== null) window.cancelAnimationFrame(transitionFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', syncAfterWindowResize);
      transitionHost?.removeEventListener('transitionrun', beginTransitionSync);
      transitionHost?.removeEventListener('transitionend', finishTransitionSync);
      transitionHost?.removeEventListener('transitioncancel', finishTransitionSync);
      hideNativeView();
    };
  }, [browser, menuOpen, workspaceActive, workspaceTabHostId]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void browser.reload();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') {
        event.preventDefault();
        void createPage();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        void closePage(activePageIdRef.current);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [browser]);

  async function navigate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError('');
    editingAddress.current = false;
    try {
      const state = await browser.navigate({ url: address });
      setPage(state);
      setAddress(state.url);
    } catch (reason) {
      setActionError(toBrowserUserMessage(reason));
    }
  }

  async function act(action: () => Promise<BrowserPageState>) {
    setActionError('');
    try { setPage(await action()); }
    catch (reason) { setActionError(toBrowserUserMessage(reason)); }
  }

  async function saveToLibrary() {
    setMenuOpen(false);
    setActionError(''); setActionStatus('');
    try {
      await onSaveToLibrary({ url: page.url, title: page.title || page.url, source: 'BROWSER', selected_content: null, metadata: { version: 1 } });
      setActionStatus('已保存到资料库');
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function createPage() {
    editingAddress.current = false;
    setActionError('');
    try {
      const state = await browser.createPage();
      setPage(state);
      setAddress(state.url);
      window.requestAnimationFrame(() => addressRef.current?.focus());
    } catch (reason) {
      setActionError(toBrowserUserMessage(reason));
    }
  }

  async function switchPage(pageId: string) {
    editingAddress.current = false;
    setActionError('');
    try {
      const state = await browser.switchPage({ page_id: pageId });
      setPage(state);
      setAddress(state.url);
    } catch (reason) {
      setActionError(toBrowserUserMessage(reason));
    }
  }

  async function closePage(pageId: string) {
    if (!pageId) return;
    editingAddress.current = false;
    setActionError('');
    try {
      const state = await browser.closePage({ page_id: pageId });
      setPage(state);
      setAddress(state.url);
      if (!state.url) window.requestAnimationFrame(() => addressRef.current?.focus());
    } catch (reason) {
      setActionError(toBrowserUserMessage(reason));
    }
  }

  const pageTabs = page.pages.length > 0
    ? page.pages.map((item) => <Tab
        className="right-dock-tab browser-workspace-page"
        mainClassName="right-dock-tab-main"
        closeClassName="right-dock-tab-close"
        labelClassName="browser-page-label"
        key={item.id}
        data-loading={item.is_loading ? 'true' : 'false'}
        onContextMenu={(event) => { event.preventDefault(); void act(() => browser.showPageContextMenu({ page_id: item.id })); }}
        label={item.title || '新页面'}
        active={workspaceActive && item.id === page.active_page_id}
        onActivate={() => { onRequestWorkspaceActivate?.(); void switchPage(item.id); }}
        onClose={() => void closePage(item.id)}
        testId={item.id === page.active_page_id ? 'right-dock-tab-browser' : `browser-workspace-page-${item.id}`}
        closeTestId={`browser-close-page-${item.id}`}
        closeLabel={`关闭 ${item.title || '新页面'}`}
        data-tab-id={`browser:${item.id}`}
        leading={<span className="browser-page-visual" aria-hidden="true">
          {item.is_loading
            ? <span className="browser-page-loader" />
            : item.favicon_data_url
              ? <img src={item.favicon_data_url} alt="" />
              : <span className="browser-page-fallback" />}
        </span>}
      />)
    : [<Tab
        key="browser-empty"
        className="right-dock-tab browser-workspace-page"
        mainClassName="right-dock-tab-main"
        closeClassName="right-dock-tab-close"
        label="新页面"
        leading={<AppIcon name="browse"/>}
        active={workspaceActive}
        onActivate={() => { onRequestWorkspaceActivate?.(); window.requestAnimationFrame(() => addressRef.current?.focus()); }}
        onClose={() => onRequestWorkspaceClose?.()}
        testId="right-dock-tab-browser"
        closeTestId="right-dock-close-browser"
        closeLabel="关闭浏览器"
        data-tab-id="browser"
      />];

  return <div className="browse-panel" data-testid="browse-screen">
    {workspaceTabHost && createPortal(pageTabs, workspaceTabHost, 'browser-workspace-pages')}
    <main className={`browse-content${workspaceTabHostId ? ' browser-tabs-in-workspace' : ''}`}>
      {!workspaceTabHostId && <div className="browser-page-strip">
        <TabStrip className="browser-pages" label="Browse 页面">
          {page.pages.map((item) => <Tab
            className="browser-page"
            mainClassName="browser-page-main"
            closeClassName="browser-page-close"
            labelClassName="browser-page-label"
            key={item.id}
            data-loading={item.is_loading ? 'true' : 'false'}
            onContextMenu={(event) => { event.preventDefault(); void act(() => browser.showPageContextMenu({ page_id: item.id })); }}
            label={item.title || '新页面'}
            active={item.id === page.active_page_id}
            onActivate={() => void switchPage(item.id)}
            onClose={() => void closePage(item.id)}
            testId={`browser-page-${item.id}`}
            closeTestId={`browser-close-page-${item.id}`}
            closeLabel={`关闭 ${item.title || '新页面'}`}
            leading={<span className="browser-page-visual" aria-hidden="true">
                {item.is_loading
                  ? <span className="browser-page-loader" />
                  : item.favicon_data_url
                    ? <img src={item.favicon_data_url} alt="" />
                    : <span className="browser-page-fallback" />}
              </span>}
          />)}
        </TabStrip>
        <button className="browser-new-page" aria-label="新建页面" title={shortcutLabel("新建页面 (Ctrl+T)")} onClick={() => void createPage()} data-testid="browser-new-page"><AppIcon name="plus"/></button>
      </div>}
      <div className="browser-toolbar">
        <div className="browser-actions" aria-label="页面导航">
          <button aria-label="后退" data-testid="browser-back" disabled={!page.can_go_back} onClick={() => void act(() => browser.back())}><AppIcon name="back"/></button>
          <button aria-label="前进" data-testid="browser-forward" disabled={!page.can_go_forward} onClick={() => void act(() => browser.forward())}><AppIcon name="forward"/></button>
          <button
            aria-label="刷新"
            aria-busy={page.is_loading}
            title={shortcutLabel("刷新 (Ctrl+R)")}
            data-testid="browser-reload"
            disabled={!page.url}
            onClick={() => void act(() => browser.reload())}
          ><AppIcon name="refresh"/></button>
        </div>
        <form className="address-form" onSubmit={navigate}>
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => { editingAddress.current = true; setAddress(event.target.value); }}
            onFocus={() => { editingAddress.current = true; }}
            onBlur={() => { editingAddress.current = false; if (!address.trim()) setAddress(page.url); }}
            aria-label="网址"
            placeholder="输入网址，例如 example.com"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="browser-address"
          />
        </form>
        <div className="browser-toolbar-end" ref={menuRef}>
          <span className="page-title" title={page.title}>{page.title}</span>
          <button className="browser-overflow-button" type="button" aria-label="浏览器菜单" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)} data-testid="browser-overflow"><AppIcon name="more"/></button>
          {menuOpen && <div className="browser-overflow-menu" role="menu" aria-label="浏览器菜单" data-surface="overlay" data-testid="browser-overflow-menu">
            <div className="browser-menu-group">
              <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); void createPage(); }}><span>新建标签页</span><kbd>{shortcutLabel("Ctrl+T")}</kbd></button>
              <button role="menuitem" type="button" disabled={!/^https?:\/\//u.test(page.url)} onClick={() => void saveToLibrary()} data-testid="browser-save-library"><span>保存到资料库</span></button>
            </div>
            <div className="browser-menu-group">
              <button role="menuitem" type="button" disabled={!page.url} onClick={() => { setMenuOpen(false); void act(() => browser.reload()); }}><span>刷新页面</span><kbd>{shortcutLabel("Ctrl+R")}</kbd></button>
              <button role="menuitem" type="button" disabled={!page.active_page_id} onClick={() => { setMenuOpen(false); void closePage(page.active_page_id); }}><span>关闭标签页</span><kbd>{shortcutLabel("Ctrl+W")}</kbd></button>
            </div>
            <div className="browser-menu-group browser-menu-settings">
              <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onOpenBrowserSettings(); }} data-testid="browser-open-settings"><span>浏览器设置</span></button>
            </div>
          </div>}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{page.is_loading ? '网页正在加载' : ''}</span>
        {page.is_loading && <div className="browser-loading" role="progressbar" aria-label="网页正在加载" data-testid="browser-loading"><span /></div>}
      </div>
      {(actionError || page.error) && <div className="browser-error" role="status" data-testid="browser-error">{actionError || toBrowserUserMessage(page.error)}</div>}
      {actionStatus && <div className="browser-status" role="status">{actionStatus}</div>}
      <div className="browse-viewport" ref={hostRef} data-testid="browse-viewport" aria-busy={page.is_loading}>
        {!page.url && <div className="browse-empty"><AppIcon name="browse"/><h2>开始浏览</h2><p>输入 URL 以打开页面</p></div>}
      </div>
    </main>
  </div>;
}

export function BrowseScreen({ browser, onSaveToLibrary, onOpenBrowserSettings, onProjects, onNow, onFields, onNewConversation, onSettings }: BrowseScreenProps) {
  return <div className="shell browse-shell">
    <PrimaryNav active="BROWSE" onProjects={onProjects} onNow={onNow} onBrowse={() => undefined} onFields={onFields} onNewConversation={onNewConversation} onSettings={onSettings} />
    <BrowsePanel browser={browser} onSaveToLibrary={onSaveToLibrary} onOpenBrowserSettings={onOpenBrowserSettings} />
  </div>;
}
