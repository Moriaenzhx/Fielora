import type { AgentRunView, AgentEventView, StartAgentRunRequest } from '@fielora/contracts';

type Request = (method: string, params: unknown) => Promise<unknown>;

/** A lost IPC reply is not proof that a durable command failed. Never resend it. */
export async function startAgentWithReconciliation(request: Request, input: StartAgentRunRequest): Promise<AgentRunView> {
  const startedAt = Date.now();
  try {
    return await request('command.agent.start', input) as AgentRunView;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('FIPC request timed out: command.agent.start')) throw error;
    try {
      const runs = await request('query.agent.list', { conversation_id: input.conversation_id }) as AgentRunView[];
      for (const run of runs) {
        if (run.created_at < startedAt || run.field_id !== input.field_id || run.provider_config_id !== input.provider_config_id || run.task !== input.task) continue;
        if (input.user_message_id) {
          const events = await request('query.agent.events', { run_id: run.id, after_sequence: 0, limit: 1 }) as AgentEventView[];
          const payload = events[0]?.payload;
          if (!payload || typeof payload !== 'object' || !('user_message_id' in payload) || payload.user_message_id !== input.user_message_id) continue;
        }
        return run;
      }
    } catch {
      // Core may still be unavailable. Do not invent a failed Run or retry work.
    }
    throw new Error('AGENT_START_STATUS_UNKNOWN', { cause: error });
  }
}
