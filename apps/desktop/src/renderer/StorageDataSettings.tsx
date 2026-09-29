import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ProfileView } from '@fielora/contracts';
import type { StorageInfo } from '../storage-manager';
import type { AppPreferences } from './app-preferences';
import { Button, SettingsToggle } from './UiPrimitives';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

type StorageDetailId = StorageInfo['details'][number]['id'];

const detailLabels: Record<StorageDetailId, string> = {
  MAIN_DATABASE: '主 SQLite 数据库',
  AGENT_LEDGER: 'Agent 账本',
  LIBRARY_BLOBS: '资料库 Blob 存储',
  SQLITE_WAL: 'SQLite WAL',
  SQLITE_SHM: 'SQLite SHM',
  VECTOR_INDEX: '向量索引',
  SEARCH_INDEX: '搜索索引',
  INTERNAL_INDEX: '内部仓库索引',
  CACHE: '缓存',
};

const directoryDetails = new Set<StorageDetailId>(['LIBRARY_BLOBS', 'INTERNAL_INDEX', 'CACHE']);

function detailState(state: StorageInfo['details'][number]['state']): string {
  if (state === 'NOT_PRESENT') return '未启用 / 不存在';
  if (state === 'SHARED_DATABASE') return '存储于主数据库';
  return '存在';
}

function StorageLocation({ title, description, path, children }: {
  title: string;
  description: string;
  path: string;
  children: ReactNode;
}) {
  return <div className="storage-location" data-testid="storage-location">
    <div className="storage-location-heading"><strong>{title}</strong><small>{description}</small></div>
    <div className="storage-location-path" title={path}>{path}</div>
    <div className="storage-location-actions">{children}</div>
  </div>;
}

export function StorageDataSettings({ preferences, onPreferencesChange }: { preferences: AppPreferences; onPreferencesChange: (preferences: AppPreferences) => void }) {
  const [info, setInfo] = useState<StorageInfo>();
  const [profile, setProfile] = useState<ProfileView>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [includeLibrary, setIncludeLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    const [nextInfo, nextProfile] = await Promise.all([window.fielora.storage.info(), window.fielora.profile.get()]);
    setInfo(nextInfo); setProfile(nextProfile);
  }, []);
  useEffect(() => { void refresh().catch((reason) => setStatus(reason instanceof Error ? reason.message : String(reason))); }, [refresh]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setStatus('');
    try { await action(); await refresh(); setStatus(success); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function importProfile() {
    setBusy(true); setStatus('');
    try {
      const result = await window.fielora.profile.import();
      if (!result.canceled && result.preferences) onPreferencesChange(result.preferences);
      await refresh();
      setStatus(result.canceled ? '已取消导入。' : 'Fielora Profile 已导入；Project 路径可能需要重新定位。');
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  if (!info) return <div className="settings-section" data-testid="settings-storage"><header><h1>存储与数据</h1></header><p>{status || '正在读取真实存储位置…'}</p></div>;

  const rootRows = [
    { label: 'Fielora 数据', description: '保存对话、项目状态和本地设置。', value: info.roots.data_root, open: 'DATA_ROOT' as const, change: () => run(() => window.fielora.storage.migrateDataRoot(), '数据目录迁移完成；原目录已保留。') },
    { label: '资料库', description: '保存加入资料库的本地文件。', value: info.roots.library_root, open: 'LIBRARY_ROOT' as const, change: () => run(() => window.fielora.storage.migrateLibraryRoot(), '资料库目录迁移完成；原目录已保留。') },
  ];

  return <div className="settings-section" data-testid="settings-storage">
    <header><h1>存储与数据</h1></header>
    <section className="settings-card storage-root-list">{rootRows.map((row) => <StorageLocation key={row.label} title={row.label} description={row.description} path={row.value}>
      <Button variant="secondary" onClick={() => void window.fielora.storage.open(row.open)}>打开文件夹</Button><Button variant="ghost" disabled={busy} onClick={() => void row.change()}>更改位置</Button>
    </StorageLocation>)}
      <StorageLocation title="缓存" description={`可安全清理的临时数据，当前占用 ${bytes(info.cache_bytes)}。`} path={info.roots.cache_root}>
        <Button variant="secondary" onClick={() => void window.fielora.storage.open('CACHE_ROOT')}>打开文件夹</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => window.fielora.storage.clearCache(), '缓存已清理；durable data 未改变。')}>清理缓存</Button>
      </StorageLocation>
    </section>
    <section className="settings-card profile-backup-card"><div className="settings-card-heading profile-backup-heading"><span><strong>备份与迁移</strong><small>将对话、项目状态、设置等迁移到另一台 Fielora。</small><small>凭据和网站登录状态不会包含在备份中。</small></span></div>
      <div className="settings-row storage-backup-option"><span><strong>包含资料库文件</strong><small>同时备份资料库中的本地文件，可能显著增加备份体积。</small></span><SettingsToggle value={includeLibrary} onChange={setIncludeLibrary} label="包含资料库文件" testId="backup-include-library-toggle" disabled={busy} /></div>
      <div className="storage-actions"><Button variant="secondary" disabled={busy} onClick={() => void run(() => window.fielora.profile.export({ include_library: includeLibrary, preferences }), 'Fielora Profile 已导出。')} data-testid="profile-export">导出 Fielora</Button><Button variant="secondary" disabled={busy} onClick={() => void importProfile()} data-testid="profile-import">导入 Fielora</Button></div>
    </section>
    <section className="settings-card storage-details"><button className="settings-card-heading storage-details-toggle" onClick={() => setDetailsOpen((open) => !open)}><span><strong>详细存储信息</strong><small>只显示当前实现真实使用或明确不存在的物理对象。</small></span><span>{detailsOpen ? '收起' : '展开'}</span></button>
      {detailsOpen && <div className="storage-detail-list">
        <div className="settings-row storage-profile-metadata" data-testid="storage-profile-metadata"><span><strong>Profile 信息</strong><small>Profile ID：{profile?.profile_id ?? '—'}</small><small>Device ID：{profile?.device_id ?? '—'} · Schema {profile?.schema_version ?? '—'}</small></span></div>
        {info.details.map((detail) => <div className="settings-row storage-detail-row" key={detail.id} data-storage-detail={detail.id}><span className="storage-detail-copy"><span className="storage-detail-heading"><strong>{detailLabels[detail.id]}</strong><small>{detailState(detail.state)}</small></span>{detail.path && <small title={detail.path}>{detail.path}</small>}</span>{detail.path && <div className="storage-detail-actions"><Button variant="ghost" onClick={() => void window.fielora.clipboard.writeText(detail.path!)}>复制路径</Button><Button variant="ghost" onClick={() => void window.fielora.storage.open(detail.id)}>{directoryDetails.has(detail.id) ? '打开' : '打开所在位置'}</Button></div>}</div>)}
      </div>}
    </section>
    {status && <p className="settings-storage-status" role="status">{status}</p>}
  </div>;
}
