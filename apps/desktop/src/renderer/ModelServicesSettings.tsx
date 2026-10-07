import { useEffect, useRef, useState } from 'react';
import type { ModelProviderPreset, ProviderConfigView, ProviderKind } from '@fielora/contracts';
import { Button, SelectMenu } from './UiPrimitives';
import { ModelRuntimeSettings } from './ModelRuntimeSettings';
import { providerKindLabels } from './phase04-presentation';
import { useUiLocale } from './ui-locale';

export interface ProviderSetupRequest { id?: string; nonce: number }
const mismatchedVendor = (catalog: ModelProviderPreset[], kind: ProviderKind, model: string) => kind === 'OPENAI_COMPATIBLE' ? undefined : catalog.find(p => p.model_ids.some(id => id.toLowerCase() === model.trim().toLowerCase()));
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ModelServicesSettings({ providers, error, probeStatus, onProbe, onRefresh, setupRequest }: {
  providers: ProviderConfigView[]; error: string; probeStatus: Record<string, string>;
  onProbe: (provider: ProviderConfigView) => Promise<void>; onRefresh: () => Promise<void>; setupRequest?: ProviderSetupRequest;
}) {
  const { t } = useUiLocale();
  const active = providers.filter(p => p.lifecycle_status !== 'REMOVED');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<ModelProviderPreset[]>([]);
  const [localError, setLocalError] = useState('');
  const [confirm, setConfirm] = useState<'REMOVE' | 'KEY' | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = active.find(p => p.id === selectedId) ?? active[0];
  const mismatch = selected && mismatchedVendor(catalog, selected.provider_kind, selected.default_model);
  useEffect(() => { void window.fielora.provider.catalog().then(setCatalog).catch(e => setLocalError(describeError(e))); }, []);
  useEffect(() => { if (setupRequest) { setSelectedId(setupRequest.id ?? ''); setCreating(!setupRequest.id); setEditing(true); setConfirm(null); } }, [setupRequest]);
  async function refresh() { await onRefresh(); window.dispatchEvent(new Event('fielora:providers-changed')); }
  async function remove() {
    if (!selected || !confirm) return;
    setBusy(true); setLocalError('');
    try { if (confirm === 'KEY') await window.fielora.provider.deleteCredential({provider_config_id:selected.id}); else await window.fielora.provider.remove({provider_config_id:selected.id}); await refresh(); setConfirm(null); }
    catch(e) { setLocalError(describeError(e)); } finally {setBusy(false);}
  }
  return <div className="model-services" data-testid="provider-setup">
    <div className="model-services-heading"><p>{t('为对话与 Agent 配置模型。密钥保存在此设备的本地数据库中，测试连接与任务直接复用。','Configure models for conversations and Agent. Keys stay in this device’s local database and are reused for connection tests and tasks.')}</p><Button variant="secondary" data-testid="manage-providers" onClick={() => {setCreating(true);setEditing(true);setConfirm(null);}} disabled={editing}>{t('添加服务','Add service')}</Button></div>
    {(error || localError) && <p className="error" role="alert">{error || localError}</p>}
    <div className="model-services-layout">
      <div role="group" className="model-service-nav" aria-label={t('已配置服务','Configured services')}>
        <span className="model-section-label">{t('已配置服务','Configured services')} · {active.length}</span>
        {active.map(p => <button key={p.id} type="button" disabled={editing} aria-pressed={!creating && selected?.id === p.id} className={!creating && selected?.id === p.id ? 'selected' : ''} onClick={() => {setSelectedId(p.id);setConfirm(null);}} data-testid={`provider-select-${p.id}`}><strong>{p.display_name}</strong><small>{p.default_model}</small><span>{p.credential_present ? t('密钥已保存','Key saved') : t('待添加密钥','Key required')}</span></button>)}
        {!active.length && <p>{t('添加一个服务后，即可在对话中选择模型。','Add a service to select its model in conversations.')}</p>}
      </div>
      <div className="model-service-detail">
        {editing ? <ProviderEditor key={creating ? 'new' : selected?.id} initial={creating ? undefined : selected} catalog={catalog} onSaved={async p => {await refresh();setSelectedId(p.id);setCreating(false);setEditing(false);}} onCancel={async () => {await refresh();setCreating(false);setEditing(false);}} /> : selected ? <>
          <header className="model-service-title"><div><span className="model-section-label">{t('模型服务','Model service')}</span><h2>{selected.display_name}</h2><p>{selected.default_model}</p></div><Button variant="secondary" onClick={() => setEditing(true)} data-testid={`settings-edit-${selected.id}`}>{t('编辑连接','Edit connection')}</Button></header>
          <p className="model-section-label">{selected.model_runtime?.profile.source==='OFFICIAL_DOCUMENTATION'?t('内置厂商适配','Built-in vendor adaptation'):t('标准协议 · 无厂商优化','Standard protocol · No vendor optimization')}</p>
          <dl className="model-connection-facts"><div><dt>{t('协议','Protocol')}</dt><dd>{providerKindLabels[selected.provider_kind]}</dd></div><div><dt>{t('服务地址','Endpoint')}</dt><dd>{selected.base_url ?? t('官方服务地址','Official endpoint')}</dd></div></dl>
          {mismatch && <div className="model-config-notice" role="status"><p>{t('模型与协议不匹配：请在编辑页选择对应服务商和套餐。只保存 API Key 不会修正连接。','The model and protocol do not match. Select the provider and plan in the editor. Saving an API key alone does not fix the connection.')}</p><Button variant="secondary" onClick={() => setEditing(true)} data-testid="provider-repair-connection">{t('修正连接','Fix connection')}</Button></div>}
          <div className="model-connection-status"><span role="status">{probeStatus[selected.id] ?? (selected.credential_present ? t('密钥已保存 · 连接未测试','Key saved · Connection not tested') : t('请先添加 API Key','Add an API key first'))}</span><Button variant="secondary" disabled={!!mismatch || !selected.credential_present || probeStatus[selected.id] === '正在测试…'} onClick={() => void onProbe(selected)} data-testid={`settings-probe-${selected.id}`}>{t('测试连接','Test connection')}</Button></div>
          <ModelRuntimeSettings key={selected.id} provider={selected}/>
          <div className="model-service-maintenance"><Button variant="ghost" onClick={() => setConfirm('KEY')} disabled={!selected.credential_present || busy}>{t('删除密钥','Delete key')}</Button><Button variant="ghost" onClick={() => setConfirm('REMOVE')} disabled={busy}>{t('移除服务','Remove service')}</Button></div>
          {confirm && <div className="model-config-notice" role="alert"><p>{confirm === 'KEY' ? t('删除后，此服务需要重新填写密钥才能使用。','This service will need a new key after deletion.') : t('移除此服务后，对话与 Agent 将无法继续使用它。已有内容会保留。','Conversations and Agent can no longer use this service after removal. Existing content is retained.')}</p><Button variant="secondary" disabled={busy} onClick={() => void remove()}>{t('确认删除','Confirm deletion')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('取消','Cancel')}</Button></div>}
        </> : <div className="model-service-empty"><h2>{t('连接你的第一个模型','Connect your first model')}</h2><p>{t('内置十个主流国产模型系列，也支持 OpenAI、Anthropic 和自定义兼容服务。','Ten domestic model families, plus OpenAI, Anthropic and custom compatible services.')}</p><Button variant="primary" data-testid="provider-add-toggle" onClick={() => {setCreating(true);setEditing(true);}}>{t('选择服务商','Choose a provider')}</Button></div>}
      </div>
    </div>
    <p className="model-services-footnote">{t('使用时，提问及选定上下文会发送到所配置的服务地址；用量、费用与内容保留遵循服务方政策。','Prompts and selected context are sent to your configured endpoint. Usage, costs and retention follow the provider’s policies.')}</p>
  </div>;
}

