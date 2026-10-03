import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CaptureView,
  FieldSummary,
} from '@fielora/contracts';
import {
  captureKindLabels,
  capturePreview,
  captureSourceLabel,
  captureStateLabel,
} from './phase04-presentation';
import { SelectMenu } from './UiPrimitives';

type ExperienceSurface = 'INBOX' | null;
type CaptureAction = { captureId: string; mode: 'ATTACH' | 'PROMOTE' } | null;

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function Phase04Layer() {
  const [surface, setSurface] = useState<ExperienceSurface>(null);
  const [captures, setCaptures] = useState<CaptureView[]>([]);
  const [fields, setFields] = useState<FieldSummary[]>([]);
  const [expandedCaptureId, setExpandedCaptureId] = useState('');
  const [captureAction, setCaptureAction] = useState<CaptureAction>(null);
  const [error, setError] = useState('');
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    const [nextCaptures, nextFields] = await Promise.all([
      window.fielora.capture.list({ placement: null, lifecycle: null, field_id: null, cursor: null, limit: 100 }),
      window.fielora.field.list(),
    ]);
    setCaptures(nextCaptures.items);
    setFields(nextFields);
  }, []);

  const rememberFocus = useCallback(() => {
    if (surface === null && document.activeElement instanceof HTMLElement) previousFocusRef.current = document.activeElement;
  }, [surface]);

  const showSurface = useCallback((next: Exclude<ExperienceSurface, null>) => {
    rememberFocus();
    setError('');
    setSurface(next);
    void window.fielora.browser.hide().catch(() => undefined);
    void refresh().catch((reason) => setError(message(reason)));
  }, [refresh, rememberFocus]);

  const close = useCallback(() => {
    setSurface(null);
    setError('');
    setCaptureAction(null);
    window.dispatchEvent(new Event('resize'));
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    const openInbox = () => showSurface('INBOX');
    window.addEventListener('fielora:open-inbox', openInbox);
    return () => {
      window.removeEventListener('fielora:open-inbox', openInbox);
    };
  }, [showSurface]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && surface) close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close, surface]);

  async function archive(capture: CaptureView) {
    await window.fielora.capture.archive({ capture_id: capture.id, expected_revision: capture.revision });
    setCaptureAction(null); await refresh();
  }
  async function restore(capture: CaptureView) {
    await window.fielora.capture.restore({ capture_id: capture.id, expected_revision: capture.revision });
    await refresh();
  }
  async function attach(capture: CaptureView, fieldId: string) {
    if (!fieldId) return;
    await window.fielora.capture.attach({ capture_id: capture.id, field_id: fieldId, expected_revision: capture.revision });
    setCaptureAction(null); await refresh();
  }
  async function promote(capture: CaptureView, fieldId: string) {
    await window.fielora.capture.promote({ capture_id: capture.id, field_id: fieldId || null, expected_revision: capture.revision });
    setCaptureAction(null); await refresh();
  }

  const header = <><div><p className="eyebrow">CAPTURE</p><h2>Inbox</h2><p>暂时收好，之后再决定放到哪里。</p></div><button className="icon-button" onClick={close} aria-label="关闭">×</button></>;

  return <>
    {surface && <div className="experience-backdrop" data-effect="backdrop-dim" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="experience-panel" role="dialog" aria-modal="true" data-surface="overlay" aria-label="Fielora Inbox" data-testid="inbox-surface">
        <header>{header}</header>

        {surface === 'INBOX' && <div className="experience-body inbox-list">
          {captures.length === 0 ? <div className="empty"><h3>还没有捕获内容</h3><p>在 Browse 中捕获页面或选区，它们会先来到这里。</p></div> : captures.map((capture) => {
            const expanded = expandedCaptureId === capture.id;
            const currentAction = captureAction?.captureId === capture.id ? captureAction.mode : null;
            return <article key={capture.id} className={`capture-card ${capture.lifecycle_status === 'ARCHIVED' ? 'archived' : ''}`} data-testid="inbox-capture-card">
              <div className="capture-card-meta"><span>{captureKindLabels[capture.kind]}</span><small>{captureSourceLabel(capture)} · {new Date(capture.created_at).toLocaleString()}</small><em>{captureStateLabel(capture)}</em></div>
              <h3>{capture.title}</h3>
              <p className="capture-preview" data-testid="capture-preview">{capturePreview(capture.content) || '这份捕获没有可显示的文字预览。'}</p>
              <button className="capture-expand" type="button" onClick={() => setExpandedCaptureId(expanded ? '' : capture.id)}>{expanded ? '收起完整内容' : '查看完整内容'}</button>
              {expanded && <pre className="capture-full-content" data-testid="capture-full-content">{capture.content}</pre>}
              {currentAction && <div className="capture-decision" data-testid="capture-decision">
                <div><strong>{currentAction === 'ATTACH' ? '加入哪个 Field？' : '在哪里继续这份灵感？'}</strong><small>{currentAction === 'ATTACH' ? '让这份材料属于一件持续工作。' : '保留来源，并把它作为后续工作入口。'}</small></div>
                <SelectMenu value="" ariaLabel="选择 Field" options={[{ value: '', label: '选择…', disabled: true }, ...(currentAction === 'PROMOTE' ? [{ value: '__global', label: '先作为独立灵感保留' }] : []), ...fields.map((field) => ({ value: field.id, label: field.title }))]} onChange={(fieldId) => {
                  if (currentAction === 'ATTACH') void attach(capture, fieldId);
                  else if (fieldId === '__global') void promote(capture, '');
                  else void promote(capture, fieldId);
                }} />
                <button type="button" className="quiet-button" onClick={() => setCaptureAction(null)}>取消</button>
              </div>}
              <div className="capture-card-actions">
                {capture.lifecycle_status === 'ACTIVE' && capture.placement_status !== 'PROMOTED' && <button type="button" className="primary-button compact" onClick={() => setCaptureAction({ captureId: capture.id, mode: 'ATTACH' })}>加入 Field</button>}
                <details><summary aria-label="更多操作">更多</summary><div>{capture.lifecycle_status === 'ACTIVE' && capture.placement_status !== 'PROMOTED' && <button type="button" onClick={() => setCaptureAction({ captureId: capture.id, mode: 'PROMOTE' })}>作为灵感继续</button>}{capture.lifecycle_status === 'ACTIVE' ? <button type="button" onClick={() => void archive(capture)}>归档</button> : <button type="button" onClick={() => void restore(capture)}>恢复</button>}</div></details>
              </div>
            </article>;
          })}
        </div>}

        {error && <p className="experience-message error" role="alert">{error}</p>}
      </section>
    </div>}
  </>;
}
