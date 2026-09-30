# Notes

A local Markdown note app for Linux, built with Tauri 2, React, TypeScript, Tailwind, and CodeMirror. The compact interface uses Graphite + amber as its default theme and brand, with a folded-page bookmark mark.

## Run

```sh
npm install
npm run desktop
```

Requires Node.js, Rust, and the Linux Tauri build dependencies. This project was built on CachyOS with GTK 3 and WebKitGTK 4.1 already installed. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for another machine.

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
- App settings open from the sidebar or Ctrl+comma. Appearance offers Graphite + amber, Ink + jade, Midnight + ice, Charcoal + coral, Forest + moss, and the original One Dark Pro. Themes persist separately from notes and apply to the editor, preview, dialogs, graph, and drawing controls. Theme selection previews locally; Save changes applies it, Cancel keeps the saved theme, and Reset to defaults selects Graphite + amber. Adjust editor font/size/spacing, wrapping, line numbers, tab size, spellcheck, reading width, default preview, autosave delay, search scope/order/limit, session restoration, focus refresh, and file ordering. Settings persist outside your notes; Reset to defaults is available before saving.
- Workspace and icon menus use the app theme. Dialogs focus their first field on opening; menus support arrow keys and Escape without focus outlines.
- Right-click a note or image to open it, split it, rename/move it, customize its icon/color, copy its path, or move it to Trash.
- Right-click a folder to rename or move it, or customize its icon and name color. Drag notes, images, or folders onto a folder or the Files heading to move them within the workspace. Existing destinations and moves into a folder itself are rejected. All 2,118 names in the installed free Lucide catalog are searchable and bundled offline; no account is needed. Workspace settings use the same picker. Colors can use a palette or a custom hex value.
- Remove a workspace through its settings without deleting its directory. Pending notes save first; failures keep the workspace open.
- Ordinary `.md` files, optional folders, inline English/Hebrew tags.
- Global fuzzy title/tag search, with the current workspace first. Combine terms, such as `vector #exam`.
- Full-text search with matching snippets, workspace/folder/tag filters, and saved searches.
- Note/heading autocomplete, backlinks, heading outline, pinned notes, and Markdown slash commands.
- Hierarchical note graph from workspace tools or the command palette. Circular links bundle through workspace/folder groups; inspect incoming/outgoing connections, search notes, switch scope, zoom/pan, and open a note. Settings → Graph adjusts bundling strength with a visual preview.
- Command palette, quick capture and daily notes in a dedicated Quick Notes workspace. Capture and Today are available directly in the sidebar.
- Editable Markdown starter templates, workspace task overview, and YAML properties with table/board views. See [workflow details](docs/note-workflows.md).
- Lightweight drawings with editable source and portable SVG previews. See [drawing controls and storage](docs/drawings.md).
- Workspace-specific tabs and split panes, restored on restart. Opening a visible note focuses its existing pane; closing or collapsing a split keeps the remaining note reachable. Middle-click a tab to close it after saving, including pending property edits.
- Raw Markdown editing with compact Edit/Read controls, a toggleable formatting bar, and a preview whose paragraphs reveal editable Markdown when clicked. Drawing, formatting, and rename actions are in the note header’s More note actions menu. Navigation and dialogs keep proportional typography independent of the note font.
- Automatic paragraph direction for mixed Hebrew/English; code stays LTR.
- Tables, task lists, syntax-highlighted code, math, wiki links, existing inline images, and image tabs with zoom.
- Debounced autosave with Saving/Saved/Failed states in the bottom status bar, retry, and Save a copy. Saving and renaming share a document queue so typing can continue during disk writes.
- New filenames follow the title until manually renamed. Existing files retain their names. Clicking the filename above a note opens rename/move.
- Atomic writes, revision conflict detection, and save-before-close. A failed save keeps the window open and retains the text in memory.
- Moves reconcile open notes, tabs, pins, folder selection and appearance together. Typing can continue during a move; subsequent save or reread failures retain the buffer and report a warning separately from the committed move. Closing waits for queued relocations and note creation.

## Keyboard

| Shortcut | Action |
| --- | --- |
| Ctrl+, | App settings |
| Ctrl+P | Search all workspace titles and tags |
| Ctrl+Shift+P | Search note contents |
| Ctrl+K | Command palette |
| Ctrl+Shift+N | Quick capture in Quick Notes/Inbox |
| Ctrl+Shift+D | Open today's note in Quick Notes/Daily |
| Ctrl+N | New note in the selected folder |
| Ctrl+S | Save pending changes |
| Ctrl+W | Close the focused note after saving |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+\\ | Toggle split pane |
| Ctrl+B / Ctrl+I | Bold / italic in Markdown |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo in the editor |
| ↑ / ↓, Enter, Escape | Navigate, open, and close search |

## Validation

```sh
npm test
npm run typecheck
npm run desktop:build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

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
- Workspace contents refresh when the window regains focus by default; this is configurable. There is no continuous filesystem watcher yet.
- Incoming-link updates handle direct wiki links and inline Markdown destinations in registered workspaces. Reference-style destinations, escaped paths, and outgoing relative links inside a moved note are not rewritten. Link-update failures are reported separately from the successful rename.
- Existing images are supported; clipboard/drop image insertion is intentionally absent. Image tabs accept the native service’s supported formats and size limit.
- Conflicting unsaved text is kept in memory and can be saved as a copy; there is no recovery journal after a process or system crash. External programs can still race a save in the short interval between revision checking and atomic replacement.
- The initial JavaScript entry is about 47% smaller after splitting the editor, dialogs, and icon catalog. Some optional chunks still trigger Vite’s size warning. Local search, tree, preview, and scan measurements are in [docs/performance.md](docs/performance.md); end-to-end native input latency is not yet measured.

## License

This project is licensed under the [MIT License](LICENSE).

Lucide, its Feather-derived icons, D3 graph modules, and adapted CodeMirror/Lezer editor code have license notices in `public/THIRD_PARTY_NOTICES.txt`, which is embedded in the desktop frontend build.

GTK 4 compatibility experiment: see [the test report](docs/gtk4-experiment-2026-09-30.md). This worktree uses pinned experimental upstream sources and is not the production dependency configuration.
