# Final check, 2026-09-30

Reviewed the complete working-tree feature against **`570b7c5`** (the starting HEAD), including all relevant untracked files. Scope includes six themes and the Graphite + amber identity, active-tab/workspace feedback, and session/command/document-lifetime changes. Repairs remain unstaged; the index was empty and remains unchanged. No personal workspace was used for tests.

## Confirmed findings and repairs

| Finding | Impact and repair | Verification |
| --- | --- | --- |
| Special native files could block reads | A Markdown/SVG named pipe could stall a read while holding the service mutex, or stall indexing. Central descriptor-based regular-file reads use nonblocking/no-follow opens on Unix. Scans skip special files. Image reads also cap actual bytes at 20 MB. Settings, incoming links, cache and existing drawing assets share the safe reader. | Before repair, each bounded note/image/scan probe stalled and was killed. Afterward all complete, legitimate notes/images still read, and settings remain available. Temporary-file tests cover image limits and directories. |
| Drawing export escaped document lifetime | Shutdown could finish while SVG export was pending, before its Markdown link and note save. The entire export/edit/flush workflow is now admitted; the dialog stays busy and cannot close during export. | Deferred-export domain regression plus the actual Drawing dialog: shutdown stayed pending until release, then the source and preview link were saved and the dialog closed. |
| Late refresh survived workspace removal | A completed scan followed by a delayed note read could restore removed entries or mutate a retired buffer; same-ID reopening could join an obsolete refresh. Refreshes now check a workspace registration token and exact document registration, and coalesce only within the same registration. | Four new refresh/removal/disposal/reopen regressions failed before repair and passed afterward. |
| Split-pane property fields collapsed | At 760×520 with a split and sidebar, the old details panel left 16px fields, all padding/border. Details now overlay their own writing pane at widths ≤650px, with usable fields and an accessible close control. | Running UI: 284.5px pane, 272px panel, 164px fields, no horizontal overflow. Wide panes retain the regular 272px companion and 174px fields. Closing restores the writing area. |
| Adapted editor theme lacked attribution | The new theme retained adapted CodeMirror One Dark syntax/style rules without its MIT notice. Restored upstream attribution and included the newly direct Lezer dependency notice. | Compared upstream/installed licenses; rebuilt frontend includes the exact notice file. |

Updated maintained workflow, drawing, native-contract and design documentation. Corrected stale details-button and graph-color wording. Removed the obsolete FIFO-based concurrency fixture, preserving its valid stalled-scan assertion through a bounded, one-shot, per-cache pause compiled only for tests. A mutation holding the settings lock across scanning makes that regression fail. No additional dead code or unused dependency removal was justified by the inspected callers; the feature already removes the old theme package and migrates its callers.

## Remaining dependency findings

