# Filtered capability discovery continuity — 2026-10-12

User flow: discover browser capabilities → start a managed local preview → open and
interact with the actual page. The failed workshop Run found browser/server entries
but its subsequent model requests still lacked their definitions, then used finite
commands for persistent servers and misreported a sandbox barrier.

Extend only the existing select_tools projection: successful filtered catalog pages
expose their returned available names next turn, bounded by the existing 12-extension
limit. Exact-name discovery remains supported. Unfiltered catalog inventory does not
expose everything. Re-read definitions from the current admitted catalog, never from
receipt text; absent/revoked tools remain absent. Cold recovery uses the same ledger.
No execution, policy, approval, credential, remote-page or process lifetime changes.

Clarify finite-command cleanup and managed browser_server use in tool descriptions
and timeout recovery. Do not disable cleanup or silently convert shell commands to
persistent processes. Browser HTTP(S), loopback readiness and file policy remain.

Tests: reproduce exact filtered-discovery receipt/request omission; bounded page,
unavailable/revoked/failed/empty filter cases and cold restoration; actual Electron
managed Python server → Browser page/native input/check with no real model calls.
Clarify behavioral testing and the observed Electron window.prompt limitation in
model-facing guidance; do not patch third-party pages or add a privileged bridge.
Audit the supplied workshop unchanged in an isolated copy and separately report its
actual interaction/test coverage; fixture success cannot prove original model repair.
No migration or alternate runtime. Rollback only reverts model-view composition.
