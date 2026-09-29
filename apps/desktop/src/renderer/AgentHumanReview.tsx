import { useEffect, useMemo, useRef, useState } from 'react';
import { reviewDisplayFor, type AgentReviewFile, type AgentReviewSummary } from './agent-review';
import { reviewDiffRows } from './review-diff';
import { Button, IconButton } from './UiPrimitives';
import { AppIcon, FileTypeIcon } from './ui';

interface AgentHumanReviewProps {
  review: AgentReviewSummary;
  task: string;
  runId: string;
  onOpenFile: (path: string) => void;
  onMarkReviewed?: (file: AgentReviewFile) => Promise<void>;
  onUndo?: (file: AgentReviewFile) => Promise<void>;
  selectedPathHint?: string;
}

function DiffCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className="human-review-count"><span className="diff-additions">+{additions}</span><span className="diff-deletions">−{deletions}</span></span>;
}

function UnifiedDiff({ file }: { file: AgentReviewFile }) {
  const rows = useMemo(() => reviewDiffRows(file), [file]);
  if (file.changeType === 'RENAME') return <p className="human-review-notice"><code>{file.previousPath}</code> → <code>{file.path}</code></p>;
  if (!rows.length) return <p className="human-review-notice">没有可显示的文本差异。</p>;
  return <div className="human-unified-diff" data-testid="agent-review-human-diff" aria-label="代码差异，左侧为原行号，右侧为新行号">
    {rows.map((row, index) => <div className={`human-diff-row is-${row.kind}`} key={index}>
      {row.kind === 'hunk' || row.kind === 'meta' ? <span className="human-diff-note">{row.text}</span> : <>
        <span className="human-diff-line-number" aria-hidden="true">{row.oldLine}</span>
        <span className="human-diff-line-number" aria-hidden="true">{row.newLine}</span>
        <span className="human-diff-sign" aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span>
        <code>{row.text || ' '}</code>
      </>}
    </div>)}
  </div>;
}

