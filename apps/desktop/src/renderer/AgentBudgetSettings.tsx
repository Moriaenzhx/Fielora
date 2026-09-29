import { useEffect, useState } from 'react';
import type { AgentResourceBudget } from '@fielora/contracts';
import { defaultAgentResourceBudget } from './app-preferences';
import { Button, SelectMenu } from './UiPrimitives';
import { useUiLocale } from './ui-locale';

const presetMinutes = [5, 15, 30, 60, 120, 240, 480, 720, 1440];

export function AgentBudgetSettings({ value, onChange }: { value: AgentResourceBudget; onChange: (value: AgentResourceBudget) => void }) {
  const { t } = useUiLocale();
  const minutes = value.max_execution_ms / 60_000;
  const [custom, setCustom] = useState(!presetMinutes.includes(minutes));
  const [draft, setDraft] = useState(String(minutes));
  useEffect(() => { setDraft(String(minutes)); setCustom(!presetMinutes.includes(minutes)); }, [minutes]);
  const number = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(number) && number >= 1 && number <= 1440;
  const save = (duration: number) => onChange({ max_execution_ms: duration * 60_000, max_input_tokens: 0, max_output_tokens: 0 });
  const title = t('累计执行时长', 'Execution time allowance');
  return <div data-testid="settings-task-budget">
    <p className="settings-budget-intro">{t('新任务和主动继续任务时应用当前设置；正在运行的任务保持原时长。达到时长后保存进展并暂停。', 'Applies when starting or explicitly continuing a task. Running tasks keep their allowance. Reaching the time limit saves progress and pauses work.')}</p>
    <section className="settings-card">
      <div className="settings-row">
        <span><strong>{title}</strong><small>{t('累计模型和工具执行时间，不包含等待你回答的时间。', 'Combined model and tool execution time, excluding time waiting for your response.')}</small></span>
        <SelectMenu value={custom ? 'custom' : String(value.max_execution_ms)} onChange={next => { if (next === 'custom') setCustom(true); else { setCustom(false); save(Number(next) / 60_000); } }} ariaLabel={title} testId="agent-budget-max_execution_ms" options={[...presetMinutes.map(n => ({ value: String(n * 60_000), label: n < 60 ? t(`${n} 分钟`, `${n} minutes`) : t(`${n / 60} 小时`, `${n / 60} hours`) })), { value: 'custom', label: t('自定义', 'Custom') }]}/>
      </div>
      {custom && <div className="settings-row">
        <span><strong>{t('自定义时长', 'Custom duration')}</strong><small id="agent-budget-duration-hint">{t('1–1440 分钟（最长 24 小时）', '1–1440 minutes (up to 24 hours)')}</small></span>
        <form className="settings-budget-custom" onSubmit={event => { event.preventDefault(); if (valid) save(number); }}>
          <input type="number" min="1" max="1440" step="1" value={draft} onChange={event => setDraft(event.target.value)} aria-label={t('自定义分钟数', 'Custom minutes')} aria-describedby="agent-budget-duration-hint" aria-invalid={!valid} data-testid="agent-budget-custom-minutes"/>
          <span>{t('分钟', 'min')}</span><Button type="submit" variant="secondary" disabled={!valid || number === minutes} data-testid="agent-budget-custom-apply">{t('应用', 'Apply')}</Button>
        </form>
      </div>}
    </section>
    <div className="settings-budget-footer"><small>{t('Token 用量仅用于统计，不限制任务。单次请求超时、权限审批和无进展保护仍生效。', 'Token usage is measured, without a cumulative task limit. Request timeouts, approvals and lack-of-progress protection still apply.')}</small><Button variant="secondary" onClick={() => { setCustom(false); onChange({ ...defaultAgentResourceBudget }); }} data-testid="agent-budget-reset">{t('恢复默认', 'Restore defaults')}</Button></div>
  </div>;
}
