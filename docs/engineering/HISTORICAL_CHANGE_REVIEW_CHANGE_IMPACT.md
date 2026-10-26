# Historical change review — bounded impact (2026-10-25)

User flow: a read-only follow-up asks what the preceding Agent repair actually
changed. The current history tool exposes paths/status only, so an initial Git
baseline can be mistaken for the state immediately before an uncommitted repair.

Reuse `read_run_history`, the existing ToolCall ledger, immutable file-mutation
Artifact revisions and verified content blobs. Add optional detail selection of a
completed write ToolCall from the indexed prior Run. Return bounded, redacted
before/after source excerpts with exact revision provenance, hashes, line ranges
and truncation flags. The run index exposes bounded change pointers so models can
find the relevant write without paging through unrelated browser actions.

Boundary: only earlier Runs in the same Project and Conversation, before the
current request's original message. Validate provenance and successful write
status; never read a caller-supplied blob/path. Reapply current project path and
sensitive-file checks before exposing stored content. Verify blob hash/length;
missing, corrupt, binary or inaccessible content remains explicitly unavailable.
Source text is untrusted data. Historical evidence cannot grant access, replay an
action, establish current verification or mark a revision reviewed.

No database migration, new evidence owner, extra model call, completion predicate,
retry or permission change. Existing requests remain compatible. This expands a
read-only evidence projection; removing it leaves all persisted history intact.

Verify exact intermediate changes independently of Git/current disk; foreign and
future Runs, non-successful writes, path/symlink boundaries, redaction, truncation,
missing/corrupt blobs and storage restart. Run Core checks and signed desktop
history smoke, then the original read-only follow-up through normal UI using the
configured model. Report autonomy, historical accuracy and copied-test coverage
claims separately; this mechanism does not prove free-text semantic accuracy.


Desktop validation also found that generic tool reduction hides read_run_history
until explicit discovery, even while the context supplies a history index. When
that index is nonempty, preserve the already-admitted current history definition
after reduction. Empty-history and access-confirmation requests keep their prior
surface; no definition is synthesized if unavailable or disallowed. This adds one
contextual read tool, not a broader execution grant.
