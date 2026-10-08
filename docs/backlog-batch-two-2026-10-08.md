# Backlog implementation, batch two — 2026-10-08

Status: complete and verified; changes remain uncommitted.

This batch continues the TODO implementation requested by the user. The first-batch report remains historical evidence for its own checks.

## Changes

- Native filesystem notifications cover registered roots and visible subdirectories, with debounce, bounded event queues, excluded-tree filtering and warnings. Registration catch-up and identity-based replacement handling cover changes made while watches attach and folders recreated at the same path. Focus and manual refresh remain available.
- Child scan and transient note-read failures produce partial snapshots with path-specific warnings. The frontend retains omitted entries, open tabs, buffers and content-analysis data until a complete scan establishes their absence. Unavailable roots retain the existing frontend index.
- Changed on disk is a distinct save state that pauses autosave and retains text. Reload confirms discard and rereads disk; Keep mine uses the latest optimistic revision; Save a copy retires the original only after a durable copy and an unchanged edit generation. Regression tests cover edits during recovery, stale refreshes and saves, and ABA changes during copying.
- Frontmatter tags and aliases accept strings and lists, merge/deduplicate tags, and support Hebrew/NFC metadata. Aliases feed search, wiki links, completion, backlinks and graph edges; paths and titles take precedence and ambiguous aliases remain unresolved. Metadata extraction does not serialize or rewrite frontmatter.
- Title display uses the first body H1 or filename fallback. Loading and body editing do not inject an H1 or relocate an existing later heading. Explicit title editing changes or adds the H1.
- Create, rename and move operations reject hidden/excluded destination components before changing files. Tab names now exclude their nested close-button label. Search copy includes aliases.

## Verification

- Frontend: 357 tests passed; one existing opt-in performance test skipped. TypeScript, ESLint and Prettier checks passed.
- Native: 119 tests passed (27 unit, 88 service, three metadata, one GLib); strict all-target Clippy and Rust formatting passed.
- Dependency audit with warnings denied, local vendor integrity, optimized GLib regression and whitespace checks passed.
- Drawing bundle guard passed. The corrected desktop release rebuilt at `src-tauri/target/release/notes`.
- Integration review corrections covered registration/listener catch-up, symlink-leaf invalidation, transient scan reads and same-path directory/root replacement.

Browser demo checks exercised conflict status, Keep mine, Reload/Cancel/discard, and durable recovery copies retaining the separate disk version. Frontmatter bytes and heading-free body text survived recovery; editing a body with a later H1 preserved its position. Alias search opened a differently named note and tab/panel accessible names excluded the close action. Recovery controls also fit a 760×520 viewport without horizontal overflow. Browser demo checks do not prove native IPC or real workspace event delivery; temporary-file Rust tests cover those filesystem behaviors separately.

Fresh local search/tree/graph sanity measurements and bundle sizes are recorded in [performance.md](performance.md). They are not before/after native typing measurements.

## Remaining limits

OS watch quotas and notification delivery on network/cloud mounts can limit live refresh; warnings and manual/focus refresh remain available. Watch reconciliation enumerates visible directories, and refresh still scans fingerprints and rereads open documents. Long native mutation/drawing/incoming-link lock scopes, typed IPC errors, persistent indexes, a notice queue, attachment import, and broader App decomposition remain open in TODO.md.

There is no unsaved-text crash recovery journal. External writers can still race between revision checking and atomic replacement. Existing GTK dependency maintenance and optional Vite chunk warnings remain. No installer, commit, push or deployment is part of this batch.
