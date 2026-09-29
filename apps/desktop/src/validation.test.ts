import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBrowserBounds, validateBrowserNavigate, validateBrowserPageRequest, validateClipboardText, validateCreate, validateCreateState, validateFocus, validateSetFocusV1,
  validateSnapshot, validateSnapshotV1,
  validateCreateProvider, validateStoreCredential, validateStartModel, validateCreateCapture,
  validateCreateConversation, validateCreateConversationMessage, validateUpdateProject, validateApplyWorkspaceFile,
  validateRunTerminal,
  validateStartAgent, validateResumeAgent, validateListAgentEvents, validateResolveAgentApproval,
  validateListFileArtifactReviews, validateMarkFileArtifactReviewed, validateUndoFileArtifactRevision,
  validateActivateMcpConnection,
  validateStoreWorkspaceAttachment, validateReadWorkspaceAttachment, validateSaveWorkspaceAttachment,
} from './validation.ts';

const fieldId = '018f84cb-7c4e-7a12-a6d4-3c441f80a227';

test('bridge payload validators do not expose arbitrary pass-through', () => {
  assert.deepEqual(validateCreate({ title: 'Phase 02', goal: null }), { title: 'Phase 02', goal: null });
  assert.throws(() => validateCreate({ title: 'Phase 02', goal: null, method: 'system.shutdown' }));
  assert.deepEqual(validateFocus({ field_id: fieldId, expected_revision: 2, focus: 'Persistence' }), {
    field_id: fieldId, expected_revision: 2, focus: 'Persistence',
  });
  assert.throws(() => validateFocus({ field_id: fieldId, expected_revision: 0, focus: 'x' }));
  assert.throws(() => validateFocus({ field_id: fieldId, expected_revision: 2, focus: { arbitrary: true } }));
  assert.deepEqual(validateSnapshot({ field_id: fieldId, layout: { primary: 'FIELD' }, open_objects: [] }), {
    field_id: fieldId, layout: { primary: 'FIELD' }, open_objects: [],
  });
});

test('Browse bridge accepts only typed URL, Page ID, and view bounds payloads', () => {
  assert.deepEqual(validateBrowserNavigate({ url: 'https://example.com/' }), { url: 'https://example.com/' });
  assert.throws(() => validateBrowserNavigate({ url: 'https://example.com/', method: 'command.field.create' }));
  assert.deepEqual(validateBrowserPageRequest({ page_id: 'page_123e4567-e89b-42d3-a456-426614174000' }), {
    page_id: 'page_123e4567-e89b-42d3-a456-426614174000',
  });
  assert.throws(() => validateBrowserPageRequest({ page_id: 'field_123e4567-e89b-42d3-a456-426614174000' }));
  assert.throws(() => validateBrowserPageRequest({ page_id: 'page_123e4567-e89b-42d3-a456-426614174000', field_id: fieldId }));
  assert.deepEqual(validateBrowserBounds({ x: 210, y: 64, width: 970, height: 696 }), {
    x: 210, y: 64, width: 970, height: 696,
  });
  assert.throws(() => validateBrowserBounds({ x: -1, y: 0, width: 100, height: 100 }));
  assert.throws(() => validateBrowserBounds({ x: 0, y: 0, width: 100, height: 100, preload: 'evil.js' }));
});

test('trusted clipboard bridge accepts bounded text only', () => {
  assert.equal(validateClipboardText('复制这条消息'), '复制这条消息');
  assert.equal(validateClipboardText(''), '');
  assert.throws(() => validateClipboardText({ text: 'not a primitive' }));
  assert.throws(() => validateClipboardText('界'.repeat(349_526)));
});

