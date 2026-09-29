# File actions and appearance

User-approved scope: middle-click tab closing; Delete for notes/images; image rename/move; every free Lucide icon available offline for workspaces/folders/files; file/folder text colors; removing workspace registrations without touching directories.

## Shared contract

- `Appearance = { icon: string | null; color: string | null }` (null means default). Icon IDs are Lucide kebab-case names. Colors are `#RRGGBB`.
- Settings adds `appearances: Record<workspaceId, Record<relativePath, Appearance>>`, defaulting to `{}` for existing configs. Workspace icon/color remain their existing fields.
- `set_entry_appearance({ workspaceId, path, appearance }) -> Appearance` validates registered root/path (files or folders), stores only app config.
- `remove_workspace({ workspaceId }) -> Settings` removes registration/session/appearance/auto-name metadata, leaves every disk file untouched, works even if the folder is offline. Persist atomically before committing in-memory config.
- `rename_image({ workspaceId, path, name }) -> { path, rewritten: Rewrite[], warnings: string[] }`. Destination is a workspace-relative path, must keep the image extension, rejects collision/traversal/symlinks, updates resolvable incoming image links.
- `delete_file({ workspaceId, path, revision: string | null }) -> { warnings: string[] }`. Only Markdown and supported image files, never folders. Markdown revision is required and checked. Use the desktop Trash, never a permanent-delete fallback. Tests inject a trash implementation so no real user Trash is touched.
- Appearance metadata follows automatic note renames, manual note renames, and image moves. Deleted files lose their appearance/session metadata.
- File operations that commit successfully must return their new path/warnings even if subsequent metadata persistence fails.

## Work

1. Native service and regression tests, owned by native worker (`src-tauri/**`).
2. Searchable icon/color picker and icon rendering, owned by appearance worker (new appearance components only).
3. Main agent: typed adapters/state, dialogs/context menu, middle click, metadata rendering, safe operation sequencing, integration and native/browser checks.
4. Focused review of file mutation safety and integration, fix findings, rebuild executable and document results.

Deletion and workspace removal are explicit application actions. Their confirmation dialogs cannot dismiss while running. The UI flushes notes before either action; failure preserves the open buffer. All testing uses temporary workspaces or browser demo data.

## Review and verification

- Native service and appearance component implementations completed; whole-change review found seven issues.
- Fixed workspace-root move semantics, image-only wiki rewriting, workspace-root image links, local image resolution across duplicated workspace filenames, saving pending note edits before image-link updates, stable note identity in confirmation dialogs, and icon alias collisions.
- TypeScript and 24 frontend tests pass. Native worker verified 40 filesystem tests and Clippy with warnings denied.
- Browser integration exercised middle click, image move/Delete, file/folder colors, workspace icons/removal, autofocus, 56 rendered icon choices per page, and pagination across all 2,118 installed icon names.
- A scoped review caught a Markdown caption edge case. Link/image classification now uses the existing Markdown parser; regression tests cover nested brackets, inline code in captions, and nested-image replacement offsets.
- Final scoped review passed with no remaining findings. The release executable is rebuilt after the final fixes.
