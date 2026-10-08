# Native interface

All JSON fields use camelCase. Note and image paths are relative to a registered workspace. IDs are opaque strings. All mutations and reads must resolve inside the selected registered root and reject symlink escapes. Persist config separately from user files. Commands run filesystem work away from the UI thread.

File reads require regular files. On Unix, nonblocking, no-follow opens reject named pipes and final-component symlink substitutions before reading, with file type checked on the open descriptor. Workspace scans exclude special files as well as symlinks. Markdown and image reads enforce a 20 MiB bound on both descriptor metadata and actual bytes, including files that grow during reading. Oversized Markdown saves and incoming-link rewrites fail before writing. Scans retain oversized or invalid UTF-8 notes with their filename as the title and no tags. Stable invalid text results are cached until the file fingerprint changes; transient read failures retry. The bounded scan cache keys entries by registered root and file path, so overlapping roots keep separate entries and native writes invalidate every cached copy of a file. These checks preserve ordinary notes, images, settings, and drawing previews; they do not eliminate the documented race with external writers during saves.

The scan cache admits up to 20,000 entries per root and 40,000 entries across roots, with a shared 32 MiB estimated memory budget that includes metadata, keys and index overhead. Derived title/tag payloads larger than 4 KiB remain uncached. Cache hits refresh recency. Reaching a limit evicts the least recently used entry from that root or the shared cache, so new files can enter the cache instead of being permanently excluded after the old 10,000-entry cutoff. Scans still check file fingerprints, and corpora exceeding these finite limits can require reparsing evicted entries. These bounds apply to derived scan metadata; settings and note contents are stored separately.

Malformed `notes.json` settings recover at startup. Before replacing them, preserve their exact bytes in a unique `notes.json.recovery-<uuid>.bak` file beside the config. Invalid preference types, enum values, or ranges reset only preferences to defaults when the remaining settings deserialize successfully; workspace registrations, sessions, appearances and automatic filenames survive. Other malformed settings recover to defaults. Backup and replacement must succeed before startup continues. Read failures and nonregular config paths remain errors. Workspace registration, workspace customization, session saving and preference saving publish in-memory changes only after config persistence succeeds.

```ts
type Workspace = {
  id: string;
  name: string;
  path: string;
  color: string;
  icon: string;
};
type Entry = {
  path: string;
  kind: "note" | "image" | "folder";
  title: string;
  tags: string[];
  aliases: string[];
  modified: number;
};
type Snapshot = {
  workspace: Workspace;
  entries: Entry[];
  warnings: string[];
  incomplete: boolean;
};
type NoteFile = {
  path: string;
  content: string;
  revision: string;
  autoRename: boolean;
};
type Rewrite = {
  workspaceId: string;
  path: string;
  content: string;
  revision: string;
};
type SaveResult = NoteFile & { rewritten: Rewrite[]; warnings: string[] };
type Session = {
  tabs: string[];
  primary: string | null;
  secondary: string | null;
  split: boolean;
};
type Appearance = { icon: string | null; color: string | null };
type Settings = {
  preferences: Preferences;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  sessions: Record<string, Session>;
  toolbarVisible: boolean;
  appearances: Record<string, Record<string, Appearance>>;
};
```

`Preferences` is defined in [the shared preference schema](../src/domain/preferences.ts).

Commands (argument names are the exact frontend invoke object keys):

