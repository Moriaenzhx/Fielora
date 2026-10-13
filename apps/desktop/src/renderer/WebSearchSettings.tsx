import { useEffect, useRef, useState } from 'react';
import type { WebSearchConfigView, WebSearchProbeView } from '@fielora/contracts';
import { useUiLocale } from './ui-locale';
import { webSearchFailure, webSearchSources, searchProviderName } from './web-search';
import { SelectMenu } from './UiPrimitives';

const EXA = 'exa.search.v1', BRAVE = 'brave.search.v1', CUSTOM = 'searxng.search.v1';
export function WebSearchSettings() {
  const { t } = useUiLocale();
  const [config, setConfig] = useState<WebSearchConfigView | null>(null);
  const [selected, setSelected] = useState(EXA);
  const [endpoint, setEndpoint] = useState('');
  const [probe, setProbe] = useState<WebSearchProbeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const secret = useRef<HTMLInputElement>(null);
  useEffect(() => { void window.fielora.webSearch.config().then(value => {
    setConfig(value); setSelected(value.provider_id);
    setEndpoint(value.providers.find(p => p.provider_id === CUSTOM)?.endpoint ?? '');
  }, () => setNotice(t('无法读取搜索配置', 'Could not read search configuration'))); }, [t]);
  const provider = config?.providers.find(p => p.provider_id === selected);
  const dirty = selected !== config?.provider_id || (selected === CUSTOM && endpoint !== provider?.endpoint);
  async function act(action: 'save' | 'delete' | 'test' | 'configure') {
    setBusy(true); setNotice(''); setProbe(null);
    try {
      if (action === 'test') setProbe(await window.fielora.webSearch.test());
      else {
        const next = action === 'configure'
          ? await window.fielora.webSearch.update({provider_id:selected, endpoint:selected === CUSTOM ? endpoint.trim() : null})
          : action === 'save'
            ? await window.fielora.webSearch.storeCredential({provider_id:selected, secret:secret.current?.value ?? ''})
            : await window.fielora.webSearch.deleteCredential({provider_id:selected});
        setConfig(next);
        if (action === 'configure') setEndpoint(next.providers.find(p => p.provider_id === CUSTOM)?.endpoint ?? '');
        setNotice(t('搜索配置已更新，下次搜索生效。', 'Search configuration updated for the next search.'));
      }
    } catch { setNotice(t('操作未完成，请检查服务地址或 Key 后重试。', 'Could not complete this action. Check the endpoint or key.')); }
    finally { if (secret.current) secret.current.value = ''; setBusy(false); }
  }
  async function copySetupUrl() {
    const url = selected === EXA ? 'https://dashboard.exa.ai/api-keys' : selected === BRAVE ? 'https://api-dashboard.search.brave.com/app/keys' : 'https://docs.searxng.org/dev/search_api.html';
    try { await window.fielora.clipboard.writeText(url); setNotice(t('地址已复制，可粘贴到浏览器打开。', 'Address copied. Paste it into your browser.')); }
    catch { setNotice(t('未能复制地址。', 'Could not copy the address.')); }
  }
  return <div className="settings-extension-pane" data-testid="settings-web-search">
    <section className="settings-web-search-card">
      <div className="settings-card-heading"><span><strong>{t('联网搜索', 'Web search')}</strong><small>{t('独立于模型服务。Fielora 负责调用、读取网页和呈现来源；以下服务提供搜索结果。', 'Independent of the model provider. Fielora calls search services, reads pages, and presents sources.')}</small></span></div>
      <p data-testid="web-search-active">{config ? t(`当前默认：${searchProviderName(config.provider_id)}`, `Default: ${searchProviderName(config.provider_id)}`) : t('正在读取配置…', 'Loading configuration…')}</p>
      {config?.config_error && <p role="alert">{t('已保存的搜索配置无法读取，搜索已停用。请重新保存配置。', 'Saved search configuration is invalid. Save valid settings to enable search.')}</p>}
      <label>{t('搜索服务', 'Search service')}</label>
      <SelectMenu testId="web-search-provider" ariaLabel={t('搜索服务', 'Search service')} value={selected}
        options={(config?.providers ?? []).map(item=>({value:item.provider_id,label:item.display_name,disabled:busy}))}
        onChange={value=>{if (busy) return; setSelected(value);setProbe(null);setNotice('');if(secret.current) secret.current.value='';}}/>
      {selected === CUSTOM ? <>
        <p>{t('连接你部署的 SearXNG，或实现相同 JSON 搜索协议的服务。需要启用 JSON 输出；服务本身仍可能向上游搜索引擎发送查询。', 'Connect your SearXNG instance or a service implementing its JSON search API. Enable JSON output. The service may send queries to upstream engines.')}</p>
        <label htmlFor="web-search-endpoint">{t('搜索接口地址', 'Search endpoint')}</label>
        <input id="web-search-endpoint" data-testid="web-search-endpoint" value={endpoint} onChange={e=>{setEndpoint(e.target.value);setProbe(null);}} disabled={busy} placeholder="http://127.0.0.1:8080/search" maxLength={4096}/>
        <small>{t('支持公网 HTTPS 或本机 localhost / 回环地址。不支持登录、API Key 或局域网地址；请填写完整搜索接口地址，不含查询参数。', 'Public HTTPS or a local loopback endpoint. No login, API key, or LAN addresses. Use the full search endpoint without query parameters.')}</small>
      </> : <>
        <p>{selected === EXA ? t('查询发送给 Exa。免 Key 入口受公共限额约束；可选填自己的 Exa Key 使用账户额度。', 'Queries go to Exa. Keyless access has public limits; an optional Exa key uses your account quota.') : t('查询发送给 Brave Search。需要单独申请 Brave API Key，费用和额度由你的 Brave 账户决定。', 'Queries go to Brave Search. A separate Brave API key is required; your account determines quota and cost.')}</p>
        <small>{provider?.endpoint}</small>
        <p data-testid="web-search-mode">{provider?.credential_present ? t('使用你保存的 API Key', 'Using your saved API key') : selected === EXA ? t('已接入免密钥搜索 · 受公共服务限额约束', 'Keyless search available · Public limits apply') : t('尚未配置 API Key', 'API key not configured')}</p>
        <label htmlFor="web-search-key">{selected === EXA ? t('Exa API Key（可选）', 'Exa API key (optional)') : 'Brave API Key'}</label>
        <input id="web-search-key" data-testid="web-search-key" ref={secret} type="password" autoComplete="off" spellCheck={false} maxLength={2048} disabled={busy} placeholder={provider?.credential_present ? t('输入新 Key 以替换', 'Enter a replacement key') : t('输入此搜索服务的 Key', 'Enter this search service’s key')}/>
        <div className="settings-web-search-actions">
          <button type="button" className="ui-button ui-button--secondary" disabled={busy || !config} onClick={()=>void act('save')} data-testid="web-search-save">{t('保存 Key', 'Save key')}</button>
          {provider?.credential_present && <button type="button" className="ui-button ui-button--ghost" disabled={busy} onClick={()=>void act('delete')} data-testid="web-search-delete">{t('移除 Key', 'Remove key')}</button>}
        </div>
        <small>{t('每家服务的 Key 分开保存，不在界面回显。模型服务的 Key 不适用于这里。', 'Keys are stored separately on this device and never shown again. Model provider keys do not apply here.')}</small>
      </>}
      <div className="settings-web-search-actions">
        <button type="button" className="ui-button ui-button--secondary" disabled={busy || !config || (!dirty && !config.config_error)} onClick={()=>void act('configure')} data-testid="web-search-configure">{t('保存为默认服务', 'Save as default')}</button>
        <button type="button" className="ui-button ui-button--primary" disabled={busy || !config || dirty || !!config.config_error} onClick={()=>void act('test')} data-testid="web-search-test">{busy ? t('处理中…', 'Working…') : t('测试搜索', 'Test search')}</button>
        <button type="button" className="ui-button ui-button--ghost" onClick={()=>void copySetupUrl()}>{selected === CUSTOM ? t('复制接口文档地址', 'Copy API documentation URL') : t('复制 Key 管理地址', 'Copy key management URL')}</button>
      </div>
      <small>{dirty ? t('先保存选择，再测试。', 'Save the selection before testing.') : t('测试会向当前默认服务搜索公开的 Rust 文档。失败时显示原因，不自动切换到其他服务。', 'The test searches public Rust documentation using the saved service. Failures are reported without switching services.')}</small>
      {notice && <p role="status">{notice}</p>}
      {probe && <div role="status" data-testid="web-search-probe"><p>{searchProviderName(probe.provider_id)} · {probe.success ? t(`搜索请求成功 · 返回 ${probe.result_count} 个来源`, `Search succeeded · ${probe.result_count} sources`) : webSearchFailure(probe.error_code)}</p>
        {webSearchSources(probe.sources).map(source => <p key={source.url}>{source.title}<small className="web-search-probe-url">{source.url}</small></p>)}
      </div>}
    </section>
  </div>;
}
