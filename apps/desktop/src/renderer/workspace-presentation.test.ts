import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEventView, AgentRunView, ConversationMessageView } from '@fielora/contracts';
import {
  agentTurnOwnership,
  agentTurnDisplayAnchor,
  previousAgentAttempts,
  sentConversations,
  conversationTitleFromContent,
  friendlyFilePreviewFailure,
  hasUserMessage,
  isDefaultConversationTitle,
  parseFileProposal,
  reviewDiff,
  resolveComposerPermission,
  shouldSubmitComposerKey,
  workspacePreviewKind,
} from './workspace-presentation.ts';

test('continuation folds only earlier attempts of the same user turn, leaving the latest result last', () => {
  const messages = [
    { id: 'user-old', role: 'USER' }, { id: 'answer-old', role: 'ASSISTANT', invocation_id: 'old-run' },
    { id: 'user', role: 'USER' }, { id: 'failed', role: 'ASSISTANT', invocation_id: 'failed-run' },
    { id: 'success', role: 'ASSISTANT', invocation_id: 'success-run' },
    { id: 'next-user', role: 'USER' }, { id: 'next-answer', role: 'ASSISTANT', invocation_id: 'next-run' },
  ] as ConversationMessageView[];
  assert.deepEqual(previousAgentAttempts(messages, 'user', 'success').map(message => message.id), ['failed']);
  assert.deepEqual(previousAgentAttempts(messages.slice(0, 4), 'user', null).map(message => message.id), ['failed']);
  assert.deepEqual(previousAgentAttempts(messages, null, null), []);
  assert.deepEqual(previousAgentAttempts(messages, 'user-old', 'answer-old'), []);
});

test('composer sends on Enter but preserves Shift+Enter and IME confirmation', () => {
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false }), true);
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, isComposing: false }), false);
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitComposerKey({ key: 'a', shiftKey: false, isComposing: false }), false);
  assert.equal(shouldSubmitComposerKey({ key: 'v', shiftKey: false, isComposing: false }), false);
  assert.equal(shouldSubmitComposerKey({ key: 'Insert', shiftKey: true, isComposing: false }), false);
});

test('an unsent conversation is identified only by the absence of user messages', () => {
  assert.equal(hasUserMessage([]), false);
  assert.equal(hasUserMessage([{ role: 'ASSISTANT' }]), false);
  assert.equal(hasUserMessage([{ role: 'ASSISTANT' }, { role: 'USER' }]), true);
});

test('the first user request produces a compact content-derived conversation title', () => {
  assert.equal(conversationTitleFromContent('我们准备在这里去改一些项目代码，可以吗？'), '修改项目代码');
  assert.equal(conversationTitleFromContent('请帮我排查接口联调问题'), '排查接口联调问题');
  assert.equal(conversationTitleFromContent(''), '新对话');
  assert.equal(isDefaultConversationTitle('新对话'), true);
  assert.equal(isDefaultConversationTitle('新对话 2'), true);
  assert.equal(isDefaultConversationTitle('代码重构计划'), false);
});

test('unsent drafts are hidden from navigation without mutating the page collection', () => {
  const conversations = [{ id: 'draft-new' }, { id: 'sent' }, { id: 'draft-old' }];
  assert.deepEqual(
    sentConversations(conversations, new Set(['draft-new', 'draft-old'])),
    [{ id: 'sent' }],
  );
  assert.deepEqual(conversations.map(item => item.id), ['draft-new', 'sent', 'draft-old']);
  assert.deepEqual(sentConversations(conversations, new Set()), conversations);
});

test('file proposal accepts one bounded relative replacement', () => {
  assert.deepEqual(parseFileProposal('Done\n```fielora-file path="src/app.ts"\nexport const ok = true;\n```'), {
    relativePath: 'src/app.ts', content: 'export const ok = true;',
  });
  assert.equal(parseFileProposal('```fielora-file path="../secret"\nno\n```'), null);
});

test('review diff clearly separates removed and added lines', () => {
  const diff = reviewDiff('src/app.ts', 'one\ntwo\nthree', 'one\nchanged\nthree');
  assert.match(diff, /-two/);
  assert.match(diff, /\+changed/);
  assert.match(diff, /--- a\/src\/app.ts/);
});

