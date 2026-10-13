import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import type { WorkspaceAttachmentView } from '../workspace-types';

export type ComposerDraft = { prompt: string; attachments: WorkspaceAttachmentView[] };
const emptyDraft = (): ComposerDraft => ({ prompt: '', attachments: [] });
export const consumeComposerDraft = (current: ComposerDraft, submitted: ComposerDraft): ComposerDraft => current === submitted ? emptyDraft() : current;
export const composerDraftKey = (projectId: string, conversationId: string): string => JSON.stringify([projectId, conversationId]);

// Unsaved editing state lasts for this app session, including workspace remounts.
// Sent messages and attachment blobs retain their existing persistence owners.
export class ComposerDraftStore {
  private readonly drafts = new Map<string, ComposerDraft>();
  read(key: string): ComposerDraft { return this.drafts.get(key) ?? emptyDraft(); }
  write(key: string, draft: ComposerDraft): void {
    if (draft.prompt || draft.attachments.length) this.drafts.set(key, draft);
    else this.drafts.delete(key);
  }
  move(from: string, to: string): void {
    if (from === to || !this.drafts.has(from)) return;
    this.write(to, this.read(from)); this.drafts.delete(from);
  }
}
const sessionDrafts = new ComposerDraftStore();

export function useComposerDraft(key: string) {
  const activeKey = useRef(key);
  const [draft, setDraft] = useState(() => sessionDrafts.read(key));
  useLayoutEffect(() => {
    activeKey.current = key;
    setDraft(sessionDrafts.read(key));
  }, [key]);
  const update = useCallback((target: string, action: (value: ComposerDraft) => ComposerDraft) => {
    const next = action(sessionDrafts.read(target));
    sessionDrafts.write(target, next);
    if (activeKey.current === target) setDraft(next);
  }, []);
  const setPrompt = useCallback((value: SetStateAction<string>) => update(activeKey.current, current => ({ ...current, prompt: typeof value === 'function' ? value(current.prompt) : value })), [update]);
  const setAttachments = useCallback((value: SetStateAction<WorkspaceAttachmentView[]>) => update(activeKey.current, current => ({ ...current, attachments: typeof value === 'function' ? value(current.attachments) : value })), [update]);
  const move = useCallback((from: string, to: string) => sessionDrafts.move(from, to), []);
  const clear = useCallback((target: string, submitted?: ComposerDraft) => update(target, current => submitted ? consumeComposerDraft(current, submitted) : emptyDraft()), [update]);
  return { ...draft, snapshot: draft, setPrompt, setAttachments, update, move, clear };
}
