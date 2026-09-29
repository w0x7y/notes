# Performance measurements

Measured with Node 26.10.0 on the development machine on 2026-09-29, against commit ee2d1e3. These are local benchmarks, not guarantees of end-to-end native input latency or cold filesystem speed.

| Workload | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Fuzzy title/tag search, 500 notes | 0.072 ms | 0.052 ms | 0.112 ms | 0.099 ms |
| Fuzzy title/tag search, 5,000 notes | 0.700 ms | 0.303 ms | 0.941 ms | 0.464 ms |
| Prepare file tree, 500 notes / 50 folders | 1.247 ms | 0.162 ms | 1.272 ms | 0.209 ms |
| Prepare file tree, 5,000 notes / 50 folders | 12.470 ms | 2.142 ms | 12.675 ms | 2.251 ms |
| Parse/render preview, 500 paragraphs | 10.863 ms | 4.611 ms | 20.006 ms | 7.528 ms |
| Warm native workspace scan, 500 notes | 9.637 ms | 0.434 ms | 9.721 ms | 0.797 ms |
| Warm native workspace scan, 5,000 notes | 96.699 ms | 5.750 ms | 98.374 ms | 6.260 ms |

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