test('Phase 02 bridge accepts only typed focus, bounded DTOs, and typed layout', () => {
  assert.deepEqual(validateSetFocusV1({ field_id: fieldId, expected_field_revision: 2, focus: { kind: 'STATE', state_id: fieldId } }), {
    field_id: fieldId, expected_field_revision: 2, focus: { kind: 'STATE', state_id: fieldId },
  });
  assert.throws(() => validateSetFocusV1({ field_id: fieldId, expected_field_revision: 2, focus: { kind: 'STATE', state_id: fieldId, html: '<b>x</b>' } }));
  assert.deepEqual(validateCreateState({ field_id: fieldId, kind: 'TASK', content: 'Ship', confidence: 0.8 }).kind, 'TASK');
  assert.throws(() => validateCreateState({ field_id: fieldId, kind: 'TASK', content: 'Ship', confidence: Number.NaN }));
  const layout = { version: 1, template: 'PRIMARY_ONLY', primary: { pane_id: 'primary_task', primitive: 'TASK_PANE', binding: { kind: 'FIELD_TASKS' }, collapsed: false }, supporting: [], focused_pane_id: 'primary_task' };
  assert.deepEqual(validateSnapshotV1({ field_id: fieldId, layout }).layout, layout);
  assert.throws(() => validateSnapshotV1({ field_id: fieldId, layout: { ...layout, ratio: 0.72 } }));
});

test('Phase 04 bridge rejects secret echo fields, unknown context, and malformed provenance', () => {
  assert.equal(validateCreateProvider({ provider_kind: 'OPENAI', display_name: 'OpenAI', base_url: null, default_model: 'gpt-test', custom_endpoint_acknowledged: false }).provider_kind, 'OPENAI');
  assert.throws(() => validateCreateProvider({ provider_kind: 'OPENAI', display_name: 'OpenAI', base_url: null, default_model: 'gpt-test', custom_endpoint_acknowledged: false, secret: 'no' }));
  assert.equal(validateStoreCredential({ provider_config_id: fieldId, secret: 'test-only' }).secret, 'test-only');
  assert.throws(() => validateStoreCredential({ provider_config_id: fieldId, secret: 'x'.repeat(2049) }));
  assert.throws(() => validateStoreCredential({ provider_config_id: fieldId, secret: '界'.repeat(683) }));
  const chip = { kind: 'CURRENT_FIELD', source_identity: fieldId, source_revision_or_navigation_generation: '1', display_label: 'Field', content: 're-read', sensitivity: 'NORMAL', completeness: 'COMPLETE' };
  assert.equal(validateStartModel({ provider_config_id: fieldId, model_id: null, intent: 'ASK', user_input: 'hello', context_package: [chip], response_mode: 'TEXT' }).context_package.length, 1);
  assert.throws(() => validateStartModel({ provider_config_id: fieldId, model_id: null, intent: 'ASK', user_input: 'hello', context_package: [{ ...chip, authority: 'REALITY' }], response_mode: 'TEXT' }));
  assert.throws(() => validateStartModel({ provider_config_id: fieldId, model_id: null, intent: 'ASK', user_input: 'hello', context_package: Array.from({ length: 9 }, () => chip), response_mode: 'TEXT' }));
  assert.throws(() => validateStartModel({ provider_config_id: fieldId, model_id: null, intent: 'ASK', user_input: 'x'.repeat(8001), context_package: [], response_mode: 'TEXT' }));
  assert.throws(() => validateStartModel({ provider_config_id: fieldId, model_id: null, intent: 'ASK', user_input: 'hello', context_package: [{ ...chip, content: '😀'.repeat(4001) }], response_mode: 'TEXT' }));
  const source = { kind: 'USER_INPUT', title: null, uri: null, field_id: null, resource_type: null, resource_id: null, resource_revision: null, provider_config_id: null, provider_model_id: null, provider_invocation_id: null, is_partial: false };
  assert.equal(validateCreateCapture({ kind: 'TEXT', title: 'Note', content: 'Body', source }).source.kind, 'USER_INPUT');
  assert.throws(() => validateCreateCapture({ kind: 'TEXT', title: 'Note', content: 'Body', source: { ...source, authorization: 'Bearer secret' } }));
  assert.throws(() => validateCreateCapture({ kind: 'TEXT', title: 'N'.repeat(121), content: 'Body', source }));
  assert.throws(() => validateCreateCapture({ kind: 'TEXT', title: 'Note', content: 'x'.repeat(16001), source }));
});

