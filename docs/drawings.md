# Drawings

Open a note and click **Drawing** beside Preview. Drawings support rectangles,
ellipses, lines, arrows, freehand strokes, and multiline English/Hebrew text.
Choose a stroke color, thickness, optional shape fill, and text size in the toolbar.

Select objects to move them, drag the blue lower-right handle to resize them,
or double-click text to edit it. Undo, redo, duplicate, delete, zoom, and fit are
available in the toolbar. Changes use the note's existing autosave queue. Text
also autosaves while its text field is open. Done returns to the note; preview
shows a canvas that you can click to edit again. Copy SVG copies a vector image
to the clipboard.

| Shortcut | Action |
| --- | --- |
| V / H | Select / pan |
| R / O / L / A / P / T | Rectangle / ellipse / line / arrow / pen / text |
| Space + drag, middle-button drag | Pan |
| Scroll | Pan |
| Ctrl + scroll | Zoom around the cursor |
| Shift + shape drag | Square / circle |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+D / Delete | Duplicate / delete selection |
| Arrow keys / Shift+arrow keys | Move selection by 1 / 10 units |
| Ctrl+Enter in text | Finish text editing |
| Ctrl+S / Ctrl+W | Save now / return to note |

## Storage

Drawings live in a top-level `notes-drawing` fenced block inside the `.md` file.
The block contains versioned JSON, including an ID and ordered shape list. Text
outside the block is preserved. Clearing every object keeps an editable empty
drawing. Opening Drawing edits the note's first drawing; preview can open each
individual drawing if a note contains multiple blocks.

This is the app's own small drawing format. It does not import Excalidraw files
or provide collaboration, connectors that follow shapes, image imports, grouping,
or multiple selection. Done and Ctrl+S also write an immutable SVG under
`assets/drawings/` and add an ordinary relative Markdown image link after the
editable block. Other Markdown editors can display this SVG, while retaining the
source JSON. This app combines the source and fallback into one preview. Keep the
assets folder with the notes when copying a workspace. Old SVG revisions remain
on disk so copied references keep working; there is no automatic asset cleanup.
Hand-edited JSON needs to be reopened and saved through Drawing to regenerate its
preview. Moving a note between folders has the existing outgoing-relative-link
limitation; reopening and saving the drawing rebuilds its relative preview link.
Icons, search, renaming, moving, and deleting work through the containing note.

Invalid drawing data and conflicting edits are rejected without replacing the
source. A failed disk save keeps the drawing in the note buffer and exposes Retry.
Limits are 1,000 shapes, 5,000 points in one stroke, 50,000 pen points in a scene,
and 2 million JSON characters. Coordinates serialize to two decimal places.

## Performance and verification

The original canvas implementation added no dependency; portable SVG exports now use a small native XML validator. The editor and static canvas preview are separate lazy
imports. Ordinary Markdown notes do not load either. Pointer moves update an
imperative canvas controller, with at most one pending animation frame. React,
undo history, validation, JSON serialization, and autosave receive completed
gestures, not pointer moves. Text edits use the existing debounced autosave.
There is no idle animation loop. Resize observers and pointer listeners are
removed when a canvas unmounts. Offscreen shapes are culled; undo is bounded to
60 gestures and reuses unchanged shapes. Backing resolution is capped at 2x.

Measured locally against commit `27a20f2` on 2026-09-29:

- Complete startup JavaScript graph: 468,708 bytes before, 470,500 after, +0.38%.
- Ordinary note editor graph: 1,019,876 bytes before, 1,023,548 after, +0.36%.
- Drawing editor adds about 27 KB of JavaScript after opening a note.
- Search over 500 notes: 0.0542 ms baseline median, 0.0523 ms with this change.
- Search over 5,000 notes: 0.3530 ms baseline median, 0.2995 ms with this change.
- Splitting a 1 MB note: 0.0266 ms baseline median, 0.0265 ms with this change.
- Browser canvas submission for 1,000 rectangles: 0.5 ms median, 0.6 ms p95.
- An idle open canvas made zero repaint calls during a one-second observation.

These short timings are sanity checks, not proof of a speedup or measurements of
native input-to-display latency. Canvas submission excludes GPU presentation.
The static-graph totals include transitive imports rather than just the entry
file; numbers exclude CSS and fonts. The canvas timing used the development
browser and does not represent 1,000 complex freehand objects.

Reproduce the bundle checks and ordinary note benchmarks:

```sh
npm run build
node scripts/check-drawing-bundle.mjs
node scripts/performance.mjs
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

The bundle check rejects eager drawing imports in the ordinary note/preview graph
and an extra drawing editor payload above 60 KB. Pass a directory containing a
previous build manifest to compare static graphs. Tests cover round trips,
fences, conflict detection, schema limits, safe SVG text, geometry, undo bounds,
save failure/retry, native persistence after restart, and search metadata.

Browser checks exercised creating shapes, moving, duplicate/delete, undo/redo,
English/Hebrew text, autosave before closing text entry, preview and reopen, focus,
and viewport layout. Pointer drags were dispatched through the real controller
with pointer capture stubbed only for synthetic browser events; physical mouse
capture behavior still needs testing in the native Hyprland window.