export function AgentHumanReview({ review, task, runId, onOpenFile, onMarkReviewed, onUndo, selectedPathHint = '' }: AgentHumanReviewProps) {
  const [selectedPath, setSelectedPath] = useState(review.files[0]?.path ?? '');
  const [reviewedRevisions, setReviewedRevisions] = useState<string[]>([]);
  const [undoFinished, setUndoFinished] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [filesOpen, setFilesOpen] = useState(false);
  const [mode, setMode] = useState<'VISUAL' | 'RAW'>('VISUAL');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!review.files.some((file) => file.path === selectedPath)) setSelectedPath(review.files[0]?.path ?? '');
  }, [review.files, selectedPath]);
  useEffect(() => {
    if (selectedPathHint && review.files.some((file) => file.path === selectedPathHint)) setSelectedPath(selectedPathHint);
  }, [review.files, selectedPathHint]);
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); setActionError(''); }, [selectedPath, runId]);
  const selected = useMemo(() => review.files.find((file) => file.path === selectedPath) ?? review.files[0] ?? null, [review.files, selectedPath]);
  const display = selected ? reviewDisplayFor(selected) : 'RAW';
  const index = selected ? review.files.indexOf(selected) : 0;
  const selectFile = (file: AgentReviewFile) => { setSelectedPath(file.path); setFilesOpen(false); };
  const perform = async (file: AgentReviewFile, action: 'review' | 'undo') => {
    setActionBusy(true); setActionError('');
    try {
      if (action === 'review' && onMarkReviewed) { await onMarkReviewed(file); setReviewedRevisions((items) => [...items, file.revisionId!]); }
      if (action === 'undo' && onUndo) { await onUndo(file); setUndoFinished((items) => [...items, file.revisionId!]); }
    } catch { setActionError(action === 'undo' ? '未能撤销修改，请重新检查文件状态后重试。' : '未能保存审阅状态，请重试。'); }
    finally { setActionBusy(false); }
  };

  return <section className="agent-review agent-human-review" data-testid="agent-review" data-review-mode={mode} data-agent-run-id={runId} data-file-count={review.files.length} data-additions={review.additions} data-deletions={review.deletions} aria-label={task.split(/\r?\n/)[0] || '本次任务变更'}>
    <header className="human-review-heading">
      <span>{review.state === 'PROPOSED' ? '待应用变更' : '本次任务'}</span>
      <DiffCounts additions={review.additions} deletions={review.deletions}/>
      <Button variant="ghost" className="human-review-file-toggle" disabled={review.files.length < 2} aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)} data-testid="agent-review-files-toggle">{review.files.length} 个文件{review.files.length > 1 && <AppIcon name="chevronDown" size="sm"/>}</Button>
    </header>
    {filesOpen && <div className="human-review-files" aria-label="已修改文件">
      {review.files.map((file) => <Button variant="ghost" className={file.path === selected?.path ? 'active' : ''} aria-pressed={file.path === selected?.path} onClick={() => selectFile(file)} key={file.path} data-testid="agent-review-file" data-change-type={file.changeType}>
        <FileTypeIcon path={file.path}/><span className="human-review-path" title={file.path}>{file.path}</span><DiffCounts additions={file.additions} deletions={file.deletions}/>
      </Button>)}
    </div>}
    {selected ? <>
      <div className="human-review-file-heading" data-testid="agent-review-file" data-change-type={selected.changeType}>
        <FileTypeIcon path={selected.path}/><span className="human-review-path" title={selected.path}>{selected.path}</span>
        <DiffCounts additions={selected.additions} deletions={selected.deletions}/>
        {review.files.length > 1 && <nav aria-label="切换差异文件"><span>{index + 1}/{review.files.length}</span><IconButton size="sm" label="上一个文件" icon={<AppIcon name="back" size="sm"/>} disabled={index === 0} onClick={() => selectFile(review.files[index - 1]!)}/><IconButton size="sm" label="下一个文件" icon={<AppIcon name="forward" size="sm"/>} disabled={index === review.files.length - 1} onClick={() => selectFile(review.files[index + 1]!)}/></nav>}
      </div>
      {selected.applicability === 'CHANGED_SINCE' && <p className="human-review-notice" data-testid="agent-review-stale">当前文件已有后续修改，下方显示本次任务保存的差异。</p>}
      <div className="human-review-scroll" ref={scrollRef} tabIndex={0} aria-label="文件差异">
        {mode === 'VISUAL' && display !== 'RAW' ? <UnifiedDiff file={selected}/> : <pre className="human-review-raw" data-testid="agent-review-diff">{selected.diff}</pre>}
      </div>
      <footer className="human-review-footer">
        {actionError && <p className="human-review-action-error" role="alert">{actionError}</p>}
        <div className="human-review-actions">
          <div className="human-review-mode" role="group" aria-label="Diff 显示方式">
            {display !== 'RAW' && <Button variant="ghost" aria-pressed={mode === 'VISUAL'} onClick={() => setMode('VISUAL')} data-testid="agent-review-human">差异</Button>}
            <Button variant="ghost" aria-pressed={mode === 'RAW' || display === 'RAW'} onClick={() => setMode('RAW')} data-testid="agent-review-raw">原始</Button>
          </div>
          <Button variant="ghost" onClick={() => onOpenFile(selected.path)} data-testid="agent-review-open-file"><AppIcon name="openAction" size="sm"/>打开文件</Button>
          {selected.artifactId && selected.revisionId && onMarkReviewed && <Button disabled={actionBusy || selected.reviewState === 'REVIEWED' || reviewedRevisions.includes(selected.revisionId)} onClick={() => { void perform(selected, 'review'); }} data-testid="agent-review-mark-reviewed"><AppIcon name="check" size="sm"/>{selected.reviewState === 'REVIEWED' || reviewedRevisions.includes(selected.revisionId) ? '已审阅' : '标记已审阅'}</Button>}
          {selected.artifactId && selected.revisionId && onUndo && selected.undoAvailability === 'AVAILABLE' && !undoFinished.includes(selected.revisionId) && <Button variant="ghost" disabled={actionBusy} onClick={() => { void perform(selected, 'undo'); }} data-testid="agent-review-undo">撤销修改</Button>}
        </div>
        {selected.undoAvailability === 'BLOCKED_CHANGED_SINCE' && <p className="human-review-notice" data-testid="agent-review-undo-blocked">当前文件已变化，无法安全撤销</p>}
        {selected.revisionId && undoFinished.includes(selected.revisionId) && <p className="human-review-notice" role="status">已撤销这次修改</p>}
      </footer>
    </> : <p className="human-review-notice">暂无文件变更。</p>}
  </section>;
}
