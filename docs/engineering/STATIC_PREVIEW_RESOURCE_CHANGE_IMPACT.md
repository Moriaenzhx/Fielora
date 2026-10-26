# Static preview resources and failure diagnosis

Date: 2026-10-24. Scope: repair the existing Vue task's browser verification.

The actual task produced a working Vite build, but its root-relative JS/CSS
requests missed BrowserStaticPreview's random mount. The Host reported an empty
document without resource errors. Recovery kept asking for another inspect and
its compact server history omitted `serve`, losing the served directory.

The existing BrowserRuntime may redirect same-origin GET **subresources** of the
exact run-owned static-preview page into that preview's mount. The HTTP listener
continues rejecting unmounted requests. No source rewriting, public root alias,
external redirect, main-frame/subframe remapping, second server, new session or
permission route is introduced. Containment, hidden-file/symlink rejection,
size/request limits, CSP and no-external-connection policy remain enforced.
Only actual final HTTP response bytes enter scoped input provenance.

Agent-owned documents return bounded HTTP/network resource failures alongside
script errors: sanitized URL identity, resource type, numeric status or stable
network code; no headers, bodies, credentials, query or fragment. Navigation
clears the buffer and old request IDs cannot contaminate the new document.
Ordinary Browse is not logged. Errors are observations, not business verdicts;
incomplete resource coverage cannot grant scoped verification.

Existing recovery context preserves successful `serve` arguments/receipt and
resource failures across source reads/reduction/restart. Repeated unchanged
empty observations require investigation rather than unconditional re-inspection.
No new schema, state owner, task completion authority or automatic input replay.

Verify real root-relative modules/CSS/nested imports, failure/reset diagnostics,
unchanged server containment, scoped provenance, and the original unchanged Vue
build in the desktop Host. Run Cross and affected native/packaged regressions.
Then perform an interactive same-model follow-up; engineering PASS does not
replace that result. Rollback removes these additive mappings/diagnostics; old
receipts and the cancelled first attempt remain readable and unchanged.
