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

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
