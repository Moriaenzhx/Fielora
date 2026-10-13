# Research visibility — 2026-10-12

User flow: distinguish an announcement from an actual search, see returned sites
and useful excerpts in the conversation, and distinguish search matches from
successfully read pages. Validate in real Electron before and after restart.

The existing ToolCall ledger remains authoritative for execution facts. L9 renders
search/read operations in chronological inline rows without requiring nested
operation disclosure. A compact source summary remains visible when completed
history is collapsed. Pending, running, empty, failed and interrupted searches
are separate states; model prose never creates a search event or a source.

Retention amendment to AGENT_WEB_SEARCH_CHANGE_IMPACT: successful public searches
add at most 480 UTF-8 bytes of the already returned snippet per source (maximum
10), and public fetches add at most 640 bytes of returned text, with explicit
truncation. These optional plain-text previews live in the existing receipt;
there is no full-page archive, new table, credential data or raw network log.
They remain untrusted source content, not verified claims. The model projection
omits duplicate previews from trusted receipt metadata and retains the existing
untrusted observation. Historical receipts without previews show titles/links
and explicitly state the excerpt was not saved; no invented backfill.

Use validated HTTP(S) links and local domain badges. Rendering does not request
third-party favicon services or open pages automatically. Normal link navigation
continues through the existing desktop navigation policy. A source read status
requires an actual same-Run successful body receipt; planned URLs and failed
reads cannot acquire it. No change to permissions, completion or browser checks.

Old readers ignore optional JSON fields; old records remain readable. Rollback
removes rendering/new preview production without deleting historical evidence.
Verify bounds, untrusted markup, credential/script URLs, failure/empty/pending
states, same-Run association, cold recovery, default-visible results and link
navigation. Fixture, live network, real model and original workshop acceptance
remain separate. The long-task case continuity work remains a separate slice.
