// This function runs only as fixed product code in a separate Chromium world.
// Page/model data is passed as JSON, never executable source or selectors.
export async function browserAgentDom(input: { action: string; snapshot_id?: string; next_snapshot_id: string; ref?: string; value?: string; checks?: { ref?: string; property: string; expected: string }[] }) {
  type Entry = { node: Element; signature: string };
  const context = globalThis as typeof globalThis & { __fieloraBrowserSnapshot?: { id: string; refs: Map<string, Entry> } };
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return !!(r.width && r.height) && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (el: Element) => (el instanceof HTMLElement ? el.innerText : el.textContent ?? '').trim().slice(0, 2000);
  const value = (el: Element) => el instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(el.type) ? '[redacted]' : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value.slice(0, 4096) : '';
  const signature = (el: Element) => JSON.stringify([text(el), value(el), el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('disabled'), el.getAttribute('readonly'), el.getAttribute('href'), el.getAttribute('type')]);
  const label = (el: Element) => (el.getAttribute('aria-label') || el.getAttribute('title') || (el instanceof HTMLInputElement ? [...el.labels ?? []].map(l => text(l)).join(' ') : '')).slice(0, 500);
  const rectData = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const hitPoint = (el: Element) => {
    const sample = (left: number, top: number, right: number, bottom: number) => {
      if (right <= left || bottom <= top) return null;
      for (const fy of [0.5, 0.15, 0.85]) for (const fx of [0.5, 0.15, 0.85]) {
        const x = Math.min(Math.ceil(right) - 1, Math.max(Math.ceil(left), Math.round(left + (right - left) * fx)));
        const y = Math.min(Math.ceil(bottom) - 1, Math.max(Math.ceil(top), Math.round(top + (bottom - top) * fy)));
        if (x >= left && x < right && y >= top && y < bottom && el.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    };
    for (const box of [...el.getClientRects()].slice(0, 8)) {
      let left = Math.max(0, box.left), top = Math.max(0, box.top);
      let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
      // Native hit testing is authoritative, including fixed descendants that
      // can escape an ancestor's overflow clip. Usually no ancestor walk is needed.
      const direct = sample(left, top, right, bottom);
      if (direct) return direct;
      // A bounding box can lie inside the viewport but outside a nested
      // scrolling container. Sample the clipped client area, not that box.
      for (let parent = el.parentElement, depth = 0; parent && depth < 24; parent = parent.parentElement, depth++) {
        const style = getComputedStyle(parent), r = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight);
        }
      }
      const clipped = sample(left, top, right, bottom);
      if (clipped) return clipped;
    }
    return null;
  };
  const settleScroll = () => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  let attemptedTarget: Element | undefined;
  let scrollPerformed = false;
  // Development overlays commonly render in an about:blank iframe. Reading
  // only the parent body reported an empty page while the user saw a compiler
  // error. Read bounded same-origin documents, without crossing origin policy
  // or issuing frame input from coordinates in a different document.
  const embeddedDocuments: { depth: number; readable: boolean; text: string }[] = [];
  let embeddedChars = 0;
  let embeddedTextTruncated = false;
  const inspectFrames = (doc: Document, depth: number) => {
    if (depth > 2) return;
    for (const frame of [...doc.querySelectorAll('iframe')].slice(0, 8)) {
      if (embeddedDocuments.length >= 8 || !visible(frame)) continue;
      try {
        const child = frame.contentDocument;
        if (!child) { embeddedDocuments.push({ depth, readable: false, text: '' }); continue; }
        const fullFrameText = child.body?.innerText ?? '';
        const frameText = fullFrameText.slice(0, Math.max(0, 16000 - embeddedChars));
        embeddedTextTruncated ||= frameText.length < fullFrameText.length;
        embeddedChars += frameText.length;
        embeddedDocuments.push({ depth, readable: true, text: frameText });
        inspectFrames(child, depth + 1);
      } catch { embeddedDocuments.push({ depth, readable: false, text: '' }); }
    }
  };
  inspectFrames(document, 1);
  let textTotalChars = 0;
  const bodyText = () => {
    const full = [document.body?.innerText ?? '', ...embeddedDocuments.filter(d => d.readable).map(d => d.text)].join('\n');
    textTotalChars = full.length;
    return full.slice(0, 24000);
  };
  const resolve = (ref?: string) => {
    const state = context.__fieloraBrowserSnapshot;
    const entry = ref && state?.refs.get(ref);
    if (!state || state.id !== input.snapshot_id || !entry || !entry.node.isConnected || signature(entry.node) !== entry.signature) throw new Error('BROWSER_STALE_ELEMENT');
    return entry.node;
  };
  let inputState = 'NOT_DISPATCHED';
  try {
  let checks: { property: string; expected: string; actual: string; passed: boolean; ref?: string }[] | undefined;
  if (input.action === 'request_login') {
    // Keep known product failures structured across Electron's isolated-world
    // boundary; thrown errors are wrapped and otherwise lose their error code.
    if (context.__fieloraBrowserSnapshot?.id !== input.snapshot_id) return { success: false, error_code: 'BROWSER_STALE_SNAPSHOT' };
    if (![...document.querySelectorAll('input[type="password"]')].some(visible)) return { success: false, error_code: 'BROWSER_LOGIN_NOT_OBSERVED' };
  }
  if (input.action === 'verify') {
    if (context.__fieloraBrowserSnapshot?.id !== input.snapshot_id) throw new Error('BROWSER_STALE_SNAPSHOT');
    checks = input.checks!.map(check => {
      const el = ['contains', 'absent'].includes(check.property) ? null : resolve(check.ref);
      let actual: string;
      switch (check.property) {
        case 'contains': actual = String(bodyText().includes(check.expected)); break;
        case 'absent': {
          const present = bodyText().includes(check.expected);
          actual = !present && (textTotalChars > 24000 || embeddedTextTruncated) ? 'UNKNOWN_TRUNCATED_OBSERVATION' : String(!present);
          break;
        }
        case 'text': actual = text(el!); break;
        case 'value': actual = value(el!); break;
        case 'visible': actual = String(visible(el!)); break;
        case 'enabled': actual = String(!el!.matches(':disabled') && el!.getAttribute('aria-disabled') !== 'true'); break;
        case 'readonly': actual = String(el!.hasAttribute('readonly') || el!.getAttribute('aria-readonly') === 'true'); break;
        case 'before': actual = String(!!(el!.compareDocumentPosition(resolve(check.expected)) & Node.DOCUMENT_POSITION_FOLLOWING)); break;
        default: throw new Error('BROWSER_INVALID_CHECK');
      }
      const expected = ['contains', 'absent', 'before'].includes(check.property) ? 'true' : check.expected;
      return { ...check, actual, passed: actual === expected };
    });
  } else if (['click', 'fill', 'select', 'scroll'].includes(input.action)) {
    const el = resolve(input.ref);
    attemptedTarget = el;
    if (!visible(el) || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') throw new Error('BROWSER_ELEMENT_UNAVAILABLE');
    if (input.action === 'scroll') {
      if (!hitPoint(el)) {
        for (const block of ['center', 'end', 'start'] as const) {
          el.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }); scrollPerformed = true;
          await settleScroll();
          resolve(input.ref);
          if (hitPoint(el)) break;
        }
      }
    }
    else if (input.action === 'click') {
      let point = hitPoint(el);
      if (!point) for (const block of ['center', 'end', 'start'] as const) {
        el.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }); scrollPerformed = true;
        await settleScroll();
        resolve(input.ref);
        point = hitPoint(el);
        if (point) break;
      }
      const rect = el.getBoundingClientRect();
      if (!point && (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight)) throw new Error('BROWSER_ELEMENT_OUTSIDE_VIEWPORT');
      if (!point) throw new Error('BROWSER_ELEMENT_COVERED');
      // Main sends native Chromium input, rather than calling page click handlers.
      return { input_state: inputState, click: point, scroll_performed: scrollPerformed };
    } else {
      if (el.hasAttribute('readonly') || el instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(el.type)) throw new Error('BROWSER_INPUT_RESTRICTED');
      if (input.action === 'select' && el instanceof HTMLSelectElement) {
        if (![...el.options].some(option => option.value === input.value)) throw new Error('BROWSER_OPTION_NOT_FOUND');
        inputState = 'DISPATCHING';
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, input.value);
      } else if (input.action === 'fill' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        inputState = 'DISPATCHING';
        el.focus();
        const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, input.value);
      } else throw new Error('BROWSER_INPUT_UNSUPPORTED');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      inputState = 'DISPATCHED';
    }
  }
  const refs = new Map<string, Entry>();
  const elements: { ref: string; tag: string; text: string; value: string; label: string; type: string; enabled: boolean; readonly: boolean; in_viewport: boolean; hit_target: boolean; href?: string; options?: { value: string; text: string }[] }[] = [];
  for (const el of [...document.querySelectorAll('body *')].slice(0, 5000)) {
    if (elements.length >= 400) break;
    if (!visible(el) || el instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(el.type)) continue;
    // CSS/pseudo-element icons often use an empty span with a title and a
    // framework click handler. They are real observed controls, even though
    // innerText is empty. Merely exposing a ref never bypasses hit testing.
    if (!(el.matches('input,textarea,select,button,a,label,h1,h2,h3,[role="button"],[role="dialog"],[title],[aria-label],[tabindex],[onclick],[ng-click],[data-ng-click],[x-ng-click]') || el.children.length === 0 && text(el))) continue;
    const ref = `e${elements.length + 1}`;
    refs.set(ref, { node: el, signature: signature(el) });
    const rect = el.getBoundingClientRect();
    const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    let href: string | undefined;
    if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
      try { const target = new URL(el.href); if (['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && target.href.length <= 4096) href = target.href; } catch { /* No navigable URL. */ }
    }
    elements.push({ ref, tag: el.tagName.toLowerCase(), text: text(el).slice(0, 500), value: value(el),
      label: label(el),
      type: el.getAttribute('type') ?? '', enabled: !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true', readonly: el.hasAttribute('readonly'),
      in_viewport: inViewport, hit_target: !!hitPoint(el), ...(href ? { href } : {}),
      ...(el instanceof HTMLSelectElement ? { options: [...el.options].slice(0, 80).map(o => ({ value: o.value, text: o.text })) } : {}) });
  }
  context.__fieloraBrowserSnapshot = { id: input.next_snapshot_id, refs };
  const hasPasswordInput = [...document.querySelectorAll('input[type="password"]')].some(visible);
  const hasVisibleMedia = [...document.querySelectorAll('canvas,img,video,iframe')].some(visible);
  const renderedText = bodyText();
  const errorAt = renderedText.search(/Failed to compile|Module build failed|Uncaught SyntaxError/);
  const textTruncated = textTotalChars > renderedText.length || embeddedTextTruncated;
  return { input_state: inputState, scroll_performed: scrollPerformed, viewport: { width: innerWidth, height: innerHeight }, snapshot_id: input.next_snapshot_id, text: renderedText, elements, checks,
    text_truncated: textTruncated, text_returned_chars: renderedText.length, text_total_chars: textTotalChars,
    ...(textTruncated ? { text_guidance: 'This is a bounded rendered-text excerpt, not a complete source file. Do not save it as a full downloaded resource or infer absence from the omitted text. Obtain the remaining content through an admitted source-reading tool.' } : {}),
    ...(errorAt >= 0 ? { rendered_error_excerpt: renderedText.slice(errorAt, errorAt + 1600) } : {}),
    embedded_documents: embeddedDocuments,
    ...(embeddedDocuments.length ? { observation_note: 'Embedded document text is included when same-origin. Element refs cover the top document only. Cross-origin frame contents require a screenshot; blank parent text does not mean blank pixels.' } : {}),
    document_state: document.readyState, content_state: bodyText().trim() || elements.length || hasVisibleMedia ? 'PRESENT' : 'EMPTY',
    has_password_input: hasPasswordInput,
    ...(input.action === 'request_login' ? { user_action_required: 'LOGIN', verification_eligible: false } : {}),
    success: checks ? checks.every(check => check.passed) : true, partial: textTruncated || document.querySelectorAll('body *').length > 5000 || elements.length >= 400 };
  } catch (error) {
    const code = error instanceof Error && /^BROWSER_[A-Z_]+$/.test(error.message) ? error.message : 'BROWSER_DOM_FAILED';
    const observed: Record<string, unknown> = input.action !== 'inspect' && inputState === 'NOT_DISPATCHED'
      ? await browserAgentDom({ ...input, action: 'inspect' }) : {};
    const state = context.__fieloraBrowserSnapshot;
    const observedRef = (node: Element | null) => [...state?.refs.entries() ?? []].find(([,entry]) => entry.node === node)?.[0];
    let targetInfo: Record<string, unknown> | undefined;
    if (attemptedTarget?.isConnected) {
      const target = attemptedTarget;
      const r = target.getBoundingClientRect(), x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)), y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
      const blocker = document.elementFromPoint(x, y);
      targetInfo = { ref: observedRef(attemptedTarget), label: label(attemptedTarget), bounds: rectData(r),
        blocker: blocker && !attemptedTarget.contains(blocker) ? { ref: observedRef(blocker), tag: blocker.tagName.toLowerCase(), id: blocker.id.slice(0, 120), label: label(blocker), text: text(blocker).slice(0, 160), position: getComputedStyle(blocker).position, bounds: rectData(blocker.getBoundingClientRect()) } : null,
        same_label_candidates: (observed.elements as {ref:string;label:string;hit_target:boolean}[] ?? []).filter(e => e.label && e.label === label(target) && e.ref !== observedRef(target)).slice(0, 6).map(e => ({ ref:e.ref, label:e.label, hit_target:e.hit_target })) };
    }
    return { ...observed, success: false, error_code: code, input_state: inputState, outcome_unknown: inputState === 'DISPATCHING', scroll_performed: scrollPerformed,
      ...(targetInfo ? { interaction_target: targetInfo } : {}),
      guidance: inputState === 'NOT_DISPATCHED'
        ? 'No requested input was dispatched. This result includes a fresh snapshot and target/blocker facts when available. Use these refs directly; do not repeat inspect/click on the same obstruction. Select an observed actionable alternative or address the observed overlay. Do not edit business code or call application handlers to work around an interaction failure.'
        : 'Input may have changed the page. Inspect the current state before deciding the next action; do not replay this input.' };
  }
}
