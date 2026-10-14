export interface ComputerPreviewRequest {
  run_id: string;
  tool_call_id: string;
  capture: boolean;
}

export interface ComputerPreviewView {
  state: 'AVAILABLE' | 'UNAVAILABLE';
  error_code?: string;
  target?: { app_id: string; bundle_id: string; name: string };
  snapshot_id?: string;
  icon_data_url?: string;
  image_data_url?: string;
  width?: number;
  height?: number;
  captured_at?: number;
}

/** Targets come from Core's receipt/session, never an arbitrary renderer PID. */
export function validateComputerPreview(value: unknown): ComputerPreviewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid application preview request');
  const input = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Object.keys(input).some(key => !['run_id', 'tool_call_id', 'capture'].includes(key))
    || typeof input.run_id !== 'string' || !uuid.test(input.run_id)
    || typeof input.tool_call_id !== 'string' || !uuid.test(input.tool_call_id)
    || (input.capture !== undefined && typeof input.capture !== 'boolean')) throw new Error('Invalid application preview request');
  return { run_id: input.run_id, tool_call_id: input.tool_call_id, capture: input.capture === true };
}

export function localPreviewPng(value: unknown, maxBytes = 3_000_000): string | undefined {
  return typeof value === 'string' && value.length <= maxBytes
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && !/[\r\n]/.test(value) ? value : undefined;
}

export function computerPreviewMessage(code?: string): string {
  if (code === 'COMPUTER_SCREEN_RECORDING_REQUIRED') return '需要在系统设置中允许 Fielora 录制屏幕，才能显示窗口画面。';
  if (code === 'COMPUTER_ACCESSIBILITY_REQUIRED') return '需要系统辅助功能权限，才能识别当前操作窗口。';
  if (code === 'COMPUTER_PREVIEW_RUN_INACTIVE') return '任务已暂停或结束，窗口预览已停止。';
  if (code === 'COMPUTER_BUSY') return '应用正在执行操作，请稍后刷新。';
  if (code === 'COMPUTER_PLATFORM_UNSUPPORTED' || code === 'COMPUTER_PREVIEW_UNSUPPORTED') return '当前系统暂不支持应用窗口预览。';
  if (code?.includes('STALE') || code?.includes('CHANGED') || code?.includes('RECEIPT')) return '操作窗口已变化，请等待下一次应用观察。';
  if (code?.includes('TIMEOUT')) return '窗口画面暂时未返回，可以稍后刷新。';
  return '暂时无法取得这个应用窗口的画面。';
}
