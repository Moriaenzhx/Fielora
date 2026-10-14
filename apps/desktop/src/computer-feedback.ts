import type { AgentToolCallView } from '@fielora/contracts';

export interface ComputerPointerFeedback {
  action: string;
  x: number;
  y: number;
  windowBounds: [number, number, number, number];
}

/** Presentation suppression only: overlapping tasks must not uncover a native
 * target until every acknowledged operation has settled. */
export class ComputerFeedbackActivity {
  private readonly operations = new Map<string, Set<string>>();
  get busy(): boolean { return this.operations.size > 0; }
  begin(runId: string, toolId: string): void {
    const calls = this.operations.get(runId) ?? new Set<string>();
    calls.add(toolId); this.operations.set(runId, calls);
  }
  completed(runId: string, toolId: string): void {
    const calls = this.operations.get(runId);
    calls?.delete(toolId);
    if (calls?.size === 0) this.operations.delete(runId);
  }
  runEnded(runId: string): void { this.operations.delete(runId); }
  reset(): void { this.operations.clear(); }
}

export function computerPointerFeedback(tool: AgentToolCallView | undefined): ComputerPointerFeedback | null {
  if (!tool || tool.name !== 'computer' || tool.status !== 'COMPLETED') return null;
  const receipt = tool.receipt as Record<string, unknown> | null;
  if (receipt?.kind !== 'COMPUTER' || receipt.success !== true || receipt.outcome_unknown === true || receipt.input_state !== 'DISPATCHED') return null;
  const feedback = receipt.input_feedback as Record<string, unknown> | undefined;
  const target = receipt.target as Record<string, unknown> | undefined;
  const feedbackTarget = feedback?.target as Record<string, unknown> | undefined;
  if (!feedback || feedback.coordinate_space !== 'SCREEN_POINTS' || !target?.app_id || feedbackTarget?.app_id !== target.app_id
    || feedback.action !== receipt.action || !['move', 'click', 'scroll', 'drag'].includes(String(feedback.action))) return null;
  const bounds = feedback.window_bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)
    || bounds[2] <= 0 || bounds[3] <= 0) return null;
  const x = feedback.action === 'drag' ? feedback.end_x : feedback.x;
  const y = feedback.action === 'drag' ? feedback.end_y : feedback.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
    || x < bounds[0] || y < bounds[1] || x >= bounds[0] + bounds[2] || y >= bounds[1] + bounds[3]) return null;
  return { action: String(feedback.action), x, y, windowBounds: bounds as ComputerPointerFeedback['windowBounds'] };
}

export const computerActionLabels: Record<string, string> = {
  status: '检查电脑控制状态', observe: '读取应用窗口', screenshot: '查看窗口画面', activate: '切换应用',
  click: '点击', type: '输入文字', press: '发送快捷键', scroll: '滚动', move: '移动指针', drag: '拖动',
};
