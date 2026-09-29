# Explicit task outcomes — 2026-09-23

User flow: an installation request must either perform and verify the work, wait
for necessary input, or explain an evidenced blocker. A natural-language question
must never become COMPLETED merely because no action keyword matched.

Design: the existing general Model/Tool loop gains one native Observe control
tool, finish_task, for typed completed/blocked proposals with request interpretation,
user quote, result text and current-Run evidence IDs. request_user_input remains
the durable needs-input route; ordinary tool calls mean continue. Bare text is
nonterminal and receives bounded repair feedback. No new classifier, framework,
runtime, permission, schema, migration, provider-specific flow or dependency.

Harness validates source binding, receipt existence/status, attempted effects,
unknown outcomes, unread references and fresh verification before projecting the
proposal into the existing Run/Conversation state. Completed tool invocation means
proposal evaluated, not task verified. Blocked maps to PAUSED, never success.
Control calls run alone, cannot hide later batched effects, and do not self-grant.
Restart restores existing receipts; uncommitted terminal proposals need fresh
evaluation on resume and are not replayed as new side effects. Existing deterministic
verified Fast Edit/access answers and bounded read-only child reports remain.

Compatibility: old records remain readable; unfinished old general Runs use the new
protocol on their next invocation. Rollback needs no migration. A model can still
misinterpret meaning; typed output proves protocol validity, not semantic truth.
Historical bogus-success records are retained as evidence, not silently rewritten.

Capability guidance separates dedicated search APIs from admitted rendered-browser
tools. No search service, arbitrary shell fallback, safe archive bypass or skill
marketplace is introduced. A missing adapter is not proof all networking is absent.

Validation: raw zero-tool Archify reply; malformed/false completion; legitimate
answer-only; blocked and needs-input; bounded repair; foreign/missing/failed evidence;
unknown effects, stale verification, same-batch mutation, restart, original Chinese
counterquestion, current protocol through provider-neutral tool serialization.
Run Cross and targeted dev/packaged Electron gates; report premerge failures and
real-provider acceptance separately. Legacy deterministic fixtures encode their
terminal proposals explicitly; adversarial fixtures retain the raw violating output.

Reference patterns (design guidance, not a certification):
- https://www.anthropic.com/engineering/building-effective-agents — environmental
  feedback, clear tool interfaces, bounded stopping and sandbox evaluation.
- https://docs.langchain.com/oss/python/langgraph/interrupts — checkpointed human
  input and same-thread resumption.
- https://docs.langchain.com/oss/python/langgraph/persistence — durable state and
  explicit recovery boundaries. Fielora keeps its existing Rust ledger.
