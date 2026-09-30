# Native interface

All JSON fields use camelCase. Note and image paths are relative to a registered workspace. IDs are opaque strings. All mutations and reads must resolve inside the selected registered root and reject symlink escapes. Persist config separately from user files. Commands run filesystem work away from the UI thread.

File reads require regular files. On Unix, nonblocking, no-follow opens reject named pipes and final-component symlink substitutions before reading, with file type checked on the open descriptor. Workspace scans exclude special files as well as symlinks. Image reads enforce the 20 MB bound on both descriptor metadata and actual bytes. These checks preserve ordinary notes, images, settings, and drawing previews; they do not eliminate the documented race with external writers during saves.

```ts
type Workspace = { id: string; name: string; path: string; color: string; icon: string };
type Entry = { path: string; kind: 'note' | 'image' | 'folder'; title: string; tags: string[]; modified: number };
type Snapshot = { workspace: Workspace; entries: Entry[] };
type NoteFile = { path: string; content: string; revision: string; autoRename: boolean };
type Rewrite = { workspaceId: string; path: string; content: string; revision: string };
type SaveResult = NoteFile & { rewritten: Rewrite[]; warnings: string[] };
type Session = { tabs: string[]; primary: string | null; secondary: string | null; split: boolean };
type Appearance = { icon: string | null; color: string | null };
type Settings = { preferences: Preferences; workspaces: Workspace[]; activeWorkspaceId: string | null; sessions: Record<string, Session>; toolbarVisible: boolean; appearances: Record<string, Record<string, Appearance>> };
```

`Preferences` is defined in [the shared preference schema](../src/domain/preferences.ts).

Commands (argument names are the exact frontend invoke object keys):

- `load_settings({}) -> Settings`
- `save_preferences({preferences}) -> Preferences` persists validated app preferences, including `theme` as one of `graphite-amber`, `ink-jade`, `midnight-ice`, `charcoal-coral`, `forest-moss`, or `one-dark-pro`, with `graphite-amber` as the default for old settings. Theme preferences never alter notes, custom appearances, or sessions. Also includes `graphBundling` as a finite number from 0 to 1 with a default of 0.85. Older configs receive the default; invalid values and failed config writes retain previous preferences. Graph display settings never alter note files.
- `save_sessions({sessions, activeWorkspaceId, toolbarVisible}) -> void`
- `add_workspace({path}) -> Snapshot` (canonicalize, deduplicate; generate ID and initial name/color/book icon)
- `update_workspace({workspaceId,name,color,icon}) -> Workspace`
- `scan_workspace({workspaceId}) -> Snapshot` (recursive, exclude hidden directories, symlinks and special files; include folders, Markdown, common image formats; tags outside code)
- `read_note({workspaceId,path}) -> NoteFile` (revision is content hash)
- `create_note({workspaceId,folder}) -> NoteFile` (unique Untitled.md, Untitled 2.md; empty content; autoRename true)
- `save_note({workspaceId,path,content,revision}) -> SaveResult` (optimistic conflict detection, atomic write; title-driven filenames only for app-created notes until manual rename)
- `rename_note({workspaceId,path,name,revision}) -> SaveResult` (explicit filename, autoRename false; name may be a workspace-relative destination path; never overwrite another file)
- `create_folder({workspaceId,parent,name}) -> void`
- `move_folder({workspaceId,path,destination}) -> {path:string,rewritten:Rewrite[],warnings:string[]}` (rename or move an existing folder inside its workspace; reject collisions and descendants)
- `read_image({workspaceId,path}) -> {data:string,mime:string}` (base64 data, allowlist extensions, regular files up to 20 MB)

Automatic title is the first H1 Markdown heading; preserve source formatting. Empty title maps to Untitled. Sanitize path separators/control characters and choose a unique destination, with existing source exempt from collision checks. Store auto-naming state outside workspaces and preserve existing filenames.

Rename updates resolvable wiki/Markdown incoming links across registered workspaces, avoiding ambiguous basename links and code. Returned `rewritten` entries let the frontend reconcile open buffers. If a link update fails, preserve the renamed note and report a warning; never silently discard a write error.

Each relocation supplies its complete note/image mapping to the incoming-link module. It enumerates candidate files once, resolves links against original paths, and computes destinations relative to final paths. A changed referring note is written once through the existing atomic writer, and returned once with its final content and revision. Overlapping registered roots do not count the same physical note twice; image references remain scoped to their workspace. Enumeration, read and write failures produce warnings while other referring notes continue. Existing limits on reference-style links, escaped paths and general outgoing-link repair still apply.

The frontend relocation coordinator reserves open document save queues before manual note/image/folder operations and reconciles paths, tabs, pins, appearances, folder selection and heading navigation together. Folder paths are committed before destination rereads; an unreadable destination leaves its buffer registered at the new path. Edits made during relocation are saved afterward. A committed relocation resolves even if a follow-up save fails; that failure is reported separately and its text remains unsaved. New note registration shares this queue, and save-before-close waits for queued work and a stable document registry. Incoming rewrites never replace newer unsaved text: retain it and require conflict recovery.

Errors must reject with a human-readable string. On stale revision include a clear external-change message and do not write. Do not expose generic unrestricted filesystem commands. Use a mutex for ordered config/file mutations with no lock held across await. Tests use temporary folders. No external user folders are opened automatically.

Tauri config: identifier `dev.idan.notes`, title `Notes`, default size 1280x800, minimum 760x520; dev URL `http://localhost:1420`; frontendDist `../dist`; beforeDevCommand `npm run dev`; beforeBuildCommand `npm run build`. Native dialog plugin for folder selection and opener plugin for HTTP(S) links. Browser demo does not call native commands.