function ProviderEditor({initial,catalog,onSaved,onCancel}:{initial?:ProviderConfigView;catalog:ModelProviderPreset[];onSaved:(p:ProviderConfigView)=>Promise<void>;onCancel:()=>Promise<void>}) {
  const { t } = useUiLocale();
  const [current,setCurrent]=useState(initial);
  const matched=initial?.model_optimization === false ? undefined : catalog.find(p => p.base_urls.includes(initial?.base_url ?? ''));
  const [customModel,setCustomModel]=useState(!matched?.versions.some(v=>v.model_id===initial?.default_model));
  const [presetId,setPresetId]=useState(matched?.id ?? 'MANUAL');
  const [kind,setKind]=useState<ProviderKind>(initial?.provider_kind ?? 'OPENAI_COMPATIBLE');
  const [name,setName]=useState(initial?.display_name ?? '');
  const [model,setModel]=useState(initial?.default_model ?? '');
  const [url,setUrl]=useState(initial?.base_url ?? '');
  const [ack,setAck]=useState(initial?.endpoint_class === 'CUSTOM');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const secret=useRef<HTMLInputElement>(null);
  const preset=catalog.find(p=>p.id===presetId);
  const custom=kind==='OPENAI_COMPATIBLE';
  const optimized=Boolean(preset && !customModel && preset.base_urls.includes(url.replace(/\/$/,'')));
  const mismatch=mismatchedVendor(catalog,kind,model);
  const version=preset?.versions.find(v=>v.model_id===model && (preset.id!=='SPARK' || v.base_url===url));
  function choose(p:ModelProviderPreset) {setPresetId(p.id);setCustomModel(false);setKind('OPENAI_COMPATIBLE');setUrl(p.versions[0]?.base_url ?? p.base_url);setModel(p.versions[0]?.model_id ?? '');if(!current)setName(p.label);setAck(false);setError('');}
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(mismatch) return;
    setBusy(true);setError('');
    try {
      const common={model_optimization:optimized,provider_kind:kind,display_name:name.trim(),default_model:model.trim(),base_url:custom?url.trim():null,custom_endpoint_acknowledged:custom&&ack};
      let next=current?await window.fielora.provider.update({provider_config_id:current.id,expected_revision:current.revision,...common}):await window.fielora.provider.create(common);
      setCurrent(next); // Keep identity if credential storage fails; retry must not create duplicates.
      if(secret.current?.value) {next=await window.fielora.provider.storeCredential({provider_config_id:next.id,secret:secret.current.value});setCurrent(next);}
      await onSaved(next);
    } catch(e) {setError(describeError(e));} finally {if(secret.current)secret.current.value='';setBusy(false);}
  }
  return <form className="model-provider-editor" data-testid="provider-form" onSubmit={event=>void save(event)}>
    <header><span className="model-section-label">{current?t('编辑连接','Edit connection'):t('添加模型服务','Add a model service')}</span><h2>{t('选择服务商','Choose a provider')}</h2><p>{t('自动填写官方地址与模型名称；请使用对应平台的密钥。','Official endpoints and model IDs are filled for you. Use a key from the matching platform.')}</p></header>
    <fieldset disabled={busy}>
      <div className="model-provider-grid" aria-label={t('国产模型服务商','Domestic model providers')}>{catalog.map(p=><button type="button" key={p.id} aria-pressed={presetId===p.id} className={presetId===p.id?'selected':''} onClick={()=>choose(p)} data-testid={`provider-preset-${p.id.toLowerCase()}`}><strong>{p.label}</strong></button>)}</div>
      {!catalog.length && <p role="status">{t('厂商目录暂不可用，可使用手动配置。','Provider catalog unavailable; manual configuration is available.')}</p>}
      <SelectMenu ariaLabel={t('其他服务或手动配置','Other providers or manual setup')} value={preset?'PRESET':kind} onChange={value=>{if(value==='PRESET')return;setPresetId('MANUAL');setCustomModel(true);setKind(value as ProviderKind);setUrl('');setModel('');setAck(false);}} options={[...(preset?[{value:'PRESET',label:t('其他服务 / 手动设置','Other providers / manual setup')}]:[]),{value:'OPENAI_COMPATIBLE',label:t('自定义兼容服务','Custom compatible service')},{value:'OPENAI',label:t('OpenAI 官方 · Responses','Official OpenAI · Responses')},{value:'ANTHROPIC',label:t('Anthropic 官方 · Messages','Official Anthropic · Messages')}]} testId="provider-protocol"/>
      {preset && <p className="model-preset-description">{preset.description}</p>}
      {presetId==='QWEN' && <label>{t('百炼服务类型','Model Studio service')}<SelectMenu value={url==='https://coding.dashscope.aliyuncs.com/v1'?'CODING':'GENERAL'} ariaLabel="百炼服务类型" options={[{value:'GENERAL',label:t('通用 API / Token Plan','General API / Token Plan')},{value:'CODING',label:'Coding Plan'}]} onChange={value=>{setUrl(value==='CODING'?'https://coding.dashscope.aliyuncs.com/v1':preset!.base_url);setAck(false);}} testId="provider-qwen-plan"/></label>}
      <label>{t('显示名称','Display name')}<input name="display_name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder={t('例如：日常工作模型','For example: Work model')}/></label>
      <label>{t('模型版本','Model version')}{preset && <SelectMenu value={!customModel && version?version.id:'CUSTOM'} ariaLabel={t('模型版本','Model version')} options={[...preset.versions.map(v=>({value:v.id,label:v.label})),{value:'CUSTOM',label:t('自定义 Model ID（无厂商优化）','Custom Model ID (no vendor optimization)')}]} onChange={value=>{const next=preset.versions.find(v=>v.id===value);setCustomModel(!next);setModel(next?.model_id ?? '');if(next && preset.id==='SPARK'){setUrl(next.base_url);setAck(false);}}} testId="provider-model-preset"/>}<input type={preset && !customModel && version?'hidden':'text'} name="default_model" required maxLength={256} value={model} onChange={e=>setModel(e.target.value)} placeholder={t('区分大小写，以账号可用模型为准','Case sensitive; use a model available to your account')}/></label>
      {mismatch && <div className="model-config-notice" role="alert" data-testid="provider-config-mismatch"><p>{t('该模型不能使用当前官方协议。请先选择对应服务商，再确认密钥所属套餐和服务地址。','This model cannot use the selected official protocol. Choose its provider, then confirm the key’s plan and endpoint.')}</p><Button type="button" variant="secondary" onClick={()=>choose(mismatch)} data-testid="provider-use-matched-vendor">{t('选择','Choose')} {mismatch.label}</Button></div>}
      <p className="model-config-notice" data-testid="provider-adaptation-mode">{optimized?t('内置适配：保存后可选择此版本支持的推理模式。','Built-in adaptation: choose supported reasoning modes after saving.'):t('自定义配置：使用所选标准协议，不添加厂商优化参数或专用提示词。','Custom configuration: standard protocol, without vendor parameters or specialized prompts.')}</p>
      {custom && <label>{t('服务地址','Endpoint')}<input name="base_url" type="url" required value={url} onChange={e=>{setUrl(e.target.value);setAck(false);}} placeholder="https://api.example.com/v1"/><small>{providerKindLabels[kind]}</small></label>}
      {!custom && <p className="model-config-notice">{t('服务地址','Endpoint')}: {kind==='OPENAI'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages'}</p>}
      <label>{presetId==='SPARK'?'APIPassword':'API Key'}<input ref={secret} name="secret" type="password" autoComplete="off" required={!current?.credential_present} maxLength={2048} placeholder={current?.credential_present?t('已保存；留空以保留','Saved; leave blank to keep'):t('粘贴服务商提供的密钥','Paste your provider key')}/><small>{t('保存在本地数据库，保存后不可回看，无需系统密码。','Stored in the local database; never displayed after saving. No system password required.')}</small></label>
      {custom && <label className="model-endpoint-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/><span>{t('我确认使用上方服务地址，并将提问与选定上下文发送给该服务。','I confirm this endpoint and sending prompts and selected context to it.')}{current?.credential_present && t('留空密钥会继续使用已保存的密钥。',' An empty key field reuses the saved key.')}</span></label>}
      <div className="model-editor-actions"><Button type="submit" variant="primary" disabled={busy || !!mismatch || (custom&&!ack)} data-testid="provider-form-save">{busy?t('正在保存…','Saving…'):t('保存连接','Save connection')}</Button><Button type="button" variant="secondary" data-testid="provider-form-cancel" onClick={()=>void onCancel()} disabled={busy}>{t('取消','Cancel')}</Button></div>
    </fieldset>
    {error&&<p role="alert" className="error">{error}</p>}
  </form>;
}
