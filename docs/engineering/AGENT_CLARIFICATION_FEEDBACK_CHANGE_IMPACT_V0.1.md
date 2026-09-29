# Clarification feedback correction — 2026-09-23

Scope: the existing unfinished Run receives a natural-language reply to a question,
reconsiders its next action, and explains a continuing blocker instead of silently
repeating the same question. No new classifier, Run lifecycle, permission, network
service, credential flow, FIPC or migration.

Production evidence: Archify Run 01a0b4f3-9088-7da3-80b8-78f51abd8d18 accepted the
reply at event 190, resumed at 191, queried capability_status at step 29, and asked
the identical question at step 30. Reconstructing the current-request projection
from persisted messages and current guidance matches the recorded SHA-256
932988d2f74472cb86c59bc87dcd7a5fa05ed724c4877959b3e68c1e22eee670 (3751 UTF-8 bytes).
The reply was delivered. The capability receipt reported no registered web provider.
No production data was changed and no model request was replayed.

Changes: project the most recent accepted question/reply as a sourced native
assistant/user exchange at the end of each normal model request, after reduction;
retain the original task and bounded earlier replies. Add per-call reply IDs/digests
and visible tool names to existing model event metadata. The existing Observe
request_user_input accepts an optional bounded reason; re-asking the latest answered
question with only whitespace differences requires a reason addressing the reply.
This is a narrow protocol guard, not a semantic judge or a ban on valid clarification.
Rejected questions return actionable feedback and stop later actions in that batch.

Compatibility: old question receipts and question-only first calls remain valid.
No change to access grants, original request identity, verification or unknown-effect
reconciliation. Reasons are model claims, never permission or proof. Plain model
text cannot complete the still-unfinished installation. Existing failure/budget
controls remain. Rollback removes these projections/checks without data migration.

Validation: exact Chinese counterquestion after app restart; unchanged re-ask returns
feedback without another visible question or later batched write; explained re-ask
pauses visibly; supplying the source then completes a verified fixture action in the
same Run. Cover compaction/idempotent projection, foreign/stale reply rejection,
native message roles and diagnostics. Cross lane and targeted desktop smoke.
Fixture results do not prove real-model Archify installation or semantic quality.
