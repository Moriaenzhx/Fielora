import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityView, FieldResumeV1View, FieldStateKind, FieldSummary, HealthDTO,
  ReferenceView, StateView, SurfaceLayoutV1,
} from '@fielora/contracts';
import fieloraLogo from '../../assets/fielora-brand-mark.svg';
import { PrimaryNav } from './PrimaryNav';
import { ProjectWorkspace } from './ProjectWorkspace';
import { SettingsScreen, type SettingsCategory } from './SettingsScreen';
import type { SelectedUsageModel } from './model-usage';
import { LibraryScreen } from './LibraryScreen';
import { ScheduledTasksScreen } from './ScheduledTasksScreen';
import { SelectMenu, TextActionDialog } from './UiPrimitives';
import { applyAppPreferences, readAppPreferences, resolveAppearance, resolveTitlebarCaption, writeAppPreferences, type AppPreferences } from './app-preferences';
import type { AppView } from './view-state';
import { notifyUiLanguagePreferenceChanged } from './ui-locale';
import {
  activityLabel,
  continuationPresentation,
  fieldModeLabels,
  focusLabel,
  referenceLifecycleLabels,
  screenFor,
  stateKindLabels,
  stateStatusLabels,
} from './view-state';

function paneId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const time = BigInt(Date.now());
  for (let index = 0; index < 6; index += 1) bytes[index] = Number((time >> BigInt((5 - index) * 8)) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `pane_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function App() {
  const [health, setHealth] = useState<HealthDTO>();
  const [fields, setFields] = useState<FieldSummary[]>([]);
  const [resume, setResume] = useState<FieldResumeV1View>();
  const [states, setStates] = useState<StateView[]>([]);
  const [references, setReferences] = useState<ReferenceView[]>([]);
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState<AppPreferences>(() => readAppPreferences(window.localStorage));
  const [appView, setAppView] = useState<AppView>(() => {
    const startup = readAppPreferences(window.localStorage).startupDestination;
    return startup === 'BROWSE' ? 'PROJECTS' : startup;
  });
  const [newConversationRequest, setNewConversationRequest] = useState(0);
  const [addProjectRequest, setAddProjectRequest] = useState(0);
  const [workspaceRequest, setWorkspaceRequest] = useState<{ id: number; tool: 'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER' }>({ id: 0, tool: 'FILES' });
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('GENERAL');
  const [modelSelection, setModelSelection] = useState<SelectedUsageModel | null>(null);
  const [settingsFieldId, setSettingsFieldId] = useState<string | null>(null);
  const [newStateKind, setNewStateKind] = useState<FieldStateKind>('TASK');
  const [stateEdit, setStateEdit] = useState<{ mode: 'REVISE' | 'SUPERSEDE'; state: StateView; value: string } | null>(null);
  const selectedFieldRef = useRef<string | undefined>(undefined);
  const appViewRef = useRef<AppView>(appView);
  const navigationHistory = useRef<AppView[]>([appView]);
  const navigationIndex = useRef(0);

  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const effectiveAppearance = resolveAppearance(preferences.appearance.themePreference, dark.matches);
      applyAppPreferences(document.documentElement, preferences, {
        prefersDark: dark.matches,
        prefersReducedMotion: reducedMotion.matches,
        supportsBackdrop: CSS.supports('backdrop-filter', 'blur(1px)'),
      });
      void window.fielora.window.setTitlebarTheme(effectiveAppearance, resolveTitlebarCaption(preferences.appearance, effectiveAppearance));
    };
    apply();
    dark.addEventListener('change', apply);
    reducedMotion.addEventListener('change', apply);
    return () => {
      dark.removeEventListener('change', apply);
      reducedMotion.removeEventListener('change', apply);
    };
  }, [preferences]);

  const refreshHealth = useCallback(async () => {
    try { const next = await window.fielora.core.getHealth(); setHealth(next); if (next.state === 'READY') setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  const refreshFields = useCallback(async () => {
    try { setFields(await window.fielora.field.list()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  const refreshReality = useCallback(async (fieldId: string) => {
    const [nextResume, nextStates, activeReferences, archivedReferences, nextActivities] = await Promise.all([
      window.fielora.field.resumeV1({ field_id: fieldId }),
      window.fielora.state.list({ field_id: fieldId, kind: null, status: null, cursor: null, limit: 100 }),
      window.fielora.reference.list({ field_id: fieldId, lifecycle: 'ACTIVE', cursor: null, limit: 100 }),
      window.fielora.reference.list({ field_id: fieldId, lifecycle: 'ARCHIVED', cursor: null, limit: 100 }),
      window.fielora.activity.list({ field_id: fieldId, cursor: null, limit: 50 }),
    ]);
    if (selectedFieldRef.current !== fieldId) return;
    setResume(nextResume); setStates(nextStates.items); setReferences([...activeReferences.items, ...archivedReferences.items]); setActivities(nextActivities.items);
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 350);
    const unsubscribe = window.fielora.core.subscribe((event) => {
      if (event.event === 'event.core.health' && 'error' in event && event.error) setError(event.error);
      void refreshHealth(); void refreshFields();
      if (event.event === 'event.field.changed' && 'field_id' in event && resume?.field.id === event.field_id) void refreshReality(event.field_id);
    });
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, [refreshFields, refreshHealth, refreshReality, resume?.field.id]);
  useEffect(() => { if (health?.state === 'READY') { void refreshFields(); if (resume?.field.id) void refreshReality(resume.field.id); } }, [health?.state, refreshFields, refreshReality, resume?.field.id]);

  useEffect(() => {
    document.body.dataset.activeFieldId = resume?.field.id ?? '';
    return () => { delete document.body.dataset.activeFieldId; };
  }, [resume?.field.id]);

  async function run(action: () => Promise<unknown>, fieldId?: string) {
    setBusy(true); setError('');
    try { await action(); if (fieldId) await refreshReality(fieldId); await refreshFields(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function openField(fieldId: string) { selectedFieldRef.current = fieldId; setAppView('FIELDS'); setBusy(true); try { await refreshReality(fieldId); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  async function createState(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!resume) return; const form = new FormData(event.currentTarget); const target = event.currentTarget;
    await run(async () => { await window.fielora.state.create({ field_id: resume.field.id, kind: newStateKind, content: String(form.get('content') ?? ''), confidence: null }); target.reset(); }, resume.field.id);
  }
  async function createReference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!resume) return; const form = new FormData(event.currentTarget); const target = event.currentTarget;
    await run(async () => { await window.fielora.reference.create({ field_id: resume.field.id, title: String(form.get('title') ?? ''), url: String(form.get('url') ?? '') }); target.reset(); }, resume.field.id);
  }
  async function focusState(state: StateView) { if (!resume) return; await run(() => window.fielora.field.setFocusV1({ field_id: resume.field.id, expected_field_revision: resume.field_revision, focus: { kind: 'STATE', state_id: state.id } }), resume.field.id); }
  async function transitionState(state: StateView, target: 'ACTIVE' | 'RESOLVED' | 'RETRACTED') { if (!resume) return; await run(() => window.fielora.state.transition({ field_id: resume.field.id, state_id: state.id, expected_state_revision: state.revision, target }), resume.field.id); }
  function supersedeState(state: StateView) { setStateEdit({ mode: 'SUPERSEDE', state, value: state.content }); }
  function reviseState(state: StateView) { setStateEdit({ mode: 'REVISE', state, value: state.content }); }
  async function saveStateEdit() {
    if (!resume || !stateEdit?.value.trim()) return;
    const current = stateEdit;
    await run(() => current.mode === 'REVISE'
      ? window.fielora.state.revise({ field_id: resume.field.id, state_id: current.state.id, expected_state_revision: current.state.revision, content: current.value.trim(), confidence: current.state.confidence })
      : window.fielora.state.supersede({ field_id: resume.field.id, state_id: current.state.id, expected_state_revision: current.state.revision, replacement_content: current.value.trim(), replacement_confidence: current.state.confidence }), resume.field.id);
    setStateEdit(null);
  }
  async function openReference(reference: ReferenceView) {
    if (!resume || reference.lifecycle !== 'ACTIVE') return;
    const layout: SurfaceLayoutV1 = { version: 1, template: 'PRIMARY_SUPPORT_RIGHT', primary: { pane_id: 'primary_task', primitive: 'TASK_PANE', binding: { kind: 'FIELD_TASKS' }, collapsed: false }, supporting: [{ pane_id: paneId(), primitive: 'REFERENCE_PANE', binding: { kind: 'REFERENCE', object_id: reference.id }, collapsed: false }], focused_pane_id: 'primary_task' };
    await run(async () => { await window.fielora.surface.saveSnapshotV1({ field_id: resume.field.id, layout }); await window.fielora.field.setFocusV1({ field_id: resume.field.id, expected_field_revision: resume.field_revision, focus: { kind: 'REFERENCE', object_id: reference.id } }); }, resume.field.id);
  }
  async function closeReferencePane() { if (!resume) return; await run(() => window.fielora.surface.saveSnapshotV1({ field_id: resume.field.id, layout: { version: 1, template: 'PRIMARY_ONLY', primary: { pane_id: 'primary_task', primitive: 'TASK_PANE', binding: { kind: 'FIELD_TASKS' }, collapsed: false }, supporting: [], focused_pane_id: 'primary_task' } }), resume.field.id); }
  async function archiveReference(reference: ReferenceView) { if (!resume) return; await run(() => window.fielora.reference.archive({ field_id: resume.field.id, object_id: reference.id, expected_object_revision: reference.revision }), resume.field.id); }
  async function restoreReference(reference: ReferenceView) { if (!resume) return; await run(() => window.fielora.reference.restore({ field_id: resume.field.id, object_id: reference.id, expected_object_revision: reference.revision }), resume.field.id); }

  const tasks = useMemo(() => states.filter((state) => state.kind === 'TASK' && !['SUPERSEDED', 'RETRACTED'].includes(state.status)), [states]);
  const supportingReferenceId = resume?.layout.supporting.find((pane) => pane.binding.kind === 'REFERENCE')?.binding;
  const supportingReference = supportingReferenceId?.kind === 'REFERENCE' ? references.find((reference) => reference.id === supportingReferenceId.object_id) : undefined;
  const continuation = resume ? continuationPresentation(resume, states, references) : undefined;
  const screen = screenFor(health, resume?.field.id, appView);
  const resetScreenSelection = useCallback(() => { selectedFieldRef.current = undefined; setResume(undefined); setInspectorOpen(false); }, []);
  const navigateTo = useCallback((next: AppView) => {
    resetScreenSelection();
    if (appViewRef.current === next) return;
    navigationHistory.current = navigationHistory.current.slice(0, navigationIndex.current + 1);
    navigationHistory.current.push(next);
    navigationIndex.current = navigationHistory.current.length - 1;
    appViewRef.current = next;
    setAppView(next);
  }, [resetScreenSelection]);
  const moveNavigation = useCallback((direction: -1 | 1) => {
    const nextIndex = navigationIndex.current + direction;
    if (nextIndex < 0 || nextIndex >= navigationHistory.current.length) return;
    navigationIndex.current = nextIndex;
    resetScreenSelection();
    appViewRef.current = navigationHistory.current[nextIndex]!;
    setAppView(appViewRef.current);
  }, [resetScreenSelection]);
  const goNow = useCallback(() => navigateTo('NOW'), [navigateTo]);
  const goProjects = useCallback(() => navigateTo('PROJECTS'), [navigateTo]);
  const goBrowse = useCallback(() => window.dispatchEvent(new CustomEvent('fielora:open-utility', { detail: 'BROWSER' })), []);
  const goFields = useCallback(() => navigateTo('FIELDS'), [navigateTo]);
  const goSettings = useCallback(() => { setSettingsFieldId(null); setSettingsCategory('GENERAL'); navigateTo('SETTINGS'); }, [navigateTo]);
  const goProjectSettings = useCallback((fieldId: string | null) => { setSettingsFieldId(fieldId); setSettingsCategory('GENERAL'); navigateTo('SETTINGS'); }, [navigateTo]);
  const goNewConversation = useCallback(() => { setNewConversationRequest((value) => value + 1); navigateTo('PROJECTS'); }, [navigateTo]);
  const openWorkspaceTool = useCallback((tool: 'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER') => {
    if (tool === 'TERMINAL' && appViewRef.current !== 'PROJECTS') return;
    setWorkspaceRequest((current) => ({ id: current.id + 1, tool }));
    if (tool !== 'TERMINAL' && tool !== 'BROWSER') navigateTo('PROJECTS');
  }, [navigateTo]);
  const requestAddProject = useCallback(() => { setAddProjectRequest((value) => value + 1); navigateTo('PROJECTS'); }, [navigateTo]);
  const updatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    writeAppPreferences(window.localStorage, next);
    notifyUiLanguagePreferenceChanged(next.languagePreference);
  };

  useEffect(() => {
    if (preferences.startupDestination !== 'BROWSE') return;
    const timer = window.setTimeout(goBrowse, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    appViewRef.current = appView;
    const notify = () => window.dispatchEvent(new CustomEvent('fielora:route-state', { detail: {
      route: appView,
      canBack: navigationIndex.current > 0,
      canForward: navigationIndex.current < navigationHistory.current.length - 1,
    } }));
    notify();
    const timer = window.setTimeout(notify, 0);
    return () => window.clearTimeout(timer);
  }, [appView]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const target = (event as CustomEvent<AppView>).detail;
      if (target === 'BROWSE') { goBrowse(); return; }
      if (['PROJECTS', 'NOW', 'LIBRARY', 'FIELDS', 'SETTINGS'].includes(target)) navigateTo(target);
    };
    const back = () => moveNavigation(-1);
    const forward = () => moveNavigation(1);
    const newConversation = () => goNewConversation();
    const addProject = () => requestAddProject();
    const workspace = (event: Event) => {
      const tool = (event as CustomEvent<'FILES' | 'DIFF' | 'TERMINAL' | 'BROWSER'>).detail;
      if (['FILES', 'DIFF', 'TERMINAL', 'BROWSER'].includes(tool)) openWorkspaceTool(tool);
    };
    const openSettings = (event: Event) => {
      const category = (event as CustomEvent<SettingsCategory>).detail;
      if (['GENERAL', 'APPEARANCE', 'MODELS', 'USAGE', 'EXTENSIONS', 'SKILLS', 'MCP', 'PLUGINS', 'STORAGE_DATA', 'SHORTCUTS', 'ABOUT', 'BROWSER'].includes(category)) setSettingsCategory(category);
      navigateTo('SETTINGS');
    };
    window.addEventListener('fielora:navigate', navigate);
    window.addEventListener('fielora:navigation-back', back);
    window.addEventListener('fielora:navigation-forward', forward);
    window.addEventListener('fielora:new-conversation', newConversation);
    window.addEventListener('fielora:add-project', addProject);
    window.addEventListener('fielora:open-workspace', workspace);
    window.addEventListener('fielora:open-settings', openSettings);
    return () => {
      window.removeEventListener('fielora:navigate', navigate);
      window.removeEventListener('fielora:navigation-back', back);
      window.removeEventListener('fielora:navigation-forward', forward);
      window.removeEventListener('fielora:new-conversation', newConversation);
      window.removeEventListener('fielora:add-project', addProject);
      window.removeEventListener('fielora:open-workspace', workspace);
      window.removeEventListener('fielora:open-settings', openSettings);
    };
  }, [goBrowse, goNewConversation, moveNavigation, navigateTo, openWorkspaceTool, requestAddProject]);

  if (screen === 'startup') {
    const failed = health && ['UNAVAILABLE', 'DEGRADED'].includes(health.state);
    return <main className="startup" data-testid="startup-screen"><img className="brand-logo" src={fieloraLogo} alt="Fielora" /><h1>{failed ? 'Fielora Core 暂时不可用' : '正在启动 Fielora…'}</h1><p>{failed ? (error || '核心服务未能启动。你可以重试，或打开日志目录查看详情。') : '正在恢复你的 Field Reality。'}</p>{failed && <div className="actions"><button onClick={() => void window.fielora.core.retry()} data-testid="retry-core">重试</button><button className="secondary" onClick={() => void window.fielora.core.openLogs()}>打开日志目录</button><button className="quiet" onClick={() => void window.fielora.core.quit()}>退出</button></div>}</main>;
  }

  if (screen === 'projects') return <ProjectWorkspace onModelSelectionChange={setModelSelection} onNow={goNow} onBrowse={goBrowse} onFields={goFields} onSettings={goProjectSettings} newConversationRequest={newConversationRequest} addProjectRequest={addProjectRequest} workspaceRequest={workspaceRequest} />;

  if (screen === 'library') return <LibraryScreen onProjects={goProjects} onNow={goNow} onBrowse={goBrowse} onFields={goFields} onNewConversation={goNewConversation} onSettings={goSettings} />;

  if (screen === 'settings') return <SettingsScreen modelSelection={modelSelection} preferences={preferences} onChange={updatePreferences} onBack={() => navigationIndex.current > 0 ? moveNavigation(-1) : goProjects()} initialCategory={settingsCategory} fieldId={settingsFieldId} />;

  if (screen === 'fields') {
    return <div className="shell" data-testid="fields-screen"><PrimaryNav active="FIELDS" onProjects={goProjects} onNow={goNow} onBrowse={goBrowse} onFields={() => undefined} onNewConversation={goNewConversation} onSettings={goSettings} /><main className="content fields-content">
      <header className="now-header"><div><p className="eyebrow">FIELDS</p><h1>持续工作的 Reality</h1><p>进入一个 Field，继续它当前真实的工作现场。</p></div></header>
      <section className="continue fields-list" aria-label="Fields">
        {fields.length === 0
          ? <div className="empty"><h3>还没有 Field</h3><p>可以回到 Now 创建第一个持续工作现场。</p></div>
          : fields.map((field) => <button className="field-row" key={field.id} onClick={() => void openField(field.id)} data-testid={`fields-field-${field.id}`}><span><strong>{field.title}</strong><small>{field.goal || '未设置目标'}</small></span><em>{focusLabel(field.current_focus)} →</em></button>)}
      </section>
      {error && <p className="error">{error}</p>}
    </main></div>;
  }

  if (screen === 'field' && resume) {
    return <><div className="shell" data-testid="field-screen"><PrimaryNav active="FIELDS" onProjects={goProjects} onNow={goNow} onBrowse={goBrowse} onFields={goFields} onNewConversation={goNewConversation} onSettings={goSettings} /><main className="content field-content">
      <button className="back" onClick={goNow}>← 返回 Now</button>
      <header className="field-header"><div><p className="eyebrow">FIELD</p><h1 data-testid="field-title">{resume.field.title}</h1><p>{resume.field.goal || '这个 Field 还没有目标说明。'}</p></div><div className="field-tools"><SelectMenu value={resume.field.current_mode ?? ''} ariaLabel="工作状态" options={[{ value: '', label: '选择工作状态' }, ...Object.entries(fieldModeLabels).map(([value, label]) => ({ value, label }))]} onChange={(value) => void run(() => window.fielora.field.updateMode({ field_id: resume.field.id, expected_field_revision: resume.field_revision, mode: value ? value as never : null }), resume.field.id)} /><button className="secondary-button" onClick={() => setInspectorOpen((open) => !open)} data-testid="toggle-inspector">{inspectorOpen ? '收起上下文' : '查看上下文'}</button></div></header>
      <div className="resume-strip" data-resume-reason={resume.continuation.reason}><span>{continuation?.cue}</span><strong data-testid="current-focus">{continuation?.label}</strong></div>
      <div className={`surface ${resume.layout.template !== 'PRIMARY_ONLY' ? 'with-support' : ''}`} data-template={resume.layout.template}>
        <section className="task-pane" data-testid="task-pane"><div className="pane-heading"><h2>推进中的工作</h2><span>{tasks.filter((task) => task.status === 'ACTIVE').length} 项进行中</span></div>
          {tasks.length === 0 ? <div className="empty task-empty" data-testid="empty-task-pane"><h3>还没有进行中的工作</h3><p>从下面记录第一件需要推进的事情。</p></div> : <div className="state-list">{tasks.map((state)=><article className={`state-row ${state.status.toLowerCase()}`} key={state.id}><button className="state-main" onClick={() => void focusState(state)}><span>{state.content}</span><small>{stateStatusLabels[state.status]}</small></button><div className="row-actions">{state.status === 'ACTIVE' && <button onClick={() => void transitionState(state,'RESOLVED')}>完成</button>}{state.status === 'RESOLVED' && <button onClick={() => void transitionState(state,'ACTIVE')}>重开</button>}<button onClick={() => void reviseState(state)}>修订</button><button onClick={() => void supersedeState(state)}>替代</button></div></article>)}</div>}
          <form className="quick-create" onSubmit={createState}><SelectMenu value={newStateKind} ariaLabel="记录类型" options={Object.entries(stateKindLabels).map(([value, label]) => ({ value: value as FieldStateKind, label }))} onChange={setNewStateKind} /><input name="content" required maxLength={4000} placeholder="记录下一步、问题或阻塞…" data-testid="create-state-content" /><button type="submit" disabled={busy} data-testid="create-state">记录</button></form>
        </section>
        {resume.layout.template !== 'PRIMARY_ONLY' && <section className="reference-pane" data-testid="reference-pane"><div className="pane-heading"><div><p className="eyebrow">参考资料</p><h2>{supportingReference?.title ?? '参考资料暂不可用'}</h2></div><button className="icon-button" aria-label="关闭参考资料" onClick={() => void closeReferencePane()}>×</button></div>{supportingReference?.lifecycle === 'ACTIVE' ? <><p className="inert-url">{supportingReference.canonical_url}</p><p className="muted">已保存来源地址；这里不会自动打开外部网页。</p><button className="danger-link" onClick={() => void archiveReference(supportingReference)}>归档</button></> : <div className="empty"><p>这项参考资料已归档或不可用。当前工作不会被旧记录覆盖。</p></div>}</section>}
      </div>
      {inspectorOpen && <section className="context-inspector" data-testid="context-inspector"><div className="inspector-head"><div><p className="eyebrow">按需查看</p><h2>当前上下文</h2></div><button className="icon-button" aria-label="收起上下文" onClick={() => setInspectorOpen(false)}>×</button></div><div className="inspector-grid"><div><h3>待确认与阻塞</h3>{states.filter((state)=>['QUESTION','BLOCKER'].includes(state.kind)&&state.status==='ACTIVE').map((state)=><article className="context-row" key={state.id}><button onClick={() => void focusState(state)}>{stateKindLabels[state.kind]}：{state.content}</button><div><button onClick={() => void transitionState(state,'RESOLVED')}>解决</button><button onClick={() => void supersedeState(state)}>替代</button></div></article>)}</div><div><h3>参考资料</h3>{references.map((reference)=><article className="context-row" key={reference.id}><div><strong>{reference.title}</strong><small>{referenceLifecycleLabels[reference.lifecycle]}</small></div><div>{reference.lifecycle==='ACTIVE'?<><button onClick={() => void openReference(reference)} data-testid={`open-reference-${reference.title}`}>打开工作面</button><button onClick={() => void archiveReference(reference)}>归档</button></>:<button onClick={() => void restoreReference(reference)}>恢复</button>}</div></article>)}<form className="reference-create" onSubmit={createReference}><input name="title" required maxLength={120} placeholder="参考资料名称" data-testid="reference-title" /><input name="url" required maxLength={2048} placeholder="https://…" data-testid="reference-url" /><button type="submit" disabled={busy} data-testid="create-reference">保存</button></form></div><div><h3>最近动态</h3>{activities.slice(0,8).map((activity)=><div className="activity-row" key={activity.id}><span>{activityLabel(activity.action)}</span><small>{new Date(activity.created_at).toLocaleTimeString()}</small></div>)}</div></div></section>}
      {error && <p className="error">{error}</p>}
    </main></div>{stateEdit && <TextActionDialog title={stateEdit.mode === 'REVISE' ? '修订记录' : '替代记录'} description={stateEdit.mode === 'REVISE' ? '保留同一条记录并更新内容。' : '创建替代记录，并保留原记录的历史。'} value={stateEdit.value} multiline confirmLabel={stateEdit.mode === 'REVISE' ? '保存修订' : '确认替代'} onChange={(value) => setStateEdit((current) => current ? { ...current, value } : null)} onCancel={() => setStateEdit(null)} onConfirm={() => void saveStateEdit()} testId="state-edit-dialog" />}</>;
  }

  return <ScheduledTasksScreen onProjects={goProjects} onBrowse={goBrowse} onFields={goFields} onNewConversation={goNewConversation} onSettings={goSettings} />;
}
