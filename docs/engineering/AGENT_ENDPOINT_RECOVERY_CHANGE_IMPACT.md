# Endpoint failure and activity presentation — 2026-10-07

User flow: an interrupted task retains actionable execution history; file links open the existing right workspace, while command/receipt details expand beneath their own row. DNS lookup failure must use the existing bounded retry/pause path rather than terminate as an invalid endpoint.

The production failure occurred before an HTTP response after 18 successful model turns. Historical CUSTOM_ENDPOINT_REJECTED conflates invalid URL, DNS error/empty answers and non-public answers; those records cannot prove the precise DNS cause. A successful backup command also disproves the generic terminal claim that no files changed.

Scope: Model endpoint error classification, existing Harness retry/recovery, truthful fallback text, renderer activity routing and layout. No new runtime, schema, migration, credentials or execution permissions. DNS I/O/empty answers receive PROVIDER_DNS_FAILED; invalid URL/host and any non-public resolved address remain rejected, with fresh validation and address pinning unchanged. No proxy fallback, cached-address bypass or extra retry allowance.

Compatibility: old error codes and terminal history remain readable and explicitly ambiguous. New errors use the same event field. Rollback requires only code rollback. File reads retain receipt SHA guards; changes open the existing matching Run review. Unresolved/failed records retain inline diagnostics.

Verification: deterministic resolution classification including mixed public/private answers; retry classification; UI lane and Core/Cross checks; isolated real Electron replay for inline placement, direct read/change links, keyboard, narrow width and persisted history. No production Run replay, business mutation or external model request. Mechanism PASS does not complete the original business repair.
