# Corrective review evidence continuity

Date: 2026-10-07. Scope: existing Model + Harness + Capability, L2/L6/L8.

The latest resumed coding Run used the delivered build but still exhausted its hour: 131 model turns, 102 tools, 29 reviews (six recorded and 23 schema rejections). Previous unknown/stale-reference and mixed-call rejections did not recur in this segment. It added tests, yet repeatedly reopened already checked questions. The format rejections have no field-level evidence, so their exact historical cause remains unknown.

The execution checkpoint retained command diagnostics, but focused review omitted them and only received recent exchanges plus source. Observation sweeps could also evict earlier passing checks from both the diagnostic pool and the recent-tool window. Review required at least one mistaken assumption even when no new error was established. These are confirmed mechanism gaps, not proof that all model repetition has one cause.

## Contract and compatibility

- The existing record_work_review schema permits zero lessons when no new mistake is established. Nonempty lessons retain citation, freshness, type and size checks. Empty lessons cannot supersede old diagnoses; they do not verify or complete the task. One short acknowledgment/next action is projected until new work arrives, without adding a failure hypothesis. Old checkpoints remain readable.
- INVALID_REVIEW can include optional schema_diagnostic metadata. Only fixed schema paths, reason codes and JSON type names are retained. Arbitrary keys, values, provider text and private reasoning are excluded. Existing bounded repair and dispatch interception remain unchanged.
- Execution and review share four bounded command diagnostics, reserving up to two for known check targets. The latest result per target replaces the old result, including a new failure. Up to six latest check receipts remain visible independently of the latest 16 observations. These are scoped evidence, not proof of coverage or freshness.
- After repeated protocol failure, successful non-verification commands on unchanged recorded workspace state do not automatically fund another review. Execution remains available; new checks, changed/unknown state and failed actions retain existing recovery routes.

No DB schema/migration, credentials, authority, execution permission, mandatory plan, resource allowance or completion gate changes. Raw command output stays in the existing in-memory transcript, not durable checkpoint records. No second state owner or runtime is introduced.

## Validation and rollback

Regression cases reproduce forgotten test results after repeated compaction, forced correction, missing field feedback and repeated review after print sweeps. Desktop tests exercise actual files/commands, review rejection, no-correction acknowledgment, guarded edits and restart. Reverting these projections/schema changes requires no migration. Mechanism PASS must be separated from real-provider task completion and independent business acceptance.
