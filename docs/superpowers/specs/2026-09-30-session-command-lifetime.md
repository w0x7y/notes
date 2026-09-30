# Workspace session, command and Document lifetime deepening

User-approved scope: implement all three candidates from the architecture report at `/tmp/architecture-review-20260930-111129.html`.

Workspace session transitions own tab membership, primary/secondary placement, focused-pane validity, split toggling, opening beside a note, cycling, closure fallback and relocation path mapping. Callers express intent rather than constructing sessions or independently writing focus. Preserve keyboard shortcuts and workspace-specific persistence; opening an already-visible note focuses its existing pane. Closing must save first and retain its tab after failed saves.

Workspace command decisions have one definition and dispatch policy across keyboard, palette and sidebar tools. Preserve presentation, shortcut behavior, dialog autofocus, lazy loading, drawing-specific restrictions and busy-dialog protection. Input adapters translate events; presentation does not duplicate availability or execution decisions. Palette invocation may close its own dialog before dispatch. Synchronous and asynchronous errors must reach the existing notice flow. No plugin registry or configurable shortcuts.

Document lifetime owns private loaded/pending registries, load coalescing, registration, remapping, release eligibility and operation completion. Close, deletion, recovery, workspace removal and app shutdown use this ownership. Keep NoteDocument's save queue and Relocations' reconciliation depth. Accepted loads and creations cannot republish retired state. Failed saves retain buffers and workspace registration. Never discard accepted newer edits during retirement. Workspace removal only unregisters files. The native/demo file interface remains unchanged unless verification proves a concrete need.

Preserve compact six-theme UI, Graphite + amber default, no focus outlines, custom appearances, mixed paragraph direction, collapsed folders, lazy editors/analysis, Markdown source of truth, revision checks and atomic writes. Keep existing uncommitted UI work. No commits or publication are required.

Add tests at the new interfaces and preserve existing outcome regressions. Verify fresh typecheck/frontend tests, native tests/strict Clippy if native code changes, a rebuilt desktop release, and running UI keyboard/palette/sidebar, session, save/reopen and busy/drawing behavior.
