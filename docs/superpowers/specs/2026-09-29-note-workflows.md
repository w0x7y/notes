# Note workflows

Implement the ten user-approved additions around ordinary Markdown and the existing save queue.

- Ctrl+P remains title/tag lookup. Ctrl+Shift+P opens content search with snippets, workspace/folder/tag controls and saved searches.
- Ctrl+K opens searchable commands; Ctrl+Shift+N captures in the dedicated Documents/Quick Notes workspace Inbox; daily notes use its Daily folder. Commands include note creation, lecture template, daily note, templates, search, tasks, table/board, settings, split and save.
- A lazy, shared content cache indexes headings, links, tasks and properties from notes. Reuse unchanged files, cancel stale requests, yield between batches; never scan per keystroke. Query results prioritize the current workspace. Report unreadable files.
- Link completion and slash completion use CodeMirror. Backlinks and outline share a toggleable note side panel. Navigation selects source offsets, including heading fragments and task/search matches.
- Templates are editable .md files under Templates; seed Lecture, Project, Meeting, Daily on explicit template use without replacing existing files. Expand {{title}}, {{date}}, {{time}}. Quick Notes/Daily/YYYY-MM-DD.md is reopened on repeated invocation. Capture creates Quick Notes/Inbox notes.
- Favorites and saved searches persist as app metadata. Remap favorites on rename and remove stale references on delete/removing workspace.
- Tasks are actual Markdown list checkboxes, excluding examples in code. Mutations use the live NoteDocument and verify indexed source before changing a character; flush through its existing save queue.
- Properties use YAML frontmatter, preserving unknown fields/comments, with editable status, due, subject, priority. A workspace table/board filters notes; board status changes update frontmatter. Empty notes are not enrolled until a property is added. Templates do not appear in tasks/board.
- Drawing source remains editable notes-drawing JSON. Generate immutable SVG assets and Markdown image links on drawing close/export; old notes continue working. Our preview suppresses duplicate fallback images. No draw/render loop when idle.
- UI remains One Dark Pro, existing font, mixed-direction text and keyboard interaction. New controls use existing dialog/menu patterns.

Validation: unit tests for indexing/filtering, source offsets, stale task mutation, metadata preservation, templates/date expansion, completion and drawing fallback; frontend tests/typecheck/build; native SVG service tests and cargo tests; interactive browser checks of all new views and keyboard flows.
