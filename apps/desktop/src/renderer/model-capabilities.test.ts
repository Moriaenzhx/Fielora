import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderConfigView } from '@fielora/contracts';
import { attachmentAllowed, modelCapabilities } from './model-capabilities.ts';

const qwenCodingPlan: ProviderConfigView = {
  id: 'provider', model_optimization: true, provider_kind: 'OPENAI_COMPATIBLE', display_name: 'Qwen', endpoint_class: 'CUSTOM',
  base_url: 'https://coding.dashscope.aliyuncs.com/v1', default_model: 'qwen3.7-plus', lifecycle_status: 'ACTIVE',
  credential_present: true, revision: 1, created_at: 1, updated_at: 1,
  model_runtime: {profile:{model_id:'qwen3.7-plus',profile_id:'test-declaration',source:'OFFICIAL_DOCUMENTATION',source_url:null,reviewed_on:null,tools:'SUPPORTED',images:'SUPPORTED',structured_output:'UNKNOWN',reasoning_modes:['PROVIDER_DEFAULT','OFF','ON']},settings:{reasoning:'PROVIDER_DEFAULT',max_output_tokens:4096},revision:0,effective_parameters:{max_tokens:4096},validation:null},
};

test('qwen3.7-plus image input is enabled only after model, plan and transport intersect', () => {
  const capabilities = modelCapabilities(qwenCodingPlan);
  assert.equal(capabilities.textInput, true);
  assert.equal(capabilities.toolCalling, true);
  assert.equal(capabilities.model.imageInput, true);
  assert.equal(capabilities.model.videoInput, false);
  assert.equal(capabilities.provider.imageInput, true);
  assert.equal(capabilities.transport.imageInput, true);
  assert.equal(capabilities.imageInput, true);
  assert.equal(capabilities.imageInputReason, null);
  assert.equal(attachmentAllowed(capabilities, 'IMAGE'), true);
});

test('unknown models fail closed even on the same image-capable provider transport', () => {
  const capabilities = modelCapabilities({ ...qwenCodingPlan, default_model: 'unknown-text-model' });
  assert.equal(capabilities.provider.imageInput, true);
  assert.equal(capabilities.transport.imageInput, true);
  assert.equal(capabilities.imageInput, false);
  assert.match(capabilities.imageInputReason ?? '', /尚未确认/);
  assert.equal(attachmentAllowed(capabilities, 'IMAGE'), false);
});

test('a familiar model name without a Core declaration remains unknown', () => {
  const result = modelCapabilities({...qwenCodingPlan,base_url:'https://gateway.example/v1',model_runtime:undefined});
  assert.equal(result.imageSupport,'UNKNOWN');
  assert.equal(result.toolSupport,'UNKNOWN');
  assert.equal(result.toolCalling,false);
});
