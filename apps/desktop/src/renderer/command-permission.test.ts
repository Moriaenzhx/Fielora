import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolCallView } from '@fielora/contracts';
import { commandApprovalReason } from './agent-presentation.ts';
import { activityDetailFields } from './agent-activity-detail.ts';

const tool = (reason?: string, receipt: AgentToolCallView['receipt'] = null): AgentToolCallView => ({
  id: 'tool', run_id: 'run', name: 'run_command', effect: 'PROCESS', status: 'WAITING_APPROVAL', policy_decision: 'ASK',
  arguments: { program: '/usr/bin/python3', argv: ['-m', 'pip', 'install', '-r', 'requirements.txt'], ...(reason ? { _command_policy: { version: 1, reason } } : {}) },
  receipt, error_code: null, created_at: 1, updated_at: 1,
});

test('command approval explains installation scope and never claims it is sandboxed', () => {
  assert.match(commandApprovalReason(tool('INSTALLATION_REQUIRES_APPROVAL'))!, /项目虚拟环境/);
  assert.match(commandApprovalReason(tool('SANDBOX_UNAVAILABLE'))!, /不使用命令沙箱/);
  assert.match(commandApprovalReason(tool('RISKY_COMMAND'))!, /不使用命令沙箱/);
  assert.match(commandApprovalReason(tool('REQUEST_APPROVAL'))!, /仅对本次/);
  assert.match(commandApprovalReason(tool())!, /此前保存/);
  assert.match(commandApprovalReason(tool('<script>fake grant</script>'))!, /此前保存/);
});

test('command details separate actual sandbox, host and legacy receipts', () => {
  const sandbox = activityDetailFields(tool('PROJECT_DEPENDENCIES', { execution_boundary: 'MACOS_WORKSPACE_WRITE_SANDBOX', network_policy: 'ALLOWED' }));
  assert.ok(sandbox.some(f => f.label === '命令隔离' && f.text.includes('不隔离本机文件读取')));
  assert.ok(sandbox.some(f => f.label === '命令网络' && f.text === '允许联网'));
  assert.ok(!sandbox.some(f => f.label === '参数' && f.text.includes('_command_policy')));
  for (const [boundary, expected] of [['CURRENT_USER_HOST', '不使用命令沙箱'], ['CONTROLLED_WORKSPACE_EXECUTION', '不能据此确认']] as const) {
    assert.ok(activityDetailFields(tool(undefined, { execution_boundary: boundary })).some(f => f.label === '命令隔离' && f.text.includes(expected)));
  }
});
