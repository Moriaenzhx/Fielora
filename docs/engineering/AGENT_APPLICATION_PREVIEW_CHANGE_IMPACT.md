# Application activity and local window preview

2026-10-13 — implementation scope authorized by the user's request to add application attribution and window preview to Fielora.

## User flow and ownership

While an Agent uses an authorized native application, the conversation identifies the actual application with its name/icon and offers a collapsible preview of that target window. The latest successful non-status `computer` ToolCall supplies identity; model prose, proposed arguments and status enumeration do not establish application use. Failed/unknown calls remain visibly distinct. This extends Capability's native adapter and Harness L9/product presentation, reusing L5/L6/L7 ToolCall, session, lifecycle and consent ownership.

## Boundary and affected contracts

A narrow trusted `query.agent.computer_preview` accepts Run/ToolCall IDs and an explicit image-capture flag. Core resolves the owned successful receipt, checks current Run lifecycle and the adapter's matching live snapshot/application launch, then returns bounded native metadata and, when requested, a single target-window PNG. Renderer cannot supply a PID, path, window ID or target. Main validates the request and trusted main-frame origin. macOS screen permission remains an OS prerequisite; absence, ambiguity or a changed target application's focused-window identity, launch or snapshot yields a stable unavailable reason, never another window or the entire display. Fielora itself may be in the foreground while showing that target window. Use public ScreenCaptureKit single-window capture, with a narrow native bridge under the existing Rust platform adapter; unsupported platforms/OS versions report absence.

Pixels and icon bytes are ephemeral local UI data: not a Model ToolResult, prompt attachment, durable receipt, ScreenshotEvidence, file, diagnostic log or external request. Model screenshots remain unsupported. Preview does not establish input success, verification or goal completion. Capture is bounded and non-overlapping; close/minimize, conversation switch, stale responses and Run termination release/stop preview. A displayed frame is labelled as a captured snapshot, not a live video or historical execution screenshot. No schema/migration, new permissions owner, second runtime or Provider-specific code.

## Compatibility and rollback

Existing receipts continue to render; missing target/native metadata uses a neutral icon and no invented preview. Existing native observation consent/input, browser screenshots and tool execution are unchanged. The new query is additive and can be removed with its UI and native bridge without modifying stored history. Existing unrelated worktree changes are preserved.

## Verification

Check receipt attribution and failure labels; malformed/foreign/status/stale/terminal requests; exact snapshot/launch/window matching and capture bounds; pixels excluded from durable/model paths; slow responses after hide/switch; collapse/reopen and narrow-window layout. Run Cross checks and an isolated real macOS target-window capture with distinctive content, plus actual Electron presentation and packaged smoke. Report permission-blocked native capture, unsupported Windows, deterministic-model tests and real-model task quality separately. No production tasks/data or OS permission database are modified for acceptance.

2026-10-13 validation: Cross passed (347 TS, 631 Rust, 15 FIPC; 8 existing ignored). Isolated dev and packaged actual native-window E2E passed, including icon/pixels, UI controls, narrow layout, lifecycle rejection, zero model images and a real capture rejected after Stop. Native lock invalidation has barrier tests. Full PreMerge is not green: its Browse close-page target-count assertion failed after Cross and Phase 02 desktop passed. Real-model, Windows and normally launched production OS-permission acceptance are not claimed. Reproduce the targeted test with `node tests/e2e/agent-computer-preview-e2e.mjs`; `FIELORA_PACKAGED_EXE` selects an isolated packaged executable.
