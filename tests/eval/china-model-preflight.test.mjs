import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  assessLiveAuthorization,
  assessChinaModelConfigs,
  assessQwenConfigs,
  validateEvalDocuments,
} from '../../scripts/eval-agent-china-preflight.mjs';

test('offline detector oracle rejects copied-logic tests and detects real decision faults', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-B', 'scripts/agent-convergence-case.py', 'self-test', '--case', 'detector'], {cwd:root, encoding:'utf8', timeout:30000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status,'PASS');
  assert.equal(report.cases,14);
  assert.ok(report.strong.every(row=>row.discrimination_passed));
  assert.ok(report.weak.slice(1).every(row=>!row.discrimination_passed));
});

test('offline cross-file export oracle accepts correct behavior and rejects controlled defects', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-B', 'scripts/agent-convergence-case.py', 'self-test', '--case', 'task-export'],
    {cwd:root, encoding:'utf8', timeout:60000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.cases, 12);
  assert.equal(report.baseline_tests, 2);
  assert.equal(report.unfinished_seed_rejected, true);
  assert.equal(report.reference_passed, true);
  assert.equal(report.rejected_faults.length, 7);
});

const baseline = {
  schema_version: 1,
  profile_id: 'generic-current',
  capability_profile: {},
  behavior_profile: {},
};
const candidate = {
  schema_version: 1,
  profile_id: 'qwen3.7-plus-candidate-v1',
  capability_profile: {},
  behavior_profile: {},
};
const manifest = {
  schema_version: 1,
  suite: 'fielora-cn-agent-v0.1',
  baseline_profile: baseline.profile_id,
  candidate_profile: candidate.profile_id,
  cases: Array.from({ length: 8 }, (_, index) => ({
    id: `CN0${index + 1}`,
    split: index < 5 ? 'DEVELOPMENT' : index === 7 ? 'HOLDOUT_SECURITY' : 'HOLDOUT',
    status: 'NOT_RUN',
    checks: ['fixed_check'],
  })),
};

test('eval documents keep fixed cases, profiles, and unevaluated truth', () => {
  assert.deepEqual(validateEvalDocuments(manifest, [baseline, candidate]), []);
  const invalid = structuredClone(manifest);
  invalid.cases[1].id = 'CN01';
  invalid.cases[2].status = 'PASS';
  assert.deepEqual(validateEvalDocuments(invalid, [baseline, candidate]).sort(), [
    'MANIFEST_CASE_ID_DUPLICATE',
    'UNEVALUATED_CASE_MUST_REMAIN_NOT_RUN',
  ]);
});

test('Qwen metadata preflight rejects an OpenAI-official configuration without exposing endpoint data', () => {
  const result = assessQwenConfigs([{
    display_name: '测试模型',
    provider_kind: 'OPENAI',
    default_model: 'Qwen3.7-plus',
    lifecycle_status: 'ACTIVE',
    credential_present: true,
    base_url: null,
  }]);
  assert.equal(result.ready_configs, 0);
  assert.deepEqual(result.configs[0].issues, [
    'MODEL_ID_MUST_BE_EXACT_QWEN3_7_PLUS',
    'QWEN_REQUIRES_OPENAI_COMPATIBLE_PROTOCOL',
    'HTTPS_BASE_URL_REQUIRED',
  ]);
  assert.equal(result.configs[0].endpoint_class, 'MISSING');
  assert.equal('base_url' in result.configs[0], false);
});

test('Qwen metadata and live-call authorization are orthogonal gates', () => {
  const result = assessQwenConfigs([{
    display_name: 'Qwen',
    provider_kind: 'OPENAI_COMPATIBLE',
    default_model: 'qwen3.7-plus',
    lifecycle_status: 'ACTIVE',
    credential_present: true,
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  }]);
  assert.equal(result.ready_configs, 1);
  assert.equal(result.configs[0].endpoint_class, 'ALIBABA_MODEL_STUDIO');
  assert.equal(assessLiveAuthorization({}).status, 'NOT_AUTHORIZED');
  const authorization = assessLiveAuthorization({
    LIVE_PROVIDER_CALLS: 'AUTHORIZED',
    PROVIDER: 'Qwen/DashScope',
    MODEL: 'qwen3.7-plus',
    MAX_TOTAL_REQUESTS: '7',
    MAX_TOTAL_COST_CNY: '3',
    MAX_WALL_TIME_SECONDS: '900',
  });
  assert.equal(authorization.status, 'AUTHORIZED_NOT_RUN');
  assert.deepEqual(authorization.bound, {
    max_total_requests: 7,
    max_total_cost_cny: 3,
    max_wall_time_seconds: 900,
    max_estimated_input_tokens_per_request: 120000,
    max_output_tokens_per_request: 12000,
  });
});