- `load_settings({}) -> Settings`
- `list_fonts({}) -> string[]` lists unique installed Linux font family names, including family aliases and user fonts, through Fontconfig on a blocking worker. No file paths or note contents are returned. Called on demand when settings opens, shared by both font dropdowns; errors allow retry. Browser demo uses clearly labeled sample font choices.
- `save_preferences({preferences}) -> Preferences` persists validated app preferences, including `theme` as one of `graphite-amber`, `ink-jade`, `midnight-ice`, `charcoal-coral`, `forest-moss`, or `one-dark-pro`, with `graphite-amber` as the default for old settings. Theme preferences never alter notes, custom appearances, or sessions. Also includes `graphBundling` as a finite number from 0 to 1 with a default of 0.85. Older configs receive the default; invalid values and failed config writes retain previous preferences. Graph display settings never alter note files. Font selections use `customFont` for note text and `uiFont` for navigation/dialogs. `uiFont` defaults to the existing sans serif stack for older configs; both names reject control characters. Installed family names can exceed the old free-text limit. Legacy `editorFont` remains the editor fallback and is preserved when selecting a family. Missing fonts fall back without discarding the saved family.
- `save_sessions({sessions, activeWorkspaceId, toolbarVisible}) -> void`
- `add_workspace({path}) -> Snapshot` (canonicalize, deduplicate; generate ID and initial name/color/book icon)
- `update_workspace({workspaceId,name,color,icon}) -> Workspace` validates a nonempty trimmed name, a `#RRGGBB` color, and a nonempty Lucide kebab-case icon ID, using the same color/icon rules as entry appearance.
- `scan_workspace({workspaceId}) -> Snapshot` recursively excludes hidden directories, dependency/cache folders, symlinks and special files. Include folders, Markdown and common image formats. Markdown metadata combines inline tags outside code with frontmatter `tags:` and exposes frontmatter `aliases:`; metadata extraction never rewrites the source. Child traversal, entry metadata or transient note-read failures return healthy entries with warnings and `incomplete: true`; the failed entries are omitted until a later successful scan. Deliberately unsupported note content (invalid UTF-8 or over 20 MiB) retains the filename fallback and cached empty metadata. A missing, unreadable, symlinked or non-directory registered root remains a hard error. Incomplete scans do not prune native cache entries. The frontend merges partial entries and retains undiscovered entries, tabs and content-analysis caches until a complete scan can establish their absence.
- `read_note({workspaceId,path}) -> NoteFile` (revision is content hash)
- `create_note({workspaceId,folder}) -> NoteFile` (unique Untitled.md, Untitled 2.md; empty content; autoRename true)
- `save_note({workspaceId,path,content,revision}) -> SaveResult` (optimistic conflict detection, atomic write; title-driven filenames only for app-created notes until manual rename)
- `rename_note({workspaceId,path,name,revision}) -> SaveResult` (explicit filename, autoRename false; name may be a workspace-relative destination path; never overwrite another file)
- `delete_file({workspaceId,path,revision}) -> {warnings:string[]}` moves a Markdown note, supported image, or folder and all its contents to desktop Trash. Notes require a matching revision. Folder deletion rejects workspace roots, symlink paths, and folders that overlap another registered workspace, and prunes descendant session paths, appearances and automatic filenames only after Trash succeeds. A committed deletion reports metadata persistence failures as warnings.
- `create_folder({workspaceId,parent,name}) -> void`
- `move_folder({workspaceId,path,destination}) -> {path:string,rewritten:Rewrite[],warnings:string[]}` (rename or move an existing folder inside its workspace; reject collisions, descendants and source folders that overlap another registered workspace). Descendant enumeration must succeed before the folder moves, so a failed traversal preserves the source and its metadata instead of silently omitting incoming-link targets.
- `read_image({workspaceId,path}) -> {data:string,mime:string}` (base64 data, allowlist extensions, regular files up to 20 MB)

Frontmatter extraction parses at most 64 KiB of YAML and inspects at most 256 values across `tags` and `aliases`, with a shared 64 KiB budget for their expanded strings checked before owned allocation. Unrelated properties are skipped without materializing their values. These limits bound YAML alias expansion while preserving ordinary scalar/list metadata, Unicode normalization and the source file. Metadata exceeding a limit is ignored; the note retains its heading or filename title and body tags, with a cached scan warning explaining the limit. Such a warning does not make the snapshot incomplete or prevent removed files from being pruned. Malformed YAML keeps the existing empty-frontmatter/body-tag fallback.

The native watcher emits `notes:workspace-changed` with `{workspaceIds:string[], warnings?:string[]}`. Load settings, workspace registration/removal and capture registration synchronize its explicit registered-root list after each command, including a registration that committed before a scan failed. Registration snapshots carry an internal monotonic generation, advanced under the state mutex only after committed registration changes; the watcher rejects older snapshots delivered by delayed command wrappers. Watching starts when that list reaches the worker, and failures do not prevent app startup or registration. Newly added registrations and registrations with a changed root path queue a refresh after watch installation, covering external edits between the command's initial scan and installation. Visible directories receive individual nonrecursive OS watches, providing recursive coverage without installing watches in hidden directories, `node_modules`, `__pycache__` or symlink targets. Explicitly registered roots remain eligible regardless of their own names. Overlapping roots share directory watches and each affected registration appears once in the event.

