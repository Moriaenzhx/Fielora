import { randomUUID } from 'node:crypto';
import { browserAgentDom } from './browser-agent-dom';
import { dispatchBrowserClick } from './browser-agent-input';
import { BrowserWindow, Menu, WebContentsView, clipboard, nativeImage, session } from 'electron';
import type { ContextMenuParams, MenuItemConstructorOptions, Session, WebContents } from 'electron';
import {
  allowedWindowOpenTarget,
  browserNavigationInitiatorForDocument,
  fitBrowserBounds,
  isAllowedBrowseNavigation,
  normalizeBrowserAddress,
} from './browser-policy';
import type { BrowserNavigationInitiator } from './browser-policy';
import { UNTRUSTED_WEB_PREFERENCES } from './browser-security';
import { assertCaptureIdentityCurrent, assertScreenshotBounds, waitForBoundedCapture, type BrowserCaptureGuardOptions } from './browser-capture';
import type { BrowserPage, BrowserPageState, BrowserViewBounds, BrowserViewportCapture } from './browser-types';

interface RuntimePage {
  agentViewport?: { width: number; height: number };
  appliedEmulation?: { key: string; scale: number };
  state: BrowserPage;
  view?: WebContentsView;
  committedUrl: string;
  navigationGeneration: number;
  mainFrameError?: string;
  pendingNavigation?: {
    target: string;
    initiator: BrowserNavigationInitiator;
  };
  directNavigation?: {
    target: string;
    initiator: BrowserNavigationInitiator;
  };
}

const MAX_FAVICON_BYTES = 64 * 1024;
const ALLOWED_FAVICON_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
]);

export class BrowserRuntime {
  private readonly agentPages = new Map<string, { pageId?: string; viewport?: { width: number; height: number } }>();
  private readonly agentSnapshots = new Map<string, { id: string; generation: number; url: string }>();

