# Native file actions and appearance report

The Rust service implements the four new Tauri commands from `docs/file-customization-plan.md`:

| Command | Arguments | Result |
| --- | --- | --- |
| `set_entry_appearance` | `{ workspaceId: string, path: string, appearance: { icon: string \| null, color: string \| null } }` | `Appearance` |
| `remove_workspace` | `{ workspaceId: string }` | `Settings` |
| `rename_image` | `{ workspaceId: string, path: string, name: string }` | `{ path: string, rewritten: Rewrite[], warnings: string[] }` |
| `delete_file` | `{ workspaceId: string, path: string, revision: string \| null }` | `{ warnings: string[] }` |

`Settings.appearances` is a workspace ID → relative path → appearance map. Missing settings from older configs deserialize to an empty map. Appearance changes validate that the workspace is registered, the resolved path stays inside its registered root and is a real folder, Markdown note, or supported image. Icon IDs must have kebab-case syntax; colors must be `#RRGGBB`. Setting both fields to null removes the entry.

Workspace removal removes its registration, active selection, sessions, appearances, and automatic note-name metadata. The service persists a cloned settings state before replacing its in-memory state. It never opens or deletes the workspace folder, so removal also works when that folder is unavailable.

Image rename accepts a stem or a same-extension filename as a workspace-relative destination path. A bare filename moves a nested image to the workspace root. Manual note rename uses the same path convention. Image rename preserves the source extension and refuses traversal, symlinks, unsupported source types, and occupied destinations. It rewrites resolvable `![[image]]` embeds and `![image](path)` destinations outside code spans, including workspace-root paths beginning with `/`, and returns rewritten note contents/revisions. Markdown link type comes from the existing parser's source ranges, so nested brackets and inline code in image alt text do not prevent updates. It leaves ordinary note links unchanged. Image lookup is limited to the image's own workspace, matching the preview. Appearance and session paths follow image moves and automatic/manual note renames.

Deletion accepts only Markdown notes and supported images. Notes require a matching revision; images accept null revision. The production implementation calls the desktop Trash through the `trash` crate. The service has an injectable `Trash` trait so every deletion test uses a fake and never touches a user's Trash. After a successful Trash move, it removes the deleted file's appearance and automatic-name metadata and prunes the path from tabs/panes. Trash errors leave metadata untouched. A committed rename or Trash move returns its result with warnings if config persistence subsequently fails.

Validation: `cargo test --manifest-path src-tauri/Cargo.toml` passed 40 tests; `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` passed; `git diff --check -- src-tauri` passed. Tests cover offline workspace removal, failed removal persistence, metadata migration, workspace-root moves, image and note syntax separation, nested and inline-code image alt text, nested image destinations with changing path lengths, root-relative links, workspace-local image resolution, collision/traversal/extension handling, revision checks, session pruning, Trash failure, and committed-operation warnings.
