# Workspace session, command and Document lifetime implementation plan

> **For agentic workers:** Use test-first implementation and independent review for each module, then an integration review. Execute the approved scope in this session.

**Goal:** Implement all three approved deepening candidates while preserving existing file and editing guarantees.

**Architecture:** A pure workspace session module hides transitions. A workspace command module owns definitions and dispatch while input adapters preserve lazy presentation. A Document lifetime module owns private registries and retirement coordination, preserving the existing Document saves and relocation implementation.

**Tech Stack:** React, TypeScript, Zustand, CodeMirror, Tauri/Rust, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-session-command-lifetime.md`.

## Constraints and ownership

No feature changes beyond eliminating inconsistent transitions and race conditions. Preserve all existing UI/theme changes, native file interface, save/conflict queues, lazy optional features and Hebrew/English direction. Implement in the current working tree; do not commit unrelated changes. Separate file ownership across parallel work.

### Task 1: Workspace session module

Create `src/domain/workspace-session.ts` and `workspace-session.test.ts`. Implement `emptySession()`, `sessionFocusedPath(session, focusedPane)` and `transitionSession(session, focusedPane, action)` returning `{session, focusedPane}`. Actions are discriminated `open`, `open-split`, `close`, `toggle-split`, `focus`, `cycle`, and `remap`. Do not edit app-store or App during this task.

- [x] Observe failing tests for single/split transitions, visible-note focus, close fallback, cycle wrap, invalid focus and remapping.
- [x] Implement the pure transition interface without mutating caller state or introducing an adapter.
- [x] Run focused tests and review transition invariants. Delete caller transition knowledge during integration.

Example public outcome assertion:

```ts
const view = transitionSession(emptySession(), "primary", {kind: "open", path: "One.md"});
expect(view.session.primary).toBe("One.md");
expect(view.session.tabs).toEqual(["One.md"]);
expect(view.focusedPane).toBe("primary");
```

### Task 2: Workspace command module and input adapters

Create `src/domain/workspace-commands.ts` and its tests. Modify `src/App.tsx`, `src/knowledge/CommandDialog.tsx`, `src/knowledge/WorkspaceTools.tsx` and `src/components/Sidebar.tsx` only as needed. App uses store operations `toggleSplit()`, `openInSplit(id,path)`, `cycleTab(backward?)`, `focusPane(pane)` plus existing file operations and `sessionFocusedPath`.

- [x] Observe failing tests for availability, equivalent input outcomes, busy/drawing/modal suppression, and sync/async error reporting.
- [x] Implement one command definition/dispatch policy without loading optional dialog modules eagerly.
- [x] Migrate keyboard, palette, workspace tools and Capture/Today through shared decisions; remove old dispatch duplication and direct session/focus transformations.
- [x] Run focused tests and typecheck once integration exports exist.

### Task 3: Document lifetime and store integration

Create `src/domain/document-lifetime.ts` and tests; modify `src/domain/app-store.ts`, `src/domain/relocation.ts`, `src/domain/file-actions.test.ts`, and Document/editor files only if retirement safety requires it. Consume Task 1's transition interface and publish the four store operations named in Task 2.

- [x] Characterize and reproduce concurrent load/creation/removal races with deferred operations and the real demo adapter.
- [x] Privatize loaded/pending registries and centralize coalescing, registration, remapping, held saves, retirement and draining. Ensure admissions and accepted work are ordered; never discard unsaved text.
- [x] Integrate session transitions into store open/close/split/focus/cycle and relocation mapping. Remove exported `changeSession` and map forwarding helpers.
- [x] Preserve failed save/removal, recovery copy, relocation and reopening outcomes; run covering tests and typecheck.

### Task 4: Integration, review and verification

- [x] Review all three tasks against the spec, fix material findings, and remove obsolete callers/state/tests.
- [x] Run `npm test`, `npm run typecheck`, `git diff --check` and `npm run desktop:build`. Run native tests/strict Clippy for native changes.
- [x] Verify actual UI: split/cycle/open/close, keyboard/palette/tool equivalence, Capture/Today, busy/drawing restrictions, themes and mixed paragraph direction.
- [x] Update README/current workflow documentation and record final evidence here.

## Decisions

The user's instruction to implement all candidates authorizes proceeding with the report's scope and existing product contracts. No additional feature preference is required. Native/demo adapters remain; no speculative plugin or shortcut infrastructure.

## Final evidence — 2026-09-30

All three modules are implemented and migrated. Independent reviews reproduced and fixed pending load/close publication, Capture shutdown, property/drawing draft, stale rename, pane/navigation and concurrent disposal defects. Retirement preserves failed buffers and registration; bound multi-step workflows retain admission through removal.

Fresh final checks: 223 frontend tests passed, one existing opt-in skip; TypeScript and diff checks passed. All 68 native tests and strict Clippy passed. The desktop release rebuilt successfully at `src-tauri/target/release/notes`. No commits were made.

Running browser demo checks covered property drafts with keyboard/middle close and reopen, palette autofocus/split, tab cycling, lone secondary promotion, sidebar/Tools/keyboard Today, Capture, busy and drawing suppression, drawing text committed by Save, and failure restoring title/source editing while retaining the tab. Graphite + amber remains the default; Hebrew lines retain automatic direction; active underline keeps 12px side margins. Browser demo checks do not prove native file operations.

Verification logs are in `/tmp/notes-architecture-tests-final.log`, `/tmp/notes-architecture-typecheck-final.log`, `/tmp/notes-architecture-native-tests.log`, `/tmp/notes-architecture-clippy.log`, and `/tmp/notes-architecture-build-final.log`. UI screenshot: `/home/idan/.t3/userdata/browser-artifacts/browser-screenshot-localhost-munvnyg4-71aed38a.png`.
