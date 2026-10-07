// Stable adapter categories, never raw provider response or exception text.
export function providerResponseReason(code: string | null): string | undefined {
  return ({
    PROVIDER_INVALID_RESPONSE: '模型返回的数据格式无法解析，这一步的工具没有执行。可重试；持续出现时请检查模型服务的协议兼容性。',
    PROVIDER_STREAM_INTERRUPTED: '接收模型回复时连接中断，这一步的工具没有执行。网络恢复后可继续。',
    PROVIDER_STREAM_INCOMPLETE: '模型回复在收到完整结束标记前中断，这一步的工具没有执行。可继续重试。',
    PROVIDER_STREAM_ERROR: '模型服务在回复过程中返回了错误，这一步的工具没有执行。稍后可重试；持续出现时请检查服务状态。',
    PROVIDER_INVALID_TOOL_CALL: '模型返回的工具调用未通过校验，自动重试后仍未恢复。这一步的工具没有执行，之前已完成的操作保留；继续工作时会带上纠正要求。',
    PROVIDER_EMPTY_RESPONSE: '模型结束了回复，但没有返回可用的正文或工具调用。可重试，或检查模型的思考与回复长度设置。',
    PROVIDER_OUTPUT_LIMIT: '模型回复达到长度上限，未执行这一步的工具调用。可在模型配置中提高回复长度并保存，再点击“继续工作”；已有进展会保留。',
    PROVIDER_CONTENT_FILTERED: '模型服务拦截了这次回复，未执行这一步的工具调用。请调整请求后新建任务。',
  } as Record<string, string>)[code ?? ''];
}
