# Native service handoff

The Tauri 2 backend implements every command in `docs/native-contract.md`. IPC arguments and serialized results use camelCase. `SaveResult` serializes note fields at the top level with `rewritten` and `warnings`; there are no interface deviations.

The file service stores workspaces, sessions, and automatic filename flags in the app config directory. It canonicalizes registered folders, rejects traversal and symlinks in note paths, and scans Markdown, images, and folders while excluding hidden directories and symlinks. Writes use a temporary file, file and parent-directory sync, content-hash revision checks, and permission preservation. App-created notes follow their first H1 until a manual rename. Renames never overwrite an existing destination, and resolvable wiki and inline Markdown links are rewritten across registered workspaces. Failed backlink rewrites are returned as warnings with the renamed note preserved.

Validation in `src-tauri`:

- `cargo test`: 25 filesystem integration tests passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo build`: passed; debug executable at `src-tauri/target/debug/notes`.

The tests cover UTF-8 files, tags and headings outside code, hidden directory behavior, traversal and symlink escape rejection, a replaced workspace root, revision conflicts, automatic and manual naming, incoming links in one and multiple workspaces, ambiguous basename links, session persistence, and Unix permission preservation. Review regressions also cover dangling `Untitled.md` symlinks, filesystem errors during unique-name lookup, percent-encoded Markdown destinations across repeated renames, double-backtick and multiline code spans, indented code, four-backtick and nested blockquote fences, completed renames after config failures, and autosaves whose automatic rename fails after content was written. Code exclusion for tag extraction and link rewriting uses Markdown parser source offsets.

When a new wiki basename would collide, rewrites use `[[/path/to/note]]` for a note in the same workspace and `[[workspace-id:path/to/note]]` across workspaces. The frontend resolves the latter form by registered workspace ID. Later renames update both qualified forms. If settings persistence fails after a rename, the command returns the committed path and rewritten documents with a warning. If automatic naming fails after an autosave, the command returns the saved content and new revision at the original path with a warning.

Known limits: Link rewriting handles direct wiki links and inline Markdown destinations. Reference-style links, escaped paths, and links inside the renamed note itself are not rewritten. An external process changing a note in the small interval between revision verification and the atomic replacement can still race the save. Backlink rewrites are best effort and report failures in `warnings`.
