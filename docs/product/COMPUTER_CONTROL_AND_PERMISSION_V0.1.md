# Computer control and permission

2026-10-13 implementation contract. This refines Full control within the existing Model + Harness + Capability architecture; it does not add a second permission or execution system.

## User flow

The Agent can discover `computer`, inspect actual platform readiness, select a running application, and perform task-related native operations. Full control allows ordinary actions without a confirmation for each click. OS Accessibility, screen access, administrator rights and application authentication remain separate prerequisites, reported from actual tool facts.

Two human decisions are required before clearing a whole data scope. The first confirms the prepared scope and performs no deletion. The second uses a new nonce and confirms execution of the same unchanged operation. Rejecting or cancelling either stage stops execution. Changed arguments, files or destination invalidate the prepared authorization.

Uploading non-code local data requires a separate, operation-specific approval. Being inside a project directory does not make data source code. Source exemption is conservative: tracked source/configuration, bounded readable content and sensitive-path/content exclusions; it is not a comprehensive secret detector. Files, archives, form values, queries, clipboard data and app observations can all disclose local information; changing the transport does not change the authorization requirement.

The user selected first observation consent per task + application + receiving model service. The approval identifies the application and receiving service. It covers bounded app observation for this task, not file upload, clearing data or another receiving service. Ending/cancelling the task ends its scope. A changed receiver cannot silently receive earlier application observations. Fine-grained revoke UI is not yet implemented.

## Implemented native adapter

The macOS adapter uses real AX/CGEvent operations: status, observe, activate, click, Unicode type, press and scroll. Status and target preparation inspect application identities only. The first content observation follows the ordinary persisted approval flow. Native input requires the exact prepared application launch, a fresh snapshot, a valid target and current focus; it cannot auto-click Fielora or OS approval surfaces. Known terminal/script applications and known bulk-clear/upload controls are directed to governed operations instead of bypassing policy.

The native adapter currently exposes accessibility text, not screenshots. Windows native input is explicitly unsupported in this slice. No desktop screenshot is labelled as Browser evidence. Raw AX element trees are not stored in the durable ToolCall receipt: it keeps identity, result metadata, count and a content digest; immediate model context still receives the admitted bounded observation. This is not a promise that model replies or submitted tool arguments contain no user data.

Input dispatch is separate from successful task outcome. After unknown/partial input the task must inspect state, never blindly replay. Snapshots are ephemeral and expire; cold continuation observes again. One adapter lock serializes native actions. The existing task Stop action owns cancellation; old execution cleanup must not remove a newer continuation's cancellation handle.

On macOS the CLI Core checks into the Process Manager before querying the current foreground application through system-wide AX. This identity-only call does not activate an app or grant permission. The deprecated public API remains a compatibility maintenance point. AX reads distinguish an absent focused window from a system error; only bounded, identity-checked reads retry a transient CannotComplete result. Native input never retries automatically after dispatch.

## Enforcement boundary

Core prepares trusted facts, routes exceptions through existing Approval and rechecks them before dispatch. Private policy metadata supplied by the model is discarded. Recognized direct clears/uploads and explicit opaque variants receive bounded preparation, approval or a zero-dispatch denial requiring a reviewable operation. The two confirmation stages reuse one approval row with durable events and nonce rotation; no schema migration is required.

This is **not** an OS-wide data-loss-prevention system. Full control still includes arbitrary host programs and configured MCP servers; static argument inspection cannot prove all effects of those programs, arbitrary GUI actions or a series of small mutations. Known route checks and model instructions must not be advertised as complete filesystem/network mediation. These unmediated channels, full desktop screenshots and Windows acceptance remain separate implementation/validation work.

## Acceptance

Use independent temporary data, a local upload receiver and a separate native target application. Prove first confirmation has zero effects, second confirmation survives restart, denied/cancelled/replayed/changed operations do not execute, upload sends no bytes before consent, and actual native Unicode input reaches a saved file. Desktop tests may control the isolated Fielora shell to act as the human, but must not use DOM automation on the native target. Report deterministic-model engineering, packaged host, real model and original user task separately.

For static webpage acceptance, `browser_server serve` can attach Host-observed resource hashes to browser checks. Actual HTML/JS/CSS/Markdown dependencies invalidate checks when changed; unrelated delivery notes do not. Dynamic servers, legacy receipts and unproven request ownership retain global invalidation. This is evidence for the resources exercised by the recorded checks, not automatic proof of complete application behavior.

Completion submission uses that same resource freshness function for declared browser evidence; it does not reintroduce a global-revision requirement after unrelated notes change. Command checks and legacy browser receipts retain their existing global boundary. Diagnostic errors identify the failed requirement and invalid receipt IDs without fabricating replacements or proving semantic coverage.

The visible conversation owns its composer and foreground projection. Switching conversations releases only those UI references, while Core retains background runs. Late callbacks must match the selected conversation generation; a send acknowledgement consumes only the draft snapshot actually submitted.