test('Desktop Foundation bridge keeps Project, Conversation, file, and terminal payloads bounded', () => {
  assert.equal(validateUpdateProject({ field_id: fieldId, expected_revision: 1, title: 'Renamed Project' }).title, 'Renamed Project');
  assert.throws(() => validateUpdateProject({ field_id: fieldId, expected_revision: 1, title: '', root_path: 'C:\\escape' }));
  assert.equal(validateCreateConversation({ field_id: fieldId, title: 'Build', provider_config_id: null, model_id: null }).title, 'Build');
  assert.throws(() => validateCreateConversation({ field_id: fieldId, title: 'Build', provider_config_id: null, model_id: null, root_path: 'C:\\escape' }));
  assert.equal(validateCreateConversationMessage({ conversation_id: fieldId, role: 'USER', content: 'Inspect', status: 'COMPLETED', provider_config_id: null, model_id: null, invocation_id: null }).role, 'USER');
  assert.throws(() => validateCreateConversationMessage({ conversation_id: fieldId, role: 'SYSTEM', content: 'Escalate', status: 'COMPLETED', provider_config_id: null, model_id: null, invocation_id: null }));
  assert.equal(validateApplyWorkspaceFile({ field_id: fieldId, relative_path: 'src/app.ts', expected_sha256: 'a'.repeat(64), content: 'ok' }).relative_path, 'src/app.ts');
  assert.throws(() => validateApplyWorkspaceFile({ field_id: fieldId, relative_path: '../secret', expected_sha256: 'a'.repeat(64), content: 'no' }));
  assert.equal(validateRunTerminal({ field_id: fieldId, command: 'pnpm test', working_directory: 'C:\\work' }).command, 'pnpm test');
  assert.equal(validateRunTerminal({ field_id: fieldId, command: 'pnpm test', working_directory: 'C:\\work' }).working_directory, 'C:\\work');
  assert.throws(() => validateRunTerminal({ field_id: fieldId, command: '', working_directory: 'C:\\work' }));
  assert.throws(() => validateRunTerminal({ field_id: fieldId, command: 'pnpm test' }));
});

test('Rich Result message bridge admits only bounded typed sidecars', () => {
  const fileId = `resultref_${'1'.repeat(32)}`;
  const rangeId = `resultref_${'2'.repeat(32)}`;
  const webId = `resultref_${'3'.repeat(32)}`;
  const imageId = `resultref_${'4'.repeat(32)}`;
  const file = { id:fileId,label:'app.ts',target:{kind:'PROJECT_FILE',field_id:fieldId,relative_path:'src/app.ts',expected_sha256:null},provenance:{kind:'PROJECT_CONTEXT'} } as const;
  const range = { id:rangeId,label:'app.ts · L10–L20',target:{kind:'CODE_RANGE',field_id:fieldId,relative_path:'src/app.ts',line_start:10,line_end:20,expected_sha256:'a'.repeat(64)},provenance:{kind:'TOOL_RECEIPT',tool_call_id:fieldId} } as const;
  const web = { id:webId,label:'Architecture',target:{kind:'WEB_REFERENCE',field_id:fieldId,reference_id:fieldId,https_url:'https://example.com/architecture'},provenance:{kind:'SAVED_REFERENCE',reference_id:fieldId} } as const;
  const image = { id:imageId,label:'布局裁切截图',target:{kind:'IMAGE',source:'LIBRARY',library_object_id:fieldId,expected_sha256:'b'.repeat(64),mime_type:'image/png'},provenance:{kind:'LIBRARY_OBJECT',library_object_id:fieldId} } as const;
  const screenshotImage = { id:`resultref_${'5'.repeat(32)}`,label:'当前页面',target:{kind:'IMAGE',source:'SCREENSHOT_EVIDENCE',screenshot_evidence_id:fieldId,expected_sha256:'c'.repeat(64),mime_type:'image/png'},provenance:{kind:'SCREENSHOT_EVIDENCE',screenshot_evidence_id:fieldId} } as const;
  const content=`## 实现位置\n\n[app.ts](fielora-reference:${fileId}) [app.ts · L10–L20](fielora-reference:${rangeId})\n\n![布局裁切截图](fielora-reference:${imageId})\n\n[Architecture](fielora-reference:${webId})`;
  const validated=validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[file,range,image,web]});
  assert.equal(validated.references.length,4);
  assert.equal(validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`![当前页面](fielora-reference:${screenshotImage.id})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[screenshotImage]}).references[0]?.target.kind,'IMAGE');
  for(const target of [{...screenshotImage.target,mime_type:'image/jpeg'},{...screenshotImage.target,library_object_id:fieldId},{...screenshotImage.target,screenshot_evidence_id:'forged'}]){
    assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`![当前页面](fielora-reference:${screenshotImage.id})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[{...screenshotImage,target}]}));
  }
  assert.equal(validateCreateConversationMessage({conversation_id:fieldId,role:'USER',content:'plain',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null}).references.length,0);
  assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'USER',content,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[file]}));
  assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:'missing marker',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[file]}));
  for(const relative_path of ['../outside.ts','C:\\Windows\\secret.ts','/etc/passwd']){
    assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`[unsafe](fielora-reference:${fileId})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[{...file,target:{...file.target,relative_path}}]}));
  }
  for(const target of [{...range.target,line_start:-1},{...range.target,line_start:0},{...range.target,line_start:20,line_end:10},{...range.target,line_end:1000001}]){
    assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`[range](fielora-reference:${rangeId})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[{...range,target}]}));
  }
  for(const https_url of ['http://example.com','file:///C:/secret','javascript:alert(1)','fielora://app','https://user@example.com/private']){
    assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`[web](fielora-reference:${webId})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[{...web,target:{...web.target,https_url}}]}));
  }
  for(const target of [{...image.target,source:'ATTACHMENT'},{...image.target,mime_type:'image/svg+xml'},{...image.target,expected_sha256:'B'.repeat(64)},{...image.target,library_object_id:'forged'}]){
    assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`![布局裁切截图](fielora-reference:${imageId})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[{...image,target}]}));
  }
  assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`[布局裁切截图](fielora-reference:${imageId})`,status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[image]}));
  assert.throws(()=>validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:`![布局裁切截图](fielora-reference:${imageId})`,status:'FAILED',provider_config_id:null,model_id:null,invocation_id:null,references:[image]}));
  const spoof=validateCreateConversationMessage({conversation_id:fieldId,role:'ASSISTANT',content:'[Important](file:///C:/Windows/System32) src/app.ts:20',status:'COMPLETED',provider_config_id:null,model_id:null,invocation_id:null,references:[]});
  assert.deepEqual(spoof.references,[]);
});

