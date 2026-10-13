import type { WebSearchSourceView } from '@fielora/contracts';

export function searchProviderName(id: string): string {
  if (id.includes('exa.search')) return 'Exa';
  if (id.includes('brave.search')) return 'Brave Search';
  if (id === 'searxng.search.v1') return 'SearXNG / 自建服务';
  return '搜索服务';
}

export function webSearchFailure(code: string | null | undefined): string {
  const labels: Record<string, string> = {
    WEB_SEARCH_TEST_BUSY: '已有搜索测试正在进行，请等待结果后再试。',
    AGENT_TOOL_RATE_LIMITED: '搜索服务额度或频率受限。请稍后重试，或在设置 → 能力与扩展 → 联网搜索中检查当前服务的额度。',
    AGENT_TOOL_CREDENTIAL_REJECTED: '搜索 API Key 无效或已失效，请更新搜索设置。',
    AGENT_TOOL_CREDENTIAL_MISSING: '当前搜索服务尚未配置 API Key，或 Key 已被移除。请更新搜索设置。',
    AGENT_TOOL_HTTP_CLIENT_ERROR: '服务拒绝了请求。自建 SearXNG 请确认已启用 JSON 输出。',
    AGENT_TOOL_DESTINATION_REJECTED: '搜索地址不受支持。请使用公网 HTTPS 或本机回环地址。',
    WEB_SEARCH_CONFIG_INVALID: '搜索配置无法读取，请重新保存设置。',
    AGENT_TOOL_REQUEST_TIMEOUT: '搜索请求超时，请稍后重试。',
    AGENT_TOOL_DNS_FAILED: '无法解析搜索服务地址，请检查网络。',
    AGENT_TOOL_RESPONSE_MALFORMED: '搜索服务返回了无法识别的结果，不能据此判断没有资料。',
  };
  return labels[code ?? ''] ?? '搜索服务暂时不可用，请检查网络后重试。';
}

export function webSearchSources(value: unknown): WebSearchSourceView[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((source: unknown) => {
    if (!source || typeof source !== 'object') return [];
    const item = source as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.url !== 'string' || item.url.length > 4096) return [];
    try {
      const url = new URL(item.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return [];
      return [{ title: item.title.slice(0, 512), url: url.href, published_at: typeof item.published_at === 'string' ? item.published_at.slice(0, 128) : null }];
    } catch { return []; }
  });
}
