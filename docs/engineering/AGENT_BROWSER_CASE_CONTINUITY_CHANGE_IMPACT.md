# Browser case continuity — Change Impact

User flow: resume a multi-case browser task, keep actual unchanged checks, correct mistaken expectations, and execute the remaining cases. The original workshop is still unaccepted. Its ledger contains repeated plans and initial-page checks, while CurrentWork exposes command results but no per-browser-case progress. Reissuing an identical browser_plan currently invalidates every earlier check.

Change: derive bounded case states from the existing ToolCall ledger, joining each check to the plan active when it ran. Expose actual checked assertions, missing/failed/stale cases, and source revision through the existing CurrentWork/Assessment. Repeating a plan preserves checks only for exactly unchanged URL, case ID, requirement, and current workspace revision. Changed cases, changed targets, changed source, failed checks, unknown outcomes, or rejected plans never become passes through replanning. A check proves its recorded assertions, not semantic correctness or complete request coverage. The model must derive test conditions from the original request, distinguish preconditions from outcomes, and correct contradictory hypotheses rather than modify correct code to satisfy them.

Boundary: no schema, new runtime, credential, permission, or model-specific business rules. Original task constraints stay user authority; plans remain advisory. Existing host ownership/snapshot checks and failure blockers remain. A restart still requires live page inspection and host plan setup; retained checks are historical evidence at the recorded source revision, not a claim that transient page state persists. Rollback is code-only; retain existing ledger and artifacts.

Validation: first reproduce identical-plan loss; test partial progress, changed requirements/URL/revision, later failures, rejected plans, old receipts and cold-ledger reconstruction. Real Electron must retain an earlier check after repeated host plan setup and advance to a second case. Run Cross and packaged smoke, then resume the original real-model workshop through normal UI. Report mechanism verification and real task acceptance separately; research, constraints, budget, conflict create/resolve, save/reload and exported contents require their own evidence.

Real-model continuation exposed a second cold boundary: host plans are ephemeral and were not rehydrated, so browser_verify returned BROWSER_INVALID_CHECK after restart despite a retained accepted plan. Core now passes only the latest successful same-Run plan as separate trusted adapter metadata; the host revalidates the existing URL/case schema and restores its own map. Model arguments and remote content cannot supply this field. No page, snapshot, input or passing result is restored. Same-Run provenance and invalid/foreign plans are tested; packaged E2E now quits and relaunches between cases before verifying with no new model plan.

2026-10-13 terminal reconciliation: `finish_task.required_evidence` previously
compared browser receipts to the global workspace revision even when CurrentWork
had admitted the unchanged Host-observed static resource scope. Reuse the existing
`agent_browser_scope::fresh` predicate for declared browser evidence; command and
legacy browser evidence retain global revision checks. Unrelated README edits do
not discard an actual unchanged page check; changed recorded resources, failed or
unknown receipts and current verification blockers still reject completion. No
new verification authority or coverage claim. Bounded rejection diagnostics name
the failed requirement, cited tool types/status/freshness and invalid receipt IDs
without echoing file/page bodies. Test notes-only changes, real input changes,
legacy revisions and actual desktop finish after notes; never substitute download,
read_file or native input receipts for browser_verify.
