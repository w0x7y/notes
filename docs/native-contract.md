# Native interface

All JSON fields use camelCase. Note and image paths are relative to a registered workspace. IDs are opaque strings. All mutations and reads must resolve inside the selected registered root and reject symlink escapes. Persist config separately from user files. Commands run filesystem work away from the UI thread.

```ts
type Workspace = { id: string; name: string; path: string; color: string; icon: string };
type Entry = { path: string; kind: 'note' | 'image' | 'folder'; title: string; tags: string[]; modified: number };
type Snapshot = { workspace: Workspace; entries: Entry[] };
type NoteFile = { path: string; content: string; revision: string; autoRename: boolean };
type Rewrite = { workspaceId: string; path: string; content: string; revision: string };
type SaveResult = NoteFile & { rewritten: Rewrite[]; warnings: string[] };
type Session = { tabs: string[]; primary: string | null; secondary: string | null; split: boolean };
type Settings = { workspaces: Workspace[]; activeWorkspaceId: string | null; sessions: Record<string, Session>; toolbarVisible: boolean };
```

Commands (argument names are the exact frontend invoke object keys):

- `load_settings({}) -> Settings`
- `save_sessions({sessions, activeWorkspaceId, toolbarVisible}) -> void`
- `add_workspace({path}) -> Snapshot` (canonicalize, deduplicate; generate ID and initial name/color/book icon)
- `update_workspace({workspaceId,name,color,icon}) -> Workspace`
- `scan_workspace({workspaceId}) -> Snapshot` (recursive, exclude hidden directories and symlinks; include folders, Markdown, common image formats; tags outside code)
- `read_note({workspaceId,path}) -> NoteFile` (revision is content hash)
- `create_note({workspaceId,folder}) -> NoteFile` (unique Untitled.md, Untitled 2.md; empty content; autoRename true)
- `save_note({workspaceId,path,content,revision}) -> SaveResult` (optimistic conflict detection, atomic write; title-driven filenames only for app-created notes until manual rename)
- `rename_note({workspaceId,path,name,revision}) -> SaveResult` (explicit filename, autoRename false; name may be a workspace-relative destination path; never overwrite another file)
- `create_folder({workspaceId,parent,name}) -> void`
- `read_image({workspaceId,path}) -> {data:string,mime:string}` (base64 data, allowlist extensions, reasonable size bound)

Automatic title is the first H1 Markdown heading; preserve source formatting. Empty title maps to Untitled. Sanitize path separators/control characters and choose a unique destination, with existing source exempt from collision checks. Store auto-naming state outside workspaces and preserve existing filenames.

Rename updates resolvable wiki/Markdown incoming links across registered workspaces, avoiding ambiguous basename links and code. Returned `rewritten` entries let the frontend reconcile open buffers. If a link update fails, preserve the renamed note and report a warning; never silently discard a write error.

Errors must reject with a human-readable string. On stale revision include a clear external-change message and do not write. Do not expose generic unrestricted filesystem commands. Use a mutex for ordered config/file mutations with no lock held across await. Tests use temporary folders. No external user folders are opened automatically.

Tauri config: identifier `dev.idan.notes`, title `Notes`, default size 1280x800, minimum 760x520; dev URL `http://localhost:1420`; frontendDist `../dist`; beforeDevCommand `npm run dev`; beforeBuildCommand `npm run build`. Native dialog plugin for folder selection and opener plugin for HTTP(S) links. Browser demo does not call native commands.
