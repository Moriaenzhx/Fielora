# Search provider configuration — 2026-10-12

User flow: choose and configure the independent search service in Settings, test
it, retain the choice across restart, and see the actual backend on search
results. Fielora owns orchestration/adaptation/readback; Exa and Brave supply
external search. Self-hosted SearXNG or a server implementing its JSON search
contract supplies the third path, not a new Fielora crawler/index.

Reuse SearchBackend, WebToolProvider, ToolCall receipts and StaticCredentialMediator.
Expose existing Exa and Brave adapters plus a bounded SearXNG adapter. Immutable
provider snapshots bind credential requirement and dispatch to the same backend;
switching settings must never send an Exa key to Brave or a custom address.
Preserve the existing Exa credential reference. Brave uses its own exact slot;
SearXNG v1 has no credential forwarding. No automatic cross-provider fallback.

Persist versioned non-secret selection/endpoint in the existing user config
directory, with atomic bounded writes and explicit invalid-config status. No DB
migration or second Agent state/permission/evidence owner. New trusted settings
IPC selects a backend and saves its endpoint; model tool arguments cannot do so.
Keep existing credential requests compatible by defaulting omitted provider to
Exa. Only trusted Settings can mutate this configuration.

Custom endpoint: HTTPS public destination through existing DNS pinning, or an
explicit loopback literal/localhost URL for a user's local service. Restrict the
exception to this exact configured search endpoint; reject URL credentials,
query/fragment, non-loopback private targets and redirects. It never relaxes
web.fetch or the URLs accepted as public search results. Bounded response/time,
cancellation and untrusted result semantics remain unchanged. JSON output must
be enabled on SearXNG; unsupported filters fail explicitly.

Verify independent credential slots, switch/dispatch isolation, malformed config,
restart persistence, endpoint/redirect boundaries, adapters and visible settings
with real Electron. Live Exa evidence is separate from credentialless Brave and
SearXNG fixture coverage. Preserve the paused original workshop and its remaining
acceptance debt; this configuration upgrade does not complete that task.