1. **Informational unsoundness: `glib 0.18.5`.** RustSec identifies unsafe iterator behavior in `VariantStrIter`, patched in ≥0.20. GTK 0.18.2 requires glib 0.18. No direct application use of that iterator or demonstrated application exploit was found; this does not prove the dependency is unreachable. Next action: adopt an upstream Tauri/GTK migration when compatible. [RustSec RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
2. **Informational maintenance: `proc-macro-error 1.0.4`.** Inherited through GTK/glib macros; RustSec lists no patched version. Next action: track upstream macro/dependency replacement. [RustSec RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html).

[Tauri tracks both advisories](https://raw.githubusercontent.com/tauri-apps/tauri/dev/.cargo/audit.toml), including the GTK4 requirement for the glib update. Compatible updates cannot replace the required glib/macro version ranges; adding newer direct crates would leave the affected transitive copies. No forced dependency migration was performed.

## Verification and limits

- `npm test`: **228 passed, one existing opt-in performance test skipped**.
- `npm run typecheck`: passed, with strict unused-local/parameter checks.
- `npm ls --depth=0` and Prettier checks over frontend source/configuration: passed.
- `cargo test`: **70 passed** (3 unit, 67 integration), using temporary workspaces/configuration.
- `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check`: passed.
- `npm run desktop:build`: passed; release executable rebuilt at `src-tauri/target/release/notes`.
- `node scripts/check-drawing-bundle.mjs`: passed. Drawing editor stays lazy; additional payload is 28,985 bytes (12,284 gzip), below the existing 60 KB guard. These are bundle sizes, not typing-latency measurements.
- `npm audit --json`: zero reported vulnerabilities across 223 dependencies.
- Current RustSec database `9b3a3b7` (2026-09-30), custom semver matching: 75 applicable installed-version/advisory pairs checked; the two informational matches above, no vulnerability-category matches. `cargo-audit` and `cargo-deny` are unavailable. This substitutes advisory matching, not a full reachability audit.
- Redacted credential/private-key pattern scan of tracked and untracked source: zero matches. `gitleaks` is unavailable; history and external credentials were not audited.
- Browser demo: all six themes saved through settings while preserving the mounted editor and text; preview stayed local before saving. Active-tab underline has 12px side margins; the open workspace switcher reports expansion and selected background. Narrow/wide details and deferred drawing shutdown checks passed. Synthetic raw HTML, script, event-handler aliases and JavaScript links produced no unsafe rendered elements or executed marker while legitimate content rendered.
- Native source review covered IPC, registered-root/path/symlink checks, atomic writes, revision conflicts, SVG validation, regular files, read bounds, permissions/CSP and config. Frontend review covered Markdown/HTML sanitization, link opening, YAML/JSON validation, local persistence and lazy module boundaries. This local application has no application authentication, hosted API, CI or deployment configuration in the inspected repository.
- Generated native icon matches the SVG source pixel-for-pixel; notices match the rebuilt output. Staged/unstaged diff whitespace checks and untracked-text whitespace checks passed.
- Browser checks use temporary demo data and do not establish native interaction behavior. Native file behavior is covered by Rust tests; this pass did not repeat the historical physical-input desktop smoke test. No live exploitation, source upload, production operation or end-to-end typing benchmark was performed. Findings describe inspected scope, not a security guarantee.

## Coverage inventory

Every changed/new item is accounted for below. Source and callers were read; generated artifacts were checked against source/build output. Earlier review counts and plans remain historical evidence.

| Path | Status | Coverage |
| --- | --- | --- |
| `.impeccable/design.json` | Reviewed | Documentation/configuration: current behavior, history and links |
| `CONTEXT.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `DESIGN.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `PRODUCT.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `README.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/drawings.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/final-check-2026-09-30.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/native-contract.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/note-workflows.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/superpowers/plans/2026-09-30-notes-identity-and-themes.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/superpowers/plans/2026-09-30-session-command-lifetime.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `docs/superpowers/specs/2026-09-30-session-command-lifetime.md` | Reviewed | Documentation/configuration: current behavior, history and links |
| `index.html` | Reviewed | Static identity, asset references and frontend build |
| `package-lock.json` | Reviewed | Dependency callers, lockfile diff, npm audit and build |
| `package.json` | Reviewed | Dependency callers, lockfile diff, npm audit and build |
| `public/THIRD_PARTY_NOTICES.txt` | Reviewed | Upstream license comparison; built notice matches source |
| `public/notes-mark.svg` | Reviewed | Static identity, asset references and frontend build |
| `src-tauri/icons/icon.png` | Reviewed | Generated icon: SVG source, pixel comparison, desktop build |
| `src-tauri/src/incoming_links.rs` | Reviewed | Native contracts, file safety and regressions |
| `src-tauri/src/model.rs` | Reviewed | Native contracts, file safety and regressions |
| `src-tauri/src/pathing.rs` | Reviewed | Native contracts, file safety and regressions |
| `src-tauri/src/scan_cache.rs` | Reviewed | Native contracts, file safety and regressions |
| `src-tauri/src/service.rs` | Reviewed | Native contracts, file safety and regressions |
| `src-tauri/tests/service.rs` | Reviewed | Native contracts, file safety and regressions |
| `src/App.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/chrome.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/BrandMark.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/NotePane.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/SearchDialog.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/SettingsDialog.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/Sidebar.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/appearance.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/components/settings.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/domain/app-store.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/document-lifetime.test.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/document-lifetime.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/document.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/file-actions.test.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/preferences.test.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/preferences.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/relocation.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/workspace-commands.test.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/workspace-commands.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/workspace-session.test.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/domain/workspace-session.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/drawing/DrawingDialog.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/drawing/controller.ts` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/drawing/drawing.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/drawing/render.ts` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/editor/CodeEditor.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/editor/LivePreview.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/editor/theme.ts` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/CommandDialog.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/NoteDetails.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/WorkspaceTools.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/graph.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/knowledge.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/note-details.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/knowledge/templates.ts` | Reviewed | Domain transitions, async lifetime and regressions |
| `src/knowledge/workspace-views.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/main.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/styles.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/theme/ThemePicker.tsx` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/theme/themes.css` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/theme/themes.test.ts` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
| `src/theme/themes.ts` | Reviewed | UI, editor, theme and drawing source/callers; tests/browser checks |
