import { useEffect, useState } from 'react';
import type { ResultReference } from '@fielora/contracts';
import { prototypeErrorMessage, type PrototypeReference } from './interactive-prototype';
import { AppIcon } from './ui/Icon';
import { Button, IconButton, ToolbarAction } from './UiPrimitives';

export function InteractivePrototype({ reference, onOpenSource }: {
  reference: PrototypeReference;
  onOpenSource?: (reference: ResultReference) => void;
}) {
  const { field_id, relative_path, expected_sha256 } = reference.target;
  const [opened, setOpened] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    let ownedUrl: string | null = null;
    const release = (value: string) => { void window.fielora.workspace.releasePrototype({ url: value }).catch(() => undefined); };
    setUrl(null);
    setError('');
    if (opened) {
      void window.fielora.workspace.previewPrototype({ field_id, relative_path, expected_sha256 }).then(preview => {
        const validUrl = /^fielora-prototype:\/\/[a-f0-9]{32}\/index\.html$/.test(preview.url);
        if (!live) { if (validUrl) release(preview.url); return; }
        if (!validUrl || preview.sha256 !== expected_sha256 || preview.relative_path !== relative_path
          || preview.size < 1 || preview.size > 256 * 1024) {
          if (validUrl) release(preview.url);
          setError(prototypeErrorMessage(null));
          return;
        }
        ownedUrl = preview.url;
        setUrl(preview.url);
      }).catch(reason => { if (live) setError(prototypeErrorMessage(reason)); });
    }
    return () => { live = false; if (ownedUrl) release(ownedUrl); };
  }, [opened, generation, field_id, relative_path, expected_sha256]);

  return <section className={`interactive-prototype${expanded ? ' is-expanded' : ''}`} data-testid="interactive-prototype" data-reference-id={reference.id} aria-label={`${reference.label} 交互原型`}>
    <header className="prototype-toolbar">
      <div className="prototype-title"><AppIcon name="application"/><span><strong>{reference.label}</strong><small>交互原型</small></span></div>
      <div className="prototype-actions">
        {onOpenSource && <ToolbarAction testId="prototype-source" onClick={() => onOpenSource(reference)} label="查看源码" icon={<AppIcon name="source"/>} text="源码"/>}
        {opened && <>
          <IconButton testId="prototype-reset" onClick={() => setGeneration(value => value + 1)} label="重新加载原型" icon={<AppIcon name="refresh"/>}/>
          <IconButton testId="prototype-expand" onClick={() => setExpanded(value => !value)} label={expanded ? '收起预览' : '展开预览'} icon={<AppIcon name={expanded ? 'unfocus' : 'focus'}/>}/>
          <IconButton testId="prototype-close" onClick={() => setOpened(false)} label="关闭预览" icon={<AppIcon name="close"/>}/>
        </>}
      </div>
    </header>
    {!opened ? <div className="prototype-placeholder"><Button type="button" data-testid="prototype-open" onClick={() => setOpened(true)}><AppIcon name="run"/>打开原型</Button><span>直接操作页面中的按钮和输入框</span></div>
      : error ? <div className="prototype-placeholder" role="status" data-testid="prototype-error">{error}</div>
        : url ? <div className="prototype-viewport"><iframe key={url} data-testid="prototype-frame" title={`${reference.label} 预览`} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'"/></div>
          : <div className="prototype-placeholder" role="status">正在加载原型…</div>}
    {opened && !error && <footer>预览中的输入和操作在重新加载后重置</footer>}
  </section>;
}
