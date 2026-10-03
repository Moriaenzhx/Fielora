import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentPermission, ProjectView, ProviderConfigView } from '@fielora/contracts';
import type { CreateScheduledTaskRequest, ScheduledTaskCadence, ScheduledTaskStatus, ScheduledTaskView } from '../scheduled-task-types';
import { PrimaryNav } from './PrimaryNav';
import { AppIcon } from './ui';
import { Button, IconButton, SelectMenu, TextActionDialog } from './UiPrimitives';
import {
  persistWorkspaceNavigationWidth,
  readWorkspaceNavigationWidth,
  WORKSPACE_NAVIGATION_DEFAULT_WIDTH,
  WORKSPACE_NAVIGATION_MAX_WIDTH,
  WORKSPACE_NAVIGATION_MIN_WIDTH,
  WorkspaceSurface,
} from './WorkspaceSurface';

type Filter = 'ALL' | ScheduledTaskStatus;

interface ScheduledTasksScreenProps {
  onProjects: () => void;
  onBrowse: () => void;
  onFields: () => void;
  onNewConversation: () => void;
  onSettings: () => void;
}

interface Draft {
  name: string;
  task: string;
  fieldId: string;
  providerId: string;
  permission: AgentPermission;
  cadence: ScheduledTaskCadence;
  localTime: string;
  weekday: number;
  runAt: string;
}

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'ACTIVE', label: '已开启' },
  { value: 'PAUSED', label: '已暂停' },
  { value: 'COMPLETED', label: '已完成' },
];

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function localInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const local = new Date(timestamp - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialDraft(projects: ProjectView[], providers: ProviderConfigView[]): Draft {
  const nextHour = Date.now() + 60 * 60_000;
  return {
    name: '', task: '', fieldId: projects[0]?.field_id ?? '', providerId: providers[0]?.id ?? '',
    permission: 'REVIEW_CHANGES', cadence: 'DAILY', localTime: localInputValue(nextHour).slice(11),
    weekday: new Date().getDay(), runAt: localInputValue(nextHour),
  };
}

function cadenceLabel(task: ScheduledTaskView): string {
  if (task.cadence === 'ONCE') return task.run_at ? `单次 · ${new Date(task.run_at).toLocaleString()}` : '单次';
  if (task.cadence === 'DAILY') return `每天 ${task.local_time}`;
  return `每${weekdays[task.weekday ?? 0]} ${task.local_time}`;
}

function nextRunLabel(task: ScheduledTaskView): string {
  if (task.status === 'PAUSED') return '已暂停';
  if (task.status === 'COMPLETED') return '已完成';
  if (!task.next_run_at) return '等待下次运行';
  return `下次运行 ${new Date(task.next_run_at).toLocaleString()}`;
}

export function ScheduledTasksScreen(props: ScheduledTasksScreenProps) {
  const [tasks, setTasks] = useState<ScheduledTaskView[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [providers, setProviders] = useState<ProviderConfigView[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTaskView | null>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft([], []));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ScheduledTaskView | null>(null);
  const [error, setError] = useState('');
  const [navigationWidth, setNavigationWidth] = useState(() => readWorkspaceNavigationWidth(WORKSPACE_NAVIGATION_DEFAULT_WIDTH, 'fielora:scheduled-navigation-width'));

  const readyProviders = useMemo(
    () => providers.filter((provider) => provider.lifecycle_status !== 'REMOVED' && provider.credential_present),
    [providers],
  );

  const refresh = useCallback(async () => {
    const [nextTasks, nextProjects, nextProviders] = await Promise.all([
      window.fielora.scheduledTask.list(), window.fielora.project.list(), window.fielora.provider.list(),
    ]);
    setTasks(nextTasks); setProjects(nextProjects); setProviders(nextProviders); setError('');
  }, []);

  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, [refresh]);

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((task) => (filter === 'ALL' || task.status === filter)
      && (!needle || `${task.name}\n${task.task}`.toLocaleLowerCase().includes(needle)));
  }, [filter, query, tasks]);

  function openCreate() {
    setEditing(null); setDraft(initialDraft(projects, readyProviders)); setError(''); setDialogOpen(true);
  }

  function openEdit(task: ScheduledTaskView) {
    setEditing(task);
    setDraft({
      name: task.name, task: task.task, fieldId: task.field_id, providerId: task.provider_config_id,
      permission: task.permission, cadence: task.cadence, localTime: task.local_time,
      weekday: task.weekday ?? new Date().getDay(), runAt: localInputValue(task.run_at ?? Date.now() + 60 * 60_000),
    });
    setError(''); setDialogOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId(editing?.id ?? 'CREATE'); setError('');
    try {
      const provider = providers.find((item) => item.id === draft.providerId);
      if (!provider?.credential_present || provider.lifecycle_status === 'REMOVED') throw new Error('请先在设置中配置可用的模型服务');
      const runAt = draft.cadence === 'ONCE' ? new Date(draft.runAt).getTime() : null;
      const base = {
        name: draft.name.trim(), task: draft.task.trim(), provider_config_id: provider.id,
        model_id: provider.default_model, permission: draft.permission, max_steps: 16,
        cadence: draft.cadence, local_time: draft.localTime,
        weekday: draft.cadence === 'WEEKLY' ? draft.weekday : null,
        run_at: runAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
      } satisfies Omit<CreateScheduledTaskRequest, 'field_id' | 'conversation_id'>;
      if (editing) {
        await window.fielora.scheduledTask.update({ id: editing.id, ...base });
      } else {
        if (!draft.fieldId) throw new Error('请先添加一个 Project');
        const conversation = await window.fielora.conversation.create({
          field_id: draft.fieldId, title: `已安排 · ${base.name}`,
          provider_config_id: provider.id, model_id: provider.default_model,
        });
        await window.fielora.scheduledTask.create({ ...base, field_id: draft.fieldId, conversation_id: conversation.id });
      }
      setDialogOpen(false); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusyId(null); }
  }

  async function mutate(id: string, action: () => Promise<unknown>) {
    setBusyId(id); setError('');
    try { await action(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusyId(null); }
  }

  function updateNavigationWidth(next: number) {
    const width = Math.min(Math.max(next, WORKSPACE_NAVIGATION_MIN_WIDTH), WORKSPACE_NAVIGATION_MAX_WIDTH);
    setNavigationWidth(width);
    persistWorkspaceNavigationWidth(width, 'fielora:scheduled-navigation-width');
  }

  return <WorkspaceSurface
    className="scheduled-root"
    testId="scheduled-tasks-screen"
    navigationWidth={navigationWidth}
    onNavigationWidthChange={updateNavigationWidth}
    navigationResizerTestId="scheduled-navigation-resizer"
    navigationResizerClassName="project-navigation-resizer"
    navigation={<PrimaryNav active="NOW" onProjects={props.onProjects} onNow={() => undefined} onBrowse={props.onBrowse} onFields={props.onFields} onNewConversation={props.onNewConversation} onSettings={props.onSettings} />}
  >
    <section className="scheduled-page collection-page" data-surface="content">
      <header className="scheduled-header page-header">
        <div><h1>已安排的任务</h1><p>让 Fielora 定时运行任务、设置提醒或持续监测更新。</p></div>
        <Button variant="primary" className="scheduled-create page-primary-action" onClick={openCreate}><AppIcon name="plus" size="sm"/>创建任务</Button>
      </header>
      <div className="collection-toolbar">
        <div className="scheduled-filters collection-filters" role="group" aria-label="任务状态">
          {filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
        <label className="collection-search"><AppIcon name="search" size="sm"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索已安排任务" /></label>
      </div>
      {error && <p className="scheduled-error" role="alert">{error}</p>}
      <section className="scheduled-list" aria-label="已安排任务列表">
        {visibleTasks.length === 0 ? <div className="scheduled-empty page-empty-state"><span className="collection-empty-icon"><AppIcon name="scheduled" size="lg"/></span><h2>{tasks.length === 0 ? '让重复的工作按时完成' : '没有匹配的任务'}</h2><p>{tasks.length === 0 ? '安排一次提醒，或让 Fielora 每天、每周为你处理任务。' : '请更换筛选条件或搜索词。'}</p>{tasks.length === 0 && <Button variant="secondary" onClick={openCreate}><AppIcon name="plus" size="sm"/>创建第一个任务</Button>}</div>
          : visibleTasks.map((task) => <article className="scheduled-row" key={task.id} data-status={task.status}>
            <span className="scheduled-status" aria-label={nextRunLabel(task)} />
            <div className="scheduled-copy"><strong>{task.name}</strong><p>{task.task}</p><small>{cadenceLabel(task)} · {nextRunLabel(task)}</small>{task.last_error && <small className="task-error">上次运行失败：{task.last_error}</small>}</div>
            <div className="scheduled-actions">
              <IconButton size="sm" label={`立即运行 ${task.name}`} disabled={busyId === task.id} icon={<AppIcon name="run" size="sm"/>} onClick={() => void mutate(task.id, () => window.fielora.scheduledTask.runNow({ id: task.id }))}/>
              {task.status !== 'COMPLETED' && <IconButton size="sm" label={`${task.status === 'ACTIVE' ? '暂停' : '恢复'} ${task.name}`} disabled={busyId === task.id} icon={<AppIcon name={task.status === 'ACTIVE' ? 'pause' : 'run'} size="sm"/>} onClick={() => void mutate(task.id, () => window.fielora.scheduledTask.update({ id: task.id, status: task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }))}/>}
              <IconButton size="sm" label={`编辑 ${task.name}`} icon={<AppIcon name="edit" size="sm"/>} onClick={() => openEdit(task)}/>
              <IconButton size="sm" label={`删除 ${task.name}`} disabled={busyId === task.id} icon={<AppIcon name="delete" size="sm"/>} onClick={() => setDeleteCandidate(task)}/>
            </div>
          </article>)}
      </section>
    </section>
    {dialogOpen && <div className="ui-dialog-backdrop scheduled-dialog-backdrop" role="presentation" data-effect="backdrop-dim" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialogOpen(false); }}>
      <form className="ui-dialog scheduled-dialog" role="dialog" aria-modal="true" aria-labelledby="scheduled-dialog-title" data-surface="overlay" onSubmit={save}>
        <header><div><h2 id="scheduled-dialog-title">{editing ? '编辑已安排任务' : '创建已安排任务'}</h2><p>运行结果会保存在独立对话中，方便之后查看。</p></div><IconButton size="sm" label="关闭" icon={<AppIcon name="close" size="sm"/>} onClick={() => setDialogOpen(false)}/></header>
        <label>名称<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：每日项目回顾" /></label>
        <label>任务说明<textarea required maxLength={32768} rows={4} value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} placeholder="描述要执行、提醒或监测的内容" /></label>
        <div className="scheduled-form-grid">
          <label>Project{editing ? <span className="scheduled-locked-value">{projects.find((project) => project.field_id === draft.fieldId)?.title ?? '当前 Project'}</span> : <SelectMenu value={draft.fieldId} ariaLabel="Project" options={projects.length ? projects.map((project) => ({ value: project.field_id, label: project.title })) : [{ value: '', label: '尚无 Project', disabled: true }]} onChange={(fieldId) => setDraft({ ...draft, fieldId })}/>}</label>
          <label>模型<SelectMenu value={draft.providerId} ariaLabel="模型" options={readyProviders.length ? readyProviders.map((provider) => ({ value: provider.id, label: `${provider.display_name} · ${provider.default_model}` })) : [{ value: '', label: '尚无可用模型', disabled: true }]} onChange={(providerId) => setDraft({ ...draft, providerId })}/></label>
          <label>频率<SelectMenu value={draft.cadence} ariaLabel="频率" options={[{ value: 'ONCE', label: '仅一次' }, { value: 'DAILY', label: '每天' }, { value: 'WEEKLY', label: '每周' }]} onChange={(cadence) => setDraft({ ...draft, cadence })}/></label>
          {draft.cadence === 'ONCE' ? <label>运行时间<input required type="datetime-local" value={draft.runAt} onChange={(event) => setDraft({ ...draft, runAt: event.target.value })} /></label> : <label>时间<input required type="time" value={draft.localTime} onChange={(event) => setDraft({ ...draft, localTime: event.target.value })} /></label>}
          {draft.cadence === 'WEEKLY' && <label>星期<SelectMenu value={String(draft.weekday)} ariaLabel="星期" options={weekdays.map((day, index) => ({ value: String(index), label: day }))} onChange={(weekday) => setDraft({ ...draft, weekday: Number(weekday) })}/></label>}
          <label>权限<SelectMenu value={draft.permission} ariaLabel="权限" options={[{ value: 'READ_ONLY', label: '只读' }, { value: 'REVIEW_CHANGES', label: '修改前请求审阅' }, { value: 'FULL_CONTROL', label: '完全控制' }]} onChange={(permission) => setDraft({ ...draft, permission })}/></label>
        </div>
        {error && <p className="scheduled-error" role="alert">{error}</p>}
        <footer><Button variant="secondary" onClick={() => setDialogOpen(false)}>取消</Button><Button type="submit" variant="primary" disabled={busyId !== null || projects.length === 0 || readyProviders.length === 0}>{editing ? '保存' : '创建任务'}</Button></footer>
      </form>
    </div>}
    {deleteCandidate && <TextActionDialog title="删除已安排任务" description={`将删除“${deleteCandidate.name}”的计划；对应对话和历史运行会保留。`} confirmLabel="删除任务" danger onCancel={() => setDeleteCandidate(null)} onConfirm={() => { const candidate = deleteCandidate; setDeleteCandidate(null); void mutate(candidate.id, () => window.fielora.scheduledTask.delete({ id: candidate.id })); }} testId="delete-scheduled-task"/>}
  </WorkspaceSurface>;
}
