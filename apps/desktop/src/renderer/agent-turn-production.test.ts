import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rendererRoot = import.meta.dirname;
const workspace = readFileSync(path.join(rendererRoot, 'ProjectWorkspace.tsx'), 'utf8');
const turn = readFileSync(path.join(rendererRoot, 'AgentTurn.tsx'), 'utf8');
const icons = readFileSync(path.join(rendererRoot, 'ui', 'Icon.tsx'), 'utf8');
const projection = readFileSync(path.join(rendererRoot, 'agent-activity-projection.ts'), 'utf8');
const markdown = readFileSync(path.join(rendererRoot, 'MarkdownMessage.tsx'), 'utf8');
const review = readFileSync(path.join(rendererRoot, 'AgentHumanReview.tsx'), 'utf8');
const reviewSource = readFileSync(path.join(rendererRoot, 'agent-review.ts'), 'utf8');
const tokens = readFileSync(path.join(rendererRoot, 'styles/tokens.css'), 'utf8');
const styles = [
  readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8'),
  readFileSync(path.join(rendererRoot, 'styles/appearance.css'), 'utf8'),
].join('\n');
const layoutStyles = readFileSync(path.join(rendererRoot, 'styles/layout.css'), 'utf8');

test('production conversation has one turn-owned agent presentation path', () => {
  assert.match(workspace, /<AgentTurn/);
  assert.match(workspace, /agentDisplayAnchor === message\.id/);
  assert.match(workspace, /agentRunIdRef\.current = started\.id; agentEventsRef\.current = \[\]; agentToolsRef\.current = \[\]/);
  assert.match(workspace, /agentRunIdRef\.current !== run\.id && activeRunId !== run\.id/);
  assert.match(turn, /data-agent-turn="true"/);
  assert.match(turn, /data-agent-kind=\{requestKind\}/);
  assert.match(turn, /data-testid="agent-answer"/);
  assert.match(turn, /!textOnlyAnswer && run && presentation/);
  assert.match(turn, /data-agent-run-id=/);
  assert.match(turn, /data-user-message-id=/);
  assert.match(turn, /data-testid="agent-execution-status"/);
  assert.match(turn, /data-testid="agent-terminal-result"/);
  assert.match(turn, /data-testid="agent-execution-detail"/);
  assert.match(turn, /agent-result-changes-icon"><AppIcon name="reviewChanges"\/>/);
  assert.match(icons, /diff: PlusMinus/);
});

test('legacy production activity and standalone result paths are absent', () => {
  const production = [workspace, turn, styles].join('\n');
  for (const legacy of [
    'AgentActivity', 'AgentChangeSummary', 'runActivity', 'agent-run-card', 'agent-process-toggle',
    'agent-activity-toggle', 'agent-operation-line', 'agent-result-actions', 'agent-change-summary',
    'agent-execution-popover', 'agent-execution-dock',
  ]) assert.doesNotMatch(production, new RegExp(legacy));
  assert.doesNotMatch(turn, /已完成搜索代码/);
});

test('durable events project into one chronological conversation activity stream', () => {
  assert.match(turn, /buildConversationActivityProjection\(events, tools\)/);
  assert.match(turn, /data-testid="conversation-activity-stream"/);
  assert.match(turn, /data-activity-sequence=\{item\.sequence\}/);
  assert.match(turn, /data-activity-entry=\{entry\.kind\.toLowerCase\(\)\}/);
  assert.match(projection, /\[\.\.\.events\]\.sort\(\(left, right\) => left\.sequence - right\.sequence\)/);
  assert.match(projection, /event\.kind === 'TOOL_PROPOSED'/);
  assert.match(projection, /event\.kind === 'VERIFICATION_RECORDED'/);
  assert.match(projection, /event\.kind === 'APPROVAL_REQUESTED'/);
  assert.match(projection, /event\.kind !== 'ASSISTANT_NARRATIVE'/);
  assert.match(turn, /function NarrativeBlock/);
  assert.match(turn, /item\.kind === 'NARRATIVE'/);
  assert.doesNotMatch(turn, /agentOpeningNarrative\(presentation\)/);
});

test('terminal hierarchy and human review use shared production tokens', () => {
  assert.match(tokens, /--fl-font-size-agent-title:\s*calc\(17px \* var\(--fl-ui-font-scale\)\)/);
  assert.match(tokens, /--fl-font-weight-result-title:\s*600/);
  assert.match(tokens, /--fl-font-size-agent-result-evidence:\s*calc\(13px \* var\(--fl-ui-font-scale\)\)/);
  assert.match(tokens, /--fl-font-size-agent-result-action:\s*calc\(13px \* var\(--fl-ui-font-scale\)\)/);
  assert.match(tokens, /--fl-color-icon:/);
  assert.match(tokens, /--fl-color-icon-muted:/);
  assert.match(review, /useState<'VISUAL' \| 'RAW'>/);
  assert.match(review, /reviewDisplayFor\(selected\)/);
  assert.match(review, /mode === 'VISUAL'/);
  assert.match(review, /mode === 'RAW'/);
  assert.doesNotMatch(review, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);

  const baseStyles = readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  const agentStyles = baseStyles.slice(baseStyles.indexOf('.agent-turn {'), baseStyles.indexOf('@keyframes agent-pulse'));
  const reviewStyles = baseStyles.slice(baseStyles.indexOf('.agent-review {'), baseStyles.indexOf('.terminal-workspace {'));
  assert.doesNotMatch(agentStyles, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);
  assert.doesNotMatch(reviewStyles, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);
});

test('transient model-loop stages do not become permanent completed steps and review stays responsive', () => {
  assert.doesNotMatch(turn, /[✓✔✅]/u);
  assert.doesNotMatch(turn, /className="agent-step-marker"|agent-execution-steps|completedSteps/);
  assert.doesNotMatch(turn, /presentation\.activeStep|presentation\.totalSteps|第 \{/);
  assert.match(layoutStyles, /\.project-layout\.workspace-open \{[^}]*grid-template-columns:/s);
  assert.match(layoutStyles, /\.project-layout\.workspace-open\.dock-focused \{[^}]*grid-template-columns:/s);
  assert.doesNotMatch([styles, layoutStyles].join('\n'), /\.project-layout\.agent-review-open \.workspace-panel \{[^}]*position:\s*absolute/s);
  assert.doesNotMatch([workspace, styles].join('\n'), /message-navigator/);
});

test('one stream survives the live-to-terminal transition and states remain distinct', () => {
  assert.doesNotMatch(turn, /AgentDisplayContext|displayMode|LiveActivityPreview/);
  assert.match(turn, /!textOnlyAnswer && run && presentation/);
  assert.match(turn, /data-testid="agent-pause-notice"/);
  assert.match(turn, /stopping \? '正在停止'/);
  assert.match(turn, /currentRunStateLabel/);
  assert.equal((turn.match(/<ConversationActivityStream /g) ?? []).length, 1);
});

test('review uses a compact file picker and continuous numbered diff with shared controls', () => {
  assert.match(review, /filesOpen && <div className="human-review-files"/);
  assert.match(review, /human-diff-line-number/);
  assert.match(review, /<Button variant="ghost" disabled=\{actionBusy\} onClick=.*data-testid="agent-review-undo"/);
  assert.doesNotMatch(review, /<button\b|human-diff-state-label|human-code-surface/);
  assert.match(styles, /\.human-unified-diff/);
});

test('action execution starts with a factual preparation state and never invents model progress', () => {
  assert.match(turn, /activityItems\.length === 0/);
  assert.match(turn, /data-execution-stage=\{run.status\}/);
  assert.doesNotMatch(turn, /正在准备任务上下文/);
  assert.match(projection, /event\.kind !== 'ASSISTANT_NARRATIVE'/);
  assert.doesNotMatch(projection, /text_delta[^\n]*Narrative/);
  assert.match(turn, /liveNarrative=\{liveNarrative\}/);
  assert.match(turn, /reconcileLiveNarrative\(activityItems, streamingContent, streamingStep\)/);
});

test('running presentation is narrative and activity chronology followed by honest current state', () => {
  assert.doesNotMatch(workspace, /agent-execution-layer|setExecutionHost|executionHost=\{/);
  assert.match(turn, /<AgentProgressSummary run=\{run\}/);
  assert.match(turn, /data-testid="agent-execution-status"/);
  assert.doesNotMatch(turn, /第 \{presentation\.activeStep\}|presentation\.totalSteps/);
  const activityStart = turn.indexOf('function ConversationActivityStream');
  const activityEnd = turn.indexOf('function AgentProgressSummary', activityStart);
  const activitySource = turn.slice(activityStart, activityEnd);
  assert.doesNotMatch(activitySource, />操作记录|>步骤|技术信息|本轮已更改文件/);
  assert.doesNotMatch(turn, />操作记录|>步骤|<summary>技术信息<\/summary>/);
  assert.match(turn, /toolTitle\(tool\.name\)/);
  assert.match(turn, /toolDetail\(tool\)/);
  assert.match(turn, /activityTimestamp\(entry\.completedAt/);
  assert.match(turn, /className="operation-detail"/);
  assert.doesNotMatch(turn, /agent-completion-time|function CompletionTime/);
  assert.ok((turn.match(/<MarkdownMessage/g)?.length ?? 0) >= 3);
});

test('composer queues steering without parallel runs and keeps an explicit user turn status', () => {
  assert.match(workspace, /if \(activeAgentRef\.current\) \{\s*sendingRef\.current = true;[\s\S]*?await queueFollowUp\(content\)/);
  assert.match(workspace, /data-testid="queued-follow-up-status"/);
  assert.match(workspace, /data-after-run-id=\{item\.afterRunId\}/);
  assert.match(workspace, /data-testid="queued-follow-up-card"/);
  assert.match(workspace, /editQueuedFollowUp\(item\)/);
  assert.match(workspace, /removeQueuedFollowUp\(item\.id\)/);
  assert.match(workspace, /if \(!project \|\| !conversation \|\| activeAgentRef\.current \|\| !agentRunIsTerminal\) return/);
  assert.match(workspace, /data-testid="send-steering"/);
  assert.match(workspace, /data-testid="stop-agent-secondary"/);
  assert.match(workspace, /data-testid="stop-agent"/);
});

test('auto follow can be paused by scrolling and restored to the active task', () => {
  assert.match(workspace, /atLatestAnswerRef\.current = next/);
  assert.match(workspace, /if \(atLatestAnswerRef\.current\)/);
  assert.match(workspace, /setHasUnseenActivity\(true\)/);
  assert.match(workspace, /<AppIcon name="arrowDown"/);
  assert.match(workspace, /'跳转到当前任务底部'/);
  assert.doesNotMatch(workspace, />返回当前任务</);
  assert.match(workspace, /scrollToLatestAnswer\(\);/);
  assert.match(workspace, /data-testid="jump-to-latest"/);
});

test('terminal result expands changed files and routes an exact file into Human Review', () => {
  assert.match(turn, /data-testid="agent-result-changed-files"/);
  assert.match(turn, /data-testid="agent-inline-files-expanded"/);
  assert.match(turn, /已编辑 \{review\.files\.length\} 个文件/);
  assert.match(turn, /review\.files\.slice\(0, previewLimit\)/);
  assert.match(turn, /再显示 \$\{remainingFiles\} 个文件/);
  assert.match(turn, /data-review-path=\{file\.path\}/);
  assert.match(turn, /onReviewFile\?\.\(file\.path\)/);
  assert.match(workspace, /onReviewFile=\{\(path\) => openAgentReview\(path\)\}/);
  assert.match(workspace, /selectedPathHint=\{agentReviewPath\}/);
  assert.match(review, /selectedPathHint/);
  assert.match(workspace, /function HistoricalAgentTurn/);
  assert.match(workspace, /window\.fielora\.agent\.toolCalls\(\{ run_id: runId \}\)/);
  assert.match(workspace, /historicalReview\?\.review \?\? agentReview/);
});

test('activity has one lightweight list and one selected detail outside its scrollport', () => {
  const css = readFileSync(path.join(rendererRoot, 'styles/conversation-execution.css'), 'utf8');
  assert.match(turn, /data-testid="operation-group-toggle" aria-expanded=\{state.open\}/);
  assert.match(turn, /data-testid="operation-list"/);
  assert.match(turn, /OperationDetail key=\{selected.id\}/);
  assert.match(turn, /activityDetailFields\(entry.tool\)/);
  assert.match(turn, /window.fielora.clipboard.writeText\(field.text\)/);
  assert.doesNotMatch(turn, /className="conversation-tool-body"|className="compact-command-panel" data-testid="compact-operation-detail"/);
  assert.match(css, /max-height: 256px; overflow-y: auto/);
  assert.match(css, /920px/);
  assert.match(css, /@container conversation \(max-width: 640px\)/);
});

test('progress Markdown is rendered without lexical filtering or preview truncation', () => {
  const start = turn.indexOf('function NarrativeBlock');
  const narrative = turn.slice(start, turn.indexOf('function ConversationActivityStream', start));
  assert.match(narrative, /<MarkdownMessage content=\{text\} streaming=\{streaming\}/);
  assert.doesNotMatch(narrative, /preview|slice\(|expandedContent|compact-narrative/);
  assert.doesNotMatch(projection, /isRoutineNarrative/);
});

test('activity uses the conversation scroll only and running composer actions keep the active accent', () => {
  assert.match(styles, /\.conversation-activity-stream \{[^}]*overflow: visible;/s);
  assert.match(styles, /\.agent-run-details \{[^}]*overflow: visible;/s);
  assert.doesNotMatch(styles, /\.(?:conversation-activity-stream|agent-run-details) \{[^}]*(?:max-height|height:\s*\d|overflow(?:-y)?:\s*(?:auto|scroll))/s);
  assert.match(styles, /\.message-list \{[^}]*overflow: auto;/s);
  assert.doesNotMatch(styles, /\.agent-execution-(?:popover|dock)\b/);
  const layout = readFileSync(path.join(rendererRoot, 'styles', 'layout.css'), 'utf8');
  assert.match(layout, /\.conversation-narrative,[\s\S]*?width: 100%;\s*max-width: 100%;\s*min-width: 0;/);
  assert.doesNotMatch(turn, /agent-completion-time/);
  assert.match(tokens, /--fl-font-size-agent-execution:\s*calc\(14px \* var\(--fl-ui-font-scale\)\)/);
  const appearance = readFileSync(path.join(rendererRoot, 'styles', 'appearance.css'), 'utf8');
  assert.match(appearance, /\.conversation-composer \.composer-submit\.stop,\s*\.stop-button \{[^}]*background: var\(--fl-action-primary\)/s);
  assert.doesNotMatch(appearance, /\.composer-submit\.stop,[^}]*background: var\(--fl-color-danger\)/s);
  assert.match(icons, /stop: Stop/);
});

test('terminal duration leads collapsed chronology and the exact result Markdown', () => {
  const actionFixture = [
    '## 修改',
    '',
    '- A',
    '- B',
    '',
    '### 验证',
    '',
    '`git diff --check`',
    '',
    '```text',
    'hello',
    '```',
  ].join('\n');
  assert.match(turn, /已处理 \{presentation.elapsed\}/);
  assert.match(turn, /className="agent-execution-detail is-history"/);
  const execution = turn.indexOf('<ConversationActivityStream items={activityItems}');
  const result = turn.indexOf('<AgentTerminalResult run={run}');
  assert.ok(execution > 0 && result > execution);
  assert.doesNotMatch(turn, /function ResultText|naturalResultParagraph|stripAnswerHeading/);
  assert.match(turn, /const markdown = message\?\.content \|\| result\.detail/);
  assert.equal(actionFixture.split('\n')[0], '## 修改');
  assert.match(actionFixture, /- A\n- B/);
  assert.match(actionFixture, /```text\nhello\n```/);
  assert.match(styles, /\.agent-terminal-result h2 \{[^}]*font-size: var\(--fl-font-size-agent-title\)/s);
  assert.match(styles, /\.agent-terminal-runtime \{[^}]*border-bottom: 1px solid var\(--fl-color-divider\)/s);
  for (const capability of [/\^\(#\{1,6\}\)/, /function isList/, /markdown-code-block/, /markdown-table-wrap/, /<blockquote/, /kind === 'link'/]) {
    assert.match(markdown, capability);
  }
  assert.doesNotMatch(turn, /agent-execution-detail-action/);
  assert.match(styles, /\.agent-terminal-runtime \{[^}]*border-bottom: 1px solid var\(--fl-color-divider\)/s);
});

test('result files still use applied review evidence and the existing review action', () => {
  assert.match(turn, /appliedAgentReview\(review\)/);
  assert.match(reviewSource, /review\.files\.filter\(\(file\) => file\.state === 'APPLIED'\)/);
  assert.match(turn, /editedReview && editedReview\.files\.length > 0 && <ChangedFiles/);
  assert.match(turn, /onReviewFile=\{onReviewFile\}/);
});
