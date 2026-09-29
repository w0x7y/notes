# Frontend review

Reviewed `src/**` in the first desktop implementation. Initial review ran `npm test`: 11 tests passed. Focused follow-up review inspected the fixes and their regression tests without rerunning the suite. **All four findings below are resolved.** The implementer reports 17 passing tests and successful browser/native smoke checks; those broader checks were not independently repeated by this reviewer.

Resolution details: rename now shares the document operation queue and saves newer edits against the renamed path/revision; tab closing resolves the current path after flushing; block rendering reuses the full-document Markdown environment; headings, list items, and table cells receive automatic direction. The source and regression tests cover the original reported failure cases.

## Resolved — P1 — A completed rename discards edits made while its IPC call is pending

Location at review time: `src/domain/document.ts:72–78`, `src/domain/app-store.ts:111–114`; dismissal remains enabled in `src/components/Forms.tsx` and `src/components/Dialog.tsx`.

Reproduction: submit a rename, dismiss the busy dialog with Escape/Cancel, then type before the native response returns. `acceptRename` unconditionally replaces `content` with the older response and marks that text as the saved baseline. A direct execution of the actual `NoteDocument` class confirmed that `Typed during rename` becomes `Saved` and `dirty` becomes false. The autosave timer can also issue a save against the old path during this interval. Rename must participate in the document's serialized operation queue while preserving edits made after the rename snapshot.

## Resolved — P2 — Closing a note during a title-driven rename fails to close its tab

Location at review time: `src/domain/app-store.ts:63–67`.

Reproduction: create a note, type its title, and press Ctrl+W before the debounce fires. `closeFile` captures `Untitled.md`; its flush renames the note and updates the session to `Title.md`; the subsequent removal still compares against `Untitled.md`. Resolve the document's current path after flushing, or close by stable document identity.

## Resolved — P2 — Preview blocks lose reference-link definitions in other blocks

Location: `src/editor/markdown.ts:51–61`.

Reproduction:

```markdown
Read [details][topic].

Another paragraph.

[topic]: https://example.com
```

Rendering this document as a whole produces the expected link. Executing the actual `markdownBlocks` function renders the first paragraph as literal `Read [details][topic].`, because each block is reparsed with a fresh Markdown environment and the definition belongs to the last block. Reference images are affected too. Preserve the full-document parse environment when rendering individual source blocks, and cover a reference definition separated from its use by another paragraph.

## Resolved — P2 — Preview direction is automatic only for ordinary paragraphs

Location: `src/editor/markdown.ts:42–45`, `src/styles.css:69`.

Reproduction: preview a Hebrew heading followed by a tight list, e.g. `## כותרת` then `- פריט ראשון`. The actual renderer emits `<h2>כותרת</h2>` and `<li>פריט ראשון</li>` without direction attributes. Those elements inherit the English interface's LTR direction, unlike the raw editor and ordinary preview paragraphs. Hebrew headings, tight-list items, and table cells therefore align/order differently after switching to preview. Apply automatic direction at each relevant text block while keeping code and math explicitly LTR.

## Recovery-copy follow-up

A successfully saved conflict-recovery copy now retires its unchanged failed original buffer from the open session and cache, so it no longer blocks window closure. The original disk file is untouched. Newer edits and pending operations keep the original buffer alive. Two regression tests cover successful recovery followed by flush-all, and edits made while the copy is saved.
