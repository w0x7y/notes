# Notes

A local Markdown note app for Linux, built with Tauri 2, React, TypeScript, Tailwind, and CodeMirror. The compact interface uses Graphite + amber as its default theme and brand, with a folded-page bookmark mark.

## Run

```sh
npm install
npm run desktop
```

Requires Node.js 24.15+ LTS (recommended), Rust, and the Linux Tauri build dependencies. Node.js 22.22.2+ in the 22.x series and Node.js 26+ are also supported by the current dependencies. This project was built on CachyOS with GTK 3 and WebKitGTK 4.1 already installed. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for another machine.

To build and run the release executable:

```sh
npm run desktop:build
./src-tauri/target/release/notes
```

`npm run dev` opens a browser development server on port 1420. Its sample notes live only in that tab and disappear on reload. Use the desktop app for real files. Stop an existing Vite server before running `npm run desktop`, which starts its own server on the same port.

The desktop app starts with an **Open a workspace** button. Choose an existing folder or an empty folder. Files stay in that folder; settings and workspace sessions are stored separately in `$XDG_CONFIG_HOME/dev.idan.notes/notes.json` (normally `~/.config/dev.idan.notes/notes.json`).

On NVIDIA/Wayland, startup applies `__NV_DISABLE_EXPLICIT_SYNC=1` unless explicitly set by the environment. This resolves the startup crash reproduced on this CachyOS/Hyprland machine while keeping accelerated rendering. The workaround is documented in [Tauri’s Linux graphics guide](https://v2.tauri.app/develop/debug/linux-graphics/).

## Included

- Workspace scans omit dependency/cache trees (`node_modules`, `__pycache__`) and hidden directories.
- Open folders as workspaces; customize their names, colors, and icons. Sidebar folders start collapsed, including when switching back to a workspace.
- App settings open from the sidebar or Ctrl+comma. Appearance offers Graphite + amber, Ink + jade, Midnight + ice, Charcoal + coral, Forest + moss, and the original One Dark Pro. Themes persist separately from notes and apply to the editor, preview, dialogs, graph, and drawing controls. Theme selection previews locally; Save changes applies it, Cancel keeps the saved theme, and Reset to defaults selects Graphite + amber. Choose independent UI and editor font families from dropdowns listing all installed Linux fonts, with each option rendered in its own typeface. Font choices preview locally and apply after Save changes; existing choices remain available if a font is later removed. Adjust editor size/spacing, wrapping, line numbers, tab size, spellcheck, reading width, default preview, autosave delay, search scope/order/limit, session restoration, focus refresh, and file ordering. Settings persist outside your notes; Reset to defaults is available before saving.
- Workspace and icon menus use the app theme. Dialogs focus their first field on opening; menus support arrow keys and Escape without focus outlines.
- Right-click a note or image to open it, split it, rename/move it, customize its icon/color, copy its path, or move it to Trash.
- Right-click a folder to rename or move it, customize its icon and name color, or move it and all its contents to Trash after confirmation. Open notes inside the folder save first; failed saves or Trash operations keep their buffers and tabs available. Folders shared with another registered workspace require removing that workspace registration before deletion. Drag notes, images, or folders onto a folder or the Files heading to move them within the workspace. Existing destinations and moves into a folder itself are rejected. All 2,118 names in the installed free Lucide catalog are searchable and bundled offline; no account is needed. Workspace settings use the same picker. Colors can use a palette or a custom hex value.
- Remove a workspace through its settings without deleting its directory. Pending notes save first; failures keep the workspace open.
- Ordinary `.md` files, optional folders, and English/Hebrew tags from inline text or YAML `tags:` strings/lists. YAML `aliases:` strings/lists feed search, wiki-link resolution and completion, backlinks, and the graph. Malformed frontmatter is left intact and ignored for metadata extraction.
- In-note find and replace, selection match highlighting, next-occurrence selection, and multiple cursors in the Markdown editor. Search handles Hebrew and English; replacements participate in undo. Empty editors show the slash-command and note-link completion hints.
- Global fuzzy title/alias/tag search, with the current workspace first. Combine terms, such as `vector #exam`.
- Full-text search with matching snippets, workspace/folder/tag filters, and saved searches.
- Note/heading autocomplete, backlinks, heading outline, pinned notes, and Markdown slash commands.
- Hierarchical note graph from workspace tools or the command palette. Circular links bundle through workspace/folder groups; inspect incoming/outgoing connections, search notes, switch scope, zoom/pan, and open a note. Settings → Graph adjusts bundling strength with a visual preview.
- Command palette, quick capture and daily notes in a dedicated Quick Notes workspace. Capture and Today are available directly in the sidebar.
- Editable Markdown starter templates, workspace task overview, and YAML properties with table/board views. See [workflow details](docs/note-workflows.md).
- Lightweight drawings with editable source and portable SVG previews. See [drawing controls and storage](docs/drawings.md).
- Workspace-specific tabs and split panes, restored on restart. Opening a visible note focuses its existing pane; closing or collapsing a split keeps the remaining note reachable. Middle-click a tab to close it after saving, including pending property edits.
- Raw Markdown editing with compact Edit/Read controls, a toggleable formatting bar, and a preview whose paragraphs reveal editable Markdown when clicked. Drawing, formatting, and rename actions are in the note header’s More note actions menu. Navigation and dialogs follow the UI font preference independently of the note font.
- Automatic paragraph direction for mixed Hebrew/English; code stays LTR.
- Tables, task lists, syntax-highlighted code, math, wiki links, existing inline images, and image tabs with zoom.
- Debounced autosave with Saving/Saved/Failed states in the bottom status bar. A separate Changed on disk state pauses autosave and offers Reload with discard confirmation, Keep mine with a fresh revision check, and Save a copy. Ordinary save failures offer retry and Save a copy. Saving and renaming share a document queue so typing can continue during disk writes.
- Native filesystem events refresh registered workspaces after a short debounce, excluding hidden and dependency/cache trees. Partial scans report warnings and retain previously indexed entries and open buffers until a complete scan succeeds.
- New filenames follow the title until manually renamed. Existing files retain their names. Clicking the filename above a note opens rename/move.
- Note titles use the first body H1 or the filename when no H1 exists. Opening a note or editing its body preserves frontmatter and does not insert a heading; editing the title explicitly changes or adds its H1.
- Atomic writes, revision conflict detection, and save-before-close. A failed save keeps the window open and retains the text in memory.
- Corrupt settings are backed up before recovery. Invalid preferences reset to defaults while preserving valid workspace registrations, sessions, and appearances. Notes are limited to 20 MiB for reading and saving; larger files remain listed using their filename, and opening them reports the limit. Linux file and folder moves use an atomic no-overwrite rename.
- Moves reconcile open notes, tabs, pins, folder selection and appearance together. Typing can continue during a move; subsequent save or reread failures retain the buffer and report a warning separately from the committed move. Closing waits for queued relocations and note creation.

## Keyboard

App shortcuts use physical key positions and work with both Hebrew and English layouts. Right-click in the editor uses the native editing and spell-check menu. Settings → Shortcuts lists app commands and editor controls.

| Shortcut                         | Action                                   |
| -------------------------------- | ---------------------------------------- |
| Ctrl+,                           | App settings                             |
| Ctrl+P                           | Search all workspace titles and tags     |
| Ctrl+Shift+P                     | Search note contents                     |
| Ctrl+K                           | Command palette                          |
| Ctrl+Shift+N                     | Quick capture in Quick Notes/Inbox       |
| Ctrl+Shift+D                     | Open today's note in Quick Notes/Daily   |
| Ctrl+N                           | New note in the selected folder          |
| Ctrl+S                           | Save pending changes                     |
| Ctrl+W                           | Close the focused note after saving      |
| Ctrl+Tab / Ctrl+Shift+Tab        | Next / previous tab                      |
| Ctrl+\\                          | Toggle split pane                        |
| Ctrl+B / Ctrl+I                  | Bold / italic in Markdown                |
| Ctrl+F                           | Find and replace in the editor           |
| F3 / Shift+F3                    | Next / previous search match             |
| Ctrl+D                           | Add the next occurrence to the selection |
| Alt+drag                         | Rectangular selection                    |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y   | Undo / redo in the editor                |
| ← / →, Home / End on tabs        | Select and focus a tab                   |
| Delete on a tab                  | Close it after saving                    |
| Enter / Space on a preview block | Edit that Markdown block                 |
| Escape, then Tab                 | Move keyboard focus out of the editor    |
| ↑ / ↓, Enter, Escape             | Navigate, open, and close search         |

In Edit mode, find and replace covers the note body. A preview block's editor searches only that block. The title and properties remain separate fields. Search supports case sensitivity, regular expressions, and whole words.

## Agent context with Graft

The repo includes the Graft skill for Codex and Claude Code, agent instructions,
MCP configuration, and Claude Code hooks. Install the CLI and build the local
code graph after cloning:

```sh
npm install --global @nanonets/graft@0.21.1
graft build
graft check
```

Restart the agent to load the skill and MCP configuration. The generated `graft/`
cache is ignored by Git. The structural graph needs no API key; optional LLM
summaries require a separate `graft build --deep` run.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run desktop:build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

Final check on 2026-10-08 reviewed the complete working-tree change against `62d9ba0`, including the earlier implementation batches. YAML metadata expansion, unsafe folder moves, title clearing, a Keep mine observation race, cleartext image loading and excess native permissions are repaired. 393 frontend tests and 134 native tests passed, with one existing opt-in frontend benchmark skipped. The desktop release, strict Clippy, formatting, policy regressions, vendor integrity and dependency audits passed. See [coverage, remaining findings and verification limits](docs/final-check-2026-10-08.md).

Architecture follow-up on 2026-10-08: both Workspace refresh and native Workspace mutation candidates are implemented. 387 frontend tests passed with one existing opt-in benchmark skipped; 128 native tests passed. Typecheck, lint, formatting, strict Clippy, vendor integrity, Cargo audit, optimized GLib regression and drawing bundle guard passed. The desktop release was rebuilt. See [architecture implementation and verification](docs/architecture-fixes-2026-10-08.md).

Backlog batch two on 2026-10-08: 357 frontend tests passed with one existing opt-in benchmark skipped; 119 native tests passed. Typecheck, lint, formatting, strict Clippy, Cargo audit, vendor integrity, the optimized GLib regression, drawing bundle guard and desktop release rebuild passed. Browser checks covered conflict recovery, alias search and preserved Markdown/frontmatter. See [batch-two verification](docs/backlog-batch-two-2026-10-08.md).

GitHub Actions runs frontend typechecking, tests, linting, formatting, security-policy regressions/checks, the production build and drawing bundle guard, plus native tests, formatting, strict Clippy, vendor integrity and the optimized GLib regression. Component tests use jsdom; domain tests continue to run in Node. Install the optional local pre-commit formatting/lint hook with `npm run hooks:install`.

The project retains the TypeScript 7 compiler under `@typescript/native`. ESLint uses the official side-by-side TypeScript 6 API package under the `typescript` alias because its parser requires that API. `npm ci` installs both from the lockfile; `npm run typecheck` and `npm run build` use the TypeScript 7 `tsc` binary.

Native dependency checks, from the repository root:

```sh
python3 scripts/check-native-dependencies.py
cargo audit --file src-tauri/Cargo.lock --deny warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --release --test glib_variant_iter
```

WebView policy checks, from the repository root:

```sh
python3 scripts/test-security-policy.py
python3 scripts/check-security-policy.py
```

Install `cargo-audit` with `cargo install cargo-audit --locked` if needed. The
[GTK 3 backport notes](src-tauri/vendor/README.md) document the GLib unsoundness
fix, replacement of the unmaintained macro helper, local patch ownership and
why an audit alone does not verify vendored code.

Dependency repair on 2026-09-30: the optimized GLib iterator regression crashed
with the original dependency and passed with the backport. All 71 native tests,
strict Clippy, the vendor integrity check and Cargo audit with warnings denied
passed. The desktop release was rebuilt. The three local patches must be
maintained until the upstream GTK stack can replace them.

Final check on 2026-09-30: 228 frontend tests passed with one existing opt-in performance test skipped; all 70 native tests passed. TypeScript, strict Clippy, Rust formatting, drawing bundle guard, whitespace checks and the desktop release rebuild passed. Repairs cover late refresh after workspace removal, drawing export during shutdown, narrow-pane properties, special-file native reads and editor attribution. Browser demo checks verified all six themes, tab/workspace feedback, details fields and deferred drawing export. The [final-check report](docs/final-check-2026-09-30.md) records coverage, security checks, two remaining upstream dependency advisories and verification limits.

Earlier session, command and document lifetime verification on 2026-09-30: 223 frontend tests passed with one existing opt-in performance test skipped; all 68 native tests passed. TypeScript, strict Clippy, diff checks and the desktop release build passed. Independent reviews covered session invariants, registration/removal ordering, close/load races, pending shutdown workflows, terminal disposal and editor holds. Browser demo checks verified keyboard and middle-click property draft saving, palette autofocus/split, tab cycling, lone secondary promotion, Capture/Today across sidebar, Tools and keyboard, busy/drawing command restrictions, drawing text committed by Save, and editing restored after failed deletion. Native file behavior remains covered by temporary-file Rust tests; browser checks use demo files.

Earlier theme and identity verification on 2026-09-30: 131 frontend tests passed with one existing opt-in performance test skipped; all 68 native tests passed. TypeScript, strict Clippy, and the desktop release build passed. Browser demo checks covered all six saved themes without replacing the editor or its text, local previews, Cancel and Reset, search autofocus, keyboard menus, Edit/Read, Hebrew direction, note details, graph/drawing colors, Capture/Today, and collapsed folders. A 760×520 browser frame exercised minimum-size single/split headers without horizontal overflow. Native tests use temporary files to verify all six theme choices after restart and preservation of notes and other settings.

Earlier architecture verification on 2026-09-30: 108 frontend tests passed with one existing opt-in performance test skipped; all 64 native tests passed. TypeScript, strict Clippy, Rust formatting and the desktop release build passed. Browser demo checks exercised note/folder relocation with open tabs and pins, popup autofocus, unsaved outline updates with an unchanged title, mixed paragraph direction and content results at moved paths. Native rewrite and partial-failure behavior were verified against temporary files in Rust tests. See [native contracts](docs/native-contract.md) and [workflow checks](docs/note-workflows.md).

Earlier baseline verification on 2026-09-29 (new workflow checks are documented in [docs/note-workflows.md](docs/note-workflows.md)):

- 43 frontend tests and 49 native tests passed; TypeScript, clippy, and the native release build passed.
- Browser interactions exercised new notes, title-driven names, autosave, Hebrew direction, editing a preview block, tag search, cross-workspace search navigation, the formatting bar, and split panes.
- The native release opened a temporary workspace on Hyprland, displayed its Markdown, created a note through Ctrl+N, saved typed content as `smoke.md`, and flushed the last keystroke when the window closed. The saved workspace session was inspected on disk. No personal note folder was used.
- Browser checks also exercised middle-click closing, image rename/move and deletion, file/folder colors, workspace icons, icon search/pagination, and workspace removal. New regression tests cover delayed confirmations after automatic renames, pending edits before image-link rewriting, Trash failure, and metadata persistence.
- A browser microbenchmark over 500 generated notes and 200 queries measured about 0.1 ms median / 0.2 ms p95 for the search function. This excludes rendering and does not measure native typing latency.
- Independent frontend and native reviews found save/rename races and Markdown link/code edge cases; regression tests cover the fixes. Review reports are in `docs/`.

## Current limits

- This is a first desktop build, without an installer, cloud sync, or Vim mode.
- Live filesystem refresh uses the operating system's watcher. Watch failures are reported; configurable focus refresh and manual refresh remain available. OS watch limits and network/cloud filesystem event delivery can affect live refresh.
- Incoming-link updates handle direct wiki links and inline Markdown destinations in registered workspaces. Reference-style destinations, escaped paths, and outgoing relative links inside a moved note are not rewritten. Link-update failures are reported separately from the successful rename.
- Existing images are supported; clipboard/drop image insertion is intentionally absent. Image tabs accept the native service’s supported formats and size limit.
- Cleartext HTTP images are blocked. HTTPS images load automatically and can disclose your IP address and note-open time to the image host; remote-image opt-in remains planned.
- Conflicting unsaved text is kept in memory and can be saved as a copy; there is no recovery journal after a process or system crash. External programs can still race a save in the short interval between revision checking and atomic replacement.
- The editor, dialogs, and icon catalog load in separate chunks. Some optional chunks still trigger Vite’s size warning. Current bundle sizes and local search, tree, preview, and scan measurements are in [docs/performance.md](docs/performance.md); end-to-end native input latency is not yet measured.

## License

This project is licensed under the [MIT License](LICENSE).

Lucide, its Feather-derived icons, D3 graph modules, and adapted CodeMirror/Lezer editor code have license notices in `public/THIRD_PARTY_NOTICES.txt`, which is embedded in the desktop frontend build.
