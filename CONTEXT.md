# Notes

Notes are ordinary Markdown files inside registered workspace folders.

## Language

**Workspace**:
A registered folder containing notes, images and optional subfolders. Removing a workspace removes its registration, not its files.

**Document**:
An open note with its current text, saved revision and editing position. Its unsaved text remains available when a save fails.

**Workspace session**:
The open tabs and primary/secondary note positions remembered for a workspace. The focused pane determines where a selected note opens and which note keyboard actions target.

**Workspace command**:
An action offered through keyboard shortcuts, the command palette or workspace tools. Its availability depends on the current workspace and active dialog.

**Document lifetime**:
The period from loading or creating a Document until releasing its buffer. Accepted work must finish before release; failed saves retain the buffer.

**Relocation**:
A note, image or folder changing its path within a workspace. A relocation carries its tabs, pins and appearance to the destination and updates resolvable incoming links.

**Incoming link**:
A wiki link or inline Markdown destination in another note that resolves to a note or image. Ambiguous names do not identify a unique target.

**Content analysis**:
The headings, links, tasks, properties and searchable text derived from a note. Open unsaved document text takes precedence over saved file text.
