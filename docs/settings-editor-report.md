# Editor settings and preview performance

Editor preferences now reconfigure the existing CodeMirror instance through a compartment. Font size, line height, font family, wrapping, line numbers, spellcheck, and indentation update without replacing the document or history. The editor subscribes only to these preference fields. Readable width switches between 940px and the available pane width. Default preview applies when a note view opens. Preview text uses the selected font and sizing.

`LivePreview` memoizes parsing and sanitization by body text. Stable link callbacks and a memoized component prevent save-status and title renders from rebuilding preview blocks. `markdownBlocks` renders slices of the first parsed token stream instead of parsing each block a second time. Every call retains a separate Markdown reference environment. Editable source ranges, including whitespace and definition-only blocks, remain intact. KaTeX CSS now loads with the preview module.

Reproduce the parser benchmark with:

```sh
VITE_MARKDOWN_BENCHMARK=1 npx vitest run src/editor/markdown.performance.test.ts --reporter=verbose --silent=false
```

The fixture contains 500 paragraphs, 53,418 characters, mixed English/Hebrew, inline code, emphasis, wiki links, and shared reference links. Each run warms up ten times and records fifty iterations. Node v26 on this workspace produced:

| Parser                                             |    Median |       p95 |
| -------------------------------------------------- | --------: | --------: |
| Original whole-note parse plus per-block reparsing | 10.863 ms | 20.006 ms |
| Reuse whole-note tokens                            |  4.611 ms |  7.528 ms |

These measure the parser function, not browser interaction latency. The benchmark is opt-in and has no machine-dependent pass threshold.

Regression tests compare concatenated block HTML with whole-document rendering and verify contiguous, exact source ranges for headings, lists/tasks/nesting, blockquotes, highlighted and indented code, tables, wiki links/images, math, shared references, empty notes, whitespace, and CRLF input. Reference isolation is checked across notes. A real CodeMirror state test reconfigures preferences after an edit and confirms document identity, selection, tab/indent settings, spellcheck, and working undo.

The existing outer document scroll container is retained. CodeMirror's installed `visiblePixelRange` implementation accounts for clipping by scrollable ancestors, including the current `.document-scroll`. No image cache was added, so this change introduces no new stale-image policy.

Validation: targeted editor tests and the full frontend suite passed; `npm run typecheck` passed. Parent integration checks cover the actual browser editor and viewport behavior.
