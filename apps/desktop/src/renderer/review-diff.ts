import type { AgentReviewFile } from './agent-review';

export interface ReviewDiffRow {
  kind: 'add' | 'remove' | 'context' | 'hunk' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Only hunk coordinates or a complete new/deleted file establish line numbers. */
export function reviewDiffRows(file: AgentReviewFile): ReviewDiffRow[] {
  const rows: ReviewDiffRow[] = [];
  if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(file.diff)) {
    let oldLine = 0;
    let newLine = 0;
    let remainingOld = 0;
    let remainingNew = 0;
    for (const line of file.diff.split(/\r?\n/)) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (hunk) {
        oldLine = Number(hunk[1]); newLine = Number(hunk[3]);
        remainingOld = Number(hunk[2] ?? 1); remainingNew = Number(hunk[4] ?? 1);
        rows.push({ kind: 'hunk', text: line, oldLine: null, newLine: null });
      } else if (line.startsWith('-') && remainingOld > 0) {
        rows.push({ kind: 'remove', text: line.slice(1), oldLine: oldLine++, newLine: null }); remainingOld--;
      } else if (line.startsWith('+') && remainingNew > 0) {
        rows.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ }); remainingNew--;
      } else if (line.startsWith(' ') && remainingOld > 0 && remainingNew > 0) {
        rows.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ }); remainingOld--; remainingNew--;
      } else if (line.startsWith('\\')) {
        rows.push({ kind: 'meta', text: line, oldLine: null, newLine: null });
      }
    }
    return rows;
  }
  // Legacy replacement receipts contain exact snippets but no file coordinates.
  for (const [index, change] of file.changes.entries()) {
    if (file.changes.length > 1) rows.push({ kind: 'hunk', text: `变更片段 ${index + 1}`, oldLine: null, newLine: null });
    const append = (text: string, kind: 'add' | 'remove', numbered: boolean) => {
      if (!text) return;
      const lines = text.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      lines.forEach((line, i) => rows.push({ kind, text: line, oldLine: numbered && kind === 'remove' ? i + 1 : null, newLine: numbered && kind === 'add' ? i + 1 : null }));
    };
    append(change.before ?? '', 'remove', file.changeType === 'DELETE');
    append(change.after, 'add', file.changeType === 'CREATE');
  }
  return rows;
}
