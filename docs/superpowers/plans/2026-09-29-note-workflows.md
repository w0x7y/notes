# Note Workflows Implementation Plan

> Execute inline with the executing-plans workflow. The user has authorized implementation of the ten listed additions.

**Goal:** Add search, linked navigation, capture/templates, task/project views and portable drawings while preserving Markdown and typing responsiveness.

**Architecture:** Shared lazy content analysis under src/knowledge; focused components for search, commands, templates, tasks/projects and note details. All writes use NoteDocument; SVG assets use a narrowly scoped native command.

**Tech Stack:** Existing React/TypeScript/Tauri/CodeMirror; yaml for lossless frontmatter editing and CodeMirror autocomplete.

**Spec:** docs/superpowers/specs/2026-09-29-note-workflows.md

## Global constraints
- Ctrl+Shift+P is content search; Ctrl+P stays title/tag search.
- Plain Markdown is authoritative; no account/server dependency.
- Existing dialogs autofocus; preserve dark theme and shared fonts.
- No workspace scans or drawing work on the typing path.

## Tasks
- [x] Domain/index: src/knowledge/model.ts, index.ts, properties.ts, library.ts. Test headings/tasks outside fences, Unicode, snippet offsets, conjunctive filters, safe YAML edits, stale mutation and cache reuse.
- [x] Capture/templates: src/knowledge/templates.ts and app-store createContentNote/peekDocument/navigation. Test dates, substitution, daily reopen, custom templates and no overwrite.
- [x] Search/commands: ContentSearchDialog and CommandDialog, wire shortcuts/sidebar, saved search controls. Verify keyboard navigation and filters interactively.
- [x] Linking/editor: editor/completions.ts, NoteDetails, CodeEditor jump API; source and preview completion, backlinks, outline, favorites. Test path qualification and fragment resolution.
- [x] Tasks/properties: TasksDialog, ProjectsDialog, PropertiesFields. Test mutation fidelity and inspect table/board updates.
- [x] Drawing: content-addressed native SVG writer, portability module and drawing-close integration, Markdown fallback suppression. Native test traversal/collision limits and TS round trip tests.
- [x] Integration: typecheck, full frontend/native tests, production builds, preview interaction; document shortcuts, fields and limitations in README/docs.

Validation completed: 78 frontend tests passed (one existing opt-in performance test skipped), 55 native tests passed, TypeScript and strict Clippy passed, and the native release executable built. Browser flows exercised; final drawing export click-through was interrupted when the collaborative preview disconnected. Automated SVG and drawing round-trip tests passed.
