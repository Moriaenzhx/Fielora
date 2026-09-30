import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelInvocationEvent, ProviderConfigView } from '@fielora/contracts';
import fieloraMark from '../../assets/fielora-brand-mark.svg';
import { resolveUiLocale, type AppPreferences, type StartupDestination, type UiLanguagePreference } from './app-preferences';
import { AppearanceSettings } from './AppearanceSettings';
import { AgentBudgetSettings } from './AgentBudgetSettings';
import { ModelUsageSettings } from './ModelUsageSettings';
import type { SelectedUsageModel } from './model-usage';
import { AppIcon, type AppIconName } from './ui';
import { Button, SelectMenu, SettingsToggle } from './UiPrimitives';
import {
  persistWorkspaceNavigationWidth,
  readWorkspaceNavigationWidth,
  WORKSPACE_NAVIGATION_DEFAULT_WIDTH,
  WORKSPACE_NAVIGATION_MAX_WIDTH,
  WORKSPACE_NAVIGATION_MIN_WIDTH,
  WorkspaceSurface,
} from './WorkspaceSurface';
import { StorageDataSettings } from './StorageDataSettings';
import { CapabilityExtensionsSettings, type CapabilityExtensionTab } from './CapabilityExtensionsSettings';
import { useUiLocale, type UiTranslator } from './ui-locale';

export type SettingsCategory = 'GENERAL' | 'APPEARANCE' | 'MODELS' | 'USAGE' | 'EXTENSIONS' | 'SKILLS' | 'MCP' | 'PLUGINS' | 'STORAGE_DATA' | 'SHORTCUTS' | 'ABOUT' | 'BROWSER';

interface SettingsScreenProps {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onBack: () => void;
  initialCategory?: SettingsCategory;
  fieldId?: string | null;
  modelSelection?: SelectedUsageModel | null;
}

function settingsCategories(t: UiTranslator): Array<{ id: SettingsCategory; label: string; keywords: string; icon: AppIconName }> {
  return [
    { id: 'GENERAL', label: t('常规', 'General'), keywords: '启动 页面 默认 language 语言 startup default 执行 展示 精简 详细 agent display', icon: 'settings' },
    { id: 'APPEARANCE', label: t('外观', 'Appearance'), keywords: '主题 浅色 深色 系统 字体 密度 圆角 动效 theme appearance', icon: 'appearance' },
    { id: 'MODELS', label: t('模型配置', 'Model settings'), keywords: 'provider api key model token usage billing cost budget 模型 服务 计费 统计 费用 预算 时长 长任务', icon: 'models' },
    { id: 'EXTENSIONS', label: t('能力与扩展', 'Capabilities & extensions'), keywords: 'skills agent skill mcp tool server stdio plugin extension local unpacked 插件 扩展 本地 工具 连接', icon: 'extensions' },
    { id: 'STORAGE_DATA', label: t('存储与数据', 'Storage & data'), keywords: 'storage data library cache profile backup import export 存储 数据 资料库 缓存 备份 迁移', icon: 'storage' },
    { id: 'SHORTCUTS', label: t('键盘快捷键', 'Keyboard shortcuts'), keywords: '快捷键 keyboard shortcut', icon: 'keyboard' },
    { id: 'ABOUT', label: t('关于', 'About'), keywords: '版本 about', icon: 'info' },
  ];
}

function extensionTabFor(category: SettingsCategory): CapabilityExtensionTab {
  return category === 'MCP' || category === 'PLUGINS' ? category : 'SKILLS';
}

function normalizedCategory(category: SettingsCategory): SettingsCategory {
  if (category === 'USAGE') return 'MODELS';
  return ['SKILLS', 'MCP', 'PLUGINS'].includes(category) ? 'EXTENSIONS' : category;
}

function probeFailureLabel(provider: ProviderConfigView, t: UiTranslator, code?: string | null): string {
  if (provider.provider_kind === 'OPENAI' && /^qwen/i.test(provider.default_model)) return t('连接失败 · 当前是 OpenAI 官方协议，但模型像兼容服务；请检查协议与 Base URL', 'Connection failed · The selected protocol is official OpenAI, but the model appears to use a compatible service. Check the protocol and Base URL.');
  const labels: Record<string, string> = {
    CREDENTIAL_REJECTED: t('API Key 无效或已失效', 'The API key is invalid or expired'),
    MODEL_NOT_AVAILABLE: t('模型不可用，请检查 Model ID', 'The model is unavailable. Check the Model ID'),
    PROVIDER_RATE_LIMITED: t('服务限流，请稍后重试', 'The service is rate limited. Try again later'),
    PROVIDER_UNAVAILABLE: t('服务不可达，请检查网络与 Base URL', 'The service is unavailable. Check the network and Base URL'),
    PROVIDER_PROTOCOL_ERROR: t('服务响应与所选协议不兼容', 'The service response is incompatible with the selected protocol'),
    CUSTOM_ENDPOINT_REJECTED: t('自定义地址未通过安全检查', 'The custom endpoint did not pass security checks'),
  };
  return `${t('连接失败', 'Connection failed')} · ${labels[code ?? ''] ?? code ?? t('服务异常', 'Service error')}`;
}