  async executeAgent(runId: string, args: Parameters<typeof browserAgentDom>[0] & { url?: string; width?: number; height?: number }, signal: AbortSignal): Promise<Record<string, unknown>> {
    const execution = { inputState: 'NOT_DISPATCHED' };
    try { return await this.executeAgentOperation(runId, args, signal, execution); }
    catch (error) {
      const code = error instanceof Error && /^BROWSER_[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_OPERATION_FAILED';
      const unknown = execution.inputState === 'DISPATCHING';
      const page = this.pages.get(this.agentPages.get(runId)?.pageId ?? '');
      const state = page ? this.agentReadiness(page) : { page_present: false };
      const navigationFailure = code === 'BROWSER_NAVIGATION_FAILED';
      return { success: false, error_code: code, input_state: execution.inputState, outcome_unknown: unknown,
        readiness: state, ...(page ? { page_id: page.state.id, requested_url: args.url ?? page.state.url,
          committed_url: page.committedUrl || null, navigation_generation: page.navigationGeneration } : {}),
        ...(navigationFailure ? { network_error: page?.mainFrameError ?? 'NAVIGATION_UNCOMMITTED', page_loaded: false, content_state: 'UNAVAILABLE' } : {}),
        observation_required: execution.inputState === 'DISPATCHED',
        guidance: code === 'BROWSER_SURFACE_NOT_READY'
          ? 'The native browser surface is hidden or has no usable bounds; this does not establish a network failure. Reveal this run\'s browser panel, then inspect before input or screenshot verification. A read-only inspect can still observe a committed document.'
          : navigationFailure
            ? 'No successful target document is available. Use the recorded URL and network_error to diagnose this navigation; this does not prove every source or route is unavailable. For a local URL check its server; for a remote URL inspect that address/network response. Do not infer login or ask for a source already present in the task.'
          : code === 'BROWSER_DOCUMENT_LOADING'
            ? 'The document did not finish loading within the bounded wait. Inspect this same page for current status before opening it again; this does not establish that the website is unreachable.'
          : code === 'BROWSER_PAGE_NOT_ACTIVE' || code === 'BROWSER_PAGE_UNAVAILABLE'
            ? 'This run\'s page is closed or no longer active. Reopen the recorded target for this run; do not use another run\'s page or infer network failure.'
          : execution.inputState === 'NOT_DISPATCHED'
          ? 'No requested input was dispatched. Inspect the page for fresh refs and current navigation before acting.'
          : 'Do not repeat the input. Inspect the current page to determine its result; input delivery is not task verification.' };
    }
  }

  private async executeAgentOperation(runId: string, args: Parameters<typeof browserAgentDom>[0] & { url?: string; width?: number; height?: number }, signal: AbortSignal, execution: { inputState: string }): Promise<Record<string, unknown>> {
    const live = () => { if (signal.aborted) throw new Error('BROWSER_CANCELLED'); };
    live();
    const binding = this.agentPages.get(runId) ?? {};
    let page = this.pages.get(binding.pageId ?? '');
    if (args.action === 'resize') {
      if (!Number.isInteger(args.width) || !Number.isInteger(args.height) || args.width! < 640 || args.width! > 2560 || args.height! < 480 || args.height! > 1600) throw new Error('BROWSER_INVALID_VIEWPORT');
      // A viewport preference does not create a page or disturb another run's
      // visible document. Open creates the run's page through the normal path.
      binding.viewport = { width: args.width!, height: args.height! };
      this.agentPages.set(runId, binding);
      if (page) page.agentViewport = binding.viewport;
      this.agentSnapshots.delete(runId);
      if (!page?.view || page.view.webContents.isDestroyed() || this.activePageId !== page.state.id || !this.requestedVisible) {
        return { success: true, ...(page ? { page_id: page.state.id } : {}), page_loaded: false, viewport_requested: binding.viewport,
          pending_next_open: true, observation_state: 'CONFIGURED_ONLY', verification_eligible: false,
          guidance: 'Viewport configured for this run. Open the observed project URL next; no document has been observed or verified by this configuration.' };
      }
    }
    if (args.action === 'open') {
      const url = new URL(args.url!);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('BROWSER_URL_REJECTED');
      if (!page) { page = this.addPage(); binding.pageId = page.state.id; this.agentPages.set(runId, binding); }
      page.agentViewport = binding.viewport;
      this.activePageId = page.state.id;
      this.agentSnapshots.delete(runId);
      this.layout('agent-open');
      // Attach the native page after the dock has reached its actual position.
      // Attaching at zero width during the opening transform can leave Chromium
      // without a composited surface even though DOM queries already work.
      const opening = Date.now();
      let previousBounds = '';
      let stableSince = Date.now();
      while (Date.now() - opening < 2000) {
        live();
        const bounds = this.requestedBounds ? fitBrowserBounds(this.requestedBounds, this.host.contentView.getBounds()) : null;
        const key = JSON.stringify(bounds);
        if (key !== previousBounds) { previousBounds = key; stableSince = Date.now(); }
        if (this.requestedVisible && bounds && bounds.width > 0 && bounds.height > 0 && Date.now() - stableSince >= 160) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      // Navigation is a bounded, cancellable observation. A slow response must
      // not prevent the Host from returning a diagnostic before its deadline.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: () => void = () => {};
      try {
        await Promise.race([
          this.loadTarget(page, url.href, 'USER'),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error('BROWSER_CANCELLED'));
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
            timer = setTimeout(() => reject(new Error('BROWSER_DOCUMENT_LOADING')), 12_000);
          }),
        ]);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
      this.layout('agent-open');
      if (this.agentSurfaceReady(page)) page.view?.webContents.focus();
    }
    if (!page?.view || page.view.webContents.isDestroyed() || this.activePageId !== page.state.id) throw new Error('BROWSER_PAGE_NOT_ACTIVE');
    const current = page;
    const contents = page.view.webContents;
    if (args.action === 'reload') { this.agentSnapshots.delete(runId); this.reloadPage(page); }
    const started = Date.now();
    const needsSurface = !['open', 'inspect', 'reload'].includes(args.action);
    while (current.state.is_loading || (needsSurface && !this.agentSurfaceReady(current))) {
      live();
      if (!this.isLivePage(current) || contents.isDestroyed()) throw new Error('BROWSER_PAGE_UNAVAILABLE');
      if (this.activePageId !== current.state.id) throw new Error('BROWSER_PAGE_NOT_ACTIVE');
      if (current.mainFrameError) throw new Error('BROWSER_NAVIGATION_FAILED');
      if (Date.now() - started > 12_000) throw new Error(current.state.is_loading ? 'BROWSER_DOCUMENT_LOADING' : 'BROWSER_SURFACE_NOT_READY');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    // loadURL may resolve before did-stop-loading. Apply a preconfigured
    // viewport only now, when Chromium has a committed live RenderWidget.
    if (['open', 'reload', 'resize'].includes(args.action)) {
      this.layout('agent-ready-viewport');
      if (this.agentSurfaceReady(current)) contents.focus();
    }
    live();
    let generation = current.navigationGeneration;
    let url = contents.getURL();
    if (current.mainFrameError || !current.committedUrl || generation === 0) {
      this.agentSnapshots.delete(runId);
      throw new Error('BROWSER_NAVIGATION_FAILED');
    }
    if (!/^https?:\/\//.test(url)) throw new Error('BROWSER_URL_REJECTED');
    const assertCurrent = () => {
      live();
      if (!this.isLivePage(current) || contents.isDestroyed() || this.activePageId !== current.state.id || current.navigationGeneration !== generation || contents.getURL() !== url) throw new Error('BROWSER_STALE_PAGE');
    };
    if (!['open', 'inspect', 'reload', 'screenshot', 'resize'].includes(args.action)) {
      const snapshot = this.agentSnapshots.get(runId);
      if (!snapshot || snapshot.id !== args.snapshot_id || snapshot.generation !== generation || snapshot.url !== url) throw new Error('BROWSER_STALE_SNAPSHOT');
    }
    const inspect = async (action: string) => {
      assertCurrent();
      const input = { ...args, action, next_snapshot_id: randomUUID() };
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (['fill', 'select'].includes(action)) {
        this.agentSnapshots.delete(runId);
        execution.inputState = 'DISPATCHING';
      }
      const result = await Promise.race([
        contents.executeJavaScriptInIsolatedWorld(1004, [{ code: `(${browserAgentDom.toString()})(${JSON.stringify(input)})` }], false),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('BROWSER_OPERATION_UNKNOWN')), 5000); }),
      ]).finally(() => clearTimeout(timer)) as Record<string, unknown>;
      if (typeof result.input_state === 'string') execution.inputState = result.input_state;
      assertCurrent();
      if (typeof result.snapshot_id === 'string') this.agentSnapshots.set(runId, { id: result.snapshot_id, generation, url });
      return result;
    };
    const readOnly = ['open', 'inspect', 'reload', 'screenshot', 'resize'].includes(args.action);
    let result: Record<string, unknown>;
    if (readOnly) {
      // A document's load event precedes many SPA routes/forms. Observe the
      // rendered state for a bounded settling interval, without replaying any
      // click/fill/verify. A route change invalidates the previous sample.
      const observing = Date.now();
      let previous = ''; let stableSince = observing;
      for (;;) {
        live();
        generation = current.navigationGeneration; url = contents.getURL();
        if (current.mainFrameError || !/^https?:\/\//.test(url)) throw new Error('BROWSER_NAVIGATION_FAILED');
        try { result = await inspect('inspect'); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'BROWSER_STALE_PAGE' || Date.now() - observing >= 4000) throw error;
          previous = ''; stableSince = Date.now();
          await new Promise(resolve => setTimeout(resolve, 100)); continue;
        }
        const state = JSON.stringify([url, generation, result.content_state, result.has_password_input, result.text, result.elements]);
        if (state !== previous) { previous = state; stableSince = Date.now(); }
        const settled = result.content_state === 'PRESENT' && !current.state.is_loading
          && Date.now() - stableSince >= 300 && Date.now() - observing >= 800;
        if (settled || Date.now() - observing >= 4000) {
          result.observation_state = settled ? 'SETTLED' : 'BOUNDED_WAIT_EXPIRED'; break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else result = await inspect(args.action);
    const scrolledDuringPreflight = result.scroll_performed === true;
    if (args.action === 'click' && result.success !== false) {
      // PNG capture is observation, not an input capability. Chromium can accept
      // targeted input while its display surface is unavailable for screenshots.
      // Recheck the current document and native hit point before acknowledged
      // input; subsequent observation/verification establishes the actual result.
      assertCurrent();
      result = await inspect('click');
    }
    if (args.action === 'click' && result.success !== false) {
      const point = result.click as { x: number; y: number };
      assertCurrent();
      this.agentSnapshots.delete(runId);
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('BROWSER_INVALID_POINT');
      // Electron desktop emulation scales the native input surface. DOM refs
      // remain in the requested CSS viewport; CDP input addresses that surface.
      const scale = current.appliedEmulation?.scale ?? 1;
      const nativePoint = { x: point.x * scale, y: point.y * scale };
      // Fixed Chromium input commands target this WebContentsView directly and
      // acknowledge each event. Never expose the debugger or arbitrary CDP to a
      // model/page, and never detach a debugger owned by another caller.
      const attachedHere = !contents.debugger.isAttached();
      if (attachedHere) contents.debugger.attach('1.3');
      try {
        const dispatched = await dispatchBrowserClick(execution,
          async type => {
            assertCurrent();
            await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
              type: { mouseMove: 'mouseMoved', mouseDown: 'mousePressed', mouseUp: 'mouseReleased' }[type],
              button: type === 'mouseMove' ? 'none' : 'left', clickCount: type === 'mouseMove' ? 0 : 1, ...nativePoint,
            });
          },
          async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
            return this.executeAgent(runId, { action: 'inspect', next_snapshot_id: '' }, signal);
          });
        return { ...dispatched, click_point: point, native_input_point: nativePoint, scroll_performed: scrolledDuringPreflight || result.scroll_performed === true };
      } finally {
        if (attachedHere && !contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
      }
    }
    const surfaceReady = this.agentSurfaceReady(current);
    return { ...result, page_loaded: true, page_id: current.state.id, navigation_generation: generation, url, title: current.state.title,
      readiness: this.agentReadiness(current), interaction_ready: surfaceReady,
      ...(!surfaceReady ? { verification_eligible: false,
        observation_note: [result.observation_note, 'The committed document was observed while its native surface was hidden or had no usable bounds. This is not screenshot or interaction evidence. Reveal this run\'s browser panel before input and obtain a fresh inspect.'].filter(Boolean).join(' ') } : {}) };
  }

  private agentSurfaceReady(page: RuntimePage): boolean {
    const bounds = page.view?.getBounds();
    return this.requestedVisible && this.visiblePageId === page.state.id
      && Boolean(bounds && bounds.width > 0 && bounds.height > 0);
  }

  private agentReadiness(page: RuntimePage): Record<string, unknown> {
    const live = this.isLivePage(page) && !!page.view && !page.view.webContents.isDestroyed();
    const bounds = live ? page.view!.getBounds() : undefined;
    return { page_present: live, active: this.activePageId === page.state.id,
      document_committed: !!page.committedUrl && page.navigationGeneration > 0,
      document_loading: page.state.is_loading, navigation_failed: !!page.mainFrameError,
      surface_requested: this.requestedVisible, surface_ready: live && this.agentSurfaceReady(page),
      ...(bounds ? { viewport_bounds: { width: bounds.width, height: bounds.height } } : {}) };
  }
  private readonly pages = new Map<string, RuntimePage>();
  private pageOrder: string[] = [];
  private activePageId = '';
  private requestedBounds: BrowserViewBounds | undefined;
  private requestedVisible = false;
  private visiblePageId: string | undefined;
  private readonly browseSession: Session;
  private lastDiagnostic = '';
  private hostResizeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly handleHostResize = () => {
    if (this.hostResizeTimer) clearTimeout(this.hostResizeTimer);
    this.hostResizeTimer = setTimeout(() => {
      this.hostResizeTimer = undefined;
      this.layout('window-resize-settled');
    }, 75);
  };

  constructor(
    private readonly host: BrowserWindow,
    private readonly publish: (state: BrowserPageState) => void,
    private readonly diagnosticsEnabled = false,
  ) {
    this.browseSession = session.fromPartition('persist:fielora-browse');
    this.browseSession.setPermissionCheckHandler(() => false);
    this.browseSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.browseSession.setDevicePermissionHandler(() => false);
    this.browseSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    this.browseSession.webRequest.onBeforeRequest((details, callback) => {
      const targetProtocol = protocolOf(details.url);
      if (targetProtocol !== 'file:' && targetProtocol !== 'fielora:') {
        callback({});
        return;
      }
      const page = this.pageForWebContents(details.webContents, details.webContentsId);
      const initiator = page
        ? this.navigationInitiator(page, details.url, details.frame?.url || details.referrer, details.resourceType === 'mainFrame')
        : 'OPAQUE_PAGE';
      const allowed = isAllowedBrowseNavigation(details.url, initiator);
      if (this.diagnosticsEnabled) {
        console.info(`[browse-security:request] target=${targetProtocol} resource=${details.resourceType} page=${page ? page.state.id : '(unknown)'} initiator=${initiator} decision=${allowed ? 'allow' : 'deny'}`);
      }
      callback({ cancel: !allowed });
    });
    const initialPage = this.addPage();
    this.activePageId = initialPage.state.id;
    this.host.on('resize', this.handleHostResize);
  }

  getState(): BrowserPageState {
    const active = this.activePage?.state;
    return {
      active_page_id: active?.id ?? '',
      pages: this.pageOrder.map((pageId) => ({ ...this.requirePage(pageId).state })),
      url: active?.url ?? '',
      title: active?.title ?? '',
      favicon_data_url: active?.favicon_data_url ?? null,
      can_go_back: active?.can_go_back ?? false,
      can_go_forward: active?.can_go_forward ?? false,
      is_loading: active?.is_loading ?? false,
      error: active?.error ?? null,
      surface: this.surfaceState(),
    };
  }

  show(bounds: BrowserViewBounds): BrowserPageState {
    this.requestedVisible = true;
    this.requestedBounds = bounds;
    this.layout('show');
    return this.getState();
  }

  hide(): BrowserPageState {
    this.requestedVisible = false;
    this.layout('hide');
    return this.getState();
  }

  createPage(): BrowserPageState {
    const page = this.addPage();
    this.activePageId = page.state.id;
    this.layout('create-page');
    return this.getState();
  }

  switchPage(pageId: string): BrowserPageState {
    this.requirePage(pageId);
    this.activePageId = pageId;
    this.layout('switch-page');
    return this.getState();
  }

  closePage(pageId: string): BrowserPageState {
    const page = this.requirePage(pageId);
    const closingIndex = this.pageOrder.indexOf(pageId);
    const wasActive = pageId === this.activePageId;
    this.pages.delete(pageId);
    this.pageOrder = this.pageOrder.filter((candidate) => candidate !== pageId);
    this.destroyPageView(page);

    if (this.pageOrder.length === 0) {
      this.activePageId = '';
    } else if (wasActive) {
      this.activePageId = this.pageOrder[Math.min(closingIndex, this.pageOrder.length - 1)]!;
    }

    this.layout('close-page');
    return this.getState();
  }

  showPageContextMenu(pageId: string): BrowserPageState {
    const page = this.requirePage(pageId);
    const contents = page.view?.webContents;
    const template: MenuItemConstructorOptions[] = [];
    if (contents && !contents.isDestroyed() && page.state.url) {
      template.push({ label: '重新加载', accelerator: 'Ctrl+R', click: () => this.reloadPage(page) });
      template.push({ label: '复制页面地址', click: () => clipboard.writeText(page.state.url) });
      template.push({ type: 'separator' });
    }
    template.push({ label: '关闭页面', accelerator: 'Ctrl+W', click: () => { if (this.isLivePage(page)) this.closePage(pageId); } });
    if (this.diagnosticsEnabled) {
      console.info(`[browse-page-context-menu] page=${page.state.id} loaded=${Boolean(page.state.url)} items=${template.filter((item) => item.type !== 'separator').length}`);
    }
    Menu.buildFromTemplate(template).popup({ window: this.host });
    return this.getState();
  }

  async navigate(address: string): Promise<BrowserPageState> {
    const target = normalizeBrowserAddress(address);
    let page = this.activePage;
    if (!page) {
      page = this.addPage();
      this.activePageId = page.state.id;
    }
    return this.loadTarget(page, target, 'USER');
  }

  back(): BrowserPageState {
    const contents = this.activePage?.view?.webContents;
    if (contents) {
      const index = contents.navigationHistory.getActiveIndex();
      if (index > 0) this.goToHistoryIndex(this.activePage!, index - 1);
    }
    return this.getState();
  }

  forward(): BrowserPageState {
    const contents = this.activePage?.view?.webContents;
    if (contents) {
      const index = contents.navigationHistory.getActiveIndex();
      if (index + 1 < contents.navigationHistory.length()) this.goToHistoryIndex(this.activePage!, index + 1);
    }
    return this.getState();
  }

  reload(): BrowserPageState {
    const page = this.activePage;
    if (page) this.reloadPage(page);
    return this.getState();
  }

  async getContextCandidate(): Promise<import('./browser-types').BrowserContextCandidate> {
    const page=this.activePage; if(!page?.view||page.view.webContents.isDestroyed()||!page.state.url) throw new Error('No active Browse page');
    const capturedPageId=page.state.id; const capturedGeneration=page.navigationGeneration;
    const result=await page.view.webContents.executeJavaScript(`(()=>{const selection=String(window.getSelection?.()?.toString()||'').slice(0,65536);const raw=String(document.body?.innerText||'');return {selection_text:selection,page_text:raw.slice(0,131072),is_partial:raw.length>131072};})()`,true) as {selection_text:string;page_text:string;is_partial:boolean};
    if(this.activePageId!==capturedPageId||page.navigationGeneration!==capturedGeneration) throw new Error('Browse context became stale');
    return {page_id:capturedPageId,navigation_generation:capturedGeneration,url:page.state.url,title:page.state.title,page_text:result.page_text,selection_text:result.selection_text,is_partial:result.is_partial};
  }

  private captureNativeFrame(contents: WebContentsView['webContents'], options: BrowserCaptureGuardOptions) {
      const nativeCapture = async () => {
        for (let attempt = 0; ; attempt++) {
          if (options.signal?.aborted || contents.isDestroyed()) throw new Error('Screenshot capture cancelled');
          try { return await contents.capturePage(undefined, { stayHidden: true, stayAwake: true }); }
          catch (error) {
            if (!(error instanceof Error) || error.message !== 'UnknownVizError' || attempt >= 3) throw error;
            // loadURL can resolve before Chromium publishes the first compositor
            // frame. Retry the observation only, never an interaction.
            await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
          }
        }
      };
    return waitForBoundedCapture(nativeCapture(), options);
  }

  async captureCurrentViewport(options: BrowserCaptureGuardOptions = {}): Promise<BrowserViewportCapture> {
    const page = this.activePage;
    const view = page?.view;
    const contents = view?.webContents;
    if (!page || !view || !contents || contents.isDestroyed() || !page.state.url
      || page.state.is_loading || !this.requestedVisible || this.visiblePageId !== page.state.id) {
      throw new Error('No stable visible Browse page');
    }
    const captured = {
      page_id: page.state.id,
      navigation_generation: page.navigationGeneration,
      url: contents.getURL(),
    };
    if (!captured.url || captured.url !== page.state.url) throw new Error('Browse screenshot context is unstable');
    const image = await this.captureNativeFrame(contents, options);
    const currentView = page.view;
    const currentContents = currentView?.webContents;
    assertCaptureIdentityCurrent(captured, this.isLivePage(page) && this.activePageId === page.state.id
      && this.requestedVisible && this.visiblePageId === page.state.id && !page.state.is_loading
      && currentContents === contents && !contents.isDestroyed()
      ? { page_id: page.state.id, navigation_generation: page.navigationGeneration, url: contents.getURL() }
      : null);
    if (image.isEmpty()) throw new Error('Browse screenshot is empty');
    const size = image.getSize();
    const png = image.toPNG();
    assertScreenshotBounds(png.byteLength, size.width, size.height);
    return {
      png_data_url: `data:image/png;base64,${png.toString('base64')}`,
      source_kind: 'BROWSER_VIEWPORT',
      page_id: captured.page_id,
      navigation_generation: captured.navigation_generation,
      captured_url: captured.url,
      captured_at: Date.now(),
    };
  }

  destroy(): void {
    this.host.removeListener('resize', this.handleHostResize);
    if (this.hostResizeTimer) clearTimeout(this.hostResizeTimer);
    this.hostResizeTimer = undefined;
    const existingPages = [...this.pages.values()];
    this.pages.clear();
    this.pageOrder = [];
    this.visiblePageId = undefined;
    for (const page of existingPages) this.destroyPageView(page);
    this.diagnose('destroy');
  }

  private get activePage(): RuntimePage | undefined {
    return this.pages.get(this.activePageId);
  }

  private addPage(): RuntimePage {
    const page: RuntimePage = {
      committedUrl: '',
      navigationGeneration: 0,
      state: {
        id: `page_${randomUUID()}`,
        url: '',
        title: '新页面',
        favicon_data_url: null,
        can_go_back: false,
        can_go_forward: false,
        is_loading: false,
        error: null,
      },
    };
    this.pages.set(page.state.id, page);
    this.pageOrder.push(page.state.id);
    return page;
  }

  private requirePage(pageId: string): RuntimePage {
    const page = this.pages.get(pageId);
    if (!page) throw new Error('Browse page no longer exists');
    return page;
  }

  private isLivePage(page: RuntimePage): boolean {
    return this.pages.get(page.state.id) === page;
  }

  private async openTargetInNewPage(target: string, initiator: BrowserNavigationInitiator): Promise<void> {
    const page = this.addPage();
    this.activePageId = page.state.id;
    this.layout('window-open-page');
    await this.loadTarget(page, target, initiator);
  }

  private async loadTarget(page: RuntimePage, target: string, initiator: BrowserNavigationInitiator): Promise<BrowserPageState> {
    if (!isAllowedBrowseNavigation(target, initiator)) throw new Error('Browse navigation blocked by policy');
    const authorization = { target, initiator };
    page.mainFrameError = undefined;
    page.directNavigation = authorization;
    page.pendingNavigation = authorization;
    const contents = this.ensureView(page).webContents;
    page.state = { ...page.state, url: target, favicon_data_url: null, is_loading: true, error: null };
    this.layout('navigate');
    try {
      await contents.loadURL(target);
    } catch (reason) {
      if (this.isLivePage(page) && page.directNavigation === authorization) page.mainFrameError = networkFailureCode(reason);
      if (this.isLivePage(page) && page.directNavigation === authorization && !page.state.error) {
        page.pendingNavigation = undefined;
        page.state = {
          ...page.state,
          is_loading: false,
          error: reason instanceof Error ? reason.message : '页面加载失败',
        };
        this.emit();
      }
    } finally {
      if (page.directNavigation === authorization) page.directNavigation = undefined;
    }
    return this.getState();
  }

  private ensureView(page: RuntimePage): WebContentsView {
    if (page.view) return page.view;
    const view = new WebContentsView({
      webPreferences: {
        session: this.browseSession,
        ...UNTRUSTED_WEB_PREFERENCES,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    this.host.contentView.addChildView(view);
    page.view = view;

    const contents = view.webContents;
    // A Browse Page starts at Chromium's 100% CSS zoom. Keeping this explicit avoids
    // a persisted or inherited zoom factor making the same native viewport render
    // differently from a regular Chromium window.
    contents.setZoomFactor(1);
    contents.setWindowOpenHandler(({ url, referrer }) => {
      const initiator = this.documentInitiator(referrer.url);
      const target = allowedWindowOpenTarget(url, initiator);
      if (target) {
        setImmediate(() => {
          if (this.isLivePage(page)) void this.openTargetInNewPage(target, initiator);
        });
      }
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => this.showContextMenu(page, params));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => {
      const initiator = this.navigationInitiator(page, event.url, event.initiator?.url, event.isMainFrame);
      if (!isAllowedBrowseNavigation(event.url, initiator)) {
        event.preventDefault();
        return;
      }
      if (event.isMainFrame) page.pendingNavigation = { target: event.url, initiator };
    });
    contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
      const initiator = this.navigationInitiator(page, url, undefined, isMainFrame);
      if (!isAllowedBrowseNavigation(url, initiator)) event.preventDefault();
    });
    contents.on('did-start-loading', () => {
      if (!this.isLivePage(page)) return;
      page.state = { ...this.readPageState(page), is_loading: true, error: null };
      this.emit();
    });
    contents.on('did-stop-loading', () => {
      if (!this.isLivePage(page)) return;
      page.state = { ...this.readPageState(page), is_loading: false, error: page.state.error };
      this.emit();
    });
    contents.on('did-navigate', () => { page.mainFrameError = undefined; page.navigationGeneration += 1; this.commitPageNavigation(page); });
    contents.on('did-navigate-in-page', () => { page.navigationGeneration += 1; this.commitPageNavigation(page); });
    contents.on('page-title-updated', (event) => {
      event.preventDefault();
      this.refreshPage(page);
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      void this.updatePageFavicon(page, favicons);
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!this.isLivePage(page) || !isMainFrame || errorCode === -3) return;
      page.mainFrameError = networkFailureCode(errorDescription);
      page.pendingNavigation = undefined;
      page.state = {
        ...this.readPageState(page),
        url: validatedUrl || page.state.url,
        is_loading: false,
        error: errorDescription || '页面加载失败',
      };
      this.emit();
    });
    contents.on('render-process-gone', (_event, details) => {
      if (!this.isLivePage(page)) return;
      page.state = { ...page.state, is_loading: false, error: `网页进程已停止（${details.reason}）` };
      this.emit();
    });

    this.layout('attach-page');
    return view;
  }

  private showContextMenu(page: RuntimePage, params: ContextMenuParams): void {
    const contents = page.view?.webContents;
    if (!contents || contents.isDestroyed()) return;

    const template: MenuItemConstructorOptions[] = [];
    const separator = () => {
      if (template.length > 0 && template.at(-1)?.type !== 'separator') template.push({ type: 'separator' });
    };
    const initiator = this.documentInitiator(params.frameURL || params.pageURL || page.committedUrl);
    const allowedLink = params.linkURL ? allowedWindowOpenTarget(params.linkURL, initiator) : null;

    if (params.linkURL) {
      if (allowedLink) {
        template.push({
          label: '在当前页面打开链接',
          click: () => { if (this.isLivePage(page)) void this.loadTarget(page, allowedLink, initiator); },
        });
        template.push({
          label: '在新页面中打开链接',
          click: () => { if (this.isLivePage(page)) void this.openTargetInNewPage(allowedLink, initiator); },
        });
      }
      template.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) });
    }

    if (params.hasImageContents) {
      separator();
      template.push({ label: '复制图片', click: () => contents.copyImageAt(params.x, params.y) });
    }

    if (params.isEditable) {
      separator();
      template.push({ label: '撤销', accelerator: 'Ctrl+Z', enabled: params.editFlags.canUndo, click: () => contents.undo() });
      template.push({ label: '重做', accelerator: 'Ctrl+Y', enabled: params.editFlags.canRedo, click: () => contents.redo() });
      separator();
      template.push({ label: '剪切', accelerator: 'Ctrl+X', enabled: params.editFlags.canCut, click: () => contents.cut() });
      template.push({ label: '复制', accelerator: 'Ctrl+C', enabled: params.editFlags.canCopy, click: () => contents.copy() });
      template.push({ label: '粘贴', accelerator: 'Ctrl+V', enabled: params.editFlags.canPaste, click: () => contents.paste() });
      template.push({ label: '全选', accelerator: 'Ctrl+A', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() });
    } else if (params.selectionText) {
      separator();
      template.push({ label: '复制', accelerator: 'Ctrl+C', enabled: params.editFlags.canCopy, click: () => contents.copy() });
    }

    separator();
    const history = contents.navigationHistory;
    const activeIndex = history.getActiveIndex();
    template.push({
      label: '后退',
      enabled: activeIndex > 0,
      click: () => this.goToHistoryIndex(page, history.getActiveIndex() - 1),
    });
    template.push({
      label: '前进',
      enabled: activeIndex >= 0 && activeIndex + 1 < history.length(),
      click: () => this.goToHistoryIndex(page, history.getActiveIndex() + 1),
    });
    template.push({ label: '重新加载', accelerator: 'Ctrl+R', click: () => contents.reload() });

    separator();
    template.push({
      label: '检查',
      click: () => contents.inspectElement(params.x, params.y),
    });

    if (this.diagnosticsEnabled) {
      console.info(`[browse-context-menu] page=${page.state.id} editable=${params.isEditable} selection=${Boolean(params.selectionText)} link=${Boolean(params.linkURL)} image=${params.hasImageContents} inspect=true items=${template.filter((item) => item.type !== 'separator').length}`);
    }
    Menu.buildFromTemplate(template).popup({ window: this.host });
  }

  private readPageState(page: RuntimePage): BrowserPage {
    const contents = page.view?.webContents;
    if (!contents || contents.isDestroyed()) return { ...page.state };
    const currentUrl = contents.getURL();
    const activeIndex = contents.navigationHistory.getActiveIndex();
    const historyLength = contents.navigationHistory.length();
    return {
      id: page.state.id,
      url: currentUrl === 'about:blank' ? '' : currentUrl,
      title: contents.getTitle() || '新页面',
      favicon_data_url: page.state.favicon_data_url,
      can_go_back: activeIndex > 0,
      can_go_forward: activeIndex >= 0 && activeIndex + 1 < historyLength,
      is_loading: contents.isLoading(),
      error: null,
    };
  }

  private refreshPage(page: RuntimePage): void {
    if (!this.isLivePage(page)) return;
    page.state = { ...this.readPageState(page), error: page.state.error };
    this.emit();
  }

  private commitPageNavigation(page: RuntimePage): void {
    if (!this.isLivePage(page)) return;
    const currentUrl = page.view?.webContents.getURL() ?? page.committedUrl;
    if (currentUrl === 'about:blank' && page.pendingNavigation?.target !== 'about:blank') {
      this.refreshPage(page);
      return;
    }
    page.committedUrl = currentUrl;
    page.pendingNavigation = undefined;
    this.refreshPage(page);
  }

  private documentInitiator(value: string): BrowserNavigationInitiator {
    return browserNavigationInitiatorForDocument(value);
  }

  private navigationInitiator(
    page: RuntimePage,
    target: string,
    sourceUrl: string | undefined,
    isMainFrame: boolean,
  ): BrowserNavigationInitiator {
    if (isMainFrame && page.directNavigation && sameNavigationTarget(page.directNavigation.target, target)) {
      return page.directNavigation.initiator;
    }
    if (isMainFrame && page.pendingNavigation && sameNavigationTarget(page.pendingNavigation.target, target)) {
      return page.pendingNavigation.initiator;
    }
    if (isMainFrame && page.pendingNavigation) {
      const pendingTargetInitiator = this.documentInitiator(page.pendingNavigation.target);
      if (pendingTargetInitiator === 'REMOTE_PAGE') return pendingTargetInitiator;
    }
    if (sourceUrl) return this.documentInitiator(sourceUrl);
    if (page.pendingNavigation) return this.documentInitiator(page.pendingNavigation.target);
    return this.documentInitiator(page.committedUrl);
  }

  private pageForWebContents(webContents: WebContents | undefined, webContentsId: number | undefined): RuntimePage | undefined {
    return [...this.pages.values()].find((page) => {
      const candidate = page.view?.webContents;
      return candidate === webContents || (webContentsId !== undefined && candidate?.id === webContentsId);
    });
  }

  private goToHistoryIndex(page: RuntimePage, index: number): void {
    const contents = page.view?.webContents;
    if (!contents) return;
    const target = contents.navigationHistory.getEntryAtIndex(index)?.url;
    if (!target) return;
    page.pendingNavigation = { target, initiator: 'USER' };
    contents.navigationHistory.goToIndex(index);
  }

  private reloadPage(page: RuntimePage): void {
    const contents = page.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    page.mainFrameError = undefined;
    const target = contents.getURL();
    if (target) page.pendingNavigation = { target, initiator: 'USER' };
    contents.reload();
  }

  private async updatePageFavicon(page: RuntimePage, favicons: string[]): Promise<void> {
    const contents = page.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const pageUrl = contents.getURL();
    for (const favicon of favicons) {
      const dataUrl = await this.loadFaviconDataUrl(favicon);
      if (!dataUrl) continue;
      if (!this.isLivePage(page) || page.view?.webContents.getURL() !== pageUrl) return;
      page.state = { ...page.state, favicon_data_url: dataUrl };
      this.emit();
      return;
    }
  }

  private async loadFaviconDataUrl(value: string): Promise<string | null> {
    try {
      const parsed = new URL(value);
      if (!['data:', 'http:', 'https:'].includes(parsed.protocol)) return null;
      const response = await this.browseSession.fetch(value, { credentials: 'include' });
      if (!response.ok) return null;
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > MAX_FAVICON_BYTES) return null;
      const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (!ALLOWED_FAVICON_TYPES.has(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES) return null;
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      if (size.width > 4096 || size.height > 4096) return null;
      const png = image.resize({ width: 32, height: 32, quality: 'best' }).toPNG();
      if (png.length === 0 || png.length > MAX_FAVICON_BYTES) return null;
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private destroyPageView(page: RuntimePage): void {
    const view = page.view;
    page.view = undefined;
    page.appliedEmulation = undefined;
    if (!view) return;
    if (this.host.contentView.children.includes(view)) this.host.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private layout(reason: string): void {
    this.visiblePageId = undefined;
    const available = this.host.contentView.getBounds();
    const bounds = this.requestedBounds ? fitBrowserBounds(this.requestedBounds, available) : undefined;
    for (const pageId of this.pageOrder) {
      const page = this.requirePage(pageId);
      if (!page.view) continue;
      if (bounds) {
        const previous = page.view.getBounds();
        if (previous.x !== bounds.x || previous.y !== bounds.y || previous.width !== bounds.width || previous.height !== bounds.height) page.view.setBounds(bounds);
        const resizingLoadedActivePage = pageId === this.activePageId
          && this.requestedVisible
          && Boolean(page.state.url)
          && previous.width > 0
          && previous.height > 0
          && (previous.width !== bounds.width || previous.height !== bounds.height);
        // Windows can commit a moved divider to the native View while leaving the
        // already-loaded RenderWidget at its previous CSS viewport. Applying the
        // matching desktop viewport only for a live resize avoids that stale frame
        // without changing the site's session, DPR, mobile mode, or page scale.
        if ((resizingLoadedActivePage || page.agentViewport) && page.committedUrl && !page.state.is_loading && !page.view.webContents.isDestroyed()) {
          const viewport = page.agentViewport ?? bounds;
          const scale = page.agentViewport ? Math.min(1, bounds.width / viewport.width, bounds.height / viewport.height) : 1;
          const key = JSON.stringify([viewport.width, viewport.height, scale]);
          if (page.appliedEmulation?.key !== key) {
          page.view.webContents.enableDeviceEmulation({
            screenPosition: 'desktop',
            screenSize: { width: viewport.width, height: viewport.height },
            viewPosition: { x: 0, y: 0 },
            deviceScaleFactor: 0,
            viewSize: { width: viewport.width, height: viewport.height },
            scale,
          });
          page.appliedEmulation = { key, scale };
          }
        }
      }
      const visible = Boolean(
        bounds
        && this.requestedVisible
        && pageId === this.activePageId
        && bounds.width > 0
        && bounds.height > 0,
      );
      page.view.setVisible(visible);
      if (visible) this.visiblePageId = pageId;
    }
    this.diagnose(reason);
    this.emit();
  }

  private emit(): void {
    this.diagnose('state');
    this.publish(this.getState());
  }

  private surfaceState(): BrowserPageState['surface'] {
    const activeView = this.activePage?.view;
    const attached = Boolean(activeView && this.host.contentView.children.includes(activeView));
    const bounds = activeView?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      app_view: this.requestedVisible ? 'BROWSE' : 'NOT_BROWSE',
      attached,
      visible: attached && this.visiblePageId === this.activePageId,
      bounds: { ...bounds },
    };
  }

  private diagnose(reason: string): void {
    if (!this.diagnosticsEnabled) return;
    const state = this.getState();
    const url = diagnosticUrl(state.url);
    const title = state.title.replace(/\s+/g, ' ').slice(0, 160);
    const hostBounds = this.host.contentView.getBounds();
    const zoom = this.activePage?.view?.webContents.getZoomFactor() ?? 1;
    const diagnostic = `app_view=${state.surface.app_view} attached=${state.surface.attached} visible=${state.surface.visible} host=${hostBounds.width}/${hostBounds.height} bounds=${state.surface.bounds.x}/${state.surface.bounds.y}/${state.surface.bounds.width}/${state.surface.bounds.height} zoom=${zoom.toFixed(2)} pages=${state.pages.length} active=${state.active_page_id} url=${url} title=${JSON.stringify(title)}`;
    if (diagnostic === this.lastDiagnostic) return;
    this.lastDiagnostic = diagnostic;
    console.info(`[browse-runtime:${reason}] ${diagnostic}`);
  }
}

function diagnosticUrl(value: string): string {
  if (!value) return '(empty)';
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '(invalid)';
  }
}

function networkFailureCode(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  return /\bERR_[A-Z_]+\b/.exec(message)?.[0] ?? 'NAVIGATION_FAILED';
}

function protocolOf(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return '';
  }
}

function sameNavigationTarget(left: string, right: string): boolean {
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return left === right;
  }
}