test('Complete Agent bridge accepts only bounded typed execution and approval payloads', () => {
  const start={field_id:fieldId,conversation_id:fieldId,provider_config_id:fieldId,model_id:'gpt-test',task:'Fix the failing test',permission:'REVIEW_CHANGES',max_steps:24} as const;
  assert.equal(validateStartAgent(start).permission,'REVIEW_CHANGES');
  const budget = { max_execution_ms: 14_400_000, max_input_tokens: 10_000_000, max_output_tokens: 262_144 };
  assert.deepEqual(validateStartAgent({ ...start, resource_budget: budget }).resource_budget, budget);
  assert.deepEqual(validateResumeAgent({ run_id: fieldId, resource_budget: budget }).resource_budget, budget);
  assert.deepEqual(validateStartAgent({ ...start, resource_budget: { max_execution_ms: 5_820_000 } }).resource_budget, { max_execution_ms: 5_820_000, max_input_tokens: 0, max_output_tokens: 0 });
  for (const resource_budget of [
    { ...budget, max_execution_ms: 86_400_001 }, { ...budget, max_input_tokens: -1 },
    { ...budget, max_output_tokens: 1.5 }, { ...budget, max_output_tokens: '262144' }, { ...budget, unlimited: true },
  ]) {
    assert.throws(() => validateStartAgent({ ...start, resource_budget }));
    assert.throws(() => validateResumeAgent({ run_id: fieldId, resource_budget }));
  }
  assert.equal(validateStartAgent({...start,max_steps:null}).max_steps,null);
  assert.equal(validateStartAgent({...start,user_message_id:fieldId}).user_message_id,fieldId);
  assert.throws(()=>validateStartAgent({...start,user_message_id:'not-an-id'}));
  assert.throws(()=>validateStartAgent({...start,permission:'UNRESTRICTED'}));
  assert.throws(()=>validateStartAgent({...start,max_steps:65}));
  assert.throws(()=>validateStartAgent({...start,tool:{name:'shell'}}));
  assert.deepEqual(validateListAgentEvents({run_id:fieldId,after_sequence:0,limit:500}),{run_id:fieldId,after_sequence:0,limit:500});
  assert.throws(()=>validateListAgentEvents({run_id:fieldId,after_sequence:0,limit:501}));
  assert.equal(validateResolveAgentApproval({run_id:fieldId,approval_id:fieldId,nonce:'one-time-nonce',decision:'ALLOW_ONCE'}).decision,'ALLOW_ONCE');
  assert.throws(()=>validateResolveAgentApproval({run_id:fieldId,approval_id:fieldId,nonce:'one-time-nonce',decision:'ALWAYS_ALLOW'}));
  assert.deepEqual(validateActivateMcpConnection({run_id:fieldId,connection_id:'local.docs-v1'}),{run_id:fieldId,connection_id:'local.docs-v1'});
  assert.throws(()=>validateActivateMcpConnection({run_id:fieldId,connection_id:'local docs',command:'cmd.exe'}));
  assert.deepEqual(validateListFileArtifactReviews({run_id:fieldId}),{run_id:fieldId});
  assert.deepEqual(validateMarkFileArtifactReviewed({artifact_id:fieldId,revision_id:fieldId}),{artifact_id:fieldId,revision_id:fieldId});
  assert.deepEqual(validateUndoFileArtifactRevision({source_run_id:fieldId,artifact_id:fieldId,revision_id:fieldId}),{source_run_id:fieldId,artifact_id:fieldId,revision_id:fieldId});
  assert.throws(()=>validateUndoFileArtifactRevision({source_run_id:fieldId,artifact_id:fieldId,revision_id:fieldId,path:'C:\\outside'}));
});

