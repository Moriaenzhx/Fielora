# Default Web search integration — 2026-10-12

User flow: ask for current information → search → read selected public sources →
refine the query → cite the observed sources, with real search progress in the
conversation. Validate through the production desktop and existing Agent loop.

- Capability: add a bounded Exa hosted MCP search adapter behind the existing
  SearchBackend/ToolProvider. Use its documented keyless endpoint by default;
  optional Exa API key goes through the existing CredentialStore and exact static
  binding. Retain Brave as an alternate adapter, without claiming it is configured.
- Harness: register search and fetch in the production Coordinator; retain the
  existing Network policy, approvals, cancellation, budgets and completion rules.
  Model chooses queries and subsequent actions. No new Agent/MCP runtime, arbitrary
  remote tool discovery, OAuth or external research agent is introduced.
- Network: extend the existing DNS-pinned public transport to a fixed HTTPS JSON
  POST. No POST redirects or automatic POST retries, cookies or proxy inheritance.
  Bound requests, responses, elapsed time and JSON/SSE parsing. Classify MCP errors
  (including rate limits inside HTTP 200) as failures, never empty successful search.
- Credentials/FIPC: trusted settings can save/delete an optional Exa key and run
  one explicit fixed-query connection test. Secrets use the existing local SQLite
  store, never renderer responses, tool arguments/receipts, logs or exports. No DB
  migration. A reserved non-secret static reference identifies this built-in slot.
- Sources: preserve bounded result title/URL/publication metadata in the existing
  tool receipt so reload/cold recovery can recover source identities. Snippets and
  page bodies remain bounded untrusted observations, not durable source archives.
  Retrieval time is not publication time; search is not independent verification.
- Compatibility/rollback: old receipts remain readable; absent key uses keyless
  search, whose quota/availability is external and not guaranteed. Deletion revokes
  credentialed execution; no silent fallback after a credential/auth failure. Old
  binaries ignore the new reserved credential; no user files or historical runs
  are changed. Existing public fetch security remains unchanged.
- Validation: backend wire/parser/filter/error/SSRF/cancel/secret-negative tests;
  actual production registration and policy/credential route; source continuity;
  trusted FIPC and restart; desktop settings + search/read/refine/source display;
  bounded live public search/fetch smoke. Fixture, live network, real model and
  original workshop acceptance are reported separately. No automatic Coding Plan
  evaluation or use of model credentials for search.

Initial evidence: local production store has no configured static search key.
Official Exa docs describe keyless rate-limited access. A real keyless search
returned Rust documentation; a subsequent search returned HTTP-200 rate-limit
metadata. The product must show this limit and offer an explicit key setup path.
