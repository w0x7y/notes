# Working on Notes

## Product and interface

- Read `README.md` for current features, setup, validation commands, and known limits. Read `PRODUCT.md` before changing user-facing behavior or layout; `mockups/main-ui.html` is the original visual reference.
- Keep typing and title/tag search responsive. Load optional editors, dialogs, and expensive analysis on demand; avoid rescanning files or parsing whole workspaces on keystrokes.
- Preserve the compact One Dark Pro interface, keyboard navigation, popup autofocus, and mixed Hebrew/English paragraph direction. The user explicitly prefers no focus outlines; use background or selection treatment for keyboard focus.
- Keep workspace folders collapsed on opening. Workspace removal unregisters the folder without deleting its contents.

## Storage and architecture

- Markdown files are the source of truth. Keep preferences and workspace sessions separate from note contents, and preserve unrelated frontmatter when editing properties.
- Route file operations through the platform adapter and native service. Read `docs/native-contract.md` before changing IPC, paths, or native file behavior.
- Preserve document save queues, revision conflict checks, atomic writes, and save-before-close. Failed saves must retain the user's unsaved text. Use temporary workspaces when testing writes or deletion.
- Read `docs/note-workflows.md` when changing search, links, templates, tasks, or properties. Read `docs/drawings.md` before changing drawing storage, export, or loading behavior.
- Remove unused callers, state, styles, tests, and documentation when removing a feature. Keep shared functionality that other features still use.

## Verification

- Run the relevant commands in the README validation section for each change. TypeScript changes need typechecking and frontend tests; native behavior changes need Rust tests and strict Clippy. Rebuild the desktop app when changing the shipped application.
- Verify interaction changes in the running UI. Browser development uses temporary demo data; it does not prove native file operations work.
- For performance changes, read `docs/performance.md` and use the relevant scripts in `scripts/`. Report measured results separately from expectations.
- Update current feature documentation with behavior changes. Keep historical review reports identifiable as historical evidence.
- Preserve third-party notices when changing assets or dependencies. The project's own code uses the MIT license in `LICENSE`.
