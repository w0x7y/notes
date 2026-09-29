# Native review

Approved for the reviewed scope. All findings from the original review and the focused re-review are resolved. Inspected the actual Rust fixes, regression cases, and compatibility with `src/domain/links.ts`. Accepted the reported 25 passing tests, clippy, and build evidence without rerunning commands.

## Resolved findings

- Dangling `Untitled.md` symlinks no longer cause an infinite create loop. Filename selection uses `symlink_metadata` and reports inspection errors.
- Markdown destinations containing spaces and reserved characters are percent encoded, with decoding for subsequent renames.
- Markdown parser source offsets protect inline code, multiline code spans, indented blocks, and nested fenced blocks during link rewriting and tag extraction. The code ranges preserve source text exactly.
- Settings persistence and automatic-rename failures after committed writes return the committed path/content/revision with warnings. Failed new-note metadata persistence also cleans up the empty note where possible.
- A newly ambiguous wiki basename receives a qualified destination. Both workspace-root and workspace-ID forms are resolved by the frontend and matched during subsequent native renames. Regression cases exercise repeated renames within and across workspaces.

The `core:window:allow-destroy` capability matches the frontend flush-before-destroy close handler. The production CSP permits the app's native IPC, bundled scripts/styles/fonts, and image sources while blocking object content and form submission. The Linux NVIDIA/Wayland workaround runs before application threads start and preserves an explicit environment override. The parent separately reported successful native create/edit/title-autosave/close-flush checks and graphics-workaround verification; those were not independently repeated during this source review.

Known limitations remain documented in `native-report.md`, including reference-style/escaped links, links inside the renamed note itself, and races with external writers between revision checking and replacement. No remaining blocker was found in the focused fixes.
