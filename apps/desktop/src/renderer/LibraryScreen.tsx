import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryMediaKind, LibraryObjectView } from '@fielora/contracts';
import { PrimaryNav } from './PrimaryNav';
import { AppIcon } from './ui';
import { Button } from './UiPrimitives';
import { persistWorkspaceNavigationWidth, readWorkspaceNavigationWidth, WORKSPACE_NAVIGATION_DEFAULT_WIDTH, WorkspaceSurface } from './WorkspaceSurface';

type Filter = 'ALL' | LibraryMediaKind;

const filters: Array<{ id: Filter; label: string }> = [
  { id: 'ALL', label: '全部' },
  { id: 'WEB', label: '网页' },
  { id: 'DOCUMENT', label: '文件' },
  { id: 'IMAGE', label: '图片' },
  { id: 'AUDIO', label: '音频' },
  { id: 'VIDEO', label: '视频' },
];

const kindLabels: Record<LibraryMediaKind, string> = {
  WEB: '网页', DOCUMENT: '文件', IMAGE: '图片', AUDIO: '音频', VIDEO: '视频', OTHER: '其他',
};

interface LibraryScreenProps {
  onProjects: () => void;
  onNow: () => void;
  onBrowse: () => void;
  onFields: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
}

export function LibraryScreen(props: LibraryScreenProps) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [objects, setObjects] = useState<LibraryObjectView[]>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const refreshVersion = useRef(0);
  const [navigationWidth, setNavigationWidth] = useState(() => readWorkspaceNavigationWidth(WORKSPACE_NAVIGATION_DEFAULT_WIDTH, 'fielora:library-navigation-width'));

  const refresh = useCallback(async (nextFilter: Filter = filter) => {
    const version = ++refreshVersion.current;
    setLoading(true);
    try {
      const objects = await window.fielora.library.list({ media_kind: nextFilter === 'ALL' ? null : nextFilter, include_deleted: false, limit: 200 });
      if (version !== refreshVersion.current) return;
      setObjects(objects);
      setStatus('');
    } catch (reason) { if (version === refreshVersion.current) setStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === refreshVersion.current) setLoading(false); }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addFiles() {
    try {
      const added = await window.fielora.library.addFiles();
      await refresh();
      if (added.length > 0) setStatus(`已添加 ${added.length} 个文件`);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function remove(object: LibraryObjectView) {
    try {
      await window.fielora.library.delete({ library_object_id: object.id, expected_revision: object.revision });
      await refresh();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function openObject(object: LibraryObjectView) {
    try {
      await window.fielora.library.open({ library_object_id: object.id });
      if (object.kind === 'WEB') props.onBrowse();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
  }

  const updateNavigationWidth = (width: number) => {
    setNavigationWidth(width);
    persistWorkspaceNavigationWidth(width, 'fielora:library-navigation-width');
  };

  const visibleObjects = objects.filter(object => `${object.title} ${object.original_filename ?? ''} ${object.original_source ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <WorkspaceSurface className="library-root" testId="library-screen" navigationWidth={navigationWidth} onNavigationWidthChange={updateNavigationWidth} navigationResizerTestId="library-navigation-resizer" navigationResizerClassName="library-navigation-resizer" navigation={<PrimaryNav active="LIBRARY" {...props} />}>
    <main className="content library-content collection-page">
      <header className="library-header page-header"><div><h1>资料库</h1><p>收藏文件与网页，随时查找和使用。</p></div><Button variant="primary" className="page-primary-action" onClick={() => void addFiles()} data-testid="library-add-file"><AppIcon name="filePlus"/><span>添加文件</span></Button></header>
      <div className="collection-toolbar"><nav className="library-filters collection-filters" aria-label="资料类型">{filters.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} data-testid={`library-filter-${item.id.toLowerCase()}`}>{item.label}</button>)}</nav><label className="collection-search"><AppIcon name="search" size="sm"/><input aria-label="搜索资料库" placeholder="搜索资料" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
      {loading ? <p className="collection-loading" role="status">正在读取资料…</p> : visibleObjects.length === 0 ? <section className="library-empty page-empty-state"><span className="collection-empty-icon"><AppIcon name="library" size="lg"/></span><h2>{query || filter !== 'ALL' ? '没有匹配的内容' : '把需要的资料放在这里'}</h2><p>{query || filter !== 'ALL' ? '试试其他关键词或资料类型。' : '添加本地文件，或在浏览网页时保存到资料库。'}</p>{!query && filter === 'ALL' && <Button variant="secondary" onClick={() => void addFiles()}><AppIcon name="plus" size="sm"/>添加第一份资料</Button>}</section> : <section className="library-list" aria-label="资料库内容">{visibleObjects.map((object) => <article key={object.id} className="library-row" data-testid={`library-object-${object.id}`}>
        <div><strong>{object.title}</strong><span>{kindLabels[object.media_kind]} · {object.kind === 'WEB' ? object.original_source : object.original_filename}</span><small>{new Date(object.created_at).toLocaleString()}</small></div>
        <div className="library-actions"><button onClick={() => void openObject(object)}>打开</button>{object.kind === 'FILE' && <button onClick={() => void window.fielora.library.reveal({ library_object_id: object.id })}>打开所在位置</button>}<button className="danger-link" onClick={() => void remove(object)}>删除</button></div>
      </article>)}</section>}
      {status && <p className="library-status" role="status">{status}</p>}
    </main>
  </WorkspaceSurface>;
}