Create, write, rename and delete events for Markdown, supported images and folders invalidate workspaces; ordinary read/access events and unrelated files are ignored. A changed leaf still invalidates the workspace when an indexed note or folder has just become a symlink; events inside symlink ancestors are ignored and scans exclude the target. Directory changes reconcile watches before emitting an invalidation, so files created immediately inside a new folder appear in the ensuing scan. Reconciliation compares directory identities and reinstalls watches when a directory is replaced at the same path (Unix device/inode; creation timestamp elsewhere, with a conservative modified-time fallback). Events merge for 250 ms of quiet time with a maximum burst wait of one second, plus worker scheduling and directory reconciliation time. The raw event queue is bounded at 1,024 events. Queue overflow and backend rescan flags request a refresh of all registered roots. Warning messages are deduplicated per root-list configuration, with a bounded warning history and suppression notice. Roots are checked every two seconds for availability and identity changes; reappearing or replaced roots resume watching and invalidate their registrations. Other failed watch installations retry after thirty seconds. Focus refresh remains a fallback because OS notification delivery, particularly on network filesystems, is not guaranteed. See the [notify watcher API](https://docs.rs/notify/8.2.0/notify/trait.Watcher.html) and [symlink configuration](https://docs.rs/notify/8.2.0/notify/struct.Config.html).

Creating notes/folders and relocating notes/images/folders rejects every destination directory component beginning with `.` or named `node_modules` or `__pycache__`. Existing hidden Markdown files remain scan-visible. Choosing an explicitly registered root whose own name is hidden or excluded is supported, and does not exempt excluded descendants.

Automatic title is the first H1 Markdown heading; preserve source formatting. Empty title maps to Untitled. Sanitize path separators/control characters and truncate automatic stems to 180 UTF-8 bytes without splitting a character, preserving Hebrew and other Unicode scripts. Unique filenames also reserve space for `.md` and collision suffixes within a 255-byte filename. Choose a unique destination, with existing source exempt from collision checks. Store auto-naming state outside workspaces and preserve existing filenames.

Linux file and folder moves use `renameat2(RENAME_NOREPLACE)` so a destination created after validation cannot be overwritten, including an empty folder or dangling symlink. If the kernel or filesystem lacks that operation, regular files use the existing exclusive hard-link-and-remove fallback. Folder moves fail safely on that fallback instead of using an overwriting rename.

Rename updates resolvable wiki/Markdown incoming links across registered workspaces, avoiding ambiguous basename links and code. Returned `rewritten` entries let the frontend reconcile open buffers. If a link update fails, preserve the renamed note and report a warning; never silently discard a write error.

Each relocation supplies its complete note/image mapping to the incoming-link module. It enumerates candidate files once, resolves links against original paths, and computes destinations relative to final paths. A changed referring note is written once through the existing atomic writer, and returned once with its final content and revision. Overlapping registered roots do not count the same physical note twice; image references remain scoped to their workspace. Enumeration, read and write failures produce warnings while other referring notes continue. Existing limits on reference-style links, escaped paths and general outgoing-link repair still apply.

The frontend relocation coordinator reserves open document save queues before manual note/image/folder operations and reconciles paths, tabs, pins, appearances, folder selection and heading navigation together. Folder paths are committed before destination rereads; an unreadable destination leaves its buffer registered at the new path. Edits made during relocation are saved afterward. A committed relocation resolves even if a follow-up save fails; that failure is reported separately and its text remains unsaved. New note registration shares this queue, and save-before-close waits for queued work and a stable document registry. Incoming rewrites never replace newer unsaved text: retain it and require conflict recovery.

The frontend saves and retires open folder descendants together. It waits for previously accepted workspace operations, follows queued folder moves, temporarily blocks new workspace operations, and holds descendant editing during the final save and Trash commit. Failure restores editing and retains buffers. Success removes descendant tabs, pins, appearance, folder selection and heading navigation, and rejects stale refresh results.

Errors must reject with a human-readable string. On stale revision include a clear external-change message and do not write. Do not expose generic unrestricted filesystem commands. Native Workspace mutations acquire a global mutation mutex before taking short settings snapshots. Acquiring that mutex admits the operation; registration additions/removals wait for admitted file operations, and file operations remain serialized across workspaces because Incoming links can rewrite other registered roots. No lock is held across await. The settings mutex covers snapshots and config persistence only, and is released before workspace path validation, traversal, note/image file work, drawing publication, Trash and incoming-link rewrites. Preferences, sessions, workspace customization, settings reads and scans can progress during slow file work. Entry appearance updates share mutation ordering because they validate a current file path. File follow-up commits apply their metadata changes to the latest settings, preserving concurrent preferences and session changes. Note and image reads copy registration and note naming state under the settings mutex, then release it before path resolution, disk reads, hashing or base64 encoding. Reads accepted before workspace removal may finish using that registration snapshot. Revision checks remain inside file mutation ordering. A note write that publishes successfully but fails to sync its parent directory returns its committed content and revision with a durability warning; successful incoming rewrites remain in the result with the same warning. Config persistence and string-only drawing export retain their existing error behavior. Tests use temporary folders. No external user folders are opened automatically.

Tauri config: identifier `dev.idan.notes`, title `Notes`, default size 1280x800, minimum 760x520; dev URL `http://localhost:1420`; frontendDist `../dist`; beforeDevCommand `npm run dev`; beforeBuildCommand `npm run build`. Native dialog plugin for folder selection and opener plugin for HTTP(S) links. Browser demo does not call native commands.

Only the reviewed `default` capability is enabled for local content in the main window. Grants are event listen/unlisten, window destroy for save-before-close, directory dialog open, clipboard text write, and HTTP(S)-scoped external-link opening. Production CSP blocks frames, objects and cleartext HTTP images while retaining local/data/blob/HTTPS images and IPC. `scripts/check-security-policy.py` and its regression suite guard the complete reviewed directive/permission set in CI; changes to that policy require updating the guard and reviewing the resulting grants.
