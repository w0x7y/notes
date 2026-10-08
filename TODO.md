# TODO

Findings from a full review on 2026-10-07: frontend architecture, native backend, and product/UX. The baseline was healthy at review time: typecheck passed and 238 frontend tests passed, with one opt-in performance test skipped. Original finding line numbers refer to commit `62d9ba0`; completed/partial notes below describe the current implementation.

Effort tags: **S** small, **M** medium, **L** large.

## Progress on 2026-10-08

The first implementation batch is complete. Keyboard/editor fixes, body-only autosave identity, shell subscription isolation, settings recovery, safe filename/move handling, bounded reads/caches, component tests and local/CI validation tooling are implemented. See [verification and remaining limits](docs/backlog-fixes-2026-10-08.md).

- Verification: 302 frontend tests passed, one existing opt-in benchmark skipped; 99 native tests passed. Typecheck, lint, formatting, strict Clippy, vendor integrity and drawing bundle guard passed. The desktop release was rebuilt.
- Native read lock scope is fixed; mutation/drawing/link-walk locks remain. TabBar is extracted; the broader App decomposition remains. Image insertion remains. Conflict recovery and file watching are complete in batch two below.
- Next: native mutation/link-walk lock scope, attachment import, the notice queue and broader App decomposition. Keep upstream dependency work and unmeasured native interactions open.

## Batch two on 2026-10-08

Live native filesystem refresh, safe partial scans, explicit conflict recovery, frontmatter tags/aliases, compatible title display and hidden/excluded destination validation are implemented. Seven more original checklist entries are complete. See [verification and remaining limits](docs/backlog-batch-two-2026-10-08.md).

- Verification: 357 frontend tests passed, one existing opt-in benchmark skipped; 119 native tests passed. Typecheck, lint, formatting, strict Clippy, dependency audit, vendor integrity, optimized GLib regression and drawing bundle guard passed. The corrected desktop release was rebuilt.
- Browser demo checks covered Reload/Cancel/discard, Keep mine, Save a copy, alias search, heading/frontmatter preservation, tab names and recovery controls at 760×520. Actual watcher regressions use temporary native directories; native WebView event-to-render latency remains unmeasured.
- Typed IPC errors remain open; conflict detection now compares revisions instead of matching native error prose. Long mutation/drawing/link-walk locks and persistent indexes remain open.

## Architecture follow-up on 2026-10-08

Both candidates from the architecture review are implemented. See [implementation and verification](docs/architecture-fixes-2026-10-08.md).

- [x] **Deepen Workspace refresh.** One module owns scheduling, registration/relocation freshness, scans, Document delivery, partial retention, entry identity and warnings. Startup/manual/focus/reload/mutation callers share its interface. Templates, Capture and Today use bound post-mutation folder refresh; watcher teardown preserves independently accepted manual work.
- [x] **Deepen native Workspace mutation.** One module owns ordered file/registration work, revision checks, committed-result warnings and latest-state metadata commits. Settings/scans progress during slow file work; incoming rewrites retain published results after directory-sync failure.
- Verification: 387 frontend tests passed with one existing opt-in benchmark skipped; 128 native tests passed. Typecheck, lint, formatting, strict Clippy, vendor integrity, Cargo audit, optimized GLib regression and drawing bundle guard passed. The desktop release was rebuilt; combined review is recorded in the linked report.
- Next: Incoming-link prefiltering/persistent indexing, attachment import, the notice queue and the remaining product/UX backlog. Existing vendor maintenance and unmeasured native interactions remain open.

## Final check on 2026-10-08

Reviewed the complete change against `62d9ba0` and repaired newly confirmed defects. See [per-file coverage and remaining findings](docs/final-check-2026-10-08.md).

- [x] Bound native YAML metadata input and expanded strings; skip unrelated values, preserve source/body tags, and retain limit warnings across cached scans.
- [x] Reject folder moves before commit when source traversal fails or the source overlaps another registered workspace.
- [x] Keep a cleared title editable through saving without losing the body or filename policy.
- [x] Compare Keep mine watcher observations with both the freshly checked revision and the resulting write revision; preserve conflicts for genuinely newer changes.
- [x] Block HTTP images in the renderer/CSP, narrow native permissions, and guard policy drift in CI.
- [x] Document and encode supported Node versions; correct current GTK3 advisory wording while retaining historical reports.
- Verification: 393 frontend tests passed, one existing opt-in benchmark skipped; 134 native tests and six policy tests passed. Typecheck, lint, formatting, strict Clippy, vendor integrity, drawing guard, optimized GLib, desktop release and dependency audits passed. Browser title/image/minimum-size conflict-control checks passed; browser recovery completion was interrupted by disconnection. Existing filesystem races, automatic HTTPS images and the remaining feature backlog stay open.

