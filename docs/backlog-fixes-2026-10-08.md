# Backlog fixes, 2026-10-08

This report covers the first implementation batch from `TODO.md`. The remaining backlog is still open; checked entries have implementation and verification evidence, and partial entries stay unchecked.

## Changes

- App shortcuts use physical key codes with a fallback for events without codes. Modifier and composition guards preserve ordinary typing. The editor's native context menu is restored; custom sidebar menus handle their own right-click events.
- The Markdown editor has find/replace, next-occurrence selection, selection matching, multiple cursors, rectangular selection, and completion hints. Image paste/file drop explain how to add a reference manually. Handler refs update after commit.
- Dialog headings supply accessible names. Tabs have linked panels, roving focus, arrow/Home/End navigation and Delete to close through the save queue. Preview blocks support Enter/Space and background focus treatment. Content keys preserve later drawing mounts after inserting an earlier paragraph.
- Body-only autosaves preserve metadata identity. App selects shallow active-workspace state, sidebar inputs stay stable, command listeners read committed modal state, overlapping startup requests share one promise, and workspace transitions reset selected folders in store actions. Library state moved into the domain layer.
- NotePane supplies its loaded document to the footer instead of requesting another load. Read errors appear as alerts; absent documents have no misleading footer save/loading state. Font discovery shares successful/pending requests and retries failed discovery.
- Invalid settings recover after an exact-byte backup; invalid preferences retain other valid settings. Config writes commit memory only after persistence succeeds. Workspace colors/icons validate. Note and image reads release the state lock before file I/O.
- Markdown reads/saves are limited to 20 MiB. Scan/rewrite callers share the bounded helper; oversized scans keep filename metadata. Unicode filename budgets count UTF-8 bytes. Linux file/folder moves use atomic no-overwrite renames, with a safe file fallback and explicit refusal of unsupported directory fallback.
- Native metadata uses root/path keys and bounded LRU eviction, including negative results for invalid UTF-8/oversized files. Limits are 20,000 entries per root, 40,000 globally and 32 MiB estimated memory. Preview images share reads with a separate bounded cache and reload after metadata changes.
- Added ESLint, formatting configuration, EditorConfig, optional local pre-commit hooks, jsdom component tests and GitHub Actions. TypeScript 7 remains the compiler; ESLint uses the official side-by-side TypeScript 6 API alias. Void native commands now validate their responses.

## Verification

- `npm test`: 302 passing tests; one existing opt-in Markdown benchmark skipped.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: 99 passing tests, comprising 14 unit, 84 service integration and one GLib regression.
- Strict Clippy, Rust formatting, vendor integrity, drawing bundle guard and whitespace checks: passed. Existing vendored GTK/GLib dependency warnings remain.
- `npm run desktop:build`: rebuilt `src-tauri/target/release/notes` with the current frontend and native changes.
- Browser demo: Ctrl+F opened find/replace; a Hebrew-key event with physical KeyP opened title search with the correct dialog name and field focus. The collaborative browser disconnected before further interactions. Component tests cover tab navigation/close, context-menu propagation, dialog focus, editor synchronization/undo, loading failures, image refresh and cache behavior. This does not prove native spell-check suggestions or native Ctrl+Tab/Ctrl+W.
- Search/tree/graph and warm native scan benchmarks ran. [Performance measurements](performance.md) separate timings from structural expectations and retain the native latency limits.
- The local context graph was refreshed and checked. The GitHub workflow is configured but has not been run on hosted runners. No commit, push or deployment was performed.

## Still open

Mutation, drawing and incoming-link work still hold the config lock during I/O. Scan warnings, backlink indexing, intermediate-symlink races, typed errors and generated contracts remain. App's broader modal/command decomposition remains. The cache is finite and can reparse evicted entries.

File watching, explicit conflict recovery, frontmatter tags/aliases, attachment import, the notice queue and larger note workflows remain in `TODO.md`. Unsupported image insertion now explains the refusal; it does not import images. Existing external-save races, GTK maintenance, optional bundle warnings and unmeasured native interactions remain documented.
