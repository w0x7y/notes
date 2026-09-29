# Search, capture, and connected notes

Ctrl+P searches note titles and inline tags. Ctrl+Shift+P searches note contents across registered workspaces and shows matching snippets. Workspace, folder and inline-tag filters combine; current-workspace matches appear first. Save a named search using the star beside its name field. Queries currently match all entered words as case-insensitive substrings; there is no regex/query language. Results show one snippet per matching note, capped at 150 notes.

The ellipsis beside the workspace name opens Tools, with named actions, shortcuts and workspace settings. Ctrl+K opens the command palette. It includes search, capture, daily notes, lecture/template creation, tasks, assignments/projects, settings, refresh, save, and pane actions.

Ctrl+Shift+N creates a blank note in Inbox/ inside the dedicated Quick Notes workspace. Ctrl+Shift+D opens Daily/YYYY-MM-DD.md in that same workspace, using the local calendar date. The native app creates Documents/Quick Notes on first use, using the OS Documents location. Repeating the daily command reopens the existing file without replacing its content. Removing Quick Notes unregisters it like any workspace; invoking capture/daily again registers the existing directory.

## Templates

The template picker seeds ordinary Markdown files in Templates/: Lecture, Assignment, Project, Meeting and Daily. Existing files with these names are preserved. Edit these files or add your own. Supported placeholders are {{title}}, {{date}} and {{time}}. Unknown placeholders remain literal. Daily uses Quick Notes/Templates/Daily.md; other commands use the current workspace's Templates folder. Generated daily and template filenames are fixed; new captures retain normal title-driven naming.

## Links and note details

Type [[ for note suggestions, then use arrows and Enter. Suggestions include registered workspaces; generated links qualify their target to avoid ambiguous filenames. Type # within a link for that note's headings. Clicking a heading link navigates to the heading's source line. Same-note links such as [[#Examples]] work too.

The panel button beside Drawing opens the outline, properties and backlinks. Backlinks list other notes linking to the current note. The pin button adds the note to the sidebar's Pinned list. Pins follow app-driven renames. Pins and saved searches are stored in the app's local WebView storage, outside note files; clearing app site data removes them.

Type / at the start of a line for Markdown insertions: headings, checklist, list, table, fenced code and quote. Menus do not appear inside code blocks.

## Tasks and projects

Tools → Workspace tasks opens a workspace list of actual Markdown checkboxes. Filter open/completed/all tasks or text. Checkbox changes update the source note through its normal save queue. Clicking a task opens its source line. Code examples and Templates/ are excluded.

Add status, due, subject and priority in note details, or start with an Assignment/Project template. These properties are YAML frontmatter. Editing them preserves unrelated fields and comments. Enter or leaving a field saves it; clearing it removes it. Malformed YAML is rejected without replacing it. Fix malformed frontmatter in an external text editor if needed; the note editor keeps the metadata separate from its body.

Tools → Projects and assignments shows a filtered table or board. Both views edit the original notes. Change a card's status field to move it between columns; the board does not use drag-and-drop. Default columns are Todo, In progress and Done; existing custom statuses get their own columns. Notes with none of the four properties and template source files are excluded.

## Performance and limits

Content analysis is loaded on demand. A shared in-memory cache reuses unchanged notes across content search, backlinks, tasks and projects. Reads run in batches of four, yielding to input/paint after an eight-millisecond batch budget. Queries never read files. Save and rename events invalidate affected entries; open unsaved buffers take precedence over disk reads. First use must read and parse note contents. There is no persistent full-text index; content parsing runs on the main thread and unusually large notes can take longer to parse. The existing focus-refresh setting controls external file refresh.

The [note graph](note-graph.md) loads on demand and uses a separate, bounded layout worker. The drawing editor and its SVG renderer still load only when used. Drawing Done/Ctrl+S writes immutable SVG assets with ordinary Markdown image links. See [drawings](drawings.md).

## Verification

Domain tests cover source offsets, Unicode-normalized search, conjunctive filters, code/frontmatter exclusion, stale task rejection, YAML preservation, date expansion, daily-note idempotency, template preservation, live-buffer indexing and rename-driven cache invalidation. Native tests exercise capture workspace reuse, path boundaries, SVG export, and frontmatter title/tag extraction.

Browser checks exercised search filters/highlights/saved searches, task changes reflected in an open editor, property edits/table/board, capture and daily workspace paths, slash and cross-workspace link/heading completion, heading jumps, backlinks, pinning, command filtering and template creation. Native file operations are verified by Rust tests; browser preview uses sample files. End-to-end native typing latency is not yet measured.

Final checks on 2026-09-29: 78 frontend tests passed, one existing opt-in performance test skipped; 55 native tests passed; TypeScript, strict Clippy and the native release build passed. The final drawing export browser check was interrupted when the collaborative preview disconnected. SVG export and drawing source/fallback round trips passed automated tests.
