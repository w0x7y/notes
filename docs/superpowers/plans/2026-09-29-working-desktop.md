# Working desktop app implementation plan

**Goal:** Turn the approved One Dark Pro mockup into a usable local Markdown editor on Linux.

**Spec:** `PRODUCT.md` and the user-approved `mockups/main-ui.html`.

**Architecture:** A Rust file service owns registered workspace boundaries and atomic disk writes. React owns navigation and cached search metadata; CodeMirror owns keystrokes. A serialized document save queue coalesces edits without blocking typing or losing newer edits. The browser development adapter uses explicitly labeled demo data; only Tauri accesses real files.

**Stack:** Tauri 2, React, TypeScript, Vite, Tailwind, CodeMirror 6, markdown-it, KaTeX, highlight.js, Vitest, Rust filesystem tests.

## Constraints

- Preserve the approved compact One Dark Pro layout.
- English UI; Hebrew/English paragraph direction; code remains LTR.
- Ordinary Markdown is the source of truth. Existing files are never renamed simply by opening them.
- Fuzzy title/tag search across registered workspaces, current workspace first.
- Atomic autosave, external-change detection, serialized writes, visible failure and retry.
- No image paste/drop insertion, Vim mode, cloud sync, or additional themes in this milestone.
- The design is approved and implementation is authorized. No further design gate is needed.

## Task 1: Native workspace and file service

Own `src-tauri/**`. Read `docs/native-contract.md` for the exact IPC interface.

- [x] Write Rust tests using temporary directories for workspace scanning, UTF-8 files, traversal/symlink rejection, revision conflicts, unique new filenames, automatic naming, and manual naming.
- [x] Run tests before implementation to establish failures, then implement the file service and Tauri commands.
- [x] Persist registered workspaces and sessions in the app config directory, never inside the note folder.
- [x] Update resolvable incoming links when renaming and report rewrites to open documents.
- [x] Run `cargo test` and `cargo clippy --all-targets -- -D warnings`.

## Task 2: Document state and search

Own `src/domain/**`, `src/platform/**`, and project setup.

- [x] Add behavioral tests for English/Hebrew tags, code exclusion, current-workspace prioritization, title/body round trips, and sequential/coalesced autosave.
- [x] Implement a Zod-validated native adapter and in-memory browser demo adapter behind the same interface.
- [x] Implement a document session with `subscribe`, `getSnapshot`, `edit`, `flush`, and `retry`, preserving edits made while a save is in flight.
- [x] Implement cached search over entry metadata, with `#tag` query terms and title-only free text.
- [x] Run `npm test` and `npm run typecheck`.

## Task 3: Editor and desktop interface

Own `src/components/**`, `src/editor/**`, `src/App.tsx`, and `src/styles.css`.

- [x] Build the real sidebar, workspace controls, file tree, tabs, title field, status bar, and per-workspace sessions.
- [x] Add CodeMirror with history, standard shortcuts, Markdown highlighting, line wrapping, and paragraph direction.
- [x] Add a button-toggleable formatting toolbar and Markdown preview. Preview renders safe Markdown, local images, math, code, tables, tasks, and wiki links. Clicking a preview block reveals its editable source.
- [x] Add split panes, image tabs with zoom, a keyboard search dialog, new note/folder actions, and manual rename.
- [x] Preserve unsaved documents across workspace/tab switches; flush before native window closure and keep the window open on failure.
- [x] Inspect the running UI and exercise editing, search, preview, toolbar, and split controls.

## Task 4: Integration and handoff

- [x] Run frontend tests, typecheck, production build, Rust tests, and native build.
- [x] Use a temporary sample workspace to verify the native file commands, not the user's notes.
- [x] Review the implementation for data-loss paths and cross-boundary mistakes; fix material findings.
- [x] Record actual validation and remaining limitations in README. Provide a runnable desktop command and built executable if the native build succeeds.

## Execution record

2026-09-29: The folder contained only the approved mockup and product brief, with no existing Git repository or implementation. Work proceeds in this dedicated project directory. Native file service and frontend share only the written IPC contract; their source files do not overlap.

2026-09-29: Implemented and reviewed the desktop build. Validation: 19 frontend tests, 25 Rust filesystem tests, TypeScript check, clippy with warnings denied, and release build passed. Browser controls were exercised through T3 preview; native Wayland rendering, temporary-workspace reads, keyboard-created files, title-driven naming, autosave, and close-time flush were verified on disk. Native startup required the documented NVIDIA explicit-sync workaround, now conditionally applied before the runtime starts. README records the initial-build limitations.
