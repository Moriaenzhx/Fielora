import type { ModelSupport, ProviderConfigView } from '@fielora/contracts';
export interface CapabilitySet { textInput: boolean; imageInput: boolean; videoInput: boolean; fileInput: boolean; toolCalling: boolean }
export interface ResolvedModelCapabilities extends CapabilitySet {
  model: CapabilitySet; provider: CapabilitySet; transport: CapabilitySet;
  imageInputReason: string | null; imageSupport: ModelSupport; toolSupport: ModelSupport;
}
export type ModelCapabilities = ResolvedModelCapabilities;
/** Core owns endpoint/model declarations. Unknown is distinct from unsupported. */
export function modelCapabilities(provider: ProviderConfigView | null | undefined): ResolvedModelCapabilities {
  const runtime = provider?.model_runtime;
  const profile = runtime?.profile.model_id === provider?.default_model ? runtime?.profile : undefined;
  const imageSupport = profile?.images ?? 'UNKNOWN';
  const toolSupport = profile?.tools ?? 'UNKNOWN';
  const toolVerified = !!profile && !!runtime?.validation?.checks.some(c => c.name === 'TOOL_CALL' && c.status === 'PASSED');
  const model: CapabilitySet = { textInput: true, imageInput: imageSupport === 'SUPPORTED', videoInput: false, fileInput: true, toolCalling: toolSupport === 'SUPPORTED' || toolVerified };
  const transport: CapabilitySet = {textInput:true,imageInput:!!provider,videoInput:false,fileInput:true,toolCalling:true};
  return { ...model, imageInput:model.imageInput && transport.imageInput, model, provider:transport, transport, imageSupport, toolSupport,
    imageInputReason: imageSupport === 'SUPPORTED' && provider ? null : imageSupport === 'UNSUPPORTED' ? '当前模型不支持图片输入' : '当前服务与模型的图片能力尚未确认' };
}
export function attachmentAllowed(capabilities: ResolvedModelCapabilities, kind: 'TEXT' | 'IMAGE'): boolean { return kind === 'IMAGE' ? capabilities.imageInput : capabilities.fileInput; }
