# GTK 3 dependency backports

These three crates keep Tauri 2's GTK 3 dependency types compatible while
addressing the advisories recorded in the historical
[final-check report](../../docs/final-check-2026-09-30.md).
The app owns these patches until its upstream stack supports a compatible
replacement carrying these fixes. GTK 3 binding development has resumed; its
[unmaintained advisory](https://rustsec.org/advisories/RUSTSEC-2024-0415.html)
was withdrawn on 2026-09-08. This does not replace the local backports below.

## Sources and changes

The directories are copies of the published crates.io packages, retaining
their original versions, source, tests and MIT licenses. Original Git metadata
is retained in each `.cargo_vcs_info.json`. `Cargo.toml.orig` is upstream
manifest context; Cargo builds from `Cargo.toml`.

| Package | Published archive SHA-256 | Local changes |
| --- | --- | --- |
| glib 0.18.5 | `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5` | `src/variant_iter.rs`: make the output pointer mutable and pass `&mut p` to the variadic C function. |
| glib-macros 0.18.5 | `0bb0228f477c0900c880fd78c8759b95c7636dbd7842707f49e132378aa2acdc` | Replace proc-macro-error with proc-macro-error3 3.1.1 in both manifests and source imports. |
| gtk3-macros 0.18.2 | `52ff3c5b21f14f0736fed6dcfc0bfb4225ebf5725f3c0209edeec181e4d73e9d` | Same macro dependency and import replacement. |

GLib's fix matches [upstream PR 1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
for [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
Updating GLib to 0.20 directly would leave the affected 0.18 dependency or break
GTK 3's type compatibility.

Both macro crates now use
[proc-macro-error3](https://github.com/gamma0987/proc-macro-error3), with default
features disabled and `syn2-error` enabled to match their existing Syn 2 types.
The version is pinned for reviewable updates. This removes
[RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html).
Do not substitute proc-macro-error2, which is also
[unmaintained](https://github.com/RustSec/advisory-db/blob/main/crates/proc-macro-error2/RUSTSEC-2026-0173.md).

## Verification and upkeep

Run from the repository root:

```sh
python3 scripts/check-native-dependencies.py
cargo audit --file src-tauri/Cargo.lock --deny warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --release --test glib_variant_iter
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
npm run desktop:build
```

Install the audit tool with `cargo install cargo-audit --locked` if needed.
Cargo audit checks registry dependencies and does not establish whether local
backports are safe. Pair it with the checksum/resolution check and optimized
regression test. No advisory ignore configuration is used.

`checksums.json` records every file in the three crate directories. The checker
rejects changes and additional files, requires all three crates to resolve only
to these local directories, and rejects abandoned macro dependencies. Review
the upstream diff and rerun the tests before deliberately updating checksums.
This records reviewed content; it is not a substitute for reviewing a patch.

On 2026-09-30, the optimized iterator regression crashed with SIGSEGV against
the original GLib source and passed after applying the pointer fix. It exercises
`next`, `next_back`, `nth`, `nth_back`, `last`, mixed iteration, Unicode and empty
strings/arrays. The old proc-macro-error/attribute packages and Syn 1 disappear
from the resolved lockfile.

When Tauri supports a compatible stack carrying these fixes, remove all three patch
entries and vendor directories together, regenerate the lockfile, adapt the
regression dependency, and replace this guard with checks for the new stack.
