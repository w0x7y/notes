# Performance measurements

## Architecture follow-up on 2026-10-08

Workspace refresh now owns coalescing, invalidation scheduling and fresh post-mutation scans behind one interface, preserving unchanged entry objects and arrays. Native Workspace mutation uses separate file ordering and settings access; deterministic tests show settings updates and scans finishing while actual save/rename/Trash work is paused, and metadata commits preserving those updates. File mutations still serialize across registered roots because Incoming links can rewrite other workspaces. Config persistence still holds the settings mutex, and incoming-link discovery still reads the corpus. These are structural regression guarantees, not measured end-to-end speed or native latency improvements. See [implementation verification](architecture-fixes-2026-10-08.md).

The rebuilt production bundle guard measured startup JavaScript at 617,728 bytes (202,766 gzip), note editor dependencies at 1,244,368 bytes (421,814 gzip), and note preview dependencies at 1,699,413 bytes (567,841 gzip). Drawing editor loading adds 29,026 bytes (12,302 gzip). These are current build sizes; this refactor does not claim a bundle-size reduction.

## Backlog batch two on 2026-10-08

Alias changes participate in metadata identity checks; saves that leave path, title, tags and aliases unchanged still preserve the entries array. Metadata title extraction stops at the first body H1. Native watching uses a bounded 1,024-event queue, 250 ms quiet debounce with a one-second burst limit, and watches only visible directories without following symlinks. Frontend refresh requests coalesce per workspace and retain a follow-up event received during a scan. These are structural checks, not native typing-latency measurements.

A local search/tree sanity run measured title/alias/tag search at 0.054 ms median / 0.135 ms p95 for 500 notes and 0.270 / 0.484 ms for 5,000 notes. Tree preparation measured 0.135 / 0.145 ms and 1.681 / 2.546 ms respectively. Splitting a 1 MB note measured 0.025 / 0.038 ms. These runs use the existing fixtures, which do not contain populated alias lists; alias semantics have separate regression tests. A separate graph run after desktop compilation completed measured 4.130 ms median / 5.559 ms p95 for 500 notes and 36.385 / 39.971 ms for 5,000 notes. Concurrent compilation produced much noisier earlier graph timings. These are fresh sanity measurements, not a before/after graph speed comparison.

The production drawing bundle guard measured startup JavaScript at 615,931 bytes (202,311 gzip), note editor dependencies at 1,242,571 bytes (421,359 gzip), and note preview dependencies at 1,697,616 bytes (567,388 gzip). Drawing editor loading adds 29,026 bytes (12,305 gzip). These are current bundle measurements; the earlier 47% entry reduction below describes its historical build.

Watch-triggered refresh still scans filesystem fingerprints and rereads open documents. Native watch limits, event delivery on network/cloud mounts, large-directory watch reconciliation and end-to-end typing latency remain unmeasured. Explicit refreshes can update modification metadata even when body-only saves preserved entry identity.

## Backlog fixes on 2026-10-08

Body-only autosaves now preserve the entries array when path, title and tags are unchanged. This avoids triggering file-tree preparation and workspace analysis synchronization through metadata updates. Live document content subscriptions still update analysis. Explicit refresh updates filesystem timestamps and recent-modification ordering. App subscribes to shallow active-workspace slices, and component tests verify that unrelated navigation/background-workspace updates do not rerender the shell. These are structural regression checks, not measured typing-latency improvements.

Local sanity measurements from `node scripts/performance.mjs` and `node scripts/graph-performance.mjs`:

| Workload                                |    Median |       p95 |
| --------------------------------------- | --------: | --------: |
| Title/tag search, 500 notes             |  0.051 ms |  0.102 ms |
| Title/tag search, 5,000 notes           |  0.300 ms |  0.426 ms |
| Prepare tree, 500 notes                 |  0.133 ms |  0.156 ms |
| Prepare tree, 5,000 notes               |  1.657 ms |  1.795 ms |
| Split a 1 MB note                       |  0.027 ms |  0.028 ms |
| Complete graph calculation, 500 notes   |  5.065 ms |  6.255 ms |
| Complete graph calculation, 5,000 notes | 35.162 ms | 38.313 ms |

The native cache now uses bounded LRU eviction with 20,000 entries per root, 40,000 globally and a 32 MiB estimated memory budget. Invalid UTF-8 and oversized-note metadata results cache until their fingerprints change. Warm scan measurements with `scan_benchmark`, using 30 iterations and 2,208-byte bodies, were 0.559 ms median / 0.744 ms p95 for 500 notes and 7.405 / 8.195 ms for 5,000 notes. These are fresh measurements without a same-run baseline comparison. Collections beyond the finite budgets can still reparse evicted entries.

Local preview images share pending/resolved reads by workspace, path and modification time, with a 32 MiB string-data budget. Component tests verify image refresh after metadata changes and drawing mount preservation when inserting a preceding paragraph. End-to-end native typing, presentation and pointer performance remain unmeasured.

## Earlier measurements

Measured with Node 26.10.0 on the development machine on 2026-09-29, against commit ee2d1e3. These are local benchmarks, not guarantees of end-to-end native input latency or cold filesystem speed.

