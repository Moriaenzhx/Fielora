// Stable adapter categories, never raw provider response or exception text.
export function providerResponseReason(code: string | null): string | undefined {
  return ({
    AGENT_COMPUTER_OUTCOME_REVIEW_REQUIRED: '之前的电脑输入缺少可信结果，部分输入可能已经发生。任务仍未完成，Agent 没有重放操作；请先核对应用中的实际状态，再安排后续任务。',
    AGENT_COMPUTER_RECEIVER_CHANGED: '模型接收服务已变化，应用观察授权已失效，未发送后续请求。请恢复原服务后继续，或新建任务重新授权应用访问。',
    AGENT_OPERATION_CHANGED_REQUIRES_NEW_PROPOSAL: '来源、目标或应用已变化，旧确认已失效。请拒绝此提案，再重新准备操作。',
    AGENT_OPERATION_REVALIDATION_REQUIRED: '执行前核对发现操作范围已变化，本次未执行，需要重新准备。',
    PROVIDER_REQUEST_TIMEOUT: '模型服务报告请求超时，这一步的工具没有执行。进展已保存，可稍后继续当前任务。',
    PROVIDER_DNS_FAILED: '无法解析模型服务的域名，尚未发送这一步请求。已保留进展，网络恢复后可继续当前任务。',
    CUSTOM_ENDPOINT_REJECTED: '模型连接在地址检查阶段中断。旧版记录未区分 DNS 解析失败与地址安全检查拒绝，不能仅凭此错误认定地址配置有误。请检查网络与服务地址后重试。',
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
