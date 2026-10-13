# Fielora China Model Eval V0.1

2026-10-10: the current product target is matched-model coding parity with OpenCode and a measured improvement in task completion experience. See [the comparison protocol](OPENCODE_COMPARISON.md). Source inspection and two matched interactive projects are ready; live comparative quality remains NOT_RUN. The metadata preflight below is not that acceptance.

Status: `SIX-FAMILY PREFLIGHT + QWEN CODING PLAN INTERACTIVE / AUTOMATED LIVE QUALITY BLOCKED`

This directory extends the existing Fielora Complete Agent harness for Qwen,
DeepSeek, Kimi, GLM, MiniMax and Doubao. It does not create a second Agent
runtime or six Provider-specific Agent kernels.

The current route is deliberately evidence-first:

1. Run zero-request deterministic adapter/Agent/Git/verification tests.
2. Inspect safe metadata for all six official endpoint classes.
3. Use the shared `china-coding-v1` execution discipline; Provider-specific
   capability fields remain unverified.
4. Correct each saved Provider configuration reported as blocked.
5. Require a separate explicit live-call budget for every paid/provider run.
6. Run identical cases, preserve failures, then compare one-variable candidates
   and untouched holdouts.

Run from the repository root:

```text
pnpm eval:agent:qwen:preflight
```

The command reads only safe Provider metadata through Fielora Core and reports
configuration readiness for all six initial families. It never
calls `command.provider.probe`, never reads credential bytes, and makes zero
external model requests.

The historical Qwen Phase A smoke remains disabled unless all of these are
explicitly present:

```text
LIVE_PROVIDER_CALLS=AUTHORIZED
PROVIDER=Qwen/DashScope
MODEL=qwen3.7-plus
MAX_TOTAL_REQUESTS=<positive integer>
MAX_TOTAL_COST_CNY=<positive CNY amount>
MAX_WALL_TIME_SECONDS=<positive seconds>
```

Presence is not enough: the configured Provider must also be active, have a
stored credential, use `OPENAI_COMPATIBLE`, and have an official HTTPS Base
URL. Other families require their own separately stated request/cost/time bound;
the Qwen authorization must never be reused for them. No secret or full endpoint
is written to eval evidence.

Coding Plan keys are a separate interactive-product route. They use the
plan-specific endpoint and are reported as
`INTERACTIVE_CODING_READY_NOT_EVAL_ELIGIBLE`; the automated live runner refuses
them before making a request. Use a general Model Studio/Token Plan credential
for automated live quality evaluation.
