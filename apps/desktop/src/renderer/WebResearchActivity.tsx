import { useId, useState } from 'react';
import type { AgentToolCallView } from '@fielora/contracts';
import { AppIcon } from './ui';
import { researchOperation, researchSummary, type ResearchSource } from './web-research';

function SourceRow({ source, preview }: { source: ResearchSource; preview: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const excerptId = useId();
  return <div className="research-source" data-read-state={source.readState}>
    <span className="research-domain-badge" aria-hidden="true"><AppIcon name="browse"/></span>
    <div className="research-source-body">
      <a className="research-source-title" href={source.url} target="_blank" rel="noreferrer noopener" title={source.title}>{source.title}</a>
      <div className="research-source-meta"><span className="research-source-host" title={source.host}>{source.host}</span><span className="research-read-state">{source.readLabel}</span></div>
    </div>
    {preview && <button type="button" className="research-detail-toggle research-excerpt-toggle" data-testid="research-excerpt-toggle" aria-expanded={expanded} aria-controls={excerptId} aria-label={`${expanded ? '收起' : '查看'}来源摘录：${source.title}`} title={expanded ? '收起摘录' : '查看摘录'} onClick={() => setExpanded(!expanded)}><AppIcon name="chevronDown"/></button>}
    {preview && expanded && <div className="research-source-detail" id={excerptId} data-testid="research-excerpt">
      <span className="research-excerpt-label">{source.excerptKind === 'search' ? '搜索摘要' : '正文摘录'}</span>
      <p className="research-excerpt">{source.excerpt ? <>{source.excerpt}{source.truncated && '…'}</> : '该记录未保存内容摘录，可打开来源查看。'}</p>
      {source.publishedAt && <span className="research-source-date">来源标注日期：{source.publishedAt}</span>}
    </div>}
  </div>;
}

function SourceList({ sources, preview = true }: { sources: ResearchSource[]; preview?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? sources : sources.slice(0, 2);
  return <div className="research-sources" data-testid="research-sources">
    <div className="research-source-list" id={listId}>{visible.map((source, index) => <SourceRow source={source} preview={preview} key={`${source.url}:${index}`}/>)}</div>
    {sources.length > 2 && <button type="button" className="research-more" data-testid="research-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}><AppIcon name="chevronDown"/>{expanded ? '收起来源' : `查看其余 ${sources.length - 2} 条来源`}</button>}
  </div>;
}

export function WebResearchActivity({ tool, tools, running }: { tool: AgentToolCallView; tools: readonly AgentToolCallView[]; running: boolean }) {
  const activity = researchOperation(tool, tools, running);
  if (!activity) return null;
  return <section className={`research-activity${activity.state === 'running' ? ' is-working' : ''}`} data-testid="web-research-activity" data-tool-id={tool.id} data-research-state={activity.state} aria-label={activity.heading}>
    <header><AppIcon name={activity.search ? 'search' : 'browse'}/><span className="research-heading">{activity.heading}</span>{activity.retrievedAt !== null && <time dateTime={new Date(activity.retrievedAt).toISOString()} title={new Date(activity.retrievedAt).toLocaleString()}>{new Date(activity.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</header>
    {activity.target && <div className="research-query">{activity.target}</div>}
    {activity.detail && <p className="research-status">{activity.detail}</p>}
    {activity.sources.length > 0 && <SourceList sources={activity.sources}/>}
  </section>;
}

export function WebResearchSummary({ tools }: { tools: readonly AgentToolCallView[] }) {
  const sources = researchSummary(tools);
  if (!sources.length) return null;
  return <section className="research-summary" data-testid="web-research-summary" aria-label="联网来源"><header><AppIcon name="source"/><span className="research-heading">联网来源 <span className="research-source-count">{sources.length}</span></span></header><SourceList sources={sources} preview={false}/></section>;
}
