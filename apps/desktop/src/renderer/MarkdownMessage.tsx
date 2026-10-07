import { createElement, useEffect, useState, type ReactNode } from 'react';
import type { ResultReference } from '@fielora/contracts';
import type { ResultImagePreviewView } from '../workspace-types';
import type { ActivityFileLink } from './agent-activity-detail';
import { AppIcon } from './ui/Icon';

export interface ActivityFileContext {
  resolve: (target: string) => ActivityFileLink | null;
  open?: (file: ActivityFileLink) => void;
}

interface MarkdownMessageProps {
  modernStatusMarkers?: boolean;
  content: string;
  streaming?: boolean;
  onCopyError?: (message: string) => void;
  references?: ResultReference[];
  onOpenReference?: (reference: ResultReference) => void;
  onOpenImage?: (preview: ResultImagePreviewView) => void;
  activityFiles?: ActivityFileContext;
}

interface InlineMatch {
  index: number;
  length: number;
  kind: 'code' | 'strong' | 'strike' | 'emphasis' | 'link';
  label: string;
  target?: string;
}

function firstInlineMatch(value: string): InlineMatch | null {
  const candidates: InlineMatch[] = [];
  const patterns: Array<[InlineMatch['kind'], RegExp]> = [
    ['code', /`([^`\n]+)`/],
    ['link', /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|fielora-reference:resultref_[0-9a-f]{32}|fielora-project-file:[^)\s]+)\)/i],
    ['strong', /\*\*([^*\n]+)\*\*/],
    ['strike', /~~([^~\n]+)~~/],
    ['emphasis', /(^|[^*])\*([^*\n]+)\*/],
  ];

  patterns.forEach(([kind, pattern]) => {
    const match = pattern.exec(value);
    if (!match) return;
    const prefixLength = kind === 'emphasis' ? (match[1]?.length ?? 0) : 0;
    candidates.push({
      index: match.index + prefixLength,
      length: match[0].length - prefixLength,
      kind,
      label: (kind === 'emphasis' ? match[2] : match[1]) ?? '',
      target: kind === 'link' ? match[2] : undefined,
    });
  });

  return candidates.sort((left, right) => left.index - right.index || left.length - right.length)[0] ?? null;
}

interface ReferenceRenderContext {
  modernStatusMarkers?: boolean;
  activityFiles?: ActivityFileContext;
  references: ReadonlyMap<string, ResultReference>;
  onOpenReference?: (reference: ResultReference) => void;
  onOpenImage?: (preview: ResultImagePreviewView) => void;
}

function controlledImageMarker(line: string): { label: string; referenceId: string } | null {
  const match = /^\s*!\[([^\]\n]+)\]\(fielora-reference:(resultref_[0-9a-f]{32})\)\s*$/iu.exec(line);
  return match ? { label: match[1] ?? '', referenceId: match[2] ?? '' } : null;
}

function InlineResultImage({ reference, context }: { reference: ResultReference & { target: Extract<ResultReference['target'], { kind: 'IMAGE' }> }; context: ReferenceRenderContext }) {
  const [preview, setPreview] = useState<ResultImagePreviewView | null>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'UNAVAILABLE'>('LOADING');
  const sourceLabel = reference.target.source === 'SCREENSHOT_EVIDENCE' ? '页面截图' : '资料库';
  useEffect(() => {
    let live = true;
    setPreview(null);setState('LOADING');
    const request = reference.target.source === 'SCREENSHOT_EVIDENCE' && reference.target.screenshot_evidence_id
      ? window.fielora.screenshot.preview({ screenshot_evidence_id: reference.target.screenshot_evidence_id, expected_content_sha256: reference.target.expected_sha256 })
      : reference.target.source === 'LIBRARY' && reference.target.library_object_id
        ? window.fielora.library.previewImage({ library_object_id: reference.target.library_object_id })
        : Promise.reject(new Error('Missing image source identity'));
    void request.then((resolved) => {
      const valid = resolved.source === reference.target.source
        && (resolved.source === 'LIBRARY'
          ? resolved.library_object_id === reference.target.library_object_id
            && resolved.content_hash === reference.target.expected_sha256
            && resolved.size > 0 && resolved.size <= 8 * 1024 * 1024
          : resolved.screenshot_evidence_id === reference.target.screenshot_evidence_id
            && resolved.content_sha256 === reference.target.expected_sha256
            && resolved.byte_size > 0 && resolved.byte_size <= 4 * 1024 * 1024)
        && resolved.mime_type === reference.target.mime_type
        && resolved.data_url.startsWith(`data:${resolved.mime_type};base64,`);
      if (!live) return;
      if (!valid) { setState('UNAVAILABLE'); return; }
      setPreview(resolved);setState('READY');
    }).catch(() => { if (live) setState('UNAVAILABLE'); });
    return () => { live = false; };
  }, [reference.id, reference.target.expected_sha256, reference.target.library_object_id, reference.target.mime_type, reference.target.screenshot_evidence_id, reference.target.source]);
  if (state === 'LOADING') return <figure className="markdown-inline-image is-loading" data-testid="markdown-inline-image" data-reference-id={reference.id}><div role="status">正在加载图片…</div><figcaption>{reference.label}<span>{sourceLabel}</span></figcaption></figure>;
  if (!preview) return <figure className="markdown-inline-image is-unavailable" data-testid="markdown-inline-image" data-reference-id={reference.id}><div role="status">图片不可用</div><figcaption>{reference.label}<span>{sourceLabel}</span></figcaption></figure>;
  return <figure className="markdown-inline-image" data-testid="markdown-inline-image" data-reference-id={reference.id}>
    <button type="button" onClick={() => context.onOpenImage?.(preview)} aria-label={`放大 ${reference.label}`} disabled={!context.onOpenImage}><img src={preview.data_url} alt={reference.label}/></button>
    <figcaption>{reference.label}<span>{sourceLabel}</span></figcaption>
  </figure>;
}

function renderInline(value: string, keyPrefix: string, context?: ReferenceRenderContext): ReactNode[] {
  const status = context?.modernStatusMarkers ? /^(?:✅|✔️?|☑️?)\s+(.+)$/u.exec(value) : null;
  if (status) return [<span className="markdown-status-marker" role="img" aria-label="对勾" key={`${keyPrefix}-status`}><AppIcon name="check"/></span>, ...renderInline(status[1]!, keyPrefix, { ...context!, modernStatusMarkers: false })];
  const result: ReactNode[] = [];
  let remaining = value;
  let sequence = 0;
  while (remaining.length > 0) {
    const match = firstInlineMatch(remaining);
    if (!match) {
      result.push(remaining);
      break;
    }
    if (match.index > 0) result.push(remaining.slice(0, match.index));
    const key = `${keyPrefix}-${sequence++}`;
    if (match.kind === 'code') result.push(<code key={key}>{match.label}</code>);
    if (match.kind === 'strong') result.push(<strong key={key}>{renderInline(match.label, key, context)}</strong>);
    if (match.kind === 'strike') result.push(<del key={key}>{renderInline(match.label, key, context)}</del>);
    if (match.kind === 'emphasis') result.push(<em key={key}>{renderInline(match.label, key, context)}</em>);
    if (match.kind === 'link' && match.target?.startsWith('fielora-reference:')) {
      const reference = context?.references.get(match.target.slice('fielora-reference:'.length));
      if (reference) {
        result.push(<button key={key} type="button" className="markdown-typed-reference" data-reference-kind={reference.target.kind} data-reference-id={reference.id} onClick={() => context?.onOpenReference?.(reference)} disabled={!context?.onOpenReference}><AppIcon name={reference.target.kind === 'IMAGE' ? 'images' : reference.target.kind === 'WEB_REFERENCE' ? 'browse' : 'files'}/>{renderInline(match.label, key, context)}</button>);
      } else {
        result.push(<span key={key} className="markdown-reference-unavailable">{renderInline(match.label, key, context)}</span>);
      }
    } else if (match.kind === 'link' && match.target?.toLowerCase().startsWith('fielora-project-file:')) {
      const file = context?.activityFiles?.resolve(match.target);
      result.push(file && context?.activityFiles?.open
        ? <button key={key} type="button" className="markdown-typed-reference" data-reference-kind="PROJECT_FILE" onClick={() => context.activityFiles?.open?.(file)}><AppIcon name="files"/>{match.label}</button>
        : <code key={key}>{match.label}</code>);
    } else if (match.kind === 'link') result.push(<a key={key} href={match.target} target="_blank" rel="noreferrer noopener">{renderInline(match.label, key, context)}</a>);
    remaining = remaining.slice(match.index + match.length);
  }
  return result;
}

function CodeBlock({ code, language, onCopyError }: { code: string; language: string; onCopyError?: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await window.fielora.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (reason) {
      onCopyError?.(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return <div className="markdown-code-block">
    <header><span>{language || '代码'}</span><button type="button" onClick={() => void copy()} aria-label={copied ? '代码已复制' : '复制代码'}>{copied ? '已复制' : '复制'}</button></header>
    <pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
  </div>;
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isList(line: string): boolean {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (controlledImageMarker(line) || isFence(line) || /^(#{1,6})\s+/.test(line) || /^\s*>\s?/.test(line) || isList(line) || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) return true;
  return index + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '');
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdown(content: string, onCopyError?: (message: string) => void, context?: ReferenceRenderContext): ReactNode[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) { index += 1; continue; }

    const imageMarker = controlledImageMarker(line);
    if (imageMarker) {
      const reference = context?.references.get(imageMarker.referenceId);
      if (context && reference?.target.kind === 'IMAGE' && reference.label === imageMarker.label) {
        blocks.push(<InlineResultImage key={`image-${index}`} reference={reference as ResultReference & { target: Extract<ResultReference['target'], { kind: 'IMAGE' }> }} context={context}/>);
      } else {
        blocks.push(<p key={`image-unavailable-${index}`} className="markdown-reference-unavailable">{imageMarker.label}</p>);
      }
      index += 1;
      continue;
    }

    const fence = /^\s*```\s*([\w.+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<CodeBlock key={`code-${index}`} code={code.join('\n')} language={fence[1] ?? ''} onCopyError={onCopyError}/>);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      blocks.push(createElement(`h${level}`, { key: `heading-${index}` }, renderInline(heading[2] ?? '', `heading-${index}`, context)));
      index += 1;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`}/>);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(quote.join('\n'), `quote-${index}`, context)}</blockquote>);
      continue;
    }

    if (isList(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (index < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[index] ?? '') : /^\s*[-+*]\s+/.test(lines[index] ?? ''))) {
        const item = (lines[index] ?? '').replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-+*]\s+/, '');
        items.push(<li key={`item-${index}`}>{renderInline(item, `item-${index}`, context)}</li>);
        index += 1;
      }
      blocks.push(createElement(ordered ? 'ol' : 'ul', { key: `list-${index}` }, items));
      continue;
    }

    if (index + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '')) {
      const headings = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(tableCells(lines[index] ?? ''));
        index += 1;
      }
      blocks.push(<div className="markdown-table-wrap" key={`table-${index}`}><table><thead><tr>{headings.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `th-${index}-${cellIndex}`, context)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headings.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] ?? '', `td-${index}-${rowIndex}-${cellIndex}`, context)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.flatMap((item, paragraphIndex) => [paragraphIndex > 0 ? <br key={`br-${index}-${paragraphIndex}`}/> : null, ...renderInline(item, `paragraph-${index}-${paragraphIndex}`, context)])}</p>);
  }
  return blocks;
}

export function MarkdownMessage({ content, streaming = false, onCopyError, references = [], onOpenReference, onOpenImage, activityFiles, modernStatusMarkers = false }: MarkdownMessageProps) {
  const context: ReferenceRenderContext = { references: new Map(references.map((reference) => [reference.id, reference])), onOpenReference, onOpenImage, activityFiles, modernStatusMarkers };
  return <div className={`markdown-body${streaming ? ' is-streaming' : ''}`}>{renderMarkdown(content, onCopyError, context)}</div>;
}