test('permission priority is conversation then project then global without crossing projects', () => {
  assert.equal(resolveComposerPermission(null, 'FULL_CONTROL', 'READ_ONLY'), 'FULL_CONTROL');
  assert.equal(resolveComposerPermission('READ_ONLY', 'FULL_CONTROL', 'REVIEW_CHANGES'), 'READ_ONLY');
  assert.equal(resolveComposerPermission(null, 'REVIEW_CHANGES', 'FULL_CONTROL'), 'REVIEW_CHANGES');
  assert.equal(resolveComposerPermission(null, null, 'READ_ONLY'), 'READ_ONLY');
  assert.equal(resolveComposerPermission(null, null, null), 'REVIEW_CHANGES');
});

test('agent activity and terminal response remain owned by their exact user turn', () => {
  const messages = [
    { id: 'user-1', role: 'USER', content: 'first', created_at: 10, invocation_id: null },
    { id: 'assistant-1', role: 'ASSISTANT', content: 'first result', created_at: 20, invocation_id: 'run-1' },
    { id: 'user-2', role: 'USER', content: 'second', created_at: 30, invocation_id: null },
    { id: 'assistant-2', role: 'ASSISTANT', content: 'second result', created_at: 40, invocation_id: 'run-2' },
  ] as unknown as ConversationMessageView[];
  const run = { id: 'run-2', created_at: 31, status: 'COMPLETED' } as unknown as AgentRunView;
  const events = [{ kind: 'RUN_CREATED', payload: { user_message_id: 'user-2' } }] as unknown as AgentEventView[];
  assert.deepEqual(agentTurnOwnership(messages, run, events), { userMessageId: 'user-2', assistantMessageId: 'assistant-2' });
});

test('workspace preview routes images away from the text reader and hides raw IPC failures', () => {
  assert.equal(workspacePreviewKind('assets/preview.PNG'), 'IMAGE');
  assert.equal(workspacePreviewKind('archive.zip'), 'UNSUPPORTED');
  assert.equal(workspacePreviewKind('src/app.ts'), 'TEXT');
  const message = friendlyFilePreviewFailure("Error invoking remote method 'fielora:workspace:file:read': Binary files are not supported");
  assert.equal(message.includes('fielora:'), false);
  assert.equal(message.includes('Binary files'), false);
  assert.match(message, /不支持.*预览/);
});

test('a persisted clarification does not replace the paused execution with a terminal answer', () => {
  const messages = [{ id: 'user', role: 'USER', created_at: 10 }, { id: 'question', role: 'ASSISTANT', created_at: 25, invocation_id: null }] as unknown as ConversationMessageView[];
  const run = { id: 'run', created_at: 20, status: 'PAUSED' } as AgentRunView;
  assert.deepEqual(agentTurnOwnership(messages, run, []), { userMessageId: 'user', assistantMessageId: null });
});

test('clarification display follows the question then the accepted answer without changing original ownership', () => {
  const messages = [{ id: 'user', role: 'USER' }, { id: 'question', role: 'ASSISTANT' }, { id: 'answer', role: 'USER' }] as ConversationMessageView[];
  const events = [{ kind: 'RUN_PAUSED', payload: { reason: 'AGENT_USER_INPUT_REQUIRED', question_message_id: 'question' } }] as AgentEventView[];
  assert.equal(agentTurnDisplayAnchor(messages, events, 'user'), 'question');
  events.push({ kind: 'CHECKPOINT_CREATED', payload: { kind: 'USER_INPUT_RECEIVED', user_message_id: 'answer' } } as AgentEventView);
  assert.equal(agentTurnDisplayAnchor(messages, events, 'user'), 'answer');
});

test('an evidenced blocker stays visible before the paused task and is not its terminal answer', () => {
  const messages = [{ id: 'user', role: 'USER', created_at: 10 }, { id: 'blocker', role: 'ASSISTANT', created_at: 25, invocation_id: null }] as unknown as ConversationMessageView[];
  const run = { id: 'run', created_at: 20, status: 'PAUSED' } as AgentRunView;
  const events = [{ kind: 'RUN_PAUSED', payload: { reason: 'AGENT_TASK_BLOCKED', outcome_message_id: 'blocker' } }] as AgentEventView[];
  assert.equal(agentTurnDisplayAnchor(messages, events, 'user'), 'blocker');
  assert.deepEqual(agentTurnOwnership(messages, run, events), { userMessageId: 'user', assistantMessageId: null });
});
