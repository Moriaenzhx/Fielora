import { useEffect, useMemo, useState } from 'react';
import type { ModelUsageReport, ProviderConfigView, TaskTokenUsage } from '@fielora/contracts';
import { Button, SelectMenu } from './UiPrimitives';
import { useUiLocale } from './ui-locale';
import { costSummary, estimateCost, MODEL_RATES_KEY, modelKey, parseRate, readModelRates, tokenTotal, usageChartBins, type SelectedUsageModel } from './model-usage';

const PAGE_SIZE = 20;

export function ModelUsageSettings({ providers, selection, embedded = false }: { providers: ProviderConfigView[]; selection: SelectedUsageModel | null; embedded?: boolean }) {
  const { t } = useUiLocale();
  const [range, setRange] = useState('30');
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<ModelUsageReport | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [rates, setRates] = useState(() => readModelRates(window.localStorage));
  const [rateKey, setRateKey] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [currency, setCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [priceNotice, setPriceNotice] = useState('');
  const today = Math.floor((updatedAt || Date.now()) / 86_400_000);
  const since = useMemo(() => range === 'ALL' ? null : today * 86_400_000 - (Number(range) - 1) * 86_400_000, [range, today]);
  const providerName = (id: string) => providers.find(p => p.id === id)?.display_name ?? t('历史服务', 'Historical provider');
  const nextProvider = selection ? providers.find(p => p.id === selection.providerId && p.lifecycle_status !== 'REMOVED') : null;
  const number = (v: number) => v.toLocaleString();
  const money = (v: number, code: string) => `${code} ${v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
  const rateFor = (provider: string, model: string) => rates.find(r => r.providerId === provider && r.modelId === model);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReport(null); setError(false);
    const load = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const result = await window.fielora.agent.usage({ since, offset, limit: PAGE_SIZE });
        if (!disposed) { setReport(result); setError(false); setUpdatedAt(Date.now()); }
      } catch { if (!disposed) setError(true); }
      finally { inFlight = false; }
    };
    void load();
    const unsubscribe = window.fielora.core.subscribe(event => {
      if (event.event !== 'event.agent.changed' || timer) return;
      timer = setTimeout(() => { timer = undefined; void load(); }, 300);
    });
    const poll = setInterval(() => void load(), 2000);
    return () => { disposed = true; unsubscribe(); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, [since, offset, refresh]);

  const choices = useMemo(() => {
    const values = new Map<string, SelectedUsageModel>();
    for (const p of providers.filter(p => p.lifecycle_status !== 'REMOVED')) values.set(modelKey(p.id, p.default_model), { providerId: p.id, modelId: p.default_model });
    for (const g of report?.models ?? []) values.set(modelKey(g.provider_config_id, g.model_id), { providerId: g.provider_config_id, modelId: g.model_id });
    for (const r of rates) values.set(modelKey(r.providerId, r.modelId), r);
    if (selection) values.set(modelKey(selection.providerId, selection.modelId), selection);
    return [...values.entries()];
  }, [providers, report?.models, rates, selection]);
  const selectedKey = choices.some(([key]) => key === rateKey) ? rateKey : choices[0]?.[0] ?? '';
  useEffect(() => {
    const rate = rates.find(r => modelKey(r.providerId, r.modelId) === selectedKey);
    setInputPrice(rate ? String(rate.input) : ''); setOutputPrice(rate ? String(rate.output) : ''); setCurrency(rate?.currency ?? 'CNY');
  }, [selectedKey, rates]);

  function saveRate(remove = false) {
    const selected = choices.find(([key]) => key === selectedKey)?.[1];
    if (!selected) return;
    const input = parseRate(inputPrice); const output = parseRate(outputPrice);
    if (!remove && (input === null || output === null)) { setPriceNotice(t('请输入 0–1,000,000 的有效单价；免费模型可填 0。', 'Enter a valid rate from 0 to 1,000,000; use 0 for a free model.')); return; }
    const next = rates.filter(r => modelKey(r.providerId, r.modelId) !== selectedKey);
    if (!remove) next.push({ ...selected, currency, input: input!, output: output! });
    try { window.localStorage.setItem(MODEL_RATES_KEY, JSON.stringify(next)); setRates(next); setPriceNotice(remove ? t('单价已清除。', 'Rate cleared.') : t('单价已保存，估算费用已更新。', 'Rate saved; cost estimates updated.')); }
    catch { setPriceNotice(t('单价未保存，请检查本地存储。', 'Rates could not be saved. Check local storage.')); }
  }

  const costs = costSummary(report?.models ?? [], rates);
  const bins = usageChartBins(report?.daily ?? [], since, Date.now());
  const max = Math.max(1, ...bins.map(b => tokenTotal(b.usage)));
  const modelGroups = [...(report?.models ?? [])].sort((a,b) => tokenTotal(b.usage) - tokenTotal(a.usage));
  const statuses: Record<string, string> = { RUNNING: t('运行中', 'Running'), QUEUED: t('排队中', 'Queued'), WAITING_APPROVAL: t('等待批准', 'Awaiting approval'), PAUSED: t('已暂停', 'Paused'), COMPLETED: t('已完成', 'Completed'), FAILED: t('失败', 'Failed'), CANCELLED: t('已停止', 'Stopped') };
  const costLabel = (usage: TaskTokenUsage, provider: string, model: string) => {
    if (!usage.reported_calls && !tokenTotal(usage)) return t('暂无用量', 'No usage yet');
    const rate = rateFor(provider, model); const value = estimateCost(usage, rate);
    return value === null || !rate ? t('未设单价', 'No rate') : `${money(value, rate.currency)}${usage.unreported_calls ? ' *' : ''}`;
  };

  return <div className={`model-usage-settings${embedded ? '' : ' settings-section'}`} data-testid="settings-usage">
    <header>{!embedded && <h1>{t('模型计费统计', 'Model usage & cost')}</h1>}<p>{t('按实际调用模型累计，切换模型后自动分别统计。', 'Usage follows the model used for each call, including after switching models.')}</p></header>
    <div className="usage-toolbar"><SelectMenu value={range} onChange={value => { setRange(value); setOffset(0); }} ariaLabel={t('统计时间', 'Date range')} testId="usage-range" options={[{ value: '7', label: t('最近 7 天', 'Last 7 days') }, { value: '30', label: t('最近 30 天', 'Last 30 days') }, { value: 'ALL', label: t('全部时间', 'All time') }]}/><small>{updatedAt ? `${t('更新于', 'Updated')} ${new Date(updatedAt).toLocaleTimeString()}` : t('读取中…', 'Loading…')}</small></div>
    {error && <p className="error" role="alert">{t('统计暂时不可用，已显示的数据可能过期。', 'Usage is unavailable; displayed data may be stale.')} <Button variant="secondary" onClick={() => setRefresh(v => v + 1)}>{t('重试', 'Retry')}</Button></p>}
    <section className="usage-live" aria-label={t('当前模型', 'Current model')} data-testid="usage-live">
      <strong>{t('当前运行', 'Active tasks')}</strong>
      {report?.active.length ? report.active.map(run => <div key={run.run_id}><span className="usage-live-dot"/><b>{run.model_id}</b><span>{providerName(run.provider_config_id)} · {statuses[run.status]}</span><small>{run.title}</small></div>) : <p>{report ? t('当前没有正在执行的模型任务', 'No model task is currently executing') : t('正在读取运行状态…', 'Loading active tasks…')}</p>}
      <p data-testid="usage-selection">{t('下次发送', 'Next send')} · {nextProvider ? `${nextProvider.default_model} · ${nextProvider.display_name}` : t('请先在对话中选择可用模型', 'Select an available model in a conversation')}</p>
    </section>
    {!report && !error && <p className="settings-empty" role="status">{t('正在汇总本地任务记录…', 'Loading local task history…')}</p>}
    {report && <>
      <section className="usage-overview" aria-label={t('用量概览', 'Usage summary')}>
        <div><small>{t('已记录 Token', 'Recorded tokens')}</small><strong data-testid="usage-total">{number(tokenTotal(report.usage))}</strong><small>{t('输入', 'Input')} {number(report.usage.input_tokens)} · {t('输出', 'Output')} {number(report.usage.output_tokens)}</small></div>
        <div><small>{t('任务 / 调用回执', 'Tasks / reported calls')}</small><strong>{number(report.total_tasks)} / {number(report.usage.reported_calls)}</strong><small>{report.usage.unreported_calls ? t(`${report.usage.unreported_calls} 次调用用量不完整`, `${report.usage.unreported_calls} calls have incomplete usage`) : t('随模型用量回执更新', 'Updates when model usage is reported')}</small></div>
        <div><small>{t('估算费用', 'Estimated cost')}</small><strong data-testid="usage-cost">{Object.entries(costs.totals).map(([code, value]) => money(value!, code)).join(' + ') || t('待设置单价', 'Set rates below')}</strong><small>{costs.unpriced ? t(`${costs.unpriced} 个模型未设单价`, `${costs.unpriced} models have no rate`) : t('按下方当前单价计算', 'Calculated at the rates below')}</small></div>
      </section>
      <section className="usage-chart-section"><h2>{t('Token 用量趋势', 'Token usage over time')}</h2><div className="usage-legend"><span><i className="usage-input"/>{t('输入', 'Input')}</span><span><i className="usage-output"/>{t('输出', 'Output')}</span><small>{t('UTC 日期 · 长时间范围自动合并', 'UTC dates · Long ranges are grouped')}</small></div>
        <svg className="usage-chart" viewBox="0 0 720 180" role="img" aria-label={t('输入与输出 token 堆叠柱状图', 'Stacked input and output token chart')} data-testid="usage-chart">
          <title>{t('逐时间段 Token 用量；聚焦柱形查看数值', 'Tokens by period; focus a bar for values')}</title>
          {[0, 1, 2].map(i => <line key={i} x1="0" x2="720" y1={15 + i * 65} y2={15 + i * 65} className="usage-gridline"/>)}
          {bins.map((bin, i) => { const width = 720 / bins.length; const inputHeight = bin.usage.input_tokens / max * 125; const outputHeight = bin.usage.output_tokens / max * 125; const label = `${bin.date}${i < bins.length - 1 ? ` – ${new Date(Date.parse(bins[i + 1]!.date) - 86_400_000).toISOString().slice(0, 10)}` : ''}: ${t('输入', 'input')} ${number(bin.usage.input_tokens)}, ${t('输出', 'output')} ${number(bin.usage.output_tokens)}`;
            return <g key={bin.date} tabIndex={0} aria-label={label}><title>{label}</title><rect x={i * width + width * .16} y={145 - inputHeight} width={width * .68} height={inputHeight} className="usage-input"/><rect x={i * width + width * .16} y={145 - inputHeight - outputHeight} width={width * .68} height={outputHeight} className="usage-output"/>{(i === 0 || i === bins.length - 1 || i === Math.floor(bins.length / 2)) && <text x={i * width + width / 2} y="173" textAnchor="middle">{bin.date.slice(5)}</text>}</g>;
          })}
        </svg>
        {!tokenTotal(report.usage) && <p className="settings-empty">{t('暂无已记录的 token 用量。执行模型任务后会自动显示。', 'No recorded token usage yet. Run a model task to populate the chart.')}</p>}
      </section>
      <section className="usage-models"><h2>{t('按模型统计', 'Usage by model')}</h2>{modelGroups.map(group => <div className="usage-model-row" key={modelKey(group.provider_config_id, group.model_id)}><div><strong>{group.model_id}</strong><small>{providerName(group.provider_config_id)}</small></div><div><div className="usage-meter"><span style={{ width: `${tokenTotal(report.usage) ? tokenTotal(group.usage) / tokenTotal(report.usage) * 100 : 0}%` }}/></div><small>{number(tokenTotal(group.usage))} token · {costLabel(group.usage, group.provider_config_id, group.model_id)}</small></div></div>)}</section>
      <section><h2>{t('任务明细', 'Task details')}</h2><div className="usage-table-scroll"><table className="usage-table" data-testid="usage-tasks"><thead><tr>{[t('任务 / 模型', 'Task / model'), t('输入 Token', 'Input tokens'), t('输出 Token', 'Output tokens'), t('估算费用', 'Estimated cost')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{report.tasks.map(task => <tr key={task.run_id} data-run-id={task.run_id}><td><strong>{task.title}</strong><small>{task.model_id} · {providerName(task.provider_config_id)}</small><small>{new Date(task.created_at).toLocaleString()} · {statuses[task.status]}{task.usage.unreported_calls ? t(' · 部分用量缺失', ' · Partial usage') : task.usage.reported_calls === 0 ? t(' · 暂无用量回执', ' · No usage receipt') : ''}</small></td><td>{number(task.usage.input_tokens)}</td><td>{number(task.usage.output_tokens)}</td><td>{costLabel(task.usage, task.provider_config_id, task.model_id)}</td></tr>)}</tbody></table></div>{!report.tasks.length && <p className="settings-empty">{t('此时间范围内没有任务。', 'No tasks in this date range.')}</p>}
        <div className="usage-pagination"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - PAGE_SIZE))}>{t('上一页', 'Previous')}</Button><small>{report.total_tasks ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, report.total_tasks)} / ${report.total_tasks}` : '0 / 0'}</small><Button variant="secondary" disabled={offset + PAGE_SIZE >= report.total_tasks} onClick={() => setOffset(v => v + PAGE_SIZE)}>{t('下一页', 'Next')}</Button></div>
      </section>
    </>}
    <section className="usage-rates"><h2>{t('模型单价', 'Model rates')}</h2><p>{t('每百万 Token 的价格。保存后按当前单价重算历史估算，不代表服务商实际账单。', 'Price per million tokens. Saving recalculates historical estimates at current rates; this is not a provider invoice.')}</p>
      {choices.length > 0 ? <><SelectMenu value={selectedKey} onChange={setRateKey} ariaLabel={t('计价模型', 'Model rate')} testId="usage-rate-model" options={choices.map(([key, model]) => ({ value: key, label: `${model.modelId} · ${providerName(model.providerId)}` }))}/><div className="usage-rate-fields"><label>{t('输入 / 百万 Token', 'Input / million tokens')}<input data-testid="usage-input-price" inputMode="decimal" value={inputPrice} onChange={e => setInputPrice(e.target.value)} placeholder={t('未设置', 'Not set')}/></label><label>{t('输出 / 百万 Token', 'Output / million tokens')}<input data-testid="usage-output-price" inputMode="decimal" value={outputPrice} onChange={e => setOutputPrice(e.target.value)} placeholder={t('未设置', 'Not set')}/></label><SelectMenu value={currency} onChange={value => setCurrency(value as 'CNY' | 'USD')} ariaLabel={t('单价币种', 'Rate currency')} options={[{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]}/><Button variant="secondary" onClick={() => saveRate()} data-testid="usage-save-rate">{t('保存单价', 'Save rate')}</Button><Button variant="secondary" onClick={() => saveRate(true)}>{t('清除', 'Clear')}</Button></div>{priceNotice && <p role="status">{priceNotice}</p>}</> : <p className="settings-empty">{t('添加模型服务后即可配置单价。', 'Add a model service to configure rates.')}</p>}
    </section>
    <p className="usage-note">{t('统计包含本地保存的 Agent 任务和子任务；时间筛选按用量回执日期。流式输出中未返回的用量、失败或中断的请求可能缺失，因此已记录数值可能低于实际消耗。费用仅按输入/输出单价估算，不含缓存优惠、阶梯价格、订阅与税费；不同币种分别合计。连接测试不计入任务统计。', 'Includes locally stored Agent tasks and subtasks, filtered by receipt date. Streaming, failed or interrupted requests may have missing usage, so recorded totals can be lower than actual consumption. Estimates use input/output rates only, excluding cache discounts, tiers, subscriptions and taxes; currencies are summed separately. Connection probes are excluded.')}</p>
  </div>;
}
