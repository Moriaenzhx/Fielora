import type { PrepareProviderSendRequest, UpdateModelRuntimeRequest } from '@fielora/contracts';
import type {
  ActivityCursor, ArchiveReferenceRequest, AttachReferenceSourceRequest, CreateFieldRequest,
  CreateReferenceRequest, CreateStateRequest, FieldFocusV1, FieldReferenceRequest,
  LineageEndpointRef, ListActivitiesRequest, ListReferencesRequest, ListRelationsRequest,
  ListStatesRequest, ReferenceCursor, ReferenceRequest, RelationCursor,
  RestoreReferenceRequest, RetractReferenceSourceRequest, ReviseReferenceRequest,
  ReviseStateRequest, SaveSurfaceSnapshotRequest, SaveSurfaceSnapshotV1Request,
  SetFieldFocusV1Request, StateCursor, StateReferenceRequest, SupersedeStateRequest,
  SurfaceLayoutV1, TransitionStateRequest, UpdateFieldModeRequest, UpdateFocusRequest,
  CreateProviderConfigRequest, UpdateProviderConfigRequest, ProviderConfigRequest, StoreCredentialRequest,
  StartModelInvocationRequest, CancelModelInvocationRequest, CreateCaptureRequest, CaptureRequest,
  MutateCaptureRequest, AttachCaptureRequest, PromoteCaptureRequest, ListCapturesRequest, ContextChip, CaptureSource,
  CreateProjectRequest, UpdateProjectRequest, ArchiveProjectRequest, CreateConversationRequest, ConversationRequest, UpdateConversationRequest,
  ArchiveConversationRequest, CreateConversationMessageRequest, ListConversationMessagesRequest,
  ResultReference, ScreenshotEvidencePreviewRequest, ScreenshotEvidenceRequest,
  ListScreenshotEvidenceByRunRequest, ListScreenshotEvidenceByVerificationRequest,
  SaveWebLibraryRequest, LibraryObjectRequest, DeleteLibraryObjectRequest, ListLibraryObjectsRequest,
  StartAgentRunRequest, AgentRunRequest, ResumeAgentRunRequest, ListAgentRunsRequest, ListAgentEventsRequest,
  ResolveAgentApprovalRequest,
  ModelUsageReportRequest,
  ActivateMcpConnectionRequest,
  SkillCatalogRequest, RegisterLocalPluginRequest, UnregisterLocalPluginRequest,
  ListArtifactsRequest, ReadArtifactRequest, ArtifactHistoryRequest,
  AssetPreviewRequest, DiagramPreviewRequest, SetArtifactArchiveStateCommandRequest,
  ListFileArtifactReviewsRequest, MarkFileArtifactReviewedRequest, UndoFileArtifactRevisionRequest,
  ActiveArtifactContext,
} from '@fielora/contracts';
import type { BrowserNavigateRequest, BrowserPageRequest, BrowserViewBounds } from './browser-types';
import type {
  ApplyWorkspaceFileRequest, CancelTerminalRequest, PickProjectRequest, RunTerminalRequest,
  OpenWorkspaceProjectRequest,
  ReadWorkspaceAttachmentRequest, SaveWorkspaceAttachmentRequest, StoreWorkspaceAttachmentRequest,
  WorkspaceFileRequest, WorkspaceProjectRequest,
} from './workspace-types';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATE_KINDS = new Set(['FACT', 'DECISION', 'ASSUMPTION', 'QUESTION', 'TASK', 'BLOCKER', 'RESULT']);
const STATE_STATUSES = new Set(['ACTIVE', 'RESOLVED', 'SUPERSEDED', 'RETRACTED']);
const MODES = new Set(['EXPLORE', 'THINK', 'BUILD', 'OPERATE', 'VERIFY']);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bridge payload');
  return value as Record<string, unknown>;
}
function exact(input: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error('Unexpected bridge payload field');
}
function id(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !UUID_V7.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid expected revision');
  return value as number;
}
function nullable<T>(value: unknown, parse: (input: unknown) => T): T | null { return value === null ? null : parse(value); }
function limit(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) throw new Error('Invalid limit');
  return value as number;
}
function finiteConfidence(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid confidence');
  return value;
}
function enumValue(value: unknown, allowed: Set<string>, label: string): string {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid bridge array');
  return value;
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`Invalid ${label}`);
  return Number(value);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`);
  return value;
}

export function validateCreate(value: unknown): CreateFieldRequest {
  const input = object(value); exact(input, ['title', 'goal']);
  if (typeof input.title !== 'string' || !(typeof input.goal === 'string' || input.goal === null)) throw new Error('Invalid create Field payload');
  return { title: input.title, goal: input.goal };
}
export function validateReference(value: unknown): FieldReferenceRequest {
  const input = object(value); exact(input, ['field_id']); return { field_id: id(input.field_id, 'Field reference') };
}
export function validateFocus(value: unknown): UpdateFocusRequest {
  const input = object(value); exact(input, ['field_id', 'expected_revision', 'focus']);
  if (typeof input.focus !== 'string' || input.focus.trim().length < 1 || [...input.focus.trim()].length > 120) throw new Error('Invalid legacy focus');
  return { field_id: id(input.field_id), expected_revision: revision(input.expected_revision), focus: input.focus };
}
function fieldFocus(value: unknown): FieldFocusV1 {
  const input = object(value);
  if (input.kind === 'STATE') { exact(input, ['kind', 'state_id']); return { kind: 'STATE', state_id: id(input.state_id) }; }
  if (input.kind === 'REFERENCE') { exact(input, ['kind', 'object_id']); return { kind: 'REFERENCE', object_id: id(input.object_id) }; }
  throw new Error('Invalid typed focus');
}
export function validateSetFocusV1(value: unknown): SetFieldFocusV1Request {
  const input = object(value); exact(input, ['field_id', 'expected_field_revision', 'focus']);
  return { field_id: id(input.field_id), expected_field_revision: revision(input.expected_field_revision), focus: nullable(input.focus, fieldFocus) };
}
export function validateUpdateMode(value: unknown): UpdateFieldModeRequest {
  const input = object(value); exact(input, ['field_id', 'expected_field_revision', 'mode']);
  return { field_id: id(input.field_id), expected_field_revision: revision(input.expected_field_revision), mode: input.mode === null ? null : enumValue(input.mode, MODES, 'mode') as UpdateFieldModeRequest['mode'] };
}

export function validateCreateState(value: unknown): CreateStateRequest {
  const input=object(value); exact(input,['field_id','kind','content','confidence']);
  if(typeof input.content!=='string')throw new Error('Invalid state content');
  return{field_id:id(input.field_id),kind:enumValue(input.kind,STATE_KINDS,'state kind') as CreateStateRequest['kind'],content:input.content,confidence:finiteConfidence(input.confidence)};
}
export function validateStateReference(value: unknown): StateReferenceRequest { const input=object(value);exact(input,['field_id','state_id']);return{field_id:id(input.field_id),state_id:id(input.state_id)}; }
function stateCursor(value:unknown):StateCursor{const input=object(value);exact(input,['updated_at','state_id']);if(!Number.isSafeInteger(input.updated_at))throw new Error('Invalid cursor');return{updated_at:input.updated_at as number,state_id:id(input.state_id)};}
export function validateListStates(value:unknown):ListStatesRequest{const input=object(value);exact(input,['field_id','kind','status','cursor','limit']);return{field_id:id(input.field_id),kind:input.kind===null?null:enumValue(input.kind,STATE_KINDS,'state kind') as ListStatesRequest['kind'],status:input.status===null?null:enumValue(input.status,STATE_STATUSES,'state status') as ListStatesRequest['status'],cursor:nullable(input.cursor,stateCursor),limit:limit(input.limit)};}
export function validateReviseState(value:unknown):ReviseStateRequest{const input=object(value);exact(input,['field_id','state_id','expected_state_revision','content','confidence']);if(typeof input.content!=='string')throw new Error('Invalid state content');return{field_id:id(input.field_id),state_id:id(input.state_id),expected_state_revision:revision(input.expected_state_revision),content:input.content,confidence:finiteConfidence(input.confidence)};}
export function validateTransitionState(value:unknown):TransitionStateRequest{const input=object(value);exact(input,['field_id','state_id','expected_state_revision','target']);return{field_id:id(input.field_id),state_id:id(input.state_id),expected_state_revision:revision(input.expected_state_revision),target:enumValue(input.target,new Set(['ACTIVE','RESOLVED','RETRACTED']),'transition') as TransitionStateRequest['target']};}
export function validateSupersedeState(value:unknown):SupersedeStateRequest{const input=object(value);exact(input,['field_id','state_id','expected_state_revision','replacement_content','replacement_confidence']);if(typeof input.replacement_content!=='string')throw new Error('Invalid replacement');return{field_id:id(input.field_id),state_id:id(input.state_id),expected_state_revision:revision(input.expected_state_revision),replacement_content:input.replacement_content,replacement_confidence:finiteConfidence(input.replacement_confidence)};}

export function validateCreateReference(value:unknown):CreateReferenceRequest{const input=object(value);exact(input,['field_id','title','url']);if(typeof input.title!=='string'||typeof input.url!=='string')throw new Error('Invalid reference');return{field_id:id(input.field_id),title:input.title,url:input.url};}
export function validateObjectReference(value:unknown):ReferenceRequest{const input=object(value);exact(input,['field_id','object_id']);return{field_id:id(input.field_id),object_id:id(input.object_id)};}
function referenceCursor(value:unknown):ReferenceCursor{const input=object(value);exact(input,['updated_at','object_id']);if(!Number.isSafeInteger(input.updated_at))throw new Error('Invalid cursor');return{updated_at:input.updated_at as number,object_id:id(input.object_id)};}
export function validateListReferences(value:unknown):ListReferencesRequest{const input=object(value);exact(input,['field_id','lifecycle','cursor','limit']);if(!(input.lifecycle===null||input.lifecycle==='ACTIVE'||input.lifecycle==='ARCHIVED'))throw new Error('Invalid lifecycle');return{field_id:id(input.field_id),lifecycle:input.lifecycle,cursor:nullable(input.cursor,referenceCursor),limit:limit(input.limit)};}
export function validateReviseReference(value:unknown):ReviseReferenceRequest{const input=object(value);exact(input,['field_id','object_id','expected_object_revision','title','url']);if(typeof input.title!=='string'||typeof input.url!=='string')throw new Error('Invalid reference');return{field_id:id(input.field_id),object_id:id(input.object_id),expected_object_revision:revision(input.expected_object_revision),title:input.title,url:input.url};}
export function validateArchiveReference(value:unknown):ArchiveReferenceRequest{const input=object(value);exact(input,['field_id','object_id','expected_object_revision']);return{field_id:id(input.field_id),object_id:id(input.object_id),expected_object_revision:revision(input.expected_object_revision)};}
export const validateRestoreReference=(value:unknown):RestoreReferenceRequest=>validateArchiveReference(value);

export function validateAttachReferenceSource(value:unknown):AttachReferenceSourceRequest{const input=object(value);exact(input,['field_id','state_id','reference_id']);return{field_id:id(input.field_id),state_id:id(input.state_id),reference_id:id(input.reference_id)};}
export function validateRetractReferenceSource(value:unknown):RetractReferenceSourceRequest{const input=object(value);exact(input,['field_id','relation_id','expected_relation_revision']);return{field_id:id(input.field_id),relation_id:id(input.relation_id),expected_relation_revision:revision(input.expected_relation_revision)};}
function endpoint(value:unknown):LineageEndpointRef{const input=object(value);if(input.kind==='STATE'){exact(input,['kind','state_id']);return{kind:'STATE',state_id:id(input.state_id)};}if(input.kind==='REFERENCE'){exact(input,['kind','object_id']);return{kind:'REFERENCE',object_id:id(input.object_id)};}throw new Error('Invalid endpoint');}
function relationCursor(value:unknown):RelationCursor{const input=object(value);exact(input,['created_at','relation_id']);if(!Number.isSafeInteger(input.created_at))throw new Error('Invalid cursor');return{created_at:input.created_at as number,relation_id:id(input.relation_id)};}
export function validateListRelations(value:unknown):ListRelationsRequest{const input=object(value);exact(input,['field_id','relation_type','lifecycle','endpoint','cursor','limit']);if(!(input.relation_type===null||input.relation_type==='SOURCED_FROM'||input.relation_type==='SUPERSEDED_BY'))throw new Error('Invalid relation type');if(!(input.lifecycle===null||input.lifecycle==='ACTIVE'||input.lifecycle==='RETRACTED'))throw new Error('Invalid relation lifecycle');return{field_id:id(input.field_id),relation_type:input.relation_type,lifecycle:input.lifecycle,endpoint:nullable(input.endpoint,endpoint),cursor:nullable(input.cursor,relationCursor),limit:limit(input.limit)};}
function activityCursor(value:unknown):ActivityCursor{const input=object(value);exact(input,['created_at','activity_id']);if(!Number.isSafeInteger(input.created_at))throw new Error('Invalid cursor');return{created_at:input.created_at as number,activity_id:id(input.activity_id)};}
export function validateListActivities(value:unknown):ListActivitiesRequest{const input=object(value);exact(input,['field_id','cursor','limit']);return{field_id:id(input.field_id),cursor:nullable(input.cursor,activityCursor),limit:limit(input.limit)};}

export function validateSnapshot(value: unknown): SaveSurfaceSnapshotRequest { const input=object(value);exact(input,['field_id','layout','open_objects']);if(!Array.isArray(input.open_objects)||!input.open_objects.every((item)=>typeof item==='string'&&UUID_V7.test(item)))throw new Error('Invalid open objects');return{field_id:id(input.field_id),layout:input.layout,open_objects:input.open_objects as string[]}; }
function surfaceLayout(value:unknown):SurfaceLayoutV1{const input=object(value);exact(input,['version','template','primary','supporting','focused_pane_id']);if(input.version!==1||!['PRIMARY_ONLY','PRIMARY_SUPPORT_RIGHT','PRIMARY_TWO_SUPPORTS_RIGHT'].includes(String(input.template))||!Array.isArray(input.supporting)||typeof input.focused_pane_id!=='string')throw new Error('Invalid surface layout');const pane=(value:unknown)=>{const item=object(value);exact(item,['pane_id','primitive','binding','collapsed']);if(typeof item.pane_id!=='string'||!['TASK_PANE','REFERENCE_PANE'].includes(String(item.primitive))||typeof item.collapsed!=='boolean')throw new Error('Invalid pane');const binding=object(item.binding);if(binding.kind==='FIELD_TASKS')exact(binding,['kind']);else if(binding.kind==='REFERENCE'){exact(binding,['kind','object_id']);id(binding.object_id);}else throw new Error('Invalid pane binding');return item as unknown as SurfaceLayoutV1['primary'];};return{version:1,template:input.template as SurfaceLayoutV1['template'],primary:pane(input.primary),supporting:input.supporting.map(pane),focused_pane_id:input.focused_pane_id};}
export function validateSnapshotV1(value:unknown):SaveSurfaceSnapshotV1Request{const input=object(value);exact(input,['field_id','layout']);return{field_id:id(input.field_id),layout:surfaceLayout(input.layout)};}

export function validateBrowserNavigate(value: unknown): BrowserNavigateRequest {
  const input = object(value); exact(input, ['url']);
  if (typeof input.url !== 'string' || input.url.length > 8192) throw new Error('Invalid Browse URL');
  return { url: input.url };
}

export function validateBrowserPageRequest(value: unknown): BrowserPageRequest {
  const input = object(value); exact(input, ['page_id']);
  if (typeof input.page_id !== 'string' || !/^page_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.page_id)) {
    throw new Error('Invalid Browse page ID');
  }
  return { page_id: input.page_id };
}

export function validateBrowserBounds(value: unknown): BrowserViewBounds {
  const input = object(value); exact(input, ['x', 'y', 'width', 'height']);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const item = input[key];
    if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 10000) {
      throw new Error('Invalid Browse bounds');
    }
  }
  return input as unknown as BrowserViewBounds;
}

function boundedText(value:unknown,max:number,label:string,allowEmpty=false):string{if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim()))throw new Error(`Invalid ${label}`);return value;}
function boundedUnicodeText(value:unknown,maxScalars:number,maxBytes:number,label:string,allowEmpty=false):string{if(typeof value!=='string'||[...value].length>maxScalars||new TextEncoder().encode(value).byteLength>maxBytes||(!allowEmpty&&!value.trim()))throw new Error(`Invalid ${label}`);return value;}
export function validateClipboardText(value: unknown): string { return boundedUnicodeText(value, 1_048_576, 1_048_576, 'clipboard text', true); }
const PROVIDER_KINDS=new Set(['OPENAI','ANTHROPIC','OPENAI_COMPATIBLE']);
export function validateCreateProvider(value:unknown):CreateProviderConfigRequest{const input=object(value);exact(input,['provider_kind','display_name','base_url','default_model','custom_endpoint_acknowledged','model_optimization']);if(!(input.base_url===null||typeof input.base_url==='string')||typeof input.custom_endpoint_acknowledged!=='boolean'||(input.model_optimization!==undefined&&typeof input.model_optimization!=='boolean'))throw new Error('Invalid provider config');return{provider_kind:enumValue(input.provider_kind,PROVIDER_KINDS,'provider kind') as CreateProviderConfigRequest['provider_kind'],display_name:boundedText(input.display_name,120,'display name'),base_url:input.base_url as string|null,default_model:boundedText(input.default_model,256,'model'),custom_endpoint_acknowledged:input.custom_endpoint_acknowledged,...(input.model_optimization===undefined?{}:{model_optimization:input.model_optimization as boolean})};}
export function validateUpdateProvider(value:unknown):UpdateProviderConfigRequest {
  const input=object(value);exact(input,['provider_config_id','expected_revision','provider_kind','display_name','base_url','default_model','custom_endpoint_acknowledged','model_optimization']);
  if(!(input.base_url===null||typeof input.base_url==='string')||typeof input.custom_endpoint_acknowledged!=='boolean'||(input.model_optimization!==undefined&&typeof input.model_optimization!=='boolean'))throw new Error('Invalid provider config');
  if(input.provider_kind!==undefined&&!['OPENAI','ANTHROPIC','OPENAI_COMPATIBLE'].includes(String(input.provider_kind)))throw new Error('Invalid provider kind');
  return {provider_config_id:id(input.provider_config_id),expected_revision:revision(input.expected_revision),...(input.provider_kind===undefined?{}:{provider_kind:input.provider_kind as UpdateProviderConfigRequest['provider_kind']}),display_name:boundedText(input.display_name,120,'display name'),base_url:input.base_url as string|null,default_model:boundedText(input.default_model,256,'model'),custom_endpoint_acknowledged:input.custom_endpoint_acknowledged,...(input.model_optimization===undefined?{}:{model_optimization:input.model_optimization as boolean})};
}
export function validateProviderReference(value:unknown):ProviderConfigRequest{const input=object(value);exact(input,['provider_config_id']);return{provider_config_id:id(input.provider_config_id)};}
export function validatePrepareProviderSend(value: unknown): PrepareProviderSendRequest {
  const input = object(value);
  exact(input, ['provider_config_id', 'model_id']);
  return { provider_config_id: id(input.provider_config_id), model_id: input.model_id == null ? null : boundedUnicodeText(input.model_id, 256, 1024, 'model') };
}
export function validateStoreCredential(value:unknown):StoreCredentialRequest{const input=object(value);exact(input,['provider_config_id','secret']);return{provider_config_id:id(input.provider_config_id),secret:boundedUnicodeText(input.secret,2048,2048,'credential')};}
function contextChip(value:unknown):ContextChip{const input=object(value);exact(input,['kind','source_identity','source_revision_or_navigation_generation','display_label','content','sensitivity','completeness']);return{kind:enumValue(input.kind,new Set(['CURRENT_FIELD','CURRENT_FOCUS','CURRENT_PAGE','CURRENT_SELECTION','CAPTURE','USER_NOTE']),'context kind') as ContextChip['kind'],source_identity:boundedText(input.source_identity,256,'context identity'),source_revision_or_navigation_generation:boundedText(input.source_revision_or_navigation_generation,64,'context generation'),display_label:boundedText(input.display_label,160,'context label'),content:boundedUnicodeText(input.content,4000,16*1024,'context content',true),sensitivity:enumValue(input.sensitivity,new Set(['NORMAL','SENSITIVE','BLOCKED']),'sensitivity') as ContextChip['sensitivity'],completeness:enumValue(input.completeness,new Set(['COMPLETE','PARTIAL']),'completeness') as ContextChip['completeness']};}
export function validateStartModel(value:unknown):StartModelInvocationRequest{const input=object(value);exact(input,['provider_config_id','model_id','intent','user_input','context_package','response_mode']);if(!(input.model_id===null||typeof input.model_id==='string')||!Array.isArray(input.context_package)||input.context_package.length>8||input.response_mode!=='TEXT')throw new Error('Invalid model invocation');const chips=input.context_package.map(contextChip);const totalScalars=chips.reduce((total,chip)=>total+[...chip.content].length,0);const totalBytes=chips.reduce((total,chip)=>total+new TextEncoder().encode(chip.content).byteLength,0);if(totalScalars>12000||totalBytes>48*1024)throw new Error('Invalid context package');return{provider_config_id:id(input.provider_config_id),model_id:input.model_id===null?null:boundedUnicodeText(input.model_id,256,1024,'model'),intent:enumValue(input.intent,new Set(['ASK','CONTINUE']),'intent') as StartModelInvocationRequest['intent'],user_input:boundedUnicodeText(input.user_input,8000,32*1024,'user input'),context_package:chips,response_mode:'TEXT'};}
export function validateCancelModel(value:unknown):CancelModelInvocationRequest{const input=object(value);exact(input,['invocation_id']);return{invocation_id:id(input.invocation_id)};}
function captureSource(value:unknown):CaptureSource{const input=object(value);exact(input,['kind','title','uri','field_id','resource_type','resource_id','resource_revision','provider_config_id','provider_model_id','provider_invocation_id','is_partial']);for(const key of ['title','uri','field_id','resource_type','resource_id','provider_config_id','provider_model_id','provider_invocation_id'] as const){if(!(input[key]===null||typeof input[key]==='string'))throw new Error('Invalid capture source');}if(typeof input.uri==='string'&&new TextEncoder().encode(input.uri).byteLength>2048)throw new Error('Invalid capture source URI');if(!(input.resource_revision===null||Number.isSafeInteger(input.resource_revision))||typeof input.is_partial!=='boolean')throw new Error('Invalid capture source');return input as unknown as CaptureSource;}
export function validateCreateCapture(value:unknown):CreateCaptureRequest{const input=object(value);exact(input,['kind','title','content','source']);return{kind:enumValue(input.kind,new Set(['TEXT','PAGE','SELECTION','MODEL_OUTPUT','FIELD_EXCERPT']),'capture kind') as CreateCaptureRequest['kind'],title:boundedUnicodeText(input.title,120,480,'capture title'),content:boundedUnicodeText(input.content,16000,64*1024,'capture content'),source:captureSource(input.source)};}
export function validateCaptureReference(value:unknown):CaptureRequest{const input=object(value);exact(input,['capture_id']);return{capture_id:id(input.capture_id)};}
export function validateMutateCapture(value:unknown):MutateCaptureRequest{const input=object(value);exact(input,['capture_id','expected_revision']);return{capture_id:id(input.capture_id),expected_revision:revision(input.expected_revision)};}
export function validateAttachCapture(value:unknown):AttachCaptureRequest{const input=object(value);exact(input,['capture_id','field_id','expected_revision']);return{capture_id:id(input.capture_id),field_id:id(input.field_id),expected_revision:revision(input.expected_revision)};}
export function validatePromoteCapture(value:unknown):PromoteCaptureRequest{const input=object(value);exact(input,['capture_id','field_id','expected_revision']);return{capture_id:id(input.capture_id),field_id:input.field_id===null?null:id(input.field_id),expected_revision:revision(input.expected_revision)};}
export function validateListCaptures(value:unknown):ListCapturesRequest{const input=object(value);exact(input,['placement','lifecycle','field_id','cursor','limit']);if(!(input.placement===null||['INBOX','ATTACHED','PROMOTED'].includes(String(input.placement)))||!(input.lifecycle===null||['ACTIVE','ARCHIVED'].includes(String(input.lifecycle))))throw new Error('Invalid capture filter');let cursor=null;if(input.cursor!==null){const item=object(input.cursor);exact(item,['updated_at','capture_id']);if(!Number.isSafeInteger(item.updated_at))throw new Error('Invalid capture cursor');cursor={updated_at:item.updated_at as number,capture_id:id(item.capture_id)};}return{placement:input.placement as ListCapturesRequest['placement'],lifecycle:input.lifecycle as ListCapturesRequest['lifecycle'],field_id:input.field_id===null?null:id(input.field_id),cursor,limit:limit(input.limit)};}
const LIBRARY_MEDIA_KINDS=new Set(['DOCUMENT','IMAGE','AUDIO','VIDEO','OTHER','WEB']);
export function validateSaveWebLibrary(value:unknown):SaveWebLibraryRequest{const input=object(value);exact(input,['url','title','source','selected_content','metadata']);if(typeof input.url!=='string'||typeof input.source!=='string'||!(input.selected_content===null||typeof input.selected_content==='string')||typeof input.metadata!=='object'||input.metadata===null||Array.isArray(input.metadata))throw new Error('Invalid saved web object');const parsed=new URL(input.url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Invalid saved web URL');return{url:boundedUnicodeText(input.url,2048,8192,'saved web URL'),title:boundedUnicodeText(input.title,512,2048,'saved web title'),source:boundedUnicodeText(input.source,64,256,'saved web source'),selected_content:input.selected_content===null?null:boundedUnicodeText(input.selected_content,16000,64000,'saved selection',true),metadata:input.metadata};}
export function validateLibraryObject(value:unknown):LibraryObjectRequest{const input=object(value);exact(input,['library_object_id']);return{library_object_id:id(input.library_object_id,'Library object')};}
export function validateDeleteLibraryObject(value:unknown):DeleteLibraryObjectRequest{const input=object(value);exact(input,['library_object_id','expected_revision']);return{library_object_id:id(input.library_object_id,'Library object'),expected_revision:revision(input.expected_revision)};}
export function validateListLibraryObjects(value:unknown):ListLibraryObjectsRequest{const input=object(value);exact(input,['media_kind','include_deleted','limit']);if(!(input.media_kind===null||typeof input.media_kind==='string'&&LIBRARY_MEDIA_KINDS.has(input.media_kind))||typeof input.include_deleted!=='boolean'||!(input.limit===null||Number.isInteger(input.limit)&&Number(input.limit)>=1&&Number(input.limit)<=500))throw new Error('Invalid Library filter');return{media_kind:input.media_kind as ListLibraryObjectsRequest['media_kind'],include_deleted:input.include_deleted,limit:input.limit as number|null};}

export function validatePickProject(value: unknown): PickProjectRequest {
  const input=object(value); exact(input,['title','goal']);
  if(!(input.goal===null||typeof input.goal==='string'))throw new Error('Invalid Project goal');
  return{title:boundedUnicodeText(input.title,120,480,'Project title',true),goal:input.goal as string|null};
}
export function validateCreateProject(value: unknown): CreateProjectRequest {
  const input=object(value); exact(input,['title','goal','root_path']);
  const picked=validatePickProject({title:input.title,goal:input.goal});
  return{...picked,title:boundedUnicodeText(picked.title,120,480,'Project title'),root_path:boundedUnicodeText(input.root_path,32767,32767,'Project root')};
}
export function validateUpdateProject(value:unknown):UpdateProjectRequest{const input=object(value);exact(input,['field_id','expected_revision','title']);return{field_id:id(input.field_id),expected_revision:revision(input.expected_revision),title:boundedUnicodeText(input.title,120,480,'Project title')};}
export function validateArchiveProject(value:unknown):ArchiveProjectRequest{const input=object(value);exact(input,['field_id','expected_revision']);return{field_id:id(input.field_id),expected_revision:revision(input.expected_revision)};}
export const validateWorkspaceProject=(value:unknown):WorkspaceProjectRequest=>validateReference(value);
export function validateOpenWorkspaceProject(value:unknown):OpenWorkspaceProjectRequest{const input=object(value);exact(input,['field_id','target']);return{field_id:id(input.field_id),target:enumValue(input.target,new Set(['FILE_EXPLORER','VISUAL_STUDIO_CODE','CURSOR','VISUAL_STUDIO','GIT_BASH','INTELLIJ_IDEA','PYCHARM','WEBSTORM']),'workspace open target') as OpenWorkspaceProjectRequest['target']};}
function conversationFields(input:Record<string,unknown>):{title:string;provider_config_id:string|null;model_id:string|null}{
  if(!(input.provider_config_id===null||typeof input.provider_config_id==='string')||!(input.model_id===null||typeof input.model_id==='string'))throw new Error('Invalid Conversation selection');
  return{title:boundedUnicodeText(input.title,120,480,'Conversation title'),provider_config_id:input.provider_config_id===null?null:id(input.provider_config_id),model_id:input.model_id===null?null:boundedUnicodeText(input.model_id,256,1024,'model')};
}
export function validateCreateConversation(value:unknown):CreateConversationRequest{const input=object(value);exact(input,['field_id','title','provider_config_id','model_id']);return{field_id:id(input.field_id),...conversationFields(input)};}
export function validateConversationReference(value:unknown):ConversationRequest{const input=object(value);exact(input,['conversation_id']);return{conversation_id:id(input.conversation_id)};}
export function validateUpdateConversation(value:unknown):UpdateConversationRequest{const input=object(value);exact(input,['conversation_id','expected_revision','title','provider_config_id','model_id']);return{conversation_id:id(input.conversation_id),expected_revision:revision(input.expected_revision),...conversationFields(input)};}
export function validateArchiveConversation(value:unknown):ArchiveConversationRequest{const input=object(value);exact(input,['conversation_id','expected_revision']);return{conversation_id:id(input.conversation_id),expected_revision:revision(input.expected_revision)};}
function validateResultReference(value:unknown):ResultReference{
  const input=object(value);exact(input,['id','label','target','provenance']);
  const referenceId=boundedUnicodeText(input.id,42,42,'result reference');
  if(!/^resultref_[0-9a-f]{32}$/.test(referenceId))throw new Error('Invalid result reference');
  const targetInput=object(input.target);
  const kind=enumValue(targetInput.kind,new Set(['PROJECT_FILE','CODE_RANGE','WEB_REFERENCE','IMAGE']),'result reference target') as ResultReference['target']['kind'];
  let target:ResultReference['target'];
  if(kind==='PROJECT_FILE'){
    exact(targetInput,['kind','field_id','relative_path','expected_sha256']);
    const hash=targetInput.expected_sha256===null?null:boundedUnicodeText(targetInput.expected_sha256,64,64,'reference hash');
    if(hash!==null&&!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid reference hash');
    target={kind,field_id:id(targetInput.field_id,'Project'),relative_path:relativePath(targetInput.relative_path),expected_sha256:hash};
  }else if(kind==='CODE_RANGE'){
    exact(targetInput,['kind','field_id','relative_path','line_start','line_end','expected_sha256']);
    const lineStart=integer(targetInput.line_start,1,1000000,'reference line');
    const lineEnd=integer(targetInput.line_end,lineStart,1000000,'reference line');
    if(lineEnd-lineStart>100000)throw new Error('Invalid reference range');
    const hash=targetInput.expected_sha256===null?null:boundedUnicodeText(targetInput.expected_sha256,64,64,'reference hash');
    if(hash!==null&&!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid reference hash');
    target={kind,field_id:id(targetInput.field_id,'Project'),relative_path:relativePath(targetInput.relative_path),line_start:lineStart,line_end:lineEnd,expected_sha256:hash};
  }else if(kind==='WEB_REFERENCE'){
    exact(targetInput,['kind','field_id','reference_id','https_url']);
    const url=boundedUnicodeText(targetInput.https_url,2048,8192,'HTTPS reference');let parsed:URL;
    try{parsed=new URL(url);}catch{throw new Error('Invalid HTTPS reference');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Invalid HTTPS reference');
    target={kind,field_id:id(targetInput.field_id,'Project'),reference_id:id(targetInput.reference_id,'Reference'),https_url:url};
  }else{
    exact(targetInput,['kind','source','library_object_id','screenshot_evidence_id','expected_sha256','mime_type']);
    const hash=boundedUnicodeText(targetInput.expected_sha256,64,64,'image reference hash');
    if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid image reference hash');
    const source=enumValue(targetInput.source,new Set(['LIBRARY','SCREENSHOT_EVIDENCE']),'image reference source') as 'LIBRARY'|'SCREENSHOT_EVIDENCE';
    if(source==='LIBRARY'){
      if(targetInput.screenshot_evidence_id!==undefined&&targetInput.screenshot_evidence_id!==null)throw new Error('Invalid image source identity');
      target={kind,source,library_object_id:id(targetInput.library_object_id,'Library object'),expected_sha256:hash,mime_type:enumValue(targetInput.mime_type,new Set(['image/png','image/jpeg','image/webp']),'image reference MIME')};
    }else{
      if(targetInput.library_object_id!==undefined&&targetInput.library_object_id!==null)throw new Error('Invalid image source identity');
      target={kind,source,screenshot_evidence_id:id(targetInput.screenshot_evidence_id,'Screenshot evidence'),expected_sha256:hash,mime_type:enumValue(targetInput.mime_type,new Set(['image/png']),'image reference MIME')};
    }
  }
  const provenanceInput=object(input.provenance);
  const provenanceKind=enumValue(provenanceInput.kind,new Set(['PROJECT_CONTEXT','TOOL_RECEIPT','SAVED_REFERENCE','LIBRARY_OBJECT','SCREENSHOT_EVIDENCE']),'result reference provenance') as ResultReference['provenance']['kind'];
  let provenance:ResultReference['provenance'];
  if(provenanceKind==='PROJECT_CONTEXT'){exact(provenanceInput,['kind']);provenance={kind:provenanceKind};}
  else if(provenanceKind==='TOOL_RECEIPT'){exact(provenanceInput,['kind','tool_call_id']);provenance={kind:provenanceKind,tool_call_id:id(provenanceInput.tool_call_id,'Tool call')};}
  else if(provenanceKind==='SAVED_REFERENCE'){exact(provenanceInput,['kind','reference_id']);provenance={kind:provenanceKind,reference_id:id(provenanceInput.reference_id,'Reference')};}
  else if(provenanceKind==='LIBRARY_OBJECT'){exact(provenanceInput,['kind','library_object_id']);provenance={kind:provenanceKind,library_object_id:id(provenanceInput.library_object_id,'Library object')};}
  else{exact(provenanceInput,['kind','screenshot_evidence_id']);provenance={kind:provenanceKind,screenshot_evidence_id:id(provenanceInput.screenshot_evidence_id,'Screenshot evidence')};}
  return{id:referenceId,label:boundedUnicodeText(input.label,256,1024,'reference label'),target,provenance};
}
export function validateCreateConversationMessage(value:unknown):CreateConversationMessageRequest{
  const input=object(value);exact(input,['conversation_id','role','content','status','provider_config_id','model_id','invocation_id','references']);
  if(!(input.provider_config_id===null||typeof input.provider_config_id==='string')||!(input.model_id===null||typeof input.model_id==='string')||!(input.invocation_id===null||typeof input.invocation_id==='string'))throw new Error('Invalid message provenance');
  const role=enumValue(input.role,new Set(['USER','ASSISTANT']),'message role') as CreateConversationMessageRequest['role'];
  const status=enumValue(input.status,new Set(['COMPLETED','CANCELLED','FAILED']),'message status') as CreateConversationMessageRequest['status'];
  const content=boundedUnicodeText(input.content,1048576,1048576,'message');
  const references=(input.references===undefined?[]:array(input.references)).map(validateResultReference);
  if(references.length>64||new Set(references.map((reference)=>reference.id)).size!==references.length)throw new Error('Invalid result references');
  if(role==='USER'&&references.length>0)throw new Error('User message cannot claim result references');
  if(references.some((reference)=>reference.target.kind==='IMAGE')&&(role!=='ASSISTANT'||status!=='COMPLETED'))throw new Error('Inline images require a completed Assistant result');
  if(references.some((reference)=>!content.includes(`](fielora-reference:${reference.id})`)))throw new Error('Missing result reference marker');
  if(references.some((reference)=>reference.target.kind==='IMAGE'&&(!content.split(/\r?\n/u).some((line)=>line.trim()===`![${reference.label}](fielora-reference:${reference.id})`)||reference.label.includes('[')||reference.label.includes(']'))))throw new Error('Invalid inline image marker');
  return{conversation_id:id(input.conversation_id),role,content,status,provider_config_id:input.provider_config_id===null?null:id(input.provider_config_id),model_id:input.model_id===null?null:boundedUnicodeText(input.model_id,256,1024,'model'),invocation_id:input.invocation_id===null?null:id(input.invocation_id),references};
}
export function validateListConversationMessages(value:unknown):ListConversationMessagesRequest{const input=object(value);exact(input,['conversation_id']);return{conversation_id:id(input.conversation_id)};}
export function validateScreenshotEvidence(value:unknown):ScreenshotEvidenceRequest{const input=object(value);exact(input,['screenshot_evidence_id']);return{screenshot_evidence_id:id(input.screenshot_evidence_id,'Screenshot evidence')};}
export function validateScreenshotEvidencePreview(value:unknown):ScreenshotEvidencePreviewRequest{const input=object(value);exact(input,['screenshot_evidence_id','expected_content_sha256']);const digest=boundedUnicodeText(input.expected_content_sha256,64,64,'screenshot digest');if(!/^[0-9a-f]{64}$/.test(digest))throw new Error('Invalid screenshot digest');return{screenshot_evidence_id:id(input.screenshot_evidence_id,'Screenshot evidence'),expected_content_sha256:digest};}
export function validateScreenshotEvidenceByRun(value:unknown):ListScreenshotEvidenceByRunRequest{const input=object(value);exact(input,['run_id']);return{run_id:id(input.run_id,'Agent run')};}
export function validateScreenshotEvidenceByVerification(value:unknown):ListScreenshotEvidenceByVerificationRequest{const input=object(value);exact(input,['verification_receipt_id']);return{verification_receipt_id:id(input.verification_receipt_id,'Verification receipt')};}
export function validateListArtifacts(value:unknown):ListArtifactsRequest{const input=object(value);exact(input,['cursor','limit','include_archived']);let cursor=null;if(input.cursor!=null){const raw=object(input.cursor);exact(raw,['updated_at','artifact_id']);cursor={updated_at:integer(raw.updated_at,0,Number.MAX_SAFE_INTEGER,'artifact cursor time'),artifact_id:id(raw.artifact_id,'Artifact')};}return{cursor,limit:input.limit==null?null:integer(input.limit,1,100,'artifact limit'),include_archived:boolean(input.include_archived,'include archived')};}
export function validateReadArtifact(value:unknown):ReadArtifactRequest{const input=object(value);exact(input,['artifact_id','revision_id']);return{artifact_id:id(input.artifact_id,'Artifact'),revision_id:input.revision_id==null?null:id(input.revision_id,'Artifact revision')};}
export function validateArtifactHistory(value:unknown):ArtifactHistoryRequest{const input=object(value);exact(input,['artifact_id','before_sequence','limit']);return{artifact_id:id(input.artifact_id,'Artifact'),before_sequence:input.before_sequence==null?null:integer(input.before_sequence,2,Number.MAX_SAFE_INTEGER,'Artifact revision sequence'),limit:input.limit==null?null:integer(input.limit,1,100,'artifact history limit')};}
export function validateAssetPreview(value:unknown):AssetPreviewRequest{const input=object(value);exact(input,['asset_id','expected_content_sha256']);const digest=boundedUnicodeText(input.expected_content_sha256,64,64,'asset digest');if(!/^[0-9a-f]{64}$/.test(digest))throw new Error('Invalid asset digest');return{asset_id:id(input.asset_id,'Asset'),expected_content_sha256:digest};}
export function validateDiagramPreview(value:unknown):DiagramPreviewRequest{const input=object(value);exact(input,['artifact_id','revision_id']);return{artifact_id:id(input.artifact_id,'Artifact'),revision_id:id(input.revision_id,'Artifact revision')};}
export function validateSetArtifactArchiveState(value:unknown):SetArtifactArchiveStateCommandRequest{const input=object(value);exact(input,['field_id','conversation_id','provider_config_id','model_id','artifact_id','archived']);return{field_id:id(input.field_id),conversation_id:id(input.conversation_id),provider_config_id:id(input.provider_config_id),model_id:input.model_id==null?null:boundedUnicodeText(input.model_id,256,1024,'model'),artifact_id:id(input.artifact_id,'Artifact'),archived:boolean(input.archived,'archived')};}
export function validateListFileArtifactReviews(value:unknown):ListFileArtifactReviewsRequest{const input=object(value);exact(input,['run_id']);return{run_id:id(input.run_id,'Agent run')};}
export function validateMarkFileArtifactReviewed(value:unknown):MarkFileArtifactReviewedRequest{const input=object(value);exact(input,['artifact_id','revision_id']);return{artifact_id:id(input.artifact_id,'Artifact'),revision_id:id(input.revision_id,'Artifact revision')};}
export function validateUndoFileArtifactRevision(value:unknown):UndoFileArtifactRevisionRequest{const input=object(value);exact(input,['source_run_id','artifact_id','revision_id']);return{source_run_id:id(input.source_run_id,'Agent run'),artifact_id:id(input.artifact_id,'Artifact'),revision_id:id(input.revision_id,'Artifact revision')};}
function validateAgentAttachments(value:unknown):NonNullable<StartAgentRunRequest['attachments']>{const rawAttachments=value==null?[]:array(value);if(rawAttachments.length>4)throw new Error('Invalid Agent attachments');let attachmentBytes=0;const attachments=rawAttachments.map((value)=>{const attachment=object(value);exact(attachment,['id','filename','mime_type','size','width','height','source','data_url']);const mime=enumValue(attachment.mime_type,new Set(['image/png','image/jpeg','image/webp']),'attachment mime');const dataUrl=boundedUnicodeText(attachment.data_url,1500000,1500000,'attachment data');if(!dataUrl.startsWith(`data:${mime};base64,`)||!/^[A-Za-z0-9+/]+={0,2}$/.test(dataUrl.slice(dataUrl.indexOf(',')+1)))throw new Error('Invalid Agent attachment data');const size=integer(attachment.size,0,1048576,'attachment size');attachmentBytes+=dataUrl.length;if(attachmentBytes>6000000)throw new Error('Agent attachments too large');return{id:boundedUnicodeText(attachment.id,128,256,'attachment id'),filename:boundedUnicodeText(attachment.filename,260,1024,'attachment filename'),mime_type:mime,size,width:integer(attachment.width,1,32768,'attachment width'),height:integer(attachment.height,1,32768,'attachment height'),source:enumValue(attachment.source,new Set(['clipboard','file_picker','drag_drop']),'attachment source'),data_url:dataUrl};});return attachments;}
export function validateAgentResourceBudget(value: unknown): NonNullable<StartAgentRunRequest['resource_budget']> {
  const input = object(value);
  exact(input, ['max_execution_ms', 'max_input_tokens', 'max_output_tokens']);
  return { max_execution_ms: integer(input.max_execution_ms, 60_000, 86_400_000, 'execution budget'), max_input_tokens: integer(input.max_input_tokens ?? 0, 0, 50_000_000, 'input budget'), max_output_tokens: integer(input.max_output_tokens ?? 0, 0, 1_000_000, 'output budget') };
}
export function validateStartAgent(value:unknown):StartAgentRunRequest{const input=object(value);exact(input,['field_id','conversation_id','user_message_id','provider_config_id','model_id','task','permission','max_steps','attachments','active_work_surface','resource_budget']);if(!(input.user_message_id==null||typeof input.user_message_id==='string')||!(input.model_id===null||typeof input.model_id==='string')||!(input.max_steps===null||Number.isSafeInteger(input.max_steps)&&Number(input.max_steps)>=1&&Number(input.max_steps)<=64))throw new Error('Invalid Agent run');const attachments=validateAgentAttachments(input.attachments);let activeWorkSurface:ActiveArtifactContext|undefined;if(input.active_work_surface!=null){const active=object(input.active_work_surface);exact(active,['artifact_id','artifact_type','viewed_revision_id','current_revision_id','view_mode','archived','selected_slide','selected_sheet_id']);const viewMode=enumValue(active.view_mode,new Set(['CURRENT','HISTORICAL']),'artifact view mode') as ActiveArtifactContext['view_mode'];const viewed=id(active.viewed_revision_id,'Viewed Artifact revision');const current=id(active.current_revision_id,'Current Artifact revision');if((viewMode==='CURRENT')!==(viewed===current))throw new Error('Invalid active Artifact mode');activeWorkSurface={artifact_id:id(active.artifact_id,'Artifact'),artifact_type:enumValue(active.artifact_type,new Set(['DOCUMENT','PRESENTATION','DIAGRAM','SPREADSHEET']),'Artifact type') as ActiveArtifactContext['artifact_type'],viewed_revision_id:viewed,current_revision_id:current,view_mode:viewMode,archived:boolean(active.archived,'Artifact archived'),selected_slide:active.selected_slide==null?null:integer(active.selected_slide,0,31,'selected slide'),selected_sheet_id:active.selected_sheet_id==null?null:boundedUnicodeText(active.selected_sheet_id,64,256,'selected sheet')};}return{field_id:id(input.field_id),conversation_id:id(input.conversation_id),user_message_id:input.user_message_id==null?null:id(input.user_message_id),provider_config_id:id(input.provider_config_id),model_id:input.model_id===null?null:boundedUnicodeText(input.model_id,256,1024,'model'),task:boundedUnicodeText(input.task,32768,32768,'Agent task'),permission:enumValue(input.permission,new Set(['READ_ONLY','REVIEW_CHANGES','FULL_CONTROL']),'Agent permission') as StartAgentRunRequest['permission'],max_steps:input.max_steps as number|null,attachments,active_work_surface:activeWorkSurface,...(input.resource_budget==null?{}:{resource_budget:validateAgentResourceBudget(input.resource_budget)})};}
export function validateAgentRun(value:unknown):AgentRunRequest{const input=object(value);exact(input,['run_id']);return{run_id:id(input.run_id,'Agent run')};}
export function validateSkillCatalog(value:unknown):SkillCatalogRequest{const input=object(value);exact(input,['field_id']);return{field_id:input.field_id===null?null:id(input.field_id,'Project')};}
export function validateRegisterLocalPlugin(value:unknown):RegisterLocalPluginRequest{const input=object(value);exact(input,['root_path']);return{root_path:boundedUnicodeText(input.root_path,32767,65534,'local Plugin root')};}
export function validateUnregisterLocalPlugin(value:unknown):UnregisterLocalPluginRequest{const input=object(value);exact(input,['registration_id']);if(typeof input.registration_id!=='string'||!/^pluginreg_[0-9a-f]{32}$/.test(input.registration_id))throw new Error('Invalid Plugin registration');return{registration_id:input.registration_id};}
export function validateListAgentRuns(value:unknown):ListAgentRunsRequest{const input=object(value);exact(input,['conversation_id']);return{conversation_id:id(input.conversation_id)};}
export function validateModelUsageReport(value: unknown): ModelUsageReportRequest {
  const input = object(value); exact(input, ['since', 'offset', 'limit']);
  if (!(input.since === null || Number.isSafeInteger(input.since) && Number(input.since) >= 0 && Number(input.since) <= 8_640_000_000_000_000)
    || !Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 1_000_000
    || !Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100) throw new Error('Invalid model usage query');
  return { since: input.since as number | null, offset: Number(input.offset), limit: Number(input.limit) };
}
export function validateListAgentEvents(value:unknown):ListAgentEventsRequest{const input=object(value);exact(input,['run_id','after_sequence','limit']);if(!(input.after_sequence===null||Number.isSafeInteger(input.after_sequence)&&Number(input.after_sequence)>=0)||!(input.limit===null||Number.isSafeInteger(input.limit)&&Number(input.limit)>=1&&Number(input.limit)<=500))throw new Error('Invalid Agent event page');return{run_id:id(input.run_id,'Agent run'),after_sequence:input.after_sequence as number|null,limit:input.limit as number|null};}
export function validateResolveAgentApproval(value:unknown):ResolveAgentApprovalRequest{const input=object(value);exact(input,['run_id','approval_id','nonce','decision']);return{run_id:id(input.run_id,'Agent run'),approval_id:id(input.approval_id,'Agent approval'),nonce:boundedText(input.nonce,128,'approval nonce'),decision:enumValue(input.decision,new Set(['ALLOW_ONCE','DENY']),'approval decision') as ResolveAgentApprovalRequest['decision']};}
export function validateActivateMcpConnection(value:unknown):ActivateMcpConnectionRequest{const input=object(value);exact(input,['run_id','connection_id']);const connectionId=boundedText(input.connection_id,64,'MCP connection');if(!/^[A-Za-z0-9._-]+$/.test(connectionId))throw new Error('Invalid MCP connection');return{run_id:id(input.run_id,'Agent run'),connection_id:connectionId};}
function relativePath(value:unknown):string{const result=boundedUnicodeText(value,4096,16384,'relative path');if(/^(?:[a-zA-Z]:|[\\/])/.test(result)||result.replaceAll('\\','/').split('/').some((part)=>part===''||part==='..'))throw new Error('Invalid relative path');return result.replaceAll('\\','/');}
export function validateWorkspaceFile(value:unknown):WorkspaceFileRequest{const input=object(value);exact(input,['field_id','relative_path']);return{field_id:id(input.field_id),relative_path:relativePath(input.relative_path)};}
export function validateStoreWorkspaceAttachment(value:unknown):StoreWorkspaceAttachmentRequest{const input=object(value);exact(input,['id','name','size','mime_type','data_url','width','height','source']);const mime=enumValue(input.mime_type,new Set(['image/png','image/jpeg','image/webp']),'attachment mime');const dataUrl=boundedUnicodeText(input.data_url,1500000,1500000,'attachment data');if(!dataUrl.startsWith(`data:${mime};base64,`)||!/^[A-Za-z0-9+/]+={0,2}$/.test(dataUrl.slice(dataUrl.indexOf(',')+1)))throw new Error('Invalid attachment data');return{id:boundedUnicodeText(input.id,128,256,'attachment id'),name:boundedUnicodeText(input.name,260,1024,'attachment name'),size:integer(input.size,1,1048576,'attachment size'),mime_type:mime,data_url:dataUrl,width:integer(input.width,1,32768,'attachment width'),height:integer(input.height,1,32768,'attachment height'),source:enumValue(input.source,new Set(['clipboard','file_picker','drag_drop']),'attachment source') as StoreWorkspaceAttachmentRequest['source']};}
export function validateReadWorkspaceAttachment(value:unknown):ReadWorkspaceAttachmentRequest{const input=object(value);exact(input,['content_ref']);if(typeof input.content_ref!=='string'||!/^[0-9a-f]{64}\.(?:png|jpg|webp)$/.test(input.content_ref))throw new Error('Invalid attachment reference');return{content_ref:input.content_ref};}
export function validateSaveWorkspaceAttachment(value:unknown):SaveWorkspaceAttachmentRequest{const input=object(value);exact(input,['content_ref','filename']);const reference=validateReadWorkspaceAttachment({content_ref:input.content_ref});const filename=boundedUnicodeText(input.filename,260,1024,'attachment filename');if(/[\\/:*?"<>|]/.test(filename)||filename==='.'||filename==='..')throw new Error('Invalid attachment filename');return{...reference,filename};}
export function validateApplyWorkspaceFile(value:unknown):ApplyWorkspaceFileRequest{const input=object(value);exact(input,['field_id','relative_path','expected_sha256','content']);if(typeof input.expected_sha256!=='string'||!/^[0-9a-f]{64}$/.test(input.expected_sha256))throw new Error('Invalid file hash');return{field_id:id(input.field_id),relative_path:relativePath(input.relative_path),expected_sha256:input.expected_sha256,content:boundedUnicodeText(input.content,1048576,1048576,'file content',true)};}
export function validateRunTerminal(value:unknown):RunTerminalRequest{const input=object(value);exact(input,['field_id','command','working_directory']);return{field_id:id(input.field_id),command:boundedUnicodeText(input.command,8000,32000,'terminal command'),working_directory:boundedUnicodeText(input.working_directory,4096,16384,'terminal working directory')};}
export function validateCancelTerminal(value:unknown):CancelTerminalRequest{const input=object(value);exact(input,['run_id']);if(typeof input.run_id!=='string'||!/^run_[0-9a-f-]{36}$/.test(input.run_id))throw new Error('Invalid terminal run');return{run_id:input.run_id};}

export function validateResumeAgent(value:unknown):ResumeAgentRunRequest{const input=object(value);exact(input,['run_id','attachments','user_message_id','resource_budget']);return{run_id:id(input.run_id,'Agent run'),...(input.resource_budget==null?{}:{resource_budget:validateAgentResourceBudget(input.resource_budget)}),...(input.user_message_id==null?{}:{user_message_id:id(input.user_message_id,'User message')}),...(input.attachments==null?{}:{attachments:validateAgentAttachments(input.attachments)})};}

export function validateUpdateModelRuntime(value: unknown): UpdateModelRuntimeRequest {
  const input = object(value); exact(input, ['provider_config_id', 'expected_provider_revision', 'expected_revision', 'settings']);
  const settings = object(input.settings); exact(settings, ['reasoning', 'max_output_tokens']);
  if (!Number.isSafeInteger(input.expected_revision) || (input.expected_revision as number) < 0 ||
      !Number.isSafeInteger(settings.max_output_tokens) || (settings.max_output_tokens as number) < 256 || (settings.max_output_tokens as number) > 16384) throw new Error('Invalid model configuration');
  return { provider_config_id: id(input.provider_config_id), expected_provider_revision: revision(input.expected_provider_revision), expected_revision: input.expected_revision as number,
    settings: { reasoning: enumValue(settings.reasoning, new Set(['PROVIDER_DEFAULT','OFF','ON','LOW','MEDIUM','HIGH','MAX']), 'reasoning mode') as UpdateModelRuntimeRequest['settings']['reasoning'], max_output_tokens: settings.max_output_tokens as number } };
}
