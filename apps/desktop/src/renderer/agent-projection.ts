import type { AgentEventView, ListAgentEventsRequest } from '@fielora/contracts';

export const AGENT_PROJECTION_UNAVAILABLE_MESSAGE = '运行记录暂时无法更新，Agent 仍会继续工作。';

// A foreground projection is owned by one selection, including its generation.
// Returning to the same conversation must not revive an earlier async callback.
export interface ConversationAgentSelection {
  projectId: string;
  conversationId: string;
  generation: number;
}

export function sameAgentSelection(current: ConversationAgentSelection, requested: ConversationAgentSelection): boolean {
  return current.projectId === requested.projectId && current.conversationId === requested.conversationId && current.generation === requested.generation;
}

export function agentForConversation<T extends { conversationId: string }>(agent: T | null, conversationId: string): T | null {
  return conversationId && agent?.conversationId === conversationId ? agent : null;
}

export function mergeAgentEventPages(
  current: AgentEventView[],
  incoming: AgentEventView[],
): AgentEventView[] {
  if (current.length === 0) return [...incoming].sort((left, right) => left.sequence - right.sequence);
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export async function loadCompleteAgentEventSequence(
  fetchPage: (request: ListAgentEventsRequest) => Promise<AgentEventView[]>,
  runId: string,
  afterSequence: number | null = null,
  pageSize = 200,
): Promise<AgentEventView[]> {
  const events: AgentEventView[] = [];
  let cursor = afterSequence;
  for (;;) {
    const page = await fetchPage({ run_id: runId, after_sequence: cursor, limit: pageSize });
    events.push(...page);
    if (page.length < pageSize) break;
    const nextCursor = page.at(-1)?.sequence ?? cursor;
    if (nextCursor === cursor) throw new Error('Agent event pagination did not advance');
    cursor = nextCursor;
  }
  return mergeAgentEventPages([], events);
}
