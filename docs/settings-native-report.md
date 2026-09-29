# Native settings and scan performance

`save_preferences({ preferences }) -> Preferences` runs through the existing async blocking-task adapter. Its model matches `src/domain/preferences.ts`, including camelCase keys, defaults, enum strings, and numeric ranges. Missing preferences in existing configuration files receive all defaults; missing individual fields receive their defaults. Invalid enum/type values fail deserialization. Numeric ranges and finite line height are validated before persistence and at configuration load.

Saving preferences clones the stored settings, atomically persists that clone, and then replaces memory. A failed write leaves the current in-memory preferences intact. Other settings and workspace registration remain part of the same serialized state.

## Measurement

Run from the repository root:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --release --example scan_benchmark
```

The example creates and removes its own temporary configuration and note directories. Each note has a heading and 2,208 bytes of repeated mixed English/Hebrew Markdown with a tag and wiki link. There are three warmups and 30 measured refreshes after workspace registration. Times include directory walking, metadata checks, title/tag collection, sorting, and result destruction. They exclude UI rendering and IPC serialization. Baseline was measured with this exact example before the scan implementation changed, in the same Linux workspace with the same release profile.

| Notes | Before median | Before p95 | After median | After p95 |
| --- | ---: | ---: | ---: | ---: |
| 500 | 9.637 ms | 9.721 ms | 0.434 ms | 0.797 ms |
| 5,000 | 96.699 ms | 98.374 ms | 5.750 ms | 6.260 ms |

These are warm unchanged-workspace scans, about 17–22 times faster here. They are local measurements, not a guarantee for other filesystems or cold startup. First scans and changed notes still read and parse Markdown. The cache is bypassed on non-Unix platforms because this implementation requires a reliable change timestamp.

## Cache behavior

`scan_cache.rs` retains only parsed titles and tags, keyed by absolute file path and verified against the canonical workspace root. Every scan still walks the filesystem and reads file metadata. On Unix the fingerprint includes full modification time, change time with nanoseconds, byte length, device, and inode. This detects same-size external edits whose modification time was restored, as covered by a regression test. New/deleted/renamed entries remain visible through every directory walk. Reads are checked against a second fingerprint before caching; read failures are retried on the next scan.

The cache holds at most 10,000 entries. Derived strings and tag-vector element storage are limited to 4,096 bytes per cached entry, plus paths, hash-map capacity, and object overhead. Larger metadata is returned normally but not retained. Successful scans prune missing entries for that root, and removing a workspace drops its entries. Cache saturation only reduces performance; every uncached file is still parsed and returned.

Native note writes, link rewrites, file renames, and deletes invalidate affected entries after the actual disk operation, including failed attempts. There is no cache lock acquisition between revision validation and the write, rename, or delete. Cache locks cover only lookups, inserts, invalidations, and pruning; directory walking, metadata syscalls, reads, parsing, writes, fsync, and Trash operations all run outside those locks. Each scan tracks its own seen paths for pruning, so concurrent scans do not share mutable visitation state. A concurrent scan may evict or replace another scan's cache entry, but fingerprints are always checked before reuse and correctness does not depend on retaining an entry. Note reads, revision hashes, save conflict checks, rename conflict checks, and delete conflict checks continue to read actual disk contents. Cached metadata is never a source for saving or conflict detection.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Both passed. There are 48 integration tests and one cache unit test, including all 40 original integration tests. New coverage checks old configuration defaults, missing preference fields, preference persistence across restart, invalid ranges/enums/non-finite numbers, failed settings writes, external edits with restored modification time, external additions/deletions/renames, native saves and incoming-link rewrites, workspace separation, and cache bounds/pruning.

A Unix FIFO regression test deterministically blocks one scan inside its file read while a note save and a second workspace scan complete. It failed against the original scan-wide cache lock and passes with the short lock scopes. The updated benchmark above includes these scopes and the per-scan seen-path set.
