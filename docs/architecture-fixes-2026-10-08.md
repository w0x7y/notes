# Workspace architecture fixes — 2026-10-08

Both candidates from the architecture review are implemented. Existing backlog fixes in the working tree were preserved; no dependencies, native command shapes or commits were changed.

## Workspace refresh

`WorkspaceRefresh` owns immediate refresh admission, coalescing, invalidation debounce and follow-up scans, registration/relocation freshness, Document rereads, partial-scan retention, entry identity and warning publication. The event adapter owns listener attachment/removal. Startup, focus/manual refresh, reload, Relocations and folder-creation workflows use the complete operation.

Scoped watcher disposal cancels its queued invalidations and suppresses late event-only results while preserving independently accepted manual work. Post-mutation refresh supersedes scans that started before the mutation. Templates, Capture and Today use bound folder creation without nested Document lifetime admission; a committed folder creation reports a failed follow-up scan as a warning and lets the workflow continue.

This module provides locality for freshness and scheduling changes and leverage across callers and tests. Its interface is the test surface; tests use the existing demo file adapter and real Documents. Document retains conflict policy, Relocations retains path reconciliation, and Content analysis retains live-buffer precedence.

## Workspace mutation

`WorkspaceMutations` owns native file and registration admission, immutable snapshots, revision checks, path validation, file publication, Incoming links and metadata follow-up. File mutations remain globally ordered because Incoming links can change files in other registered roots. Acquiring the mutation guard admits the operation; registration removal waits for admitted work.

Settings access is separate from that ordering. Note/image/drawing work, traversal, Trash and Incoming link rewrites run without holding the settings mutex. Preferences, sessions, workspace customization, settings reads and scans can progress during paused file work. Follow-up metadata commits apply to the latest settings, preserving updates made during the operation. New-note creation retains its rollback policy when filename persistence fails.

Published note writes return committed content/path/revision with durability warnings if parent-directory syncing fails. Incoming links retains successful rewritten content and revisions with those warnings. Config persistence and the existing string-only drawing interface keep their prior error semantics.

The complete native interface is the test seam. Tests use real temporary files, deterministic barriers and the existing Trash adapter; no broad fake filesystem was added. Incoming links and the scan cache remain existing deep modules.

## Validation

| Check                                                            | Result                                          |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| Frontend suite                                                   | 387 passed; 1 existing opt-in benchmark skipped |
| Typecheck, lint, frontend formatting                             | Passed                                          |
| Native suite                                                     | 128 passed; no ignored tests                    |
| Strict Clippy, Rust formatting                                   | Passed; existing vendor warnings remain         |
| Vendor integrity and Cargo audit with warnings denied            | Passed                                          |
| Desktop release, optimized GLib regression, drawing bundle guard | Passed                                          |

The template overlap and committed-refresh-failure regressions failed before their fix. Native slow-Trash/settings progress, published-save sync warning and retained-Incoming-rewrite regressions also failed with the old behavior and passed after correction. Interface tests cover stale registration/re-add, stale relocation, reopened Documents, typing or saving during rereads, partial scans, listener disposal, same-revision write ordering, stable registrations and latest-state metadata commits.

The browser demo verified clean external text reaching the open editor after refresh with Saved status, Capture opening an Inbox note, and starter-template setup populating five templates and opening the picker without console errors. Temporary test notes were removed. Browser checks do not establish native watcher-to-render or WebView latency.

Task reviews approved both implementations after fixing the unmigrated template-folder caller. The combined review approved the complete change with no actionable findings. Desktop release, optimized GLib regression and drawing bundle guard passed; graft was rebuilt.

## Decisions and remaining limits

The current checkout and captured working-tree baselines were used instead of committing earlier backlog work or copying it to a new worktree. Reviews inspect task deltas. If separating changes becomes necessary, the captured baselines support that work. Changes remain uncommitted.

Config serialization/write/sync still holds the settings mutex to preserve config publication semantics; this change addresses slow workspace file work. Independent file mutations are still serialized. Incoming-link discovery still reads the registered corpus; prefiltering and a persistent backlink index remain separate backlog work. Existing external-writer races, outgoing-link limitations, watcher limits and vendor warning noise remain. No end-to-end latency improvement is claimed.
