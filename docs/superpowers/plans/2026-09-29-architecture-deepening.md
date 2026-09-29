# Architecture deepening implementation plan

> Execute the accepted architecture review through test-driven changes, task review and final integration checks.

**Goal:** Implement all three architecture recommendations and their identified failure cases.

**Architecture:** Keep the document save queue and existing native/demo file seam. Concentrate relocation reconciliation, native relocation-wide incoming-link rewriting and shared content-analysis lifetime in modules with caller-facing tests.

**Spec:** ../specs/2026-09-29-architecture-deepening.md

## Constraints

- Markdown files remain the source of truth; preferences stay separate.
- Preserve revision conflicts, atomic writes, unsaved text and save-before-close.
- Keep optional analysis lazy, queries free of disk reads and mixed Hebrew/English direction intact.
- Preserve existing incoming-link limitations and native command shapes.
- Use temporary files for native tests. Do not change dependencies or publish.

## Task 1: Native relocation-wide incoming links

- [x] Write failing real-filesystem regressions for multiple moved targets referenced by one note, links between moved descendants and final rewrite uniqueness/revisions.
- [x] Extract the incoming-link implementation into a focused native module, enumerate candidate files once per relocation, apply target mappings before a single final write, preserve warnings and ambiguity rules.
- [x] Route note/image single moves and folder moves through that implementation; retain native command shapes.
- [x] Run Rust tests and strict Clippy; inspect correctness and failure semantics.

Owned files: src-tauri/src/service.rs, src-tauri/src/markdown.rs if required, new native incoming-link module, src-tauri/src/lib.rs module declaration only, src-tauri/tests/service.rs.

## Task 2: Frontend relocation lifecycle

- [x] Write failing tests for equivalent note rename/move ordering, edits during folder movement, overlapping moves and reread failure after disk commit.
- [x] Concentrate orchestration and reconciliation in src/domain/relocation.ts; retain NoteDocument queue depth, hold saves across relocation and retain newer edits.
- [x] Remap paths, tabs, selection, navigation, pins and appearance together; reconcile committed failures without orphaning buffers.
- [x] Remove repeated UI/store remapping, preserve close/recovery behavior, and run targeted frontend tests and typechecking.

Owned files: src/domain/app-store.ts, src/domain/document.ts, src/domain/relocation.ts, their tests, src/App.tsx, src/knowledge/library.ts only if bulk pin remapping needs it.

## Task 3: Shared content-analysis lifetime

- [x] Write failing tests for shared concurrency limits, overlapping/cancelled consumers, stale reads and removal/reopen freshness.
- [x] Introduce a framework-free shared analysis module, with a global read schedule, cache lifetime and live-buffer priority.
- [x] Make src/knowledge/index.ts thin subscription/lookup wiring and migrate note details to shared analysis where appropriate.
- [x] Retain workflow tests; run frontend tests and typechecking.

Owned files: src/knowledge/index.ts, new content-analysis module and tests, src/knowledge/NoteDetails.tsx, src/knowledge/workflows.test.ts if needed.

## Task 4: Integrate, review and verify

- [x] Review all three changes for ordering, safety, scope and stale callers; fix findings.
- [x] Update current workflow/native documentation and README validation evidence.
- [x] Run npm test, npm run typecheck, cargo test, strict Clippy and npm run desktop:build.
- [x] Verify relocation and analysis interactions through the collaborative browser using demo data.
- [x] Summarize actual verification and remaining product limits.

Completed on 2026-09-30. All three independently reproduced integration findings were corrected: close waits for queued relocations/creation, committed note renames report later save failures separately, and bulk live-buffer analysis uses the yielding scheduler. Verification: 108 frontend tests passed, one opt-in test skipped; 64 native tests passed; typecheck, strict Clippy, Rust formatting and desktop release build passed. Browser demo checks covered note/folder moves, pins, popup autofocus, unchanged-title live outlines, mixed direction and content results at moved paths. Native file behavior was checked with temporary-file tests. No dependencies changed.
