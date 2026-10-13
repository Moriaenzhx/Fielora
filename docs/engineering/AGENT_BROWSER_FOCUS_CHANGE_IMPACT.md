# Browser case focus — 2026-10-12

User flow: resume the same multi-action browser test after compression/restart,
retaining why the page was intentionally changed before deciding to reset it or
repair source. Guided Run01a13006 repeatedly interpreted no formal check as no
case activity. The existing action history has inputs, but no case/purpose bond.
This information gap is confirmed; a unique cause of model looping is not proven.

Add optional case_id and case_purpose to the existing browser action schema.
The model can attach them to an action it already needs, without another planning
round trip. The purpose is a bounded advisory model statement, not a user
constraint or verification. Browser execution, permission and snapshot handling
are unchanged; extra metadata never reaches native input parameters.

L2 derives a focus from existing same-Run ToolCalls, binding it to the accepted
plan active at that call. A changed case requirement or target is explicitly
unbound. Report the anchor attempt/status, count of related subsequent actions
and last actual check separately. Never infer an asserted PASS, automatic replay,
live page validity or current storage state. A missing label remains unknown.
NOT_RUN is clarified as no formal browser_verify, not no prior page interaction.

No new state/permission/evidence owner, DB column, schema migration, log capture,
secret source, background execution or hard-coded workshop logic. Old arguments
remain valid; rollback removes the optional projection/schema properties. Scope
checks, bounds, failed/unknown anchors, changed plans, cold serialization and the
actual compiled request after reduction must be tested. Native fixture success
is distinct from real-model convergence and original workshop acceptance.

2026-10-13 correction: real Qwen actions repeated case_id without case_purpose,
overwriting the projection's purpose with null. Preserve an explicit purpose
within the same uninterrupted case/target/requirement sequence, stopping at
case/plan boundaries or a new purpose. Intermediate checks need not finish a
multi-stage case or its cleanup. Same ledger, bounds and authority;
no new schema. Negative unit controls and the existing native cold-restart /
context-reduction fixture now cover repeated labels on subsequent actions.
