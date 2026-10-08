# Workspace refresh and mutation depth

Implement both candidates from the architecture review. Existing working-tree backlog fixes are the baseline and must be preserved.

## Global constraints

- Keep file adapter command shapes, Document save queues, revision conflict policy, Relocations, Incoming links, Document lifetime and Content analysis behavior intact.
- Workspace removal unregisters files; accepted mutations finish before removal. Committed file changes return follow-up failures as warnings.
- Scan acceptance requires current registration and relocation freshness. Preserve partial-scan retention, document identity and saved-revision checks, and unchanged entry identity.
- Tests cross the complete module interface with existing native/demo adapters and temporary native folders. Do not introduce a broad fake filesystem or speculative abstractions.
- Work in the current checkout; preserve all existing uncommitted work. Do not commit, push, or change dependencies.
- No implementation subagents may delegate further work. Controller dispatches independent reviews.

## Task 1: Complete Workspace refresh module

Move refresh admission, coalescing, event debounce/follow-up scheduling, freshness checks, document rereads/delivery, partial-scan merging, entry identity and warning publication into a deep domain module. Keep the platform event subscription as an adapter with listener lifecycle handling only. Route startup, focus/manual refresh, reload and mutation-triggered refresh through the complete operation. Avoid deadlocks with Relocations; its internal refresh must not wait on the active relocation itself. Keep Document conflict decisions in Document and registration lifetime in DocumentLifetime.

Use a small interface for registration lifecycle, immediate refresh and invalidation scheduling. Test stale registration/removal/re-add, stale relocation, overlapping refresh, events during an in-flight request (including manual refresh), partial scans, late warnings, changed saved revision, reopened documents, and typing during rereads through that interface. Replace moved scheduling/merge tests instead of duplicating private implementation tests. Retain integration tests that demonstrate app-store wiring. Add a precise glossary term for Workspace refresh to CONTEXT.md, without implementation details. Record test evidence in the task report. Run frontend tests, typecheck and lint appropriate to the changes.

## Task 2: Complete native Workspace mutation ordering

Separate explicit filesystem mutation ordering from settings access. Preserve the existing cross-workspace serialization of file mutations, since Incoming link rewrites span registered roots; unrelated settings reads/updates and scans must progress while a mutation is in slow file work. Keep registration changes serialized with mutations so removal waits for accepted mutations and rewrites retain a stable registered-root set. Use a deep mutation module that owns lock order, registration/naming snapshots, revision checks, file commit and committed-result warning rules; keep Incoming links and path validation intact. Do not merely unlock the old mutex or add atomic-write pass-throughs.

Settings access must be short around state snapshots/metadata commit; persist latest state so concurrent preferences/session changes are not overwritten. Do not hold the settings lock while traversing/reading/writing note files, Trash, or incoming-link rewrites. Preserve save/rename/image/folder/delete/create/drawing ordering and existing persistence-failure behavior. Add real-temp-file deterministic barrier tests for same-workspace revision ordering, settings progress during a paused mutation, registration removal waiting on accepted work, cross-workspace Incoming links, and committed follow-up failures. Document Workspace mutation in CONTEXT.md as a glossary term, without implementation details. Update native contract lock wording. Run native tests, formatting and strict Clippy, and record evidence.

## Completion

Review each task and the combined change against the global constraints. Fix important findings. Run frontend suite, typecheck, lint, format checks, native suite, strict Clippy, Rust format, desktop rebuild and drawing bundle guard. Update TODO.md and a dated architecture implementation report. Rebuild graft. Report validation and material limitations; leave the work uncommitted.
