import type { AgentToolCallView } from '@fielora/contracts';
import { webSearchFailure, webSearchSources, searchProviderName } from './web-search.ts';

export interface ResearchSource {
  title: string; url: string; host: string; publishedAt: string | null;
  excerpt: string; truncated: boolean; readLabel: string;
}
export interface ResearchOperation {
  search: boolean; heading: string; target: string; detail: string;
  state: 'running' | 'waiting' | 'success' | 'failed' | 'interrupted';
  retrievedAt: number | null; sources: ResearchSource[];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
export function researchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function bodyRead(tool: AgentToolCallView): boolean {
  const receipt = object(tool.receipt);
  return ['web.fetch', 'browser'].includes(tool.name) && tool.status === 'COMPLETED' && receipt.success === true
    && typeof receipt.text_returned_chars === 'number' && receipt.text_returned_chars > 0;
}
function readLabel(url: string, runId: string, tools: readonly AgentToolCallView[]): string {
  const related = tools.filter(tool => tool.run_id === runId && ['web.fetch', 'browser'].includes(tool.name) &&
    [object(tool.arguments).url, object(tool.receipt).requested_url, object(tool.receipt).final_url, object(tool.receipt).url]
      .some(value => researchUrl(value) === url));
  if (related.some(bodyRead)) return '已返回正文';
  if (related.some(tool => tool.name === 'web.fetch' && tool.status === 'FAILED')) return '正文读取失败';
  return '搜索命中 · 未读取正文';
}
function searchSources(tool: AgentToolCallView, tools: readonly AgentToolCallView[]): ResearchSource[] {
  const receipt = object(tool.receipt);
  if (tool.status !== 'COMPLETED' || receipt.success !== true || !Array.isArray(receipt.sources)) return [];
  return receipt.sources.slice(0, 10).flatMap(value => {
    const source = webSearchSources([value])[0];
    const url = source && researchUrl(source.url);
    if (!source || !url) return [];
    const preview = object(value);
    return [{ title: source.title, url, host: new URL(url).hostname, publishedAt: source.published_at,
      excerpt: text(preview.snippet, 480), truncated: preview.snippet_truncated === true,
      readLabel: readLabel(url, tool.run_id, tools) }];
  });
}

/** Presentation is derived only from actual tool calls, never assistant prose. */
export function researchOperation(tool: AgentToolCallView, tools: readonly AgentToolCallView[], running: boolean): ResearchOperation | null {
  if (!['web.search', 'web.fetch'].includes(tool.name)) return null;
  const search = tool.name === 'web.search';
  const args = object(tool.arguments), receipt = object(tool.receipt);
  const succeeded = tool.status === 'COMPLETED' && receipt.success === true;
  const pending = ['PROPOSED', 'RUNNING'].includes(tool.status);
  const state = succeeded ? 'success' : tool.status === 'WAITING_APPROVAL' ? 'waiting' : pending ? running ? tool.status === 'RUNNING' ? 'running' : 'waiting' : 'interrupted'
    : ['CANCELLED', 'UNKNOWN'].includes(tool.status) ? 'interrupted' : 'failed';
  const noun = search ? '搜索' : '读取';
  const heading = state === 'success' ? search ? '已搜索网页' : '已读取网页正文'
    : state === 'running' ? `正在${noun}网页` : state === 'waiting' ? tool.status === 'WAITING_APPROVAL' ? `${noun}等待批准` : `${noun}等待执行`
      : state === 'interrupted' ? `${noun}已中断 · 结果待确认` : `${noun}失败`;
  let sources = search ? searchSources(tool, tools) : [];
  const url = researchUrl(succeeded ? receipt.final_url ?? receipt.requested_url : args.url);
  const count = typeof receipt.text_returned_chars === 'number' && Number.isSafeInteger(receipt.text_returned_chars) && receipt.text_returned_chars >= 0 ? receipt.text_returned_chars : null;
  if (!search && succeeded && url) sources = [{ title: text(receipt.title, 512) || new URL(url).hostname, url, host: new URL(url).hostname,
    publishedAt: null, excerpt: text(receipt.excerpt, 640), truncated: receipt.excerpt_truncated === true,
    readLabel: count && count > 0 ? `已返回 ${count.toLocaleString()} 字符${receipt.truncated === true ? '（部分正文）' : ''}` : '未返回可用正文' }];
  const resultCount = Number.isSafeInteger(receipt.result_count) && Number(receipt.result_count) >= 0 ? Number(receipt.result_count) : sources.length;
  let detail = '';
  if (state === 'success' && search) detail = resultCount ? `${searchProviderName(String(receipt.provider_id ?? ''))} · 返回 ${resultCount} 条来源 · 搜索摘要需结合原文核实` : '未找到结果';
  else if (state === 'failed') detail = search ? webSearchFailure(tool.error_code) : tool.error_code === 'AGENT_TOOL_REQUEST_TIMEOUT' ? '读取超时，未取得正文。'
    : tool.error_code === 'AGENT_TOOL_DESTINATION_REJECTED' ? '该地址未通过访问检查，未取得正文。' : '未取得正文，可查看执行详情。';
  return { search, heading, target: search ? text(args.query, 512) : url ? new URL(url).hostname : '', detail, state, sources,
    retrievedAt: succeeded && typeof receipt.retrieved_at === 'number' && Number.isFinite(receipt.retrieved_at) && Math.abs(receipt.retrieved_at) <= 8640000000000000 ? receipt.retrieved_at : null };
}

export function researchSummary(tools: readonly AgentToolCallView[]): ResearchSource[] {
  const sources = new Map<string, ResearchSource>();
  for (const tool of tools) for (const source of researchOperation(tool, tools, false)?.sources ?? []) {
    const key = `${tool.run_id}:${source.url}`;
    const previous = sources.get(key);
    sources.set(key, previous ? { ...previous, excerpt: previous.excerpt || source.excerpt, readLabel: source.readLabel } : source);
  }
  return [...sources.values()];
}
