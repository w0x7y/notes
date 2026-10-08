# Review backlog implementation plan

**Goal:** Work through the findings in `TODO.md`, starting with independently verifiable fixes to editing, save performance, native robustness, and validation.

**Architecture:** Keep Markdown and the platform adapter as the storage boundaries. Preserve document queues and revision checks. Separate native, frontend performance, and tooling work so changes can be reviewed and tested together without concurrent edits to the same files.

**Spec:** `TODO.md`, `AGENTS.md`, `PRODUCT.md`, `docs/native-contract.md`, and `docs/performance.md`.

## First batch

- [x] Keyboard and editor: use physical key codes with a legacy fallback; add regression cases for Hebrew, modifiers, composition, and punctuation. Install CodeMirror search, replacement, selection matching, and multiple selections. Preserve mounted editor state and prevent external value synchronization from emitting edits. Explain unsupported image insertion. Name dialogs and preserve keyboard focus styling.
- [x] Save performance: preserve entries for saves with unchanged path/title/tags, test metadata changes and relocation separately, remove the domain dependency on the knowledge library store, select only shell state, stabilize the command listener, and make initialization share its in-flight request. Extract the tab bar with keyboard navigation and linked tab panels.
- [x] Native robustness: recover corrupt settings without deleting their original bytes; reset invalid preferences while retaining other settings. Persist config before committing state. Validate workspace appearance, bound note reads and saves, release the state lock for reads, truncate filenames by UTF-8 bytes, and use collision-safe filesystem renames. Exercise failures in temporary workspaces.
- [x] Tooling: add linting, formatting configuration, component test infrastructure, and frontend/native CI checks. Validate void IPC results and malformed responses.
- [x] Verification: run all frontend tests and typecheck, lint and format checks, native tests and strict Clippy, vendor integrity checks, browser interaction checks, performance scripts, and a desktop release rebuild. Record results and mark only fully completed backlog entries.

## Subsequent batches

Keep uncompleted items in `TODO.md`. Next tackle file watching with explicit conflict recovery, metadata compatibility, attachment import, and the larger workflow features. Review feature behavior against `PRODUCT.md` before implementation. Upstream GTK maintenance and unmeasured native interactions remain open until there is evidence to close them.
