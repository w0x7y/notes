# Settings and performance

Scope: folders start collapsed on every workspace entry; persistent global settings for existing capabilities; measured performance improvements without weakening saving, conflict detection, Markdown behavior, or mixed Hebrew/English input.

Preferences contract is authoritative in src/domain/preferences.ts. Settings adds `preferences` with defaults for old configurations. New IPC `save_preferences({preferences}) -> Preferences`, validating numeric ranges/enums, atomic persist before state replacement. Native serde uses camelCase keys and default fields. Rust enum values match strings in TypeScript. App settings accessible via sidebar footer and Ctrl+,; themed dialog, categories Editor/Saving/Search/Workspace/Shortcuts, reset and explicit Save. Apply after successful persistence. Autosave remains enabled.

Ownership:
- Native worker: src-tauri only, preferences persistence + measured unchanged-workspace scan cache; temporary-fixture benchmark and tests. Keep mutation/revision/path safety.
- Editor worker: CodeEditor, LivePreview, NotePane and editor markdown/tests only. Wire preferences, preserve editor instance/undo on changes, reduce parsing/render work with baselines and regression tests.
- Main: preference schema/adapters/state, settings UI, collapsed/indexed sidebar, cached search, startup icon/form splitting, closed clean-document eviction, startup/focus/session work, reproducible benchmarks and integration.
- Independent final review of all changes and a release build.

Baseline Node v26: search 500 median 0.0723ms/p95 0.1123ms; search 5000 median 0.7001ms/p95 0.9414ms. Initial JS entry 847,192 bytes / gzip 271,179 bytes. Tree and long-note baselines recorded by scripts/performance.mjs before edits.

## Completion

The settings dialog exposes all sixteen preferences and shortcut reference; save failures preserve previous preferences, and reset changes remain a draft until saved. Folders start collapsed on every workspace entry. Performance results and reproduction commands are in docs/performance.md.

Review found a scan-wide cache lock that could delay saves after revision checking. It was replaced with short map-only locks, with filesystem reads/parsing outside the lock. A deterministic blocked-scan regression covers saves and unrelated workspace scans. Scoped re-review passed.

43 frontend tests and 49 Rust tests pass. TypeScript, Clippy, formatting, and the desktop release build pass. Browser checks cover settings changes/reset, autofocus, local search scope, collapsed folders after switching workspaces, and preview editing. The initial JavaScript entry is 47% smaller; this is code splitting, not a reduction of the same percentage in total application code.