export function SettingsScreen({ preferences, onChange, onBack, initialCategory = 'GENERAL', fieldId = null, modelSelection = null }: SettingsScreenProps) {
  const { t } = useUiLocale();
  const [category, setCategory] = useState<SettingsCategory>(() => normalizedCategory(initialCategory));
  const [extensionTab, setExtensionTab] = useState<CapabilityExtensionTab>(() => extensionTabFor(initialCategory));
  const [modelTab, setModelTab] = useState<'SERVICES' | 'USAGE' | 'BUDGET'>(() => initialCategory === 'USAGE' ? 'USAGE' : 'SERVICES');
  const [query, setQuery] = useState('');
  const [providers, setProviders] = useState<ProviderConfigView[]>([]);
  const [providerError, setProviderError] = useState('');
  const [providerProbe, setProviderProbe] = useState<Record<string, string>>({});
  const [navigationWidth, setNavigationWidth] = useState(() => readWorkspaceNavigationWidth(WORKSPACE_NAVIGATION_DEFAULT_WIDTH, 'fielora:settings-navigation-width'));
  const probeInvocations = useRef(new Map<string, string>());

  const refreshProviders = useCallback(async () => {
    try { setProviders(await window.fielora.provider.list()); setProviderError(''); }
    catch (reason) { setProviderError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);

  useEffect(() => {
    document.body.dataset.settingsScreen = 'true';
    void refreshProviders();
    const changed = () => void refreshProviders();
    window.addEventListener('fielora:providers-changed', changed);
    return () => { delete document.body.dataset.settingsScreen; window.removeEventListener('fielora:providers-changed', changed); };
  }, [refreshProviders]);

  useEffect(() => {
    setCategory(normalizedCategory(initialCategory));
    if (initialCategory === 'USAGE') setModelTab('USAGE');
    if (initialCategory === 'MODELS') setModelTab('SERVICES');
    if (['EXTENSIONS', 'SKILLS', 'MCP', 'PLUGINS'].includes(initialCategory)) setExtensionTab(extensionTabFor(initialCategory));
  }, [initialCategory]);

  useEffect(() => window.fielora.core.subscribe((event) => {
    if (event.event !== 'event.model.invocation') return;
    const model = event as ModelInvocationEvent;
    const providerId = probeInvocations.current.get(model.invocation_id);
    if (!providerId) return;
    if (model.kind === 'COMPLETED') setProviderProbe((current) => ({ ...current, [providerId]: '连接正常' }));
    if (model.kind === 'FAILED') {
      const provider = providers.find((item) => item.id === providerId);
      setProviderProbe((current) => ({ ...current, [providerId]: provider ? probeFailureLabel(provider, t, model.error_code) : `${t('连接失败', 'Connection failed')} · ${model.error_code ?? t('服务异常', 'Service error')}` }));
    }
    if (model.kind === 'CANCELLED') setProviderProbe((current) => ({ ...current, [providerId]: '测试已取消' }));
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(model.kind)) probeInvocations.current.delete(model.invocation_id);
  }), [providers, t]);

  const categories = useMemo(() => settingsCategories(t), [t]);
  const visibleCategories = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? categories.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(needle)) : categories;
  }, [categories, query]);
  const update = (patch: Partial<AppPreferences>) => onChange({ ...preferences, ...patch });
  const activeProviders = providers.filter((provider) => provider.lifecycle_status !== 'REMOVED');

  async function probe(provider: ProviderConfigView) {
    setProviderProbe((current) => ({ ...current, [provider.id]: '正在测试…' }));
    try {
      const result = await window.fielora.provider.probe({ provider_config_id: provider.id });
      probeInvocations.current.set(result.invocation_id, provider.id);
    } catch (reason) {
      setProviderProbe((current) => ({ ...current, [provider.id]: `连接失败 · ${reason instanceof Error ? reason.message : String(reason)}` }));
    }
  }

  function updateNavigationWidth(next: number) {
    const width = Math.min(Math.max(next, WORKSPACE_NAVIGATION_MIN_WIDTH), WORKSPACE_NAVIGATION_MAX_WIDTH);
    setNavigationWidth(width);
    persistWorkspaceNavigationWidth(width, 'fielora:settings-navigation-width');
  }

  const systemUiLocale = resolveUiLocale('SYSTEM', navigator.language || navigator.languages?.[0] || 'en');
  const languageOptions = [
    { value: 'SYSTEM', label: t('跟随系统', 'Follow system') },
    { value: 'ZH_CN', label: '简体中文' },
    { value: 'EN', label: 'English' },
  ];

  return <WorkspaceSurface className="settings-root" testId="settings-screen" navigationWidth={navigationWidth} onNavigationWidthChange={updateNavigationWidth} navigationResizerTestId="settings-navigation-resizer" navigationResizerClassName="settings-navigation-resizer" navigation={<aside className="settings-navigation" data-surface="chrome" data-brand-chrome="navigation">
      <button className="settings-back" onClick={onBack} data-testid="settings-back">← <span>{t('返回应用', 'Back to app')}</span></button>
      <label className="settings-search"><span className="sr-only">{t('搜索设置', 'Search settings')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索设置…', 'Search settings…')} data-testid="settings-search" /></label>
      <nav aria-label={t('设置分类', 'Settings categories')}>
        {visibleCategories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)} data-testid={`settings-category-${item.id.toLowerCase()}`}><AppIcon name={item.icon}/><span>{item.label}</span></button>)}
      </nav>
      <div className="settings-brand"><img src={fieloraMark} alt="" /><span>Fielora Desktop</span></div>
    </aside>}>
    <section className="settings-content" data-surface="content">
      {category === 'GENERAL' && <div className="settings-section" data-testid="settings-general"><header><h1>{t('常规', 'General')}</h1></header><section className="settings-card">
        <div className="settings-row"><span><strong>{t('界面语言', 'Interface language')}</strong><small>{preferences.languagePreference === 'SYSTEM' ? t(`跟随 Windows 显示语言；当前为${systemUiLocale === 'zh-CN' ? '简体中文' : ' English'}。`, `Uses the Windows display language; currently ${systemUiLocale === 'zh-CN' ? 'Simplified Chinese' : 'English'}.`) : t('更改后立即生效，不需要重启。', 'Changes apply immediately without restarting.')}</small></span><SelectMenu value={preferences.languagePreference} onChange={(value) => update({ languagePreference: value as UiLanguagePreference })} ariaLabel={t('界面语言', 'Interface language')} testId="ui-language" options={languageOptions} /></div>
        <div className="settings-row"><span><strong>{t('默认工作面', 'Default workspace')}</strong><small>{t('选择启动 Fielora 时显示的主要工作面。', 'Choose the primary workspace shown when Fielora starts.')}</small></span><SelectMenu value={preferences.startupDestination === 'NOW' ? 'NOW' : 'PROJECTS'} onChange={(value) => update({ startupDestination: value as StartupDestination })} ariaLabel={t('默认工作面', 'Default workspace')} testId="startup-destination" options={[{ value: 'PROJECTS', label: t('项目', 'Projects') }, { value: 'NOW', label: t('现在', 'Now') }]} /></div>
      </section></div>}
      {category === 'BROWSER' && <div className="settings-section" data-testid="settings-browser"><header><h1>浏览器设置</h1></header><section className="settings-card"><div className="settings-row"><span><strong>启动时恢复浏览器</strong><small>启动 Fielora 时恢复上次打开的浏览页面。</small></span><SettingsToggle value={preferences.startupDestination === 'BROWSE'} onChange={(value) => update({ startupDestination: value ? 'BROWSE' : 'PROJECTS' })} label="启动时恢复浏览器" testId="browser-startup-toggle" /></div><div className="settings-row"><span><strong>搜索引擎</strong></span><em className="settings-readonly-value">Google</em></div><div className="settings-row"><span><strong>浏览数据</strong><small>Cookie 和网站登录状态仅保留在此设备，不会包含在 Fielora 迁移备份中。</small></span><em className="settings-readonly-value">仅此设备</em></div></section></div>}
      {category === 'APPEARANCE' && <AppearanceSettings appearance={preferences.appearance} onChange={(appearance) => onChange({ ...preferences, appearance })} />}
      {category === 'MODELS' && <div className="settings-section" data-testid="settings-models">
        <header><h1>{t('模型配置', 'Model settings')}</h1></header>
        <div className="settings-extension-tabs" role="tablist" aria-label={t('模型配置', 'Model settings')}>
          {(['SERVICES', 'USAGE', 'BUDGET'] as const).map((tab, index, tabs) => <button key={tab} id={`settings-model-tab-${tab.toLowerCase()}`} data-testid={`settings-model-tab-${tab.toLowerCase()}`} type="button" role="tab" aria-selected={modelTab === tab} aria-controls="settings-model-panel" tabIndex={modelTab === tab ? 0 : -1} className={modelTab === tab ? 'active' : ''} onClick={() => setModelTab(tab)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); const selected = tabs[next]!; setModelTab(selected); document.getElementById(`settings-model-tab-${selected.toLowerCase()}`)?.focus(); }
          }}>{tab === 'SERVICES' ? t('模型服务', 'Services') : tab === 'USAGE' ? t('用量统计', 'Usage & cost') : t('任务预算', 'Task budget')}</button>)}
        </div>
        <section id="settings-model-panel" role="tabpanel" aria-labelledby={`settings-model-tab-${modelTab.toLowerCase()}`}>
        {modelTab === 'USAGE' && <ModelUsageSettings providers={providers} selection={modelSelection} embedded/>}
        {modelTab === 'BUDGET' && <AgentBudgetSettings value={preferences.agentResourceBudget} onChange={agentResourceBudget => update({ agentResourceBudget })}/>}
        {modelTab === 'SERVICES' && <section className="settings-card settings-provider-card">
          <div className="settings-card-heading"><span><strong>已配置服务</strong><small>API Key 继续存放在 Windows Credential Manager。</small></span><Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('fielora:open-provider-setup'))} data-testid="manage-providers">添加模型服务</Button></div>
          {providerError && <p className="error">{providerError}</p>}
          {activeProviders.length === 0 ? <p className="settings-empty">尚未配置模型服务。点击“添加模型服务”填写协议、Base URL、API Key 和 Model ID。</p> : <div className="settings-provider-list">{activeProviders.map((provider) => <article key={provider.id}>
            <span><strong>{provider.display_name}</strong><small>{provider.provider_kind} · {provider.default_model}</small><small>{provider.base_url ?? '官方服务地址'}</small></span>
            <div><em className={providerProbe[provider.id] === '连接正常' ? 'pass' : provider.credential_present ? 'ready' : 'warning'}>{providerProbe[provider.id] ?? (provider.credential_present ? '凭据已保存 · 未测试' : '需要凭据')}</em><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('fielora:open-provider-setup', { detail: provider.id }))} data-testid={`settings-edit-${provider.id}`}>编辑</button><button type="button" disabled={!provider.credential_present || providerProbe[provider.id] === '正在测试…'} onClick={() => void probe(provider)} data-testid={`settings-probe-${provider.id}`}>测试连接</button></div>
          </article>)}</div>}
        </section>}
        </section>
      </div>}
      {category === 'EXTENSIONS' && <CapabilityExtensionsSettings activeTab={extensionTab} fieldId={fieldId} onTabChange={setExtensionTab}/>}
      {category === 'STORAGE_DATA' && <StorageDataSettings preferences={preferences} onPreferencesChange={onChange} />}
      {category === 'SHORTCUTS' && <div className="settings-section" data-testid="settings-shortcuts"><header><h1>键盘快捷键</h1></header><section className="settings-card shortcut-list"><div><span>新对话</span><kbd>Ctrl+N</kbd></div><div><span>打开 Project 文件夹</span><kbd>Ctrl+O</kbd></div><div><span>显示或隐藏侧栏</span><kbd>Ctrl+B</kbd></div><div><span>审阅</span><kbd>Ctrl+Shift+G</kbd></div><div><span>终端</span><kbd>Ctrl+`</kbd></div><div><span>浏览器 / 新建浏览页面</span><kbd>Ctrl+T</kbd></div><div><span>文件</span><kbd>Ctrl+P</kbd></div><div><span>地址栏</span><kbd>Ctrl+L</kbd></div><div><span>刷新网页</span><kbd>Ctrl+R</kbd></div></section></div>}
      {category === 'ABOUT' && <div className="settings-section" data-testid="settings-about"><header><h1>关于</h1></header><section className="settings-card about-card"><img src={fieloraMark} alt="" /><span><strong>Fielora Desktop 0.1.0</strong><small>Windows 11 x64 · Electron 43.4.0 · schema 11</small></span></section></div>}
    </section>
  </WorkspaceSurface>;
}
