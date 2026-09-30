# GTK 4 / WebKitGTK 6 compatibility experiment — 2026-09-30

The existing React editor, Tauri IPC, Rust services, and Markdown storage remain unchanged. The experiment is isolated on `experiment/gtk4-webkit` in `/home/idan/GitRepo/notes-gtk4-experiment`. The production worktree and its advisory mitigations remain intact.

## Upstream sources

Tested [Tauri PR #14684](https://github.com/tauri-apps/tauri/pull/14684), an unmerged migration of the existing WebKit runtime to GTK 4. This uses Tauri 2 rather than the Tauri 3 CEF alpha.

| Source fork (rmakestrash-jpg) | Pinned revision |
| --- | --- |
| tauri | `402ebddca9c2891594341edc7f5967ed1f6ded54` |
| tao | `dfa8a322eef7f5b8a6a8a9dcbe7924dd3be0cdeb` |
| wry | `7222c92af3c91998ee37e8ee1635fb3830a13c82` |
| muda | `350b9bda3eabd7327e1a2592019cd33e7f559d44` |
| tray-icon | `1d014fd17ceef7eb0d1841c4a62675fa754ee02b` |

Cargo patches reference extracted source snapshots in `~/.cache/notes-gtk4-experiment/upstream/`. Archives came from `https://codeload.github.com/rmakestrash-jpg/<repository>/tar.gz/<revision>`. Original licenses remain in the snapshots. These absolute patch paths are a local test setup, not a portable release configuration.

Resolved GTK 4 bindings are `gtk4 0.10.3`, `glib 0.21.5`, and `webkit6 0.5.0`. The older upstream fork requires Tauri 2.9.5 and tauri-build 2.5.3; the npm API and plugins were aligned with those Rust dependencies. Only dependency manifests, lockfiles, and experiment support files changed.

## Startup corrections and environment

The first native launch crashed in GTK initialization because the dialog plugin's default backend linked GTK 3 alongside GTK 4. Using its supported `xdg-portal` feature with default features disabled removes GTK 3. Production dependencies retain their original configuration.

This machine has GTK 4 but lacks system WebKitGTK 6. An official Arch distribution package, `webkitgtk-6.0-2.52.6-1-x86_64.pkg.tar.zst`, was unpacked under the experiment cache without installing system packages. Download URL: `https://archlinux.cachyos.org/repo/extra/os/x86_64/webkitgtk-6.0-2.52.6-1-x86_64.pkg.tar.zst`.

`scripts/gtk4-env.sh` supplies local pkg-config and library paths. `scripts/run-gtk4-experiment.py` uses Bubblewrap's read-only library overlay to expose WebKit's hardcoded helper executable paths. It gives the app temporary notes and XDG configuration/data/cache directories. It retains the live display, devices, and desktop portal access; it is a runtime compatibility launcher, not a security sandbox.

## Verification

- Frontend: 228 tests pass, one existing opt-in performance test skipped; TypeScript checks pass.
- Native: all 71 tests pass, including the GLib iterator regression.
- Optimized GLib regression: passes.
- Strict Clippy for application targets: passes. Upstream dependency warnings remain visible.
- Frontend and native desktop release builds: pass.
- Live Hyprland/Wayland smoke check: temporary workspace loads, mixed Hebrew/English renders, typing reaches the native file save path, and Ctrl+P opens search with autofocus. Saved Markdown and session settings were inspected on disk; a fresh native launch restored the tab and displayed the saved text.
- Main application source comparison: no changes under `src/` or `src-tauri/src/`.

Logs are `/tmp/notes-gtk4-*.log`; screenshots are `/tmp/notes-gtk4-*.png`. Only temporary workspace files were edited.

Strict `cargo audit --deny warnings` fails with ten advisory findings in the fork's older transitive dependencies: ansi_term, atty (two findings), fxhash, five unic crates, and rand. The original GLib and proc-macro-error findings are absent from the resolved dependency graph. Path source snapshots are not equivalent to audited published releases. This branch is a compatibility candidate, not a production-ready advisory replacement.

No comparative latency or memory benchmark was run. Keeping WebKit avoids introducing Chromium, but this experiment does not establish zero performance cost.

## Run the experiment on this machine

```sh
cd /home/idan/GitRepo/notes-gtk4-experiment
source scripts/gtk4-env.sh
npm run desktop:build
python3 scripts/run-gtk4-experiment.py
```

The launcher prints its disposable data path. Reuse it with `--test-root /tmp/<test-directory>` to check restoration. Use the normal production worktree to run the current app. Cargo release tests may rebuild the binary without Tauri's `custom-protocol` feature; run `npm run desktop:build` after them before testing the packaged app.

Keep the production runtime while the GTK 4 migration and its dependency refresh stabilize. Further validation should cover actual portal folder selection, clipboard integrations, drawing export, packaged distribution, and measured performance.