test('multimodal Agent and attachment bridges accept only bounded native image parts', () => {
  const image = { id: 'a'.repeat(64), filename: 'image.png', mime_type: 'image/png', size: 8, width: 32, height: 20, source: 'clipboard', data_url: 'data:image/png;base64,iVBORw0KGgo=' } as const;
  const start = { field_id: fieldId, conversation_id: fieldId, user_message_id: fieldId, provider_config_id: fieldId, model_id: 'qwen3.7-plus', task: '说明图片内容', permission: 'REVIEW_CHANGES', max_steps: 24, attachments: [image] } as const;
  assert.equal(validateStartAgent(start).attachments?.[0]?.source, 'clipboard');
  assert.equal(validateStartAgent(start).attachments?.[0]?.mime_type, 'image/png');
  assert.deepEqual(validateResumeAgent({ run_id: fieldId }), { run_id: fieldId });
  assert.equal(validateResumeAgent({ run_id: fieldId, attachments: [image] }).attachments?.[0]?.data_url, image.data_url);
  assert.throws(() => validateResumeAgent({ run_id: fieldId, attachments: [{ ...image, data_url: 'https://example.com/image.png' }] }));
  assert.throws(() => validateResumeAgent({ run_id: fieldId, task: 'replace original task' }));
  assert.throws(() => validateStartAgent({ ...start, attachments: [{ ...image, source: 'remote_url' }] }));
  assert.throws(() => validateStartAgent({ ...start, attachments: Array.from({ length: 5 }, () => image) }));

  const stored = validateStoreWorkspaceAttachment({ id: image.id, name: image.filename, size: image.size, mime_type: image.mime_type, data_url: image.data_url, width: image.width, height: image.height, source: image.source });
  assert.equal(stored.name, 'image.png');
  assert.deepEqual(validateReadWorkspaceAttachment({ content_ref: `${'a'.repeat(64)}.png` }), { content_ref: `${'a'.repeat(64)}.png` });
  assert.throws(() => validateReadWorkspaceAttachment({ content_ref: '../image.png' }));
  assert.equal(validateSaveWorkspaceAttachment({ content_ref: `${'a'.repeat(64)}.png`, filename: 'saved.png' }).filename, 'saved.png');
  assert.throws(() => validateSaveWorkspaceAttachment({ content_ref: `${'a'.repeat(64)}.png`, filename: '../saved.png' }));
});
