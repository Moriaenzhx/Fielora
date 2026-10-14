import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolCallView } from '@fielora/contracts';
import { ComputerFeedbackActivity, computerPointerFeedback } from './computer-feedback.ts';

function tool(receipt: Record<string, unknown>, status = 'COMPLETED'): AgentToolCallView {
  return { name: 'computer', status, receipt } as AgentToolCallView;
}
const target = { app_id: 'native-app' };
const feedback = { target, action: 'click', x: -100, y: 80, coordinate_space: 'SCREEN_POINTS', window_bounds: [-300, 40, 500, 400] };
const receipt = { kind: 'COMPUTER', action: 'click', success: true, input_state: 'DISPATCHED', target, input_feedback: feedback };

test('another task failing busy cannot uncover a still executing native drag', () => {
  const activity = new ComputerFeedbackActivity();
  activity.begin('drag-run', 'drag');
  activity.begin('other-run', 'click');
  activity.completed('other-run', 'click');
  assert.equal(activity.busy, true);
  activity.completed('unrelated-run', 'old-call');
  assert.equal(activity.busy, true);
  activity.completed('drag-run', 'drag');
  assert.equal(activity.busy, false);
  activity.begin('paused-run', 'capture');
  activity.begin('running-run', 'type');
  activity.runEnded('paused-run');
  assert.equal(activity.busy, true);
  activity.reset();
  assert.equal(activity.busy, false);
});

test('only actual same-application dispatched input supplies a visible pointer', () => {
  assert.deepEqual(computerPointerFeedback(tool(receipt)), { action: 'click', x: -100, y: 80, windowBounds: [-300, 40, 500, 400] });
  for (const status of ['RUNNING', 'PROPOSED', 'FAILED', 'UNKNOWN', 'CANCELLED']) assert.equal(computerPointerFeedback(tool(receipt, status)), null);
  for (const change of [{ success: false }, { outcome_unknown: true }, { input_state: 'NOT_DISPATCHED' }, { kind: 'BROWSER' }, { target: { app_id: 'another' } }]) {
    assert.equal(computerPointerFeedback(tool({ ...receipt, ...change })), null);
  }
  assert.equal(computerPointerFeedback({ ...tool({}), arguments: { input_feedback: feedback } } as AgentToolCallView), null);
});

test('coordinate space, finite bounds and the actual drag endpoint are enforced', () => {
  for (const change of [{ x: NaN }, { x: 9999 }, { y: 0 }, { coordinate_space: 'SCREENSHOT_PIXELS' }, { window_bounds: [0, 0, -1, 4] }, { action: 'type' }]) {
    assert.equal(computerPointerFeedback(tool({ ...receipt, input_feedback: { ...feedback, ...change } })), null);
  }
  assert.deepEqual(computerPointerFeedback(tool({ ...receipt, action: 'drag', input_feedback: { ...feedback, action: 'drag', end_x: 100, end_y: 200 } })),
    { action: 'drag', x: 100, y: 200, windowBounds: [-300, 40, 500, 400] });
  assert.equal(computerPointerFeedback(tool({ ...receipt, action: 'drag', input_feedback: { ...feedback, action: 'drag' } })), null);
});
