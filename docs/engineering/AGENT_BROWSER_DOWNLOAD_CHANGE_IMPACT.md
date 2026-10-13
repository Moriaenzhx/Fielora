# Bounded browser download capture — 2026-10-13

Flow: an Agent clicks Export, receives the actual downloaded file, inspects its
bytes through ordinary governed tools, and reports what was verified. Production
workshop tool198 opened a native Save panel invisible to browser observations;
no file existed. The evaluator cancelled that pending dialog and quit normally
to preserve the Run. No export acceptance is claimed.

Extend the existing browser capability with action=download and fresh snapshot/ref.
The existing Host clicks that observed control and captures one native Chromium
download from that exact run-owned WebContents. Core supplies its own existing
artifact root separately from model arguments. Native bytes go to a generated
private subdirectory there, never a remote/model-supplied destination or filename.
Return path, source URL, suggested name, byte count and SHA-256 only. Up to16MiB;
bounded wait, cancellation and partial-file cleanup; no automatic execution/open.
Project copies/edits still use ordinary governed tools. Capture is an observation
artifact, not a workspace source edit or proof of its contents.

Unarmed downloads from Agent pages are cancelled with explicit observation
guidance instead of opening an invisible native Save panel. Ordinary Browse
downloads keep native behavior. Bind by actual WebContents, accept one item,
reject extra/late downloads, and keep failed/unknown input distinct from successful
capture. A successful click is not a successful download, and successful download
does not verify JSON/business semantics. No automatic completion or case pass.

Reuse BrowserRuntime/Host, BrowserBridge, existing Run/ToolCall policy and artifact
directory. No new schema, credentials, general OS input, arbitrary JavaScript,
network policy, state owner or verification authority. Old browser calls remain
valid; rollback removes the action and capture handler. Required evidence: actual
Blob and HTTP downloads in isolated Electron, exact bytes/hash, original filename
path attack, wrong contents, oversized/failed/cancelled/late/multiple downloads,
ordinary Browse noninterference, cold task continuation and real-model outcome.

## Captured-file read handoff — 2026-10-13

A real model followed the download receipt with `read_file(artifact_path)`, but
reference-only absolute-path admission rejected the captured file. Reuse the
existing read_file projection and current Run's durable successful browser
ToolCall receipts as the only grant source. Core admits one exact captured file
inside its own browser-downloads/<run>/capture-*/download namespace, checks
regular-file/no-symlink containment plus recorded size and SHA-256, and projects
the same bounded bytes that were verified. No directory, sibling, other Run,
model-supplied receipt or generic host-path access; failed/unknown captures and
changed bytes remain denied. Preserve UTF-8/binary and read-size behavior, no
automatic execution/copy or acceptance promotion, no new schema/permission owner.
Test the direct download -> read_file handoff, cold restart, cross-Run/failed
receipt/changed-content/symlink rejection; Electron/package tests run separately
from the active production model session.
