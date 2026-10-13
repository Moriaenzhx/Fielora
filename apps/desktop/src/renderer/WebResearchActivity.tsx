import { useState } from 'react';
import type { AgentToolCallView } from '@fielora/contracts';
import { AppIcon } from './ui';
import { researchOperation, researchSummary, type ResearchSource } from './web-research';

function SourceList({ sources, preview = true }: { sources: ResearchSource[]; preview?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, 3);
  return <div className="research-sources" data-testid="research-sources">
    {visible.map(source => <div className="research-source" key={source.url}>
      <span className="research-domain-badge" aria-hidden="true">{source.host.replace(/^www\./, '').slice(0, 1).toUpperCase()}</span>
      <div className="research-source-body"><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a>
        <small>{source.host} · {source.readLabel}</small>
        {preview && <p className="research-excerpt">{source.excerpt ? <>{source.excerpt}{source.truncated && '…'}</> : '该记录未保存内容摘录，可打开来源查看。'}</p>}
        {preview && source.publishedAt && <small>来源标注日期：{source.publishedAt}</small>}
      </div>
    </div>)}
    {sources.length > 3 && <button type="button" className="research-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起来源' : `查看其余 ${sources.length - 3} 条来源`}<AppIcon name="chevronDown"/></button>}
  </div>;
}

export function WebResearchActivity({ tool, tools, running }: { tool: AgentToolCallView; tools: readonly AgentToolCallView[]; running: boolean }) {
  const activity = researchOperation(tool, tools, running);
  if (!activity) return null;
  return <section className={`research-activity${activity.state === 'running' ? ' is-working' : ''}`} data-testid="web-research-activity" data-tool-id={tool.id} data-research-state={activity.state} aria-label={activity.heading}>
    <header><AppIcon name={activity.search ? 'search' : 'browse'}/><strong>{activity.heading}</strong>{activity.retrievedAt !== null && <time dateTime={new Date(activity.retrievedAt).toISOString()}>{new Date(activity.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</header>
    {activity.target && <div className="research-query">{activity.target}</div>}
    {activity.detail && <p className="research-status">{activity.detail}</p>}
    {activity.sources.length > 0 && <SourceList sources={activity.sources}/>}
  </section>;
}

export function WebResearchSummary({ tools }: { tools: readonly AgentToolCallView[] }) {
  const sources = researchSummary(tools);
  if (!sources.length) return null;
  return <section className="research-summary" data-testid="web-research-summary" aria-label="联网来源"><header><AppIcon name="browse"/><strong>联网来源 · {sources.length}</strong></header><SourceList sources={sources} preview={false}/></section>;
}
