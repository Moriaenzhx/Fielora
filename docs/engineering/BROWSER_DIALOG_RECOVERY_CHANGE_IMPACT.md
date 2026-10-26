# Browser dialog and input recovery — 2026-10-23

Flow: an Agent clicks an observed page control; a native JavaScript dialog waits
for the user; the same input finishes once the dialog closes. Cancellation or
timeout must release the caller without replaying uncertain input. A later
native delivery acknowledgement may be retained for explicit same-Run recovery.

Confirmed failure: Chromium acknowledges mouseReleased only after confirm closes.
The Host 25s/Core 30s deadlines previously discarded the request correlation.
The native probe in artifacts/browser-dialog-recovery-20261023/probe.log reproduces
opening, cancellation, closing and the original acknowledgement in that order.

Changes: existing BrowserRuntime observes Page dialog lifecycle only while it owns
an input operation. AgentBrowserHost and BrowserBridge suspend their ordinary
deadline during that human wait, with a bounded total wait. Cancellation remains
effective; no next mouse event is sent after cancellation. Main-only progress and
completion messages remain bound to Core-created request/Run/ToolCall identities.
An acknowledged delivery is saved through the existing event ledger. Recovery
may consume that fact for the exact UNKNOWN click, without calling the tool again.
UI derives a waiting label from the existing checkpoint projection.

Invariants: no automatic dialog accept/dismiss, no dialog text treated as authority,
no model-accessible CDP, no DISPATCHED inference from merely seeing a dialog, no
verification from delivery, no receipt fabricated from page appearance, no second
state/permission/evidence owner. Missing proof, partial input, host crash before
acknowledgement and historical UNKNOWN calls remain unresolved. A cancelled Run
does not restart when a late receipt arrives. Another operation cannot overlap an
unfinished input on the same page. Unrelated requests cannot resolve its outcome.

Persistence/contracts: additive Main-only FIPC and bounded checkpoint metadata;
no schema/migration or model tool changes. Old receipts remain readable and fail
closed. Reverting code leaves additive historical events inert. Existing production
data and failure artifacts are preserved; installed application is not replaced.

Desktop integration exposed the generic terminal-event guard rejecting a true
late acknowledgement after Stop. Add one narrow storage append for correlated
browser-input lifecycle facts, validated against the existing ToolCall. It writes
only the existing event and next_sequence, preserving status, error_code,
finished_at, updated_at and allowances. Generic terminal mutation remains denied;
this is post-stop audit evidence, not a new resume or execution path.

Verification: native confirm/alert (including >30s wait), manual-equivalent cancel/
accept in isolated fixtures, Stop and late completion, partial input/closed page,
wrong request/call, cold recovery without replay, ordinary click regression;
Cross/PreMerge and targeted packaged desktop smoke. Fixtures prove mechanism;
the original real-model task is reported separately and cannot be marked passed
from this repair alone. Source records AE-011/029, Reality, Decisions and Agent spec
will track actual results and remaining limits.

Final desktop revalidation exposed a receive/deadline race after persistence: the
receiver checked an empty channel, waited for the input mutex, then saw the removed
correlation and applied its expired ordinary deadline although the receipt was now
ready. Poll the channel and deadline under the same existing input mutex used by
completion through delivery. Cancellation retains priority; no deadline increase,
new lock owner, retry or execution/verification authority is introduced.