## Original suggested order

1. Quick wins that hurt most: layout-independent shortcuts, editor context menu, in-note find. See [UX](#ux-and-polish) and [Features](#features).
2. Keystroke-path performance: whole-store subscription in `App.tsx` and the entries rebuild on every autosave.
3. Tooling: ESLint, CI, and component test infrastructure, before larger features.
4. Native robustness: corrupt settings recovery, lock scope, rename link walk, size caps.
5. Larger features: file watcher with a conflict dialog, frontmatter tags and aliases, image paste.

---

## Native backend (`src-tauri`)

### High

- [x] **Corrupt or out-of-range `notes.json` bricks startup.** `src/service.rs:190-198`, `src/lib.rs:228-229, 256`. A parse or `preferences.validate()` failure returns `Err`, setup propagates it, and `.run(...).expect(...)` panics. Fix: rename the file to `notes.json.corrupt-<ts>` and continue with `Stored::default()`. On validation failure, reset only `preferences`. Never fail setup for config problems. **Completed 2026-10-08:** Recovered settings are written only after preserving the original bytes in a uniquely named recovery backup; invalid preferences retain valid registrations, sessions and appearances.
- [ ] **A title-driven auto-rename reads every note in every workspace while holding the settings lock.** `src/service.rs:598-640`, `src/incoming_links.rs:103-136, 184-192`. Autosave on an app-created note whose H1 changed triggers a full-corpus `rewrite_incoming`. Fix: prefilter files whose bytes do not contain the old stem. Longer term, persist a backlink index built during scan. Drop the state lock before the link walk. **Partial, architecture follow-up 2026-10-08:** The link walk now runs outside the settings lock under explicit mutation ordering. Corpus prefiltering and persistent backlink indexing remain open.
- [x] **`Mutex<Stored>` is held across file I/O.** `read_note` (`src/service.rs:534-548`), `read_image` (`984-1024`, up to 20 MB plus base64), `write_drawing_svg` (`374-424`), and the mutations at `591-664`, `665-725`, `871-983`. One slow read freezes every command. Fix: clone the workspace path and `auto_names` flag under the lock, drop the guard, then do I/O. Keep the lock only around config-state transitions. **Partial 2026-10-08:** read_note and read_image now release the lock before I/O; mutation, drawing and incoming-link lock scopes still need work. **Completed, architecture follow-up 2026-10-08:** Workspace mutation owns ordered file work; note/image/drawing operations, path checks, Trash and incoming-link walks run outside the settings lock. The settings lock remains around snapshots and config-state persistence. Barrier tests prove settings/scans progress and latest metadata survives concurrent updates.
- [x] **No size cap on note reads.** `src/pathing.rs:25-29`, `src/service.rs:156-165, 602`, `src/scan_cache.rs:121`. Whole files are read, hashed, and sent over IPC. Fix: add `MAX_NOTE_BYTES` checked via `metadata().len()` and `take(n+1)`, as `read_image` already does. In scan, skip metadata extraction over the cap and use the stem as the title. **Completed 2026-10-08:** 20 MiB descriptor and byte-read bounds now apply to note reads, saves, scans and incoming-link reads. Oversized scan entries use filename metadata.
- [x] **Scan cache has a global 10,000-entry cliff, and non-UTF-8 notes are never cached.** `src/scan_cache.rs:10, 121-123, 142`. Large workspaces re-parse the overflow on every focus refresh, and Latin-1 notes are re-read forever. Fix: make the cap per-root or raise it with LRU eviction. Cache negative results keyed by fingerprint for `InvalidData`. **Completed 2026-10-08:** Replaced admission cutoff with LRU limits of 20,000 entries per root, 40,000 globally and 32 MiB estimated memory. Invalid UTF-8/oversized results cache until fingerprint changes; evicted entries can still reparse.

### Medium

- [x] **One unreadable directory or vanished file aborts the whole scan.** `src/service.rs:463, 487-489`. Fix: skip the entry and return `warnings` on `Snapshot`, as `incoming_links.rs:108-117` already does. Update the zod schema. **Completed 2026-10-08, batch two:** Child traversal, entry metadata and transient note-read failures return warnings and incomplete snapshots; frontend merge retains prior entries and open buffers. Missing, unreadable, symlinked or non-directory roots remain errors.
- [x] **Renames depend on hard links.** `move_without_overwrite`, `src/service.rs:1039-1046`. Hard links fail on FAT, exFAT, and many SMB, NFS, FUSE, and cloud-sync mounts. Fix: use `renameat2(RENAME_NOREPLACE)` via `libc`, falling back to the hard-link path. **Completed 2026-10-08:** Linux uses renameat2(RENAME_NOREPLACE); files fall back safely to hard links on unsupported kernels/filesystems. Unsupported directory fallback returns an error rather than risking replacement.
- [x] **Some config mutations change memory before persisting.** `add_workspace` (`src/service.rs:351-355`), `update_workspace` (`442-446`), `save_sessions` (`318-321`). A failed persist leaves a workspace that vanishes on restart. Fix: use clone-then-swap everywhere through a shared `transact` helper. **Completed 2026-10-08:** add_workspace, update_workspace and save_sessions clone state, persist successfully, then swap.
- [ ] **Mutex poisoning is permanent.** `src/service.rs:226, 234, 266, 289, 314, 330` and others. Fix: use `PoisonError::into_inner`, as `scan_cache.rs:70-73` does, or `parking_lot::Mutex`.
- [ ] **Remote HTTPS images load automatically.** Opening a note can disclose the user's IP and open time to the image host. Gate remote images behind an opt-in preference with a "load remote image" placeholder. **Partially completed 2026-10-08, final check:** Cleartext HTTP images are blocked in the renderer and desktop CSP; HTTPS images still load automatically.
- [ ] **TOCTOU between `resolve()` and open/rename for intermediate directory symlinks.** `src/pathing.rs:46-69`, `src/service.rs:133-155`. `O_NOFOLLOW` only protects the final component. Fix: open the root with `O_DIRECTORY|O_NOFOLLOW` and use `openat`/`renameat`/`linkat`, or `cap-std`. At minimum, re-canonicalize the parent right before `persist`.
- [x] **`clean_filename` truncates by characters, not bytes.** `src/pathing.rs:93`, `src/service.rs:615-625`. 180 Hebrew characters exceed `NAME_MAX`, so every autosave reports "automatic rename failed". Fix: truncate on a char boundary to about 200 bytes, leaving room for the ` N` suffix. **Completed 2026-10-08:** UTF-8 byte boundaries and filename suffix budgets are enforced; long Hebrew title regression passes.
- [ ] **Errors are untyped strings.** All commands in `src/service.rs` and `src/lib.rs`. The frontend matches on prose to detect conflicts. Fix: a serializable `ServiceError` enum with a `code` and a human `message`.
- [ ] **Types are hand-duplicated between serde and zod.** `src/model.rs:16-22` vs `src/domain/contracts.ts:23-29`. `Entry.kind` is a free `String` in Rust but a closed zod enum, so a new kind discards the entire scan. Fix: make `kind` a Rust enum and generate TS types with `ts-rs` or `tauri-specta`.

### Low

- [x] `update_workspace` does not validate `color` and `icon`, unlike `set_entry_appearance`. `src/service.rs:425-448` vs `248-265`. Reuse the validators. **Completed 2026-10-08:** Shared validators now cover workspace and entry appearance.
- [x] Rename and create can target hidden or excluded directories, where entries vanish from the tree. `src/service.rs:682-694, 852-869`. Apply the `workspace_entry` name rule to every new path component, as `move_folder` already does at `889-894`. **Completed 2026-10-08, batch two:** Every destination component is validated for note/folder creation, note/image rename and folder moves; rejected destinations preserve sources.
- [x] The scan cache keys by path but checks root, so overlapping roots thrash. `src/scan_cache.rs:98, 142`. Key by `(root, path)`. **Completed 2026-10-08:** Keys include both root and path; invalidation clears all copies of a file.
- [ ] A crash between temp-file creation and `persist` leaves `.tmpXXXXXX` files in note folders. `src/service.rs:135-149, 410-418`. Clean old temps on startup or scan.
- [x] `move_folder` checks existence then calls `fs::rename`, which can replace an empty directory created in between. `src/service.rs:912-931`. Use `renameat2(RENAME_NOREPLACE)`. **Completed 2026-10-08:** Files and folders now share the atomic no-overwrite move helper.
- [ ] `quick-xml` is duplicated at 0.41 via Tauri and 0.42 direct. Align when possible.
- [x] `core:default` includes unnecessary native APIs. **Completed 2026-10-08, final check:** Replaced it with event listen/unlisten and the existing window-destroy permission; explicitly enabled only the reviewed capability. A CI guard checks permissions and CSP while retaining dialog, clipboard and scoped HTTP(S) link opening.
- [ ] Maintain the local `glib 0.18.5`, `glib-macros` and `gtk3-macros` backports until a compatible upstream stack carries the fixes. GTK3 development has resumed and [RUSTSEC-2024-0415](https://rustsec.org/advisories/RUSTSEC-2024-0415.html) was withdrawn on 2026-09-08; RUSTSEC-2024-0413 concerns `atk`, not `gtk`. See `src-tauri/vendor/README.md`.

### Missing native tests

- [x] Non-UTF-8 notes. **Completed 2026-10-08:** Negative-cache and repaired-file regressions added.
- [x] Per-entry walkdir errors during scan. **Completed 2026-10-08, batch two:** Deterministic traversal/metadata/read failure coverage verifies healthy entries, path-specific warnings, incomplete snapshots and recovery.
- [x] Oversized notes. **Completed 2026-10-08:** Boundaries, read/save rejection, scan fallback and shrinking-file regressions added.
- [x] Corrupt `notes.json`. **Completed 2026-10-08:** Malformed JSON, invalid preference data, preserved metadata/backups and config symlink regressions added.
- [ ] Filesystems without hard-link support.
- [x] Config-write failure in `add_workspace` and `update_workspace`. **Completed 2026-10-08:** Failure-injection tests verify unchanged in-memory settings and successful retry, including save_sessions.

---

## Frontend (`src`)

### High

- [x] **`App` subscribes to the entire store.** `src/App.tsx:162`, `const state = useApp();`. Every store write re-renders the shell, recreates about 20 inline callbacks (`App.tsx:389-481`), and re-renders the unmemoized `Sidebar`, tree rows, and tab bar. Fix: select slices with `useShallow`, `memo` the Sidebar, and hoist entry-action handlers into stable store functions. **Completed 2026-10-08:** Shallow active-workspace slices and stable/memoized sidebar inputs isolate shell rendering; component regressions cover unrelated store updates.
- [x] **Every autosave rebuilds the entries array.** `src/domain/relocation.ts:166-181`. `saved()` always filters and pushes a new array. That triggers `buildFileTree` (`Sidebar.tsx:240-243`), the tag recompute (`Sidebar.tsx:244-250`), and `analysis.synchronize()` over all workspaces (`src/knowledge/index.ts:27-33`), every 600 ms while typing. Fix: short-circuit when path, title, and tags are unchanged, or update the entry in place. **Completed 2026-10-08:** Body-only saves preserve entry/tree identity; path, title and tag changes update metadata. Explicit refresh updates filesystem modification ordering.
- [x] **The domain layer depends on a feature-layer localStorage store.** `src/domain/app-store.ts:1` and `src/domain/relocation.ts:1` import from `src/knowledge/library.ts`, which imports back into domain. Fix: move `library.ts` into `domain/`, or have knowledge subscribe to relocation events. **Completed 2026-10-08:** Moved library.ts to domain and migrated all callers.
- [x] **No component or DOM test infrastructure.** No `jsdom`, `happy-dom`, or `@testing-library/*`, and no `vitest.config.ts`. Fix: add them, with `environment: "jsdom"` for `*.test.tsx`. Start with `NotePane` load and error states, `Dialog` focus, and `CodeEditor` value sync (`CodeEditor.tsx:345-358`). `relocation.ts` also deserves a direct test file. **Completed 2026-10-08:** Node and jsdom projects now cover App, tabs, NotePane, SaveStatus, Dialog, SettingsDialog, CodeEditor and LivePreview; relocation has direct tests.
- [x] **No ESLint, CI, pre-commit hooks, or Prettier config.** Missing: `.github/`, `.husky/`, `eslint.config.*`, `.prettierrc*`, `.editorconfig`, lint-staged config. Fix: ESLint with `typescript-eslint`, `eslint-plugin-react-hooks`, and `no-floating-promises`. A GitHub Actions workflow running typecheck, tests, build, `cargo test`, and strict Clippy. Husky with lint-staged for Prettier and ESLint. **Completed 2026-10-08:** Added lint/format checks, GitHub Actions, EditorConfig and optional Husky/lint-staged setup. Hosted CI has not run yet; equivalent local checks pass.

### Medium

- [ ] **`App.tsx` is a god component.** 13-variant `Modal` union (`src/App.tsx:127-148`), 13 near-identical lazy wrappers (`21-85`), command wiring (`188-255`), entry-kind dispatch repeating `entries.find` (`395-461`), modal host (`648-802`). Fix: extract `ModalHost`, `TabBar`, and `useWorkspaceCommands()`. Add a `lazyNamed` helper. Move entry-kind dialog resolution into the store. **Partial 2026-10-08:** TabBar is extracted and sidebar inputs stabilized. ModalHost, lazyNamed and command-hook extraction remain.
- [x] **Tab bar violates the tablist ARIA contract.** `src/App.tsx:499-556`. Close buttons are invalid tablist children, with no arrow-key navigation and no `aria-controls`/`tabpanel` link. Fix: `role="tab"` on the wrapper, `role="tabpanel"` on the pane, arrow keys, and Delete to close. **Completed 2026-10-08:** Extracted TabBar with linked panels, roving focus, arrows/Home/End/Delete, and save-before-close.
- [ ] **The file tree has no tree semantics.** `src/components/Sidebar.tsx:368-396`. Fix: `role="tree"`, `treeitem`, `group`, `aria-level`, and a roving-tabindex arrow-key handler.
- [x] **The preview re-reads every local image on every block edit.** `src/editor/LivePreview.tsx:62-99`. Fix: cache `readImage` results per workspace, path, and modified time. **Completed 2026-10-08:** Shared reads cache by workspace/path/modified, with a 32 MiB base64-string budget, LRU eviction and retry after errors. Metadata changes reload mounted images.
- [x] **The global keydown listener is re-registered on every modal change.** `src/App.tsx:188-255, 263-272`. Fix: mirror `modal` in a ref and memoize `workspaceCommands` once. **Completed 2026-10-08:** Stable command controller reads committed modal state; availability uses the current render context.
- [ ] **Three full-document string operations per keystroke.** `src/editor/CodeEditor.tsx:270` (`doc.toString()`), `src/components/NotePane.tsx:344` (`withBody`), `CodeEditor.tsx:347` (equality check). Fix: pass a change set or `Text`, keep the body separate from metadata, and compare by version counter.
- [ ] **A single global `notice` string.** `src/domain/app-store.ts:86-87`, rendered at `App.tsx:589-599` as `role="alert"`. Errors overwrite each other, with no severity or auto-dismiss. Fix: a queue of `{ id, level, message }`, with warnings as `role="status"`.
- [x] **`Dialog` has no accessible name.** `src/components/Dialog.tsx:40-62`. Fix: `useId()` with `aria-labelledby` on the dialog and an `id` on the heading. **Completed 2026-10-08:** useId links headings and dialogs; autofocus/dismissal regressions pass.
- [x] **Preview blocks are focusable divs with no role and index keys.** `src/editor/LivePreview.tsx:110, 119, 144-147`. Inserting a paragraph remounts later `DrawingPreview`s. Fix: `role="button"` and keys from `block.from` plus a content hash. **Completed 2026-10-08:** Button semantics, Enter/Space activation, focus backgrounds and exact-content keys preserve later drawings when earlier blocks change.
- [x] **The native adapter skips schema validation for two commands.** `src/platform/native.ts:48` (`saveSessions`) and `:85` (`createFolder`). Fix: route both through `call(..., schema)`. **Completed 2026-10-08:** Both void commands validate null responses; malformed IPC regression cases added.
- [x] **`SaveStatus` loads the document a second time and swallows failures.** `src/components/SaveStatus.tsx:55-66`. Fix: let `NotePane` own the document and pass it down. **Completed 2026-10-08:** NotePane supplies its existing document; read failures are visible alerts. Missing documents render no misleading footer status.

### Low

- [x] `initialize()` is not idempotent. `src/domain/app-store.ts:108-161`, guarded only by `ready` at `App.tsx:257-259`. `ready: true` is set twice (`:150`, `:156`). Keep a module-level in-flight promise. **Completed 2026-10-08:** Overlapping startup calls share an in-flight promise; deliberate subsequent reload remains supported.
- [x] `selectedFolder` reset logic is split across `App.tsx:185, 260-262`, `app-store.ts:347-350`, and `relocation.ts:283-286`. Reset it in store actions and delete the effect. **Completed 2026-10-08:** Workspace transitions reset selection in store actions; removed shell reset effect.
- [ ] Focus outlines are removed globally with `!important` (`src/styles.css:44-46, 399`). `.preview-block` gets no replacement treatment, so keyboard focus there is invisible. Add a `.preview-block:focus-visible` background and audit other custom focusables. Keep outlines off per the user's preference. **Partial 2026-10-08:** Preview blocks and tabs now have background focus treatment. Wider custom-focusable audit remains.
- [ ] Dead or test-only exports: `WorkspaceIcon` (`Sidebar.tsx:35`), `persistNow` (`app-store.ts:92`), `renderMarkdown` (`markdown.ts:78`), `headingSlug` (`knowledge/model.ts:130`), `entrySchema`/`rewriteSchema`/`sessionSchema`/`ImageFile` (`contracts.ts`), `CommandSource`/`WorkspaceCommandTarget` (`workspace-commands.ts`).
- [ ] The demo sandbox ships in the native bundle. `src/platform/index.ts:5` statically imports the 390-line `demo.ts`. Load it dynamically or behind a build flag.
- [x] `CodeEditor` assigns a ref during render. `src/editor/CodeEditor.tsx:175`. Move it into `useLayoutEffect`. **Completed 2026-10-08:** Handler updates now occur after commit in useLayoutEffect.
- [x] `WorkspaceDialog` error lacks `role="alert"`. `src/components/Forms.tsx:135`. **Completed 2026-10-08:** Workspace form errors now have alert semantics.
- [ ] `openExternalLink` silently ignores non-http(s) URLs such as `mailto:`. `src/platform/index.ts:27-28`. Allow a safelist or show a notice.
- [x] `SettingsDialog` re-enumerates installed fonts on every open. `src/components/SettingsDialog.tsx:118-136`. Cache the promise at module level. **Completed 2026-10-08:** Shared promise reuses pending and completed discovery; rejected discovery clears the cache so Retry works.

### Untested modules

Still missing dedicated tests, after the first batch:

- [ ] `src/main.tsx` (App now has component regressions.)
- [ ] `src/components/`: `AppearanceFields`, `BrandMark`, `FileDialogs`, `FontPicker`, `FormattingToolbar`, `Forms`, `ImagePane`, `ItemIcon`, `PopupMenu`, `SearchDialog`, `Sidebar`, `icon-catalog`
- [ ] `src/editor/theme.ts` (CodeEditor and LivePreview now have component regressions.)
- [ ] `src/knowledge/`: `index`, `BundlingPreview`, `CommandDialog`, `ContentSearchDialog`, `GraphCanvas`, `GraphDialog`, `NoteDetails`, `ProjectsDialog`, `PropertiesFields`, `TasksDialog`, `TemplateDialog`, `WorkspaceTools`
- [ ] `src/drawing/`: `controller.ts` (507 lines), `DrawingDialog`, `DrawingPreview`
- [ ] `src/platform/index.ts` (native.ts and image-cache.ts now have dedicated regressions.)
- [ ] `src/theme/ThemePicker.tsx`

Covered only indirectly: `domain/library.ts`, `platform/demo.ts`, `knowledge/properties.ts`, `knowledge/template-format.ts`, `drawing/{model,storage,render,preview-link}.ts`, `domain/contracts.ts`.

---

## UX and polish

- [x] **Shortcuts break under the Hebrew keyboard layout. (S)** `src/domain/workspace-commands.ts:207` matches `event.key.toLowerCase()`, so Ctrl+P arrives as Ctrl+פ. Nothing in `src/` uses `event.code`. CodeMirror bindings still work, so behavior is inconsistent. Fix: match on `event.code` with an `event.key` fallback, and add tests. **Completed 2026-10-08:** Physical key codes, legacy key fallback, modifier and composition guards; Hebrew-layout regression tests and a browser event check pass.
- [x] **Right-click is suppressed everywhere, including the editor. (S)** `src/App.tsx:378`. This removes the native cut/copy/paste menu and spell-check suggestions. Fix: scope `preventDefault` to the sidebar and tabs. **Completed 2026-10-08:** Removed shell-wide suppression; sidebar custom menus still handle their own events. Native editing menu is available to the editor.
- [x] **External changes are mislabeled as "Save failed". (M)** `receiveExternal` in `src/domain/document.ts` sets `failed`, and `SaveStatus.tsx` offers Retry, which then fails on the stale revision. Fix: a distinct "Changed on disk" state with Reload, Keep mine, and Save a copy. **Completed 2026-10-08, batch two:** Changed on disk pauses autosave and offers confirmed Reload, fresh-revision Keep mine and durable Save a copy, with recovery/edit/save race coverage.
- [ ] **Silent refusals.** Image paste and drop are swallowed in `CodeEditor.tsx` with no message. Ctrl+W with no focused note does nothing. Show a notice in each case. **Partial 2026-10-08:** Unsupported image paste and file drop now show explanatory notices. Ctrl+W without a focused note still needs feedback.
- [ ] **Shortcut documentation drift. (S)** Settings → Shortcuts in `SettingsDialog.tsx` lists 9 entries and omits Ctrl+K, Ctrl+Shift+P, Ctrl+Shift+N, and Ctrl+Shift+D. Neither surface documents Enter to edit a preview block, Escape-then-Tab to leave the editor, Ctrl+Y, the `/` and `[[` triggers, or drawing keys. **Partial 2026-10-08:** App shortcut help is generated from the registry and includes search, completion and preview controls. Drawing shortcut documentation remains.
- [ ] **Slash commands and `[[` completion are undiscoverable. (S)** The slash menu fires only at line start (`src/editor/completions.ts`). Add an editor `placeholder()` hint and a first-run tip. **Partial 2026-10-08:** Editor placeholder and shortcut help describe both triggers; a dedicated first-run tip remains.
- [ ] **Thin keyboard coverage. (S)** No shortcuts for Edit/Read toggle, note details, pin, formatting toolbar, graph, tasks, Ctrl+1 to 9 tab jump, or focusing the file tree.
- [x] **Title model clashes with Obsidian conventions. (M)** `splitNote` in `src/domain/notes.ts` treats only a leading H1 as the title. Most Obsidian notes have no H1, so they show an empty Untitled field. Native `first_h1` in `src-tauri/src/markdown.rs` finds the first H1 anywhere, so sidebar and editor titles can disagree. **Completed 2026-10-08, batch two:** Native and editor display use first body H1 or filename fallback. Loading/body edits preserve source bytes and later heading positions; explicit title editing changes or adds the H1.
- [ ] **Hebrew names truncate from the wrong end in the sidebar. (S)** `.tree-row span` uses an ellipsis inside an LTR block, around `src/styles.css:165`. Search result paths with Hebrew folders reorder slashes visually.
- [x] **Welcome copy over-promises.** `App.tsx` says "Existing Obsidian folders work too." Qualify it until frontmatter tags, callouts, and note embeds land. **Completed 2026-10-08:** Welcome explicitly describes Markdown compatibility and unsupported plugin features/syntax.
- [ ] **Read mode and long notes. (M)** `LivePreview.tsx` renders all blocks eagerly with no virtualization. Edit and Read share one `scrollTop` in `NotePane.tsx`, so toggling loses position. Following a heading link in Read mode forces Edit mode.
- [ ] **Search behavior. (M)** Title search is per-character subsequence fuzzy (`src/domain/search.ts` `fuzzyScore`), which is noisy on short Hebrew titles. Folder names are not searchable. Content search footer says "current workspace first" regardless of the preference. There is no "create note from query".
- [ ] **Static status bar.** "Local files · UTF-8 · Markdown · Auto direction" at 10px. See the word-count feature below.
- [ ] **Drag-and-drop affordances. (S)** Nothing signals that rows are draggable. Collapsed folders do not expand on hover. Dropping on the Files heading to move to root is hidden.
- [ ] **Verify Ctrl+Tab and Ctrl+W in the native WebKitGTK window.** Tab cycling was verified only in the browser demo.

---

## Features

Ranked by value to the target user: a student and developer leaving Obsidian, with hundreds of mixed Hebrew/English notes, keyboard-first.

### Top 10

- [x] **1. Layout-independent shortcuts. (S)** See UX above. Files: `src/domain/workspace-commands.ts`, `src/App.tsx`, its test, README. **Completed 2026-10-08:** Implemented; see UX above.
- [x] **2. In-note find and replace, select next occurrence, selection match highlight. (S)** `@codemirror/search` is not installed. Files: `package.json`, `src/editor/CodeEditor.tsx`, Settings shortcuts, README. **Completed 2026-10-08:** CodeMirror search, replacement, selection matching and next-occurrence selection are installed and tested, including Hebrew replacement and undo.
- [x] **3. Frontmatter `tags:` and `aliases:`. (M)** Tags are deliberately stripped by `body_without_frontmatter` in `src-tauri/src/markdown.rs:139` and `extractTags` in `src/domain/notes.ts`. Aliases should feed link resolution and `[[` completion. Files: `markdown.rs`, `service.rs` scan, `notes.ts`, `links.ts`, `completions.ts`, `knowledge/model.ts`, `docs/native-contract.md`. **Completed 2026-10-08, batch two:** String/list YAML tags and aliases support Hebrew/NFC metadata, search, links, explicit-path completion, backlinks and graph edges; duplicate aliases remain ambiguous and extraction preserves source.
- [x] **4. Native file watcher with an honest conflict dialog. (L)** No `notify` crate. Replaces focus-only refresh and fixes the mislabeled failure state. Files: `Cargo.toml`, `lib.rs`, `service.rs`, `app-store.ts`, `document.ts`, `SaveStatus.tsx`. **Completed 2026-10-08, batch two:** Debounced native watching, bounded queues, excluded/symlink filtering, registration catch-up/generations, replacement identity tracking and frontend coalescing are implemented. Actual filesystem regressions and recovery UI checks pass; manual/focus refresh remain fallbacks.
- [ ] **5. Quick switcher upgrades. (M)** Recent files on an empty query, "Create 'query'" when nothing matches, folder-path matching. Persist the recent list in the workspace session. Files: `SearchDialog.tsx`, `search.ts`, `app-store.ts`, `workspace-session.ts`, `src-tauri/src/model.rs`.
- [ ] **6. Editor context menu and image paste into an assets folder. (M)** Needs a native `write_image` command. Files: `App.tsx`, `CodeEditor.tsx`, `lib.rs`, `service.rs`, `src/platform/*.ts`, `docs/native-contract.md`. **Partial 2026-10-08:** Native editor context menu restored. Asset import and image paste remain.
- [ ] **7. Callouts, footnotes, and heading folding. (M)** `> [!note]` renders as a plain blockquote. No `markdown-it-footnote`. No `foldGutter`/`foldKeymap`. Files: `markdown.ts`, `styles.css`, `CodeEditor.tsx`, `package.json`.
- [ ] **8. Keyboard coverage and Reveal in file manager. (S)** Ctrl+E edit/read, Ctrl+Shift+O details, Ctrl+1 to 9 tabs, pin. Reveal via the opener plugin's `revealItemInDir`. Files: `workspace-commands.ts`, `App.tsx`, `NotePane.tsx`, `Sidebar.tsx`, `capabilities/default.json`.
- [ ] **9. Status bar counts and a notice queue. (S)** Word and character count, cursor line, dismissable notices with severity. Files: `App.tsx`, `CodeEditor.tsx` (`onSelection` already fires), `app-store.ts`, `styles.css`.
- [ ] **10. Configurable daily-note location and template date formats. (M)** Daily notes are hard-coded to `Quick Notes/Daily/YYYY-MM-DD.md` in `src/knowledge/templates.ts`. Templates support only `{{title}}`, `{{date}}`, `{{time}}`. Add `{{date:FORMAT}}`. Files: `templates.ts`, `template-format.ts`, `preferences.ts`, `SettingsDialog.tsx`, `model.rs`.

### More gaps vs. Obsidian

- [ ] Note embeds `![[note]]`. Today `![[x]]` is always treated as an image and shows "Image not found". Block references `^id` are absent.
- [x] Multi-cursor. No `allowMultipleSelections`, `rectangularSelection`, or `drawSelection`. **Completed 2026-10-08:** Enabled multiple selections, rectangularSelection and drawSelection; multi-selection edit regression passes.
- [ ] Recent files list and random note.
- [ ] Tag pane with counts and nested `a/b` tags. Today it is a flat list in `Sidebar.tsx`.
- [ ] Mermaid diagrams.
- [ ] Table editor with Tab cell navigation and column alignment. Today it inserts a 2x2 skeleton.
- [ ] Spell-check language selection. Only a boolean today, and `index.html` is `lang="en"`.
- [ ] Zen or focus mode that hides tabs, status bar, and document bar, plus fullscreen.
- [ ] Open in external editor.
- [ ] Bookmarks for headings, searches, and folders. Pins and saved searches live in `localStorage` in `src/knowledge/library.ts` and are lost if site data is cleared. Consider moving them to `notes.json`.
- [ ] Outline drag to reorder sections in `NoteDetails.tsx`.
- [ ] Light theme. All six palettes in `src/theme/themes.ts` are dark.
- [ ] Per-workspace settings.
- [ ] Export to HTML or PDF, and print CSS.
- [ ] In-app trash restore.
- [ ] Version history or git integration.
- [ ] Crash recovery journal for unsaved text. Documented limit in README.
- [ ] Global quick-capture hotkey and system tray via `tauri-plugin-global-shortcut`.
- [ ] Vim mode. Documented as later in PRODUCT.md.
- [ ] Installer packaging. `tauri.conf.json` already targets `deb` and `appimage`, but `desktop:build` passes `--no-bundle`. Add a separate bundle script.
- [ ] Auto-update.
- [ ] Out of scope for v1 unless priorities change: plugin API, encryption, sync, mobile, Windows/macOS (`fonts.rs:78-81` errors off Linux and `scan_cache.rs:24-27` disables caching off Unix), UI i18n, RTL chrome mirroring.

### Missing backend capabilities

- [ ] Persistent backlink and full-text index. Links are rediscovered by reading every note on each rename.
- [ ] File history or backups before overwrite.
- [ ] Image and attachment import command.
- [ ] Sync conflict-file handling, such as Syncthing `.sync-conflict` files.
- [ ] Progress events and cancellation for long operations: scan, folder move, link rewrite.

---

## Documented limits carried over from README and reports

- [ ] Link rewriting skips reference-style destinations, escaped paths, and outgoing relative links inside the moved note. `docs/native-report.md:17`.
- [ ] External writers can race a save between revision check and atomic replace. `docs/native-report.md:17`.
- [ ] Some optional Vite chunks still exceed the size warning.
- [ ] End-to-end native typing latency has never been measured. `docs/performance.md`.
- [ ] Physical pointer dragging and native-webview frame performance in the graph were not measured. `docs/superpowers/plans/2026-09-30-note-graph.md`.
- [ ] Two informational RustSec advisories remain in the GTK3 stack: RUSTSEC-2024-0429 (glib, backported locally) and RUSTSEC-2024-0370 (proc-macro-error, replaced). The three local patches need maintenance until Tauri moves off GTK3. `src-tauri/vendor/README.md`.

There are no TODO, FIXME, or HACK comments in the project's own code. The only hits are upstream comments inside `src-tauri/vendor/`.