test('Qwen Coding Plan is ready for interactive coding but excluded from automated live eval', () => {
  const provider = {
    id: 'coding-plan',
    display_name: 'Qwen Coding Plan',
    provider_kind: 'OPENAI_COMPATIBLE',
    default_model: 'qwen3.7-plus',
    lifecycle_status: 'ACTIVE',
    credential_present: true,
    base_url: 'https://coding.dashscope.aliyuncs.com/v1',
  };
  const qwen = assessQwenConfigs([provider]);
  assert.equal(qwen.ready_configs, 0);
  assert.equal(qwen.interactive_ready_configs, 1);
  assert.equal(qwen.configs[0].endpoint_class, 'ALIBABA_CODING_PLAN');
  assert.equal(qwen.configs[0].status, 'INTERACTIVE_CODING_READY_NOT_EVAL_ELIGIBLE');
  assert.deepEqual(qwen.configs[0].issues, ['CODING_PLAN_AUTOMATED_EVAL_PROHIBITED']);
  const matrix = assessChinaModelConfigs([provider]);
  assert.equal(matrix.ready_families, 0);
  assert.equal(matrix.interactive_ready_families, 1);
  assert.equal(matrix.families[0].configs[0].endpoint_class, 'CODING_PLAN_INTERACTIVE_ONLY');
});

test('Qwen preflight rejects unrelated HTTPS endpoint classes without printing the endpoint', () => {
  const result = assessQwenConfigs([{
    display_name: 'Compatible but not DashScope',
    provider_kind: 'OPENAI_COMPATIBLE',
    default_model: 'qwen3.7-plus',
    lifecycle_status: 'ACTIVE',
    credential_present: true,
    base_url: 'https://example.invalid/v1',
  }]);
  assert.equal(result.ready_configs, 0);
  assert.equal(result.configs[0].endpoint_class, 'OTHER_HTTPS');
  assert.deepEqual(result.configs[0].issues, ['DASHSCOPE_ENDPOINT_CLASS_REQUIRED']);
  assert.equal('base_url' in result.configs[0], false);
});

test('China model metadata matrix recognizes six official endpoint classes without secrets', () => {
  const providers = [
    ['Qwen', 'qwen3.7-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['DeepSeek', 'deepseek-chat', 'https://api.deepseek.com/v1'],
    ['Kimi', 'kimi-k2.5', 'https://api.moonshot.cn/v1'],
    ['GLM', 'glm-4.7', 'https://open.bigmodel.cn/api/paas/v4'],
    ['MiniMax', 'MiniMax-M2.7', 'https://api.minimaxi.com/v1'],
    ['Doubao', 'doubao-seed-2-0-code', 'https://ark.cn-beijing.volces.com/api/v3'],
  ].map(([display_name, default_model, base_url]) => ({
    display_name,
    default_model,
    base_url,
    provider_kind: 'OPENAI_COMPATIBLE',
    lifecycle_status: 'ACTIVE',
    credential_present: true,
  }));
  const result = assessChinaModelConfigs(providers);
  assert.equal(result.configured_families, 6);
  assert.equal(result.ready_families, 6);
  assert.deepEqual(result.families.map((family) => family.family), [
    'QWEN', 'DEEPSEEK', 'KIMI', 'GLM', 'MINIMAX', 'DOUBAO',
  ]);
  assert.ok(result.families.every((family) => family.configs[0].endpoint_class === 'OFFICIAL_PROVIDER'));
  assert.ok(result.families.every((family) => !('base_url' in family.configs[0])));
});
