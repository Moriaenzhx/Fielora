import { useEffect, useRef, useState } from 'react';
import type { ModelInvocationEvent, ModelRuntimeSettings as Settings, ProviderConfigView, ReasoningMode } from '@fielora/contracts';
import { Button, SelectMenu } from './UiPrimitives';
import { useUiLocale } from './ui-locale';

export function ModelRuntimeSettings({ provider }: { provider: ProviderConfigView }) {
  const { t } = useUiLocale();
  const [view, setView] = useState(provider.model_runtime);
  const [draft, setDraft] = useState<Settings>(provider.model_runtime?.settings ?? { reasoning: 'PROVIDER_DEFAULT', max_output_tokens: 4096 });
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const invocation = useRef<string | null>(null);
  const early = useRef(new Map<string, ModelInvocationEvent>());
  useEffect(() => { setView(provider.model_runtime); if (provider.model_runtime) setDraft(provider.model_runtime.settings); }, [provider]);
  useEffect(() => {
    async function finish(event: ModelInvocationEvent) {
      if (event.invocation_id !== invocation.current) return;
      invocation.current = null; setRunning(false);
      try { const next = await window.fielora.provider.get({ provider_config_id: provider.id }); setView(next.model_runtime); window.dispatchEvent(new CustomEvent('fielora:providers-changed')); }
      catch { setError(t('无法刷新验证结果，请重新打开设置', 'Could not refresh results. Reopen settings.')); }
      if (event.error_code === 'MODEL_VALIDATION_STALE') setError(t('测试期间配置已变化，请重新验证', 'Configuration changed during validation. Run it again.'));
    }
    const off = window.fielora.core.subscribe(event => {
      if (event.event !== 'event.model.invocation') return;
      const value = event as ModelInvocationEvent;
      if (!['COMPLETED','CANCELLED','FAILED'].includes(value.kind)) return;
      early.current.set(value.invocation_id, value);
      if (early.current.size > 32) early.current.delete(early.current.keys().next().value as string);
      void finish(value);
    });
    const timer = window.setInterval(() => { const id = invocation.current; if (id && early.current.has(id)) void finish(early.current.get(id)!); }, 300);
    return () => { off(); clearInterval(timer); const id = invocation.current; if (id) void window.fielora.model.cancel({invocation_id:id}).catch(() => undefined); };
  }, [provider.id, t]);
  if (!view) return null;
  const labels: Record<ReasoningMode,string> = { PROVIDER_DEFAULT:t('服务默认','Provider default'), OFF:t('关闭','Off'), ON:t('开启','On'), LOW:t('低','Low'), MEDIUM:t('中','Medium'), HIGH:t('高','High'), MAX:t('最高','Max') };
  const dirty = draft.reasoning !== view.settings.reasoning || draft.max_output_tokens !== view.settings.max_output_tokens;
  const valid = Number.isInteger(draft.max_output_tokens) && draft.max_output_tokens >= 256 && draft.max_output_tokens <= 16384;
  async function save() {
    setBusy(true); setError('');
    try { const next = await window.fielora.provider.updateRuntime({provider_config_id:provider.id,expected_provider_revision:provider.revision,expected_revision:view!.revision,settings:draft}); setView(next.model_runtime); window.dispatchEvent(new CustomEvent('fielora:providers-changed')); }
    catch { setError(t('保存失败，配置可能已更新，请重新打开设置', 'Save failed. Configuration may have changed; reopen settings.')); }
    finally { setBusy(false); }
  }
  async function validate() {
    setRunning(true); setError('');
    try { const result = await window.fielora.provider.validate({provider_config_id:provider.id}); invocation.current = result.invocation_id; }
    catch { setRunning(false); setError(t('无法开始验证，请检查凭据与服务设置', 'Could not start validation. Check credentials and service settings.')); }
  }
  const support = (value: string) => value === 'SUPPORTED' ? t('已声明支持','Declared support') : value === 'UNSUPPORTED' ? t('不支持','Unsupported') : t('未知','Unknown');
  const statuses = { PASSED:t('通过','Passed'), FAILED:t('失败','Failed'), CANCELLED:t('已取消','Cancelled'), NOT_TESTED:t('未测试','Not tested') };
  const checks: Record<string,string> = {TEXT_STREAM:t('文本流','Text streaming'),TOOL_CALL:t('工具调用','Tool call'),ERROR_CORRECTION:t('错误后重试','Retry after error'),TOOL_CONTINUATION:t('工具结果续接','Tool result continuation')};
  return <section className="settings-model-runtime" data-testid={`model-runtime-${provider.id}`}>
    <h3>{t('模型能力与推理设置','Model capabilities and reasoning')}</h3>
    <p>{t('工具','Tools')}: {support(view.profile.tools)} · {t('图片','Images')}: {support(view.profile.images)} · {t('结构化输出','Structured output')}: {support(view.profile.structured_output)}</p>
    <p className="muted">{view.profile.source === 'OFFICIAL_DOCUMENTATION' ? t('能力来源：官方文档声明，尚不能代替当前连接的实测结果。','Source: official documentation; this does not replace testing this connection.') : view.profile.source === 'CUSTOM_OPENAI' ? t('自定义模型使用所选标准协议，不添加厂商优化。推理采用服务默认行为；工具能力可通过兼容性检查确认。','Custom models use the selected standard protocol without vendor optimization. Reasoning follows provider defaults; use compatibility checks for tool evidence.') : t('暂无此地址与模型的能力声明，可使用兼容性检查获取有限测试证据。','No declaration for this endpoint and model. Compatibility checks can provide limited evidence.')}</p>
    <div className="settings-model-runtime-controls">
      <label>{t('推理模式','Reasoning mode')}<SelectMenu<ReasoningMode> ariaLabel={t('推理模式','Reasoning mode')} value={draft.reasoning} options={view.profile.reasoning_modes.map(value => ({value,label:labels[value],disabled:busy || running}))} onChange={reasoning => setDraft({...draft,reasoning})} testId={`reasoning-${provider.id}`}/></label>
      <label>{t('每次回复 Token 上限','Output token limit per call')}<input type="number" min={256} max={16384} step={256} value={draft.max_output_tokens} onChange={e => setDraft({...draft,max_output_tokens:Number(e.target.value)})} disabled={busy || running} data-testid={`output-limit-${provider.id}`}/></label>
      <Button variant="secondary" onClick={() => void save()} disabled={!dirty || !valid || busy || running} data-testid={`runtime-save-${provider.id}`}>{t('保存','Save')}</Button>
    </div>
    <p className="muted">{t('保存后用于新任务；已有任务继续沿用首次调用时的设置。服务默认沿用模型的思考方式。','Applies to new tasks. Existing tasks keep their initial settings. Provider default uses the model’s own reasoning behavior.')}</p>
    <details><summary>{t('已保存的请求参数','Saved request parameters')}</summary><pre data-testid={`runtime-parameters-${provider.id}`}>{JSON.stringify(view.effective_parameters,null,2)}</pre><small>{t('这是发送参数，不代表服务端已证明执行了相同推理强度。','These are request parameters, not proof of server-side reasoning intensity.')}</small></details>
    <p>{t('兼容性检查最多发送 4 次请求，每次最多 1024 个输出 Token，可能产生费用；不访问项目文件。','Compatibility checks send up to 4 requests with at most 1024 output tokens each and may incur charges; no project files are accessed.')}</p>
    <Button variant="secondary" disabled={running || busy || dirty || !provider.credential_present} onClick={() => void validate()} data-testid={`runtime-validate-${provider.id}`}>{running ? t('正在检查…','Checking…') : t('检查 Agent 兼容性','Check Agent compatibility')}</Button>
    {running && <Button variant="secondary" onClick={() => {const id=invocation.current;if(id) void window.fielora.model.cancel({invocation_id:id}).catch(() => setError(t('取消失败，请稍后重试','Could not cancel. Try again.')));}} data-testid={`runtime-cancel-${provider.id}`}>{t('取消检查','Cancel check')}</Button>}
    {view.validation ? <div data-testid={`runtime-report-${provider.id}`}><p>{new Date(view.validation.checked_at).toLocaleString()} · {t('仅代表本次有限测试','Evidence from this bounded check only')}</p><ul>{view.validation.checks.map(check => <li key={check.name}>{checks[check.name] ?? check.name}: {statuses[check.status]}{check.status === 'FAILED' && ` (${check.detail})`}</li>)}</ul></div> : <p>{t('此配置尚无有效测试结果','No current test evidence for this configuration')}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
