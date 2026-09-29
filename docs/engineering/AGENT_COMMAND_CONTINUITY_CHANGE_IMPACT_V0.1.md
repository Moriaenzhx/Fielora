# Command retry and Skill continuity — Change impact (2026-09-25)

Flow: load a Skill, author an input, run its command, repair a reported error, and deliberately invoke the command again. Production Run `01a0d714-bf67-75d2-b38c-7ccbf156913e` incorrectly substituted a failed command receipt for a later invocation.

Change: a new process proposal is a new invocation, not an idempotent replay merely because arguments match. It still goes through the existing ToolCall, Policy, approval and execution path. Unknown prior outcomes still pause before dispatch; same-ToolCall recovery remains receipt based. File/network/destructive duplicate guards remain. A nonzero command result is an error to the model while its transport lifecycle remains COMPLETED.

Continuity: retain at most two admitted Skill contexts (24 KiB combined), with source/trust/digests and explicit reload instructions if content exceeds this bound; retain two recent command diagnostics independently of ordinary file-read excerpts. These are bounded in-memory model context projections, not a new store or authority. No additional stdout/stderr persistence, secret access, schema, migration, permission preset or automatic retry.

Risk: a model may deliberately repeat a successful process; argument equality cannot establish operation identity or input equality. Existing policy, unknown-outcome gate, progress checks, cancellation and resource budget remain enforced. Tests must cover changed input/same command, nonzero output semantics, unknown recovery, repeated compression, content limits and tool-call pairing. Native command/artifact checks do not establish real-model task acceptance. Rollback is limited to these projection/dispatch changes; existing ledgers remain compatible.
