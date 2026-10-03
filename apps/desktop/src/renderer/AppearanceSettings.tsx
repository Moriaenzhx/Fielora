import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  AppearancePreferences,
  BackgroundGradientOverride,
  CodeFont,
  CodeFontSize,
  ReducedMotionPreference,
  UiFont,
  UiFontSize,
} from './app-preferences';
import {
  appearanceThemeDefaults,
  defaultAppearancePreferences,
  isHexColor,
  resolveAppearance,
  fontFamilyCss,
} from './app-preferences';
import { Button, SelectMenu, SettingsToggle, TextActionDialog } from './UiPrimitives';
import { useUiLocale } from './ui-locale';
import type { FontCatalog } from '../types';
import { isMac } from './platform';

interface AppearanceSettingsProps {
  appearance: AppearancePreferences;
  onChange: (appearance: AppearancePreferences) => void;
}

interface HsvColor { h: number; s: number; v: number }

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hexToHsv(value: string): HsvColor {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels as [number, number, number];
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let h = 0;
  if (delta > 0) {
    if (maximum === r) h = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: h < 0 ? h + 360 : h, s: maximum === 0 ? 0 : delta / maximum, v: maximum };
}

function hsvToHex({ h, s, v }: HsvColor): string {
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = v - chroma;
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function positionPicker(anchor: HTMLElement, width: number, height: number): { left: number; top: number } {
  const margin = 12;
  const gap = 8;
  const rect = anchor.getBoundingClientRect();
  const left = clamp(rect.right - width, margin, Math.max(margin, window.innerWidth - width - margin));
  const below = rect.bottom + gap;
  const top = below + height <= window.innerHeight - margin
    ? below
    : Math.max(margin, rect.top - gap - height);
  return { left, top };
}

function ColorPickerPopover({ label, value, onChange, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const { t } = useUiLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hsv = hexToHsv(value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      if (triggerRef.current) setPosition(positionPicker(triggerRef.current, 280, 254));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function beginDrag(event: ReactPointerEvent<HTMLElement>, kind: 'SV' | 'HUE') {
    event.preventDefault();
    const surface = event.currentTarget;
    const update = (clientX: number, clientY: number) => {
      const rect = surface.getBoundingClientRect();
      if (kind === 'SV') {
        onChange(hsvToHex({ h: hsv.h, s: clamp((clientX - rect.left) / rect.width), v: 1 - clamp((clientY - rect.top) / rect.height) }));
      } else {
        onChange(hsvToHex({ h: clamp((clientX - rect.left) / rect.width) * 359.999, s: hsv.s, v: hsv.v }));
      }
    };
    update(event.clientX, event.clientY);
    const move = (next: PointerEvent) => update(next.clientX, next.clientY);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  return <>
    <button ref={triggerRef} type="button" className="appearance-color-picker-button" style={{ background: value }} aria-label={t(`${label}颜色选择器`, `${label} color picker`)} aria-expanded={open} data-testid={`${testId}-picker`} onClick={() => setOpen((current) => !current)}/>
    {open && createPortal(<div ref={popoverRef} className="appearance-color-popover" role="dialog" aria-label={t(`${label}颜色选择器`, `${label} color picker`)} data-surface="overlay" data-testid={`${testId}-popover`} style={{ left: position.left, top: position.top }}>
      <div className="appearance-color-sv" onPointerDown={(event) => beginDrag(event, 'SV')} style={{ '--picker-hue': `hsl(${hsv.h} 100% 50%)` } as CSSProperties}>
        <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}/>
      </div>
      <div className="appearance-color-hue" onPointerDown={(event) => beginDrag(event, 'HUE')}><span style={{ left: `${(hsv.h / 360) * 100}%` }}/></div>
      <div className="appearance-color-popover-value"><span style={{ background: value }}/><strong>{value}</strong></div>
    </div>, document.body)}
  </>;
}

function ColorValueField({ label, value, preview, displayText, disabled = false, onChange, testId }: {
  label: string;
  value: string;
  preview?: string;
  displayText?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const normalized = draft.trim().toUpperCase();
    if (isHexColor(normalized)) onChange(normalized);
    else setDraft(value);
  };
  return <div className={`appearance-color-value${disabled ? ' is-default' : ''}`}>
    <span className="appearance-color-swatch" style={{ background: preview ?? value }} aria-hidden="true"/>
    {displayText ? <span className="appearance-color-summary" data-testid={`${testId}-summary`}>{displayText}</span> : <input className="appearance-color-hex" value={draft} readOnly={disabled} maxLength={7} spellCheck={false} aria-label={`${label} HEX`} data-testid={`${testId}-hex`} onChange={(event) => {
      const next = event.target.value.toUpperCase();
      setDraft(next);
      if (isHexColor(next)) onChange(next);
    }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}/>}
    {disabled ? <span className="appearance-color-picker-preview" style={{ background: preview ?? value }} aria-hidden="true"/> : <ColorPickerPopover label={label} value={value} onChange={onChange} testId={testId}/>}
  </div>;
}

function BackgroundOverrideControl({ label, solid, gradient, themeDefault, defaultDescription, defaultPreview, suggestedGradient, onSolidChange, onGradientChange, testId }: {
  label: string;
  solid: string | null;
  gradient: BackgroundGradientOverride | null;
  themeDefault: string;
  defaultDescription?: string;
  defaultPreview?: string;
  suggestedGradient: BackgroundGradientOverride;
  onSolidChange: (value: string | null) => void;
  onGradientChange: (value: BackgroundGradientOverride | null) => void;
  testId: string;
}) {
  const { t } = useUiLocale();
  const mode = gradient ? 'GRADIENT' : solid ? 'SOLID' : 'DEFAULT';
  const description = mode === 'DEFAULT' ? (defaultDescription ?? t(`当前主题默认 ${themeDefault}`, `Current theme default ${themeDefault}`)) : mode === 'GRADIENT' ? t('三个颜色中心：左下、左上、右上', 'Three color centers: bottom left, top left, top right') : t('覆盖当前主题的单色 Base Color', 'Overrides the current theme with a solid base color');
  const selectMode = (next: string) => {
    if (next === 'DEFAULT') { onSolidChange(null); onGradientChange(null); }
    else if (next === 'SOLID') { onGradientChange(null); onSolidChange(solid ?? gradient?.from ?? themeDefault); }
    else { onSolidChange(null); onGradientChange(gradient ?? { ...suggestedGradient, from: solid ?? suggestedGradient.from }); }
  };

  return <div className="appearance-setting-row appearance-color-row">
    <span><strong>{label}</strong><small>{description}</small></span>
    <div className="appearance-color-controls">
      <SelectMenu value={mode} onChange={selectMode} ariaLabel={t(`${label}来源`, `${label} source`)} testId={`${testId}-mode`} options={[{ value: 'DEFAULT', label: t('默认', 'Default') }, { value: 'SOLID', label: t('单色', 'Solid') }, { value: 'GRADIENT', label: t('渐变', 'Gradient') }]}/>
      {mode === 'GRADIENT' && gradient ? <div className="appearance-gradient-editor">
        {([
          ['bottomLeft', t('左下', 'Bottom left')], ['from', t('左上', 'Top left')], ['to', t('右上', 'Top right')],
        ] as const).map(([key, position]) => <div className="appearance-gradient-center" key={key}><small>{position}</small><ColorValueField label={`${label} · ${position}`} value={gradient[key] ?? gradient.from} onChange={(color) => onGradientChange({ ...gradient, [key]: color })} testId={`${testId}-${key}`}/></div>)}
      </div> : <ColorValueField label={label} value={solid ?? themeDefault} preview={mode === 'DEFAULT' ? defaultPreview : undefined} displayText={mode === 'DEFAULT' && defaultPreview ? t('主题渐变', 'Theme gradient') : undefined} disabled={mode === 'DEFAULT'} onChange={(next) => onSolidChange(next)} testId={testId}/>}
    </div>
  </div>;
}

function SolidColorOverrideControl({ label, value, themeDefault, onChange, testId }: {
  label: string;
  value: string | null;
  themeDefault: string;
  onChange: (value: string | null) => void;
  testId: string;
}) {
  const { t } = useUiLocale();
  const custom = value !== null;
  return <div className="appearance-setting-row appearance-color-row">
    <span><strong>{label}</strong><small>{custom ? t('覆盖当前主题的 Base Color', 'Overrides the current theme base color') : t(`当前主题默认 ${themeDefault}`, `Current theme default ${themeDefault}`)}</small></span>
    <div className="appearance-color-controls">
      <SelectMenu value={custom ? 'CUSTOM' : 'DEFAULT'} onChange={(next) => onChange(next === 'CUSTOM' ? themeDefault : null)} ariaLabel={t(`${label}来源`, `${label} source`)} testId={`${testId}-mode`} options={[{ value: 'DEFAULT', label: t('默认', 'Default') }, { value: 'CUSTOM', label: t('自定义', 'Custom') }]}/>
      <ColorValueField label={label} value={value ?? themeDefault} disabled={!custom} onChange={(next) => onChange(next)} testId={testId}/>
    </div>
  </div>;
}

export function AppearanceSettings({ appearance, onChange }: AppearanceSettingsProps) {
  const { t } = useUiLocale();
  const [resetOpen, setResetOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const update = (patch: Partial<AppearancePreferences>) => onChange({ ...appearance, ...patch });
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveAppearance = resolveAppearance(appearance.themePreference, prefersDark);
  const themeDefaults = appearanceThemeDefaults(effectiveAppearance);
  const [fontCatalog, setFontCatalog] = useState<FontCatalog | null>(null);
  const [fontStatus, setFontStatus] = useState('');
  const [fontBusy, setFontBusy] = useState(false);
  const refreshFonts = async () => {
    try { setFontCatalog(await window.fielora.fonts.list()); }
    catch { setFontStatus(t('无法读取本机字体，请重试。', 'Could not read installed fonts. Please retry.')); }
  };
  useEffect(() => { void refreshFonts(); }, []);
  const fontOptions = (code: boolean) => {
    const presets = code
      ? [{ value: 'SYSTEM_MONO', label: t('系统等宽', 'System monospace'), families: [] }, { value: 'CASCADIA_CODE', label: 'Cascadia Code', families: ['Cascadia Code'] }, { value: 'JETBRAINS_MONO', label: 'JetBrains Mono', families: ['JetBrains Mono'] }, { value: 'CONSOLAS', label: 'Consolas', families: ['Consolas'] }]
      : [{ value: 'SYSTEM', label: t('系统默认', 'System default'), families: [] }, { value: 'INTER', label: 'Inter', families: ['Inter'] }, { value: 'SEGOE_UI', label: 'Segoe UI', families: ['Segoe UI Variable', 'Segoe UI'] }, { value: 'PINGFANG_SC', label: '苹方', families: ['PingFang SC'] }, { value: 'MICROSOFT_YAHEI', label: '微软雅黑', families: ['Microsoft YaHei UI', 'Microsoft YaHei'] }];
    const installed = new Set(fontCatalog?.families.map(f => f.family.toLowerCase()));
    const options = presets.map(p => {
      const available = p.families.length === 0 || p.families.some(f => installed.has(f.toLowerCase()));
      return { value: p.value, label: p.label + (available ? '' : fontCatalog ? t(' · 未安装', ' · Not installed') : t(' · 检查中', ' · Checking')), disabled: !available };
    });
    const extra = (fontCatalog?.families ?? []).filter(f => !code || f.monospace).filter(f => !presets.some(p => p.families.includes(f.family)));
    options.push(...extra.map(f => ({ value: `LOCAL:${f.family}`, label: f.family, disabled: false })));
    const current = code ? appearance.codeFont : appearance.uiFont;
    if (!options.some(o => o.value === current)) options.push({ value: current, label: current.slice(6) + t(' · 未安装', ' · Not installed'), disabled: true });
    return options;
  };
  const uiFontOptions = fontOptions(false), codeFontOptions = fontOptions(true);
  const importFonts = async () => {
    setFontBusy(true); setFontStatus('');
    try {
      const result = await window.fielora.fonts.import();
      if (!result.canceled) {
        await refreshFonts();
        const names = result.installed.flatMap(f => f.font.families.map(f => f.family));
        setFontStatus([names.length ? t(`已安装：${[...new Set(names)].join('、')}。可在上方选择；其他已打开的软件可能需要重启。`, `Installed: ${[...new Set(names)].join(', ')}. Select above; other running apps may need to restart.`) : '', ...result.errors.map(e => `${e.filename}：${e.message}`)].filter(Boolean).join(' '));
      }
    } catch { setFontStatus(t('字体导入失败，请重试。', 'Font import failed. Please retry.')); }
    finally { setFontBusy(false); }
  };

  function resetOverrides() {
    onChange({
      ...appearance,
      sidebarBackgroundOverride: null,
      sidebarBackgroundGradientOverride: null,
      workspaceBackgroundOverride: null,
      workspaceBackgroundGradientOverride: null,
      uiFont: defaultAppearancePreferences.uiFont,
      uiFontSize: defaultAppearancePreferences.uiFontSize,
      codeFont: defaultAppearancePreferences.codeFont,
      codeFontSize: defaultAppearancePreferences.codeFontSize,
      surfaceContrast: defaultAppearancePreferences.surfaceContrast,
      actionColorOverride: null,
      translucentSidebar: defaultAppearancePreferences.translucentSidebar,
    });
    setResetOpen(false);
    setFeedback(t('已恢复当前主题默认值', 'Current theme defaults restored'));
  }

  return <div className="settings-section appearance-settings" data-testid="settings-appearance">
    <header><h1>{t('外观', 'Appearance')}</h1></header>
    {feedback && <div className="appearance-feedback" role="status" data-surface="floating"><span>{feedback}</span><button type="button" aria-label={t('关闭提示', 'Dismiss message')} onClick={() => setFeedback('')}>×</button></div>}

    <section className="appearance-section" aria-labelledby="appearance-customization-title">
      <div className="appearance-section-heading"><span><strong id="appearance-customization-title">{t('界面自定义', 'Interface customization')}</strong><small>{t('只覆盖当前主题中对应的令牌，其他颜色和材质继续继承当前主题。', 'Only the corresponding tokens are overridden. Other colors and materials continue to inherit from the current theme.')}</small></span></div>
      <div className="appearance-card appearance-customization-card">
        {isMac && <div className="appearance-setting-row appearance-material-row"><span><strong>{t('半透明侧栏', 'Translucent sidebar')}</strong><small>{t('透出窗后色彩；高对比度开启时使用实色。', 'Show colors behind the window; high contrast uses a solid background.')}</small></span><SettingsToggle value={appearance.translucentSidebar} onChange={(translucentSidebar) => update({ translucentSidebar })} label={t('半透明侧栏', 'Translucent sidebar')} testId="appearance-translucent-sidebar"/></div>}
        <BackgroundOverrideControl label={t('侧边栏背景', 'Sidebar background')} solid={appearance.sidebarBackgroundOverride} gradient={appearance.sidebarBackgroundGradientOverride} themeDefault={themeDefaults.sidebar} defaultDescription={t('默认与标题栏使用同一连续渐变', 'Uses the same continuous gradient as the title bar by default')} defaultPreview="var(--fl-brand-chrome-navigation)" suggestedGradient={effectiveAppearance === 'DARK' ? { from: '#1B1820', to: '#2B2229', bottomLeft: '#292032' } : { from: '#EFEBFF', to: '#FFEFF2', bottomLeft: '#F9E2F0' }} onSolidChange={(sidebarBackgroundOverride) => update({ sidebarBackgroundOverride, sidebarBackgroundGradientOverride: null })} onGradientChange={(sidebarBackgroundGradientOverride) => update({ sidebarBackgroundGradientOverride, sidebarBackgroundOverride: null })} testId="appearance-sidebar-background"/>
        <BackgroundOverrideControl label={t('工作区背景', 'Workspace background')} solid={appearance.workspaceBackgroundOverride} gradient={appearance.workspaceBackgroundGradientOverride} themeDefault={themeDefaults.workspace} suggestedGradient={effectiveAppearance === 'DARK' ? { from: '#181B23', to: '#222631', bottomLeft: '#202330' } : { from: '#FFFFFF', to: '#F4F8FF', bottomLeft: '#F7F2FC' }} onSolidChange={(workspaceBackgroundOverride) => update({ workspaceBackgroundOverride, workspaceBackgroundGradientOverride: null })} onGradientChange={(workspaceBackgroundGradientOverride) => update({ workspaceBackgroundGradientOverride, workspaceBackgroundOverride: null })} testId="appearance-workspace-background"/>
        <div className="appearance-setting-row appearance-font-row"><span><strong>{t('界面字体', 'UI font')}</strong><small>{t('普通 UI、Conversation 正文、导航、设置和菜单。', 'Regular UI, conversation text, navigation, settings, and menus.')}</small></span><div className="appearance-paired-controls"><SelectMenu value={appearance.uiFont} onChange={(uiFont) => update({ uiFont: uiFont as UiFont })} ariaLabel={t('界面字体', 'UI font')} testId="appearance-ui-font" searchLabel={t("搜索字体", "Search fonts")} options={uiFontOptions}/><SelectMenu value={String(appearance.uiFontSize)} onChange={(value) => update({ uiFontSize: Number(value) as UiFontSize })} ariaLabel={t('界面字号', 'UI font size')} testId="appearance-ui-font-size" options={[12, 13, 14, 15, 16, 17, 18].map((value) => ({ value: String(value), label: `${value}px` }))}/></div></div>
        <div className="appearance-setting-row appearance-font-row"><span><strong>{t('代码字体', 'Code font')}</strong><small>Code Block, Inline Code, Diff, Editor & Terminal.</small></span><div className="appearance-paired-controls"><SelectMenu value={appearance.codeFont} onChange={(codeFont) => update({ codeFont: codeFont as CodeFont })} ariaLabel={t('代码字体', 'Code font')} testId="appearance-code-font" searchLabel={t("搜索等宽字体", "Search monospace fonts")} options={codeFontOptions}/><SelectMenu value={String(appearance.codeFontSize)} onChange={(value) => update({ codeFontSize: Number(value) as CodeFontSize })} ariaLabel={t('代码字号', 'Code font size')} testId="appearance-code-font-size" options={[11, 12, 13, 14, 15, 16, 17].map((value) => ({ value: String(value), label: `${value}px` }))}/></div></div>
        <div className="appearance-font-library" data-testid="appearance-font-library">
          <div className="font-previews"><p style={{ fontFamily: fontFamilyCss(appearance.uiFont, false) ?? undefined }}>{t('字体预览 · 你好，Fielora。', 'Font preview · Hello, Fielora.')}<span> Aa Bb Cc · 0123456789</span></p><code style={{ fontFamily: fontFamilyCss(appearance.codeFont, true) ?? undefined }}>const greeting = "Hello, Fielora"; // 012345</code></div>
          <div className="font-library-actions"><span>{fontCatalog ? t(`已识别 ${fontCatalog.families.length} 个本机字体家族`, `${fontCatalog.families.length} installed font families`) : t('正在检查本机字体…', 'Checking installed fonts…')}<small>{t('导入 TTF、OTF 或 TTC，安装到当前用户，供所有软件使用。也可以在对话中让 Agent 查找并安装字体。', 'Import TTF, OTF or TTC for your OS user, available to all apps. You can also ask the Agent to find and install a font.')}</small></span><div><Button variant="secondary" disabled={fontBusy} onClick={() => void refreshFonts()}>{t('刷新', 'Refresh')}</Button><Button variant="secondary" disabled={fontBusy} onClick={() => void importFonts()} data-testid="appearance-font-import">{fontBusy ? t('正在导入…', 'Importing…') : t('导入字体', 'Import fonts')}</Button></div></div>
          {fontCatalog && <small className="font-install-directory">{fontCatalog.install_directory}</small>}
          {fontStatus && <p role="status" className="font-import-status">{fontStatus}</p>}
        </div>
        <div className="appearance-setting-row appearance-contrast-row"><span><strong>{t('对比度', 'Contrast')}</strong><small>{t('只调整中性 Surface、输入框、选中/悬停和边框层级。', 'Adjusts only neutral surfaces, inputs, selected/hover states, and border hierarchy.')}</small></span><label><input type="range" min="0" max="100" step="1" value={appearance.surfaceContrast} style={{ '--appearance-contrast-progress': `${appearance.surfaceContrast}%` } as CSSProperties} onChange={(event) => update({ surfaceContrast: Number(event.target.value) })} aria-label={t('对比度', 'Contrast')} data-testid="appearance-surface-contrast"/><output>{appearance.surfaceContrast}</output></label></div>
        <SolidColorOverrideControl label={t('按钮颜色', 'Button color')} value={appearance.actionColorOverride} themeDefault={themeDefaults.action} onChange={(actionColorOverride) => update({ actionColorOverride })} testId="appearance-action-color"/>
      </div>
    </section>

    <section className="appearance-section" aria-labelledby="appearance-accessibility-title">
      <div className="appearance-section-heading"><span><strong id="appearance-accessibility-title">{t('可访问性', 'Accessibility')}</strong></span></div>
      <div className="appearance-card">
        <div className="appearance-setting-row"><span><strong>{t('减少动态效果', 'Reduce motion')}</strong></span><SelectMenu value={appearance.reducedMotionPreference} onChange={(value) => update({ reducedMotionPreference: value as ReducedMotionPreference })} ariaLabel={t('减少动态效果', 'Reduce motion')} testId="appearance-reduced-motion" options={[{ value: 'SYSTEM', label: t('跟随系统', 'Follow system') }, { value: 'REDUCE', label: t('开启', 'On') }, { value: 'FULL', label: t('关闭', 'Off') }]}/></div>
        <div className="appearance-setting-row"><span><strong>{t('高对比度', 'High contrast')}</strong></span><SettingsToggle value={appearance.highContrast} onChange={(highContrast) => update({ highContrast })} label={t('高对比度', 'High contrast')} testId="appearance-high-contrast"/></div>
        <div className="appearance-setting-row"><span><strong>{t('平滑滚动', 'Smooth scrolling')}</strong></span><SettingsToggle value={appearance.smoothScrolling} onChange={(smoothScrolling) => update({ smoothScrolling })} label={t('平滑滚动', 'Smooth scrolling')} testId="appearance-smooth-scrolling"/></div>
      </div>
    </section>

    <footer className="appearance-footer"><button type="button" onClick={() => setResetOpen(true)} data-testid="appearance-reset">{t('恢复当前主题默认值', 'Restore current theme defaults')}</button></footer>
    {resetOpen && <TextActionDialog title={t('恢复当前主题默认值？', 'Restore current theme defaults?')} description={t('恢复背景、侧栏材质、字体、对比度和按钮颜色；可访问性、模型和项目设置不会改变。', 'Reset backgrounds, sidebar material, fonts, contrast and button color. Accessibility, models and projects stay unchanged.')} confirmLabel={t('恢复默认', 'Restore defaults')} onCancel={() => setResetOpen(false)} onConfirm={resetOverrides} testId="appearance-reset-dialog"/>}
  </div>;
}
