# Notes

A local Markdown note app for Linux, built with Tauri 2, React, TypeScript, Tailwind, and CodeMirror. The compact interface uses One Dark Pro colors.

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

- Open folders as workspaces; customize their names, colors, and icons.
- Ordinary `.md` files, optional folders, inline English/Hebrew tags.
- Global fuzzy title/tag search, with the current workspace first. Combine terms, such as `vector #exam`.
- Workspace-specific tabs and split panes, restored on restart.
- Raw Markdown editing, a toggleable formatting bar, and a preview whose paragraphs reveal editable Markdown when clicked.
- Automatic paragraph direction for mixed Hebrew/English; code stays LTR.
- Tables, task lists, syntax-highlighted code, math, wiki links, existing inline images, and image tabs with zoom.
- Debounced autosave with Saving/Saved/Failed states, retry, and Save a copy. Saving and renaming share a document queue so typing can continue during disk writes.
- New filenames follow the title until manually renamed. Existing files retain their names. Clicking the filename above a note opens rename/move.
- Atomic writes, revision conflict detection, and save-before-close. A failed save keeps the window open and retains the text in memory.

## Keyboard

| Shortcut | Action |
| --- | --- |
| Ctrl+P | Search all workspace titles and tags |
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

Verified on 2026-09-29:

- 19 frontend tests and 25 native filesystem tests passed; TypeScript, clippy, and the native release build passed.
- Browser interactions exercised new notes, title-driven names, autosave, Hebrew direction, editing a preview block, tag search, cross-workspace search navigation, the formatting bar, and split panes.
- The native release opened a temporary workspace on Hyprland, displayed its Markdown, created a note through Ctrl+N, saved typed content as `smoke.md`, and flushed the last keystroke when the window closed. The saved workspace session was inspected on disk. No personal note folder was used.
- A browser microbenchmark over 500 generated notes and 200 queries measured about 0.1 ms median / 0.2 ms p95 for the search function. This excludes rendering and does not measure native typing latency.
- Independent frontend and native reviews found save/rename races and Markdown link/code edge cases; regression tests cover the fixes. Review reports are in `docs/`.

## Current limits

- This is a first desktop build, without an installer, cloud sync, Vim mode, or other themes.
- Workspace contents refresh when the window regains focus; there is no continuous filesystem watcher yet.
- Incoming-link updates handle direct wiki links and inline Markdown destinations in registered workspaces. Reference-style destinations, escaped paths, and outgoing relative links inside a moved note are not rewritten. Link-update failures are reported separately from the successful rename.
- Existing images are supported; clipboard/drop image insertion is intentionally absent. Image tabs accept the native service’s supported formats and size limit.
- Conflicting unsaved text is kept in memory and can be saved as a copy; there is no recovery journal after a process or system crash. External programs can still race a save in the short interval between revision checking and atomic replacement.
- The initial JavaScript bundle currently triggers Vite’s size warning. Preview and code-language modules load on demand; end-to-end latency and large-file profiling remain future work.
