import type { ResultReference } from '@fielora/contracts';

export type PrototypeReference = ResultReference & {
  target: Extract<ResultReference['target'], { kind: 'PROJECT_FILE' }> & { expected_sha256: string };
};

// Only Core-resolved, version-bound file references qualify. Markdown content,
// extensions in code fences and model-authored URLs cannot create a preview.
export function prototypeReferences(references: ResultReference[], streaming: boolean): PrototypeReference[] {
  if (streaming) return [];
  const seen = new Set<string>();
  return references.filter((reference): reference is PrototypeReference => {
    const target = reference.target;
    if (target.kind !== 'PROJECT_FILE' || !/\.html?$/i.test(target.relative_path)
      || !target.expected_sha256 || !/^[a-f0-9]{64}$/.test(target.expected_sha256)) return false;
    const identity = JSON.stringify([target.field_id, target.relative_path, target.expected_sha256]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 4);
}

export function prototypeErrorMessage(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : '';
  if (code.includes('PROTOTYPE_CHANGED')) return '文件已修改。这份结果对应旧版本，请查看源码或打开最新结果中的原型。';
  if (code.includes('PROTOTYPE_TOO_LARGE')) return '文件超过预览大小限制（256 KiB），可以查看源码。';
  if (code.includes('PROTOTYPE_TOO_MANY')) return '打开的原型过多，请先关闭其他预览。';
  return '暂时无法预览。请确认项目文件仍可用，或查看源码。';
}
