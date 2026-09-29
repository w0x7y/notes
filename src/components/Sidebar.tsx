import { useState } from "react";
import {
  BookOpen,
  Braces,
  Briefcase,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Image,
  Search,
  Settings2,
} from "lucide-react";
import type { Entry, Workspace } from "../domain/contracts";
import { basename, parentFolder } from "../domain/notes";

export function WorkspaceIcon({
  icon,
  size = 19,
}: {
  icon: string;
  size?: number;
}) {
  return icon === "code" ? (
    <Braces size={size} />
  ) : icon === "work" ? (
    <Briefcase size={size} />
  ) : (
    <BookOpen size={size} />
  );
}

type Props = {
  workspaces: Workspace[];
  workspace: Workspace | undefined;
  entries: Entry[];
  active: string | null;
  selectedFolder: string;
  onFolder: (path: string) => void;
  onOpen: (path: string) => void;
  onWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onSettings: () => void;
  onSearch: (tag?: string) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
};

function FolderNode({
  path,
  entries,
  ...props
}: { path: string; entries: Entry[] } & Pick<
  Props,
  "active" | "selectedFolder" | "onFolder" | "onOpen"
>) {
  const children = entries
    .filter((entry) => parentFolder(entry.path) === path)
    .sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        a.path.localeCompare(b.path),
    );
  return (
    <div className={path ? "tree-nested" : "tree-root"}>
      {children.map((entry) =>
        entry.kind === "folder" ? (
          <FolderBranch
            key={entry.path}
            path={entry.path}
            entries={entries}
            {...props}
          />
        ) : (
          <button
            key={entry.path}
            className={`tree-row ${props.active === entry.path ? "active" : ""}`}
            onClick={() => props.onOpen(entry.path)}
            title={entry.path}
            aria-current={props.active === entry.path ? "page" : undefined}
          >
            {entry.kind === "image" ? (
              <Image size={16} />
            ) : (
              <FileText size={16} />
            )}
            <span dir="auto">{basename(entry.path)}</span>
          </button>
        ),
      )}
    </div>
  );
}

function FolderBranch(
  props: { path: string; entries: Entry[] } & Pick<
    Props,
    "active" | "selectedFolder" | "onFolder" | "onOpen"
  >,
) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        className={`tree-row folder-row ${props.selectedFolder === props.path ? "folder-selected" : ""}`}
        onClick={() => {
          setOpen(!open);
          props.onFolder(props.path);
        }}
        aria-expanded={open}
      >
        <span className="chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        {open ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span>{basename(props.path)}</span>
      </button>
      {open && <FolderNode {...props} />}
    </div>
  );
}

export function Sidebar(props: Props) {
  const tags = [...new Set(props.entries.flatMap((entry) => entry.tags))].sort(
    (a, b) => a.localeCompare(b),
  );
  return (
    <aside className="sidebar">
      <div className="workspace-picker">
        <span style={{ color: props.workspace?.color ?? "var(--purple)" }}>
          <WorkspaceIcon icon={props.workspace?.icon ?? "book"} />
        </span>
        <select
          aria-label="Workspace"
          value={props.workspace?.id ?? ""}
          onChange={(event) => {
            if (event.target.value === "__open__") props.onAddWorkspace();
            else props.onWorkspace(event.target.value);
          }}
        >
          {!props.workspace && <option value="">Choose a workspace</option>}
          {props.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
          <option value="__open__">Open another folder…</option>
        </select>
        {props.workspace && (
          <button
            className="icon-button small"
            aria-label="Workspace settings"
            onClick={props.onSettings}
          >
            <Settings2 size={14} />
          </button>
        )}
      </div>
      <button className="sidebar-search" onClick={() => props.onSearch()}>
        <Search size={15} />
        <span>Search all notes</span>
        <kbd>Ctrl P</kbd>
      </button>
      <div className="sidebar-section">
        <button
          className={`section-name ${!props.selectedFolder ? "selected-root" : ""}`}
          onClick={() => props.onFolder("")}
        >
          Files
        </button>
        <span className="flex-1" />
        {props.workspace && (
          <>
            <button
              className="icon-button small"
              title="New note (Ctrl+N)"
              aria-label="New note"
              onClick={props.onNewNote}
            >
              <FilePlus2 size={15} />
            </button>
            <button
              className="icon-button small"
              title="New folder"
              aria-label="New folder"
              onClick={props.onNewFolder}
            >
              <FolderPlus size={15} />
            </button>
          </>
        )}
      </div>
      <div className="sidebar-scroll">
        <nav className="file-tree" aria-label="Workspace files">
          <FolderNode
            key={props.workspace?.id}
            path=""
            entries={props.entries}
            active={props.active}
            selectedFolder={props.selectedFolder}
            onFolder={props.onFolder}
            onOpen={props.onOpen}
          />
        </nav>
        {!!tags.length && (
          <div className="tag-section">
            <div className="section-name">Tags</div>
            {tags.map((tag) => (
              <button
                className="tag-row"
                key={tag}
                onClick={() => props.onSearch("#" + tag)}
              >
                <Hash size={14} />
                <span dir="auto">{tag}</span>
              </button>
            ))}
          </div>
        )}
        {props.workspace && !props.entries.length && (
          <div className="sidebar-empty">
            No notes yet.
            <br />
            Press <kbd>Ctrl N</kbd> to start.
          </div>
        )}
      </div>
      <div className="workspace-path" title={props.workspace?.path}>
        {props.workspace?.path ?? "Local Markdown notes"}
      </div>
    </aside>
  );
}
