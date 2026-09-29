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

- [ ] Write Rust tests using temporary directories for workspace scanning, UTF-8 files, traversal/symlink rejection, revision conflicts, unique new filenames, automatic naming, and manual naming.
- [ ] Run tests before implementation to establish failures, then implement the file service and Tauri commands.
- [ ] Persist registered workspaces and sessions in the app config directory, never inside the note folder.
- [ ] Update resolvable incoming links when renaming and report rewrites to open documents.
- [ ] Run `cargo test` and `cargo clippy --all-targets -- -D warnings`.

## Task 2: Document state and search

Own `src/domain/**`, `src/platform/**`, and project setup.

- [ ] Add behavioral tests for English/Hebrew tags, code exclusion, current-workspace prioritization, title/body round trips, and sequential/coalesced autosave.
- [ ] Implement a Zod-validated native adapter and in-memory browser demo adapter behind the same interface.
- [ ] Implement a document session with `subscribe`, `getSnapshot`, `edit`, `flush`, and `retry`, preserving edits made while a save is in flight.
- [ ] Implement cached search over entry metadata, with `#tag` query terms and title-only free text.
- [ ] Run `npm test` and `npm run typecheck`.

## Task 3: Editor and desktop interface

Own `src/components/**`, `src/editor/**`, `src/App.tsx`, and `src/styles.css`.

- [ ] Build the real sidebar, workspace controls, file tree, tabs, title field, status bar, and per-workspace sessions.
- [ ] Add CodeMirror with history, standard shortcuts, Markdown highlighting, line wrapping, and paragraph direction.
- [ ] Add a button-toggleable formatting toolbar and Markdown preview. Preview renders safe Markdown, local images, math, code, tables, tasks, and wiki links. Clicking a preview block reveals its editable source.
- [ ] Add split panes, image tabs with zoom, a keyboard search dialog, new note/folder actions, and manual rename.
- [ ] Preserve unsaved documents across workspace/tab switches; flush before native window closure and keep the window open on failure.
- [ ] Inspect the running UI and exercise editing, search, preview, toolbar, and split controls.

## Task 4: Integration and handoff

- [ ] Run frontend tests, typecheck, production build, Rust tests, and native build.
- [ ] Use a temporary sample workspace to verify the native file commands, not the user's notes.
- [ ] Review the implementation for data-loss paths and cross-boundary mistakes; fix material findings.
- [ ] Record actual validation and remaining limitations in README. Provide a runnable desktop command and built executable if the native build succeeds.

## Execution record

2026-09-29: The folder contained only the approved mockup and product brief, with no existing Git repository or implementation. Work proceeds in this dedicated project directory. Native file service and frontend share only the written IPC contract; their source files do not overlap.