| Workload                                    | Before median | After median | Before p95 | After p95 |
| ------------------------------------------- | ------------: | -----------: | ---------: | --------: |
| Fuzzy title/tag search, 500 notes           |      0.072 ms |     0.052 ms |   0.112 ms |  0.099 ms |
| Fuzzy title/tag search, 5,000 notes         |      0.700 ms |     0.303 ms |   0.941 ms |  0.464 ms |
| Prepare file tree, 500 notes / 50 folders   |      1.247 ms |     0.162 ms |   1.272 ms |  0.209 ms |
| Prepare file tree, 5,000 notes / 50 folders |     12.470 ms |     2.142 ms |  12.675 ms |  2.251 ms |
| Parse/render preview, 500 paragraphs        |     10.863 ms |     4.611 ms |  20.006 ms |  7.528 ms |
| Warm native workspace scan, 500 notes       |      9.637 ms |     0.434 ms |   9.721 ms |  0.797 ms |
| Warm native workspace scan, 5,000 notes     |     96.699 ms |     5.750 ms |  98.374 ms |  6.260 ms |

The initial JavaScript entry changed from 847,192 bytes to 453,083 bytes, about 47% smaller. Gzip changed from 271,179 to 148,553 bytes. This measures the entry only: the editor, settings, preview, and icon catalog still download/load as separate local chunks when needed. It is not a 47% reduction in total application code.

A browser development-build check dispatched 60 edits into a 105,000-character mixed English/Hebrew note. Transaction processing measured 1.4 ms median / 3.9 ms p95 before and 1.2 ms / 2.5 ms afterward, with only 19 visible editor lines in the DOM. These short runs are noisy and exclude frame presentation, real keyboard input, and the native webview; they are a sanity check, not a claimed typing-speed multiplier. Existing viewport virtualization was retained. Splitting a 1 MB note was already about 0.027 ms and was left unchanged.

## Reproduce

```sh
node scripts/performance.mjs
VITE_MARKDOWN_BENCHMARK=1 npx vitest run src/editor/markdown.performance.test.ts --reporter=verbose --silent=false
cargo run --release --manifest-path src-tauri/Cargo.toml --example scan_benchmark
npm run build
```

The Node benchmark uses the actual search implementation with the UI's 60-result limit and repeated queries across immutable indexes. It builds the complete folder index once per sample. The original tree benchmark filtered the full note list separately for all 50 folders, matching the old sidebar's work. React now reuses the prepared tree until entries or sorting change, and collapsed folders avoid mounting their children.

Search normalizes titles and tags once per index, ranks only the requested number of results, and keeps stable order. Preview parses once and renders slices of the resulting tokens; sanitized blocks are reused during UI-only updates. Native scans cache bounded title/tag metadata but still check filesystem fingerprints on every scan. Cold or changed files are parsed normally.

Other changes reduce work without timing claims: closed saved note buffers are released; concurrent focus refreshes share one request; unchanged scan results preserve the index reference; the active workspace loads before background scans; editor preferences reconfigure the existing CodeMirror instance and preserve its cursor and undo stack. Cache locks cover only map operations, so filesystem I/O and Markdown parsing cannot block saves while holding that lock.

Regression checks cover ranking limits, same-size external edits with restored timestamps, deleted/renamed files, failed settings persistence, save conflicts, editor undo, Markdown block ranges, and a deliberately blocked scan alongside a save and a scan of another workspace. See the editor and native reports for details.

## Architecture sanity check

A separate `node scripts/performance.mjs` run on 2026-09-29, after the architecture refactor, measured the following. These are fresh local measurements, not a before/after comparison for relocation or content analysis.

| Workload                      |   Median |      p95 |
| ----------------------------- | -------: | -------: |
| Title/tag search, 500 notes   | 0.051 ms | 0.093 ms |
| Title/tag search, 5,000 notes | 0.304 ms | 0.420 ms |
| Prepare tree, 500 notes       | 0.133 ms | 0.167 ms |
| Prepare tree, 5,000 notes     | 1.654 ms | 2.314 ms |
| Split a 1 MB note             | 0.033 ms | 0.035 ms |

The content-analysis scheduler now limits reads globally across overlapping consumers. Deterministic timer-order tests verify that bulk analysis yields for both uncached and changed live buffers, while a scoped outline updates immediately. Native incoming-link discovery runs once per relocation and writes each changed referring note once. These are structural guarantees and regression results; native relocation speed and end-to-end typing latency have not been benchmarked for this refactor.

## Hierarchical note graph

Measured locally with Node 26.10.0 on 2026-09-30 using `node scripts/graph-performance.mjs`. Each fixture has 50 folders and one outgoing link per note. The script exercises the actual graph implementation, warms up twice, then measures ten runs; it also checks the resulting edge count and SVG paths.

| Workload                                  |    Median |       p95 |
| ----------------------------------------- | --------: | --------: |
| Hierarchy and resolver index, 500 notes   |  1.195 ms |  1.902 ms |
| Resolve 500 links                         |  1.075 ms |  3.050 ms |
| Generate 500 bundled SVG paths            |  1.609 ms |  2.857 ms |
| Complete graph calculation, 500 notes     |  4.116 ms |  6.534 ms |
| Hierarchy and resolver index, 5,000 notes |  9.610 ms | 10.497 ms |
| Resolve 5,000 links                       | 11.678 ms | 13.824 ms |
| Generate 5,000 bundled SVG paths          | 16.255 ms | 18.623 ms |
| Complete graph calculation, 5,000 notes   | 36.827 ms | 40.025 ms |

These measurements exclude file reads, Markdown analysis, React rendering, frame presentation, and native typing latency. More links increase path generation and rendering work. Graph content analysis is loaded on demand through the existing scheduler. Search and bundling changes reuse the metadata layout and resolver index; changing strength only regenerates paths. Large graphs hide most labels until selecting a note or zooming in.

A separate search/tree sanity run measured title/tag search at 0.052 ms median / 0.114 ms p95 for 500 notes and 0.313 / 0.458 ms for 5,000 notes. Tree preparation measured 0.133 / 0.183 ms and 1.660 / 1.765 ms respectively. These are fresh local measurements, not a before/after comparison.
