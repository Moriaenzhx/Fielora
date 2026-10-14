import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRunView, AgentToolCallView } from '@fielora/contracts';
import { computerPreviewMessage, localPreviewPng, type ComputerPreviewView } from '../computer-preview-types';
import { computerApplicationActivity } from './agent-activity-projection';
import { AppIcon } from './ui';
import { computerActionLabels, computerPointerFeedback, type ComputerPointerFeedback } from '../computer-feedback';

type DisplayMode = 'OPEN' | 'MINIMIZED' | 'CLOSED';

export function useApplicationPreview(run: AgentRunView | null, tools: readonly AgentToolCallView[], conversationId: string, stopping = false) {
  const scope = run?.conversation_id === conversationId ? run.id : '';
  const active = Boolean(!stopping && scope && run && ['RUNNING', 'WAITING_APPROVAL'].includes(run.status));
  const latest = [...tools].reverse().find(tool => tool.run_id === scope && tool.name === 'computer' && computerApplicationActivity(tool)?.action !== 'status');
  const [selection, setSelection] = useState({ scope: '', toolId: '', latestId: '' });
  const tool = selection.scope === scope && selection.latestId === latest?.id
    ? tools.find(item => item.id === selection.toolId && item.run_id === scope) : latest;
  const activity = tool ? computerApplicationActivity(tool) : null;
  const eligible = active && Boolean(activity?.canPreview);
  const [display, setDisplay] = useState<{ scope: string; mode: DisplayMode }>({ scope: '', mode: 'OPEN' });
  const mode = display.scope === scope ? display.mode : 'OPEN';
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState<{ key: string; view: ComputerPreviewView } | null>(null);
  const [iconState, setIconState] = useState<{ scope: string; values: Record<string, string> }>({ scope: '', values: {} });
  const flight = useRef<Promise<void>>(Promise.resolve());
  const toolId = eligible ? tool?.id ?? '' : '';
  const requestKey = `${scope}:${toolId}:${mode}:${revision}`;
  const target = activity?.target;

  useEffect(() => {
    let abandoned = false;
    setFrame(null);
    if (!scope || !toolId) return;
    const previous = flight.current;
    const pending = (async () => {
      // A superseded OS capture may finish, but cannot publish or overlap a new one.
      await previous.catch(() => {});
      if (abandoned) return;
      let view: ComputerPreviewView;
      try {
        view = await window.fielora.agent.computerPreview({ run_id: scope, tool_call_id: toolId, capture: mode === 'OPEN' });
      } catch {
        view = { state: 'UNAVAILABLE', error_code: 'COMPUTER_PREVIEW_UNAVAILABLE' };
      }
      if (abandoned) return;
      const icon = localPreviewPng(view.icon_data_url, 128 * 1024);
      if (icon && view.target?.app_id) {
        const appId = view.target.app_id;
        setIconState(current => ({ scope, values: { ...(current.scope === scope ? current.values : {}), [appId]: icon } }));
      }
      setFrame({ key: requestKey, view: { ...view, icon_data_url: icon, image_data_url: mode === 'OPEN' ? localPreviewPng(view.image_data_url) : undefined } });
    })();
    flight.current = pending;
    return () => { abandoned = true; };
  }, [scope, toolId, mode, requestKey]);

  const open = useCallback((chosen: AgentToolCallView) => {
    if (!active || chosen.run_id !== scope || !computerApplicationActivity(chosen)?.canPreview) return;
    setSelection({ scope, toolId: chosen.id, latestId: latest?.id ?? '' });
    setDisplay({ scope, mode: 'OPEN' });
    setRevision(value => value + 1);
  }, [active, scope, latest?.id]);
  const changeMode = (next: DisplayMode) => { setFrame(null); setDisplay({ scope, mode: next }); };

  return {
    icons: iconState.scope === scope ? iconState.values : {},
    open: active ? open : undefined,
    panel: eligible && target && mode !== 'CLOSED' ? <ApplicationPreview
      name={target.name} minimized={mode === 'MINIMIZED'}
      action={activity?.action ?? ''} pointer={computerPointerFeedback(tool)} toolId={tool?.id ?? ''}
      view={frame?.key === requestKey ? frame.view : null}
      onMinimize={() => changeMode('MINIMIZED')} onClose={() => changeMode('CLOSED')}
      onExpand={() => changeMode('OPEN')} onRefresh={() => setRevision(value => value + 1)}
    /> : null,
  };
}

function ApplicationPreview({ name, minimized, view, action, pointer, toolId, onMinimize, onClose, onExpand, onRefresh }: {
  name: string; minimized: boolean; view: ComputerPreviewView | null;
  action: string; pointer: ComputerPointerFeedback | null; toolId: string;
  onMinimize: () => void; onClose: () => void; onExpand: () => void; onRefresh: () => void;
}) {
  const icon = view?.icon_data_url ? <img className="application-preview-icon" src={view.icon_data_url} alt=""/> : <AppIcon name="application"/>;
  if (minimized) return <button type="button" className="application-preview-pill" data-testid="application-preview-reopen" aria-label={`展开 ${name} 窗口预览`} onClick={onExpand}>{icon}<span>{name}</span><AppIcon name="focus"/></button>;
  const image = view?.state === 'AVAILABLE' ? view.image_data_url : undefined;
  return <aside className="application-preview" data-testid="application-preview" aria-label={`${name} 窗口预览`}>
    <header>{icon}<strong title={name}>{name}</strong>
      <button type="button" onClick={onRefresh} disabled={!view} aria-label="刷新窗口预览" title="刷新窗口预览" data-testid="application-preview-refresh"><AppIcon name="refresh"/></button>
      <button type="button" onClick={onMinimize} aria-label="收起窗口预览" title="收起窗口预览" data-testid="application-preview-minimize"><AppIcon name="chevronDown"/></button>
      <button type="button" onClick={onClose} aria-label="关闭窗口预览" title="关闭窗口预览" data-testid="application-preview-close"><AppIcon name="close"/></button>
    </header>
    <div className="application-preview-content" aria-busy={!view}>
      {image ? <div className="application-preview-frame" style={{ width: view?.width && view.height ? Math.min(320, 240 * view.width / view.height) : undefined }}><img className="application-preview-image" data-testid="application-preview-image" src={image} alt={`${name} 的窗口快照`}/>
        {pointer && <svg key={toolId} className="application-preview-pointer" data-testid="computer-pointer-feedback" data-action={pointer.action} data-state="DISPATCHED" data-x={pointer.x} data-y={pointer.y} aria-label="最近操作的位置" viewBox="0 0 32 38" style={{ left: `${(pointer.x - pointer.windowBounds[0]) / pointer.windowBounds[2] * 100}%`, top: `${(pointer.y - pointer.windowBounds[1]) / pointer.windowBounds[3] * 100}%` }}><path d="M3 2V28L11 22L17 35L23 32L17 20L28 19Z"/></svg>}
      </div> : <p role="status">{view ? computerPreviewMessage(view.error_code) : '正在获取窗口画面…'}</p>}
    </div>
    <div className="application-preview-operation" data-testid="computer-preview-operation"><span className="application-preview-operation-dot"/>{action === 'screenshot' ? '已取得模型观察截图' : `已${computerActionLabels[action] ?? '操作应用'}`}</div>
    <footer><span>{image ? '窗口快照' : '窗口预览'}{image && view?.captured_at ? ` · ${new Date(view.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span><span title="此预览仅在本机显示；只有另行授权的截图操作会向当前模型提供窗口图片">本地预览</span></footer>
  </aside>;
}
