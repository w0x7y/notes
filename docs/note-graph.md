# Note graph

Open **Tools → Note graph** from the ellipsis beside the workspace name, or search for **Open note graph** in Ctrl+K. Each opening starts with the current workspace.

A dot represents an existing Markdown note. A line connects notes linked with `[[wiki links]]` or ordinary Markdown links. Heading links connect their parent notes. Repeated and reciprocal links share one line; self-links, unresolved or ambiguous links, external URLs, images, and links inside code examples do not add connections. The graph uses the same resolver as the editor. Connections are shown without arrows.

## Navigation

- Switch between the current workspace, all registered workspaces, or the current note's neighborhood. The local view includes incoming and outgoing connections and offers one or two steps of depth.
- Click a dot or a note in the list to open it. Search matches titles, paths, workspace names and tags, including Hebrew. Matching nodes stay bright while others dim; the list shows only matches. Enter in search opens the first match. Down enters the list; Up/Down and Enter navigate it.
- Drag the background to pan, scroll to zoom around the pointer, or use the zoom buttons. Drag a dot to reposition it. Fit brings the current arrangement into view. With the graph focused, arrow keys pan, +/− zoom, and Home fits.
- Hover a dot or focus a list result to highlight its connections. The current note has a ring. Nodes use their own or inherited folder color, falling back to the workspace color. More connections make a dot larger.
- Display offers unlinked notes, titles and templates. Templates/ is excluded by default. Dense graphs hide most titles when zoomed out; hover, search or zoom in to reveal them.

## Performance and scope

The dialog and layout worker load on demand. The existing shared content index reads notes in batches, reuses unchanged analysis and prefers open buffers. Graph construction and bounded force layout run in the worker. Scope changes cancel any old worker; completion and closing terminate it. There is no idle animation or graph work while the dialog is closed. Pan and zoom reuse the rendered SVG nodes; search does not rerun the layout or read files.

The first opening still reads and parses notes. The target is hundreds of notes, not an unbounded graph: thousands of SVG elements can be expensive. The layout caps iterations and samples repulsion above 1,000 nodes. Node positions and view controls are temporary and reset on reopening; no graph metadata is written into Markdown. Resizing restores the initial layout. Tags are searchable, but are not separate graph nodes. Read failures are reported and may leave connections missing.

## Verification

Automated coverage includes Markdown/wiki/heading links, code exclusion, duplicate and reciprocal edges, ambiguous names, scoped orphans, cross-workspace local neighborhoods, template visibility, Hebrew/tag search and finite deterministic layouts for 500 nodes. Browser checks and release-build results are recorded with the implementation change.

Verified on 2026-09-29: 85 frontend tests passed, with one existing opt-in performance test skipped. TypeScript and the Tauri release build passed. The collaborative browser exercised menu/command entry, autofocus, local depth, unlinked filtering, tag search, cross-workspace navigation, zoom and Fit. Synthetic pointer events exercised node dragging; the native pointer-capture path was not automated.

A browser-only dataset of 503 notes and 1,001 connections rendered successfully. The layout worker took about 120 ms including startup on its first large run and 89 ms on reopening, excluding content indexing and rendering. Instrumentation confirmed termination after completion and no additional workers during search/zoom/drag. These are development-browser observations, not a native latency benchmark. No personal note files were used.
