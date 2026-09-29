import { useState, type MouseEvent } from "react";
import {
  BookOpen,
  Braces,
  Briefcase,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Copy,
  PanelsLeftRight,
  PencilLine,
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
import { MenuButton, PopupMenu, type MenuAnchor } from "./PopupMenu";
import { run } from "../domain/app-store";
import { copyText } from "../platform";
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
  onOpenSplit: (path: string) => void;
  onRename: (path: string) => void;
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
> & {
    onContextMenu: (event: MouseEvent<HTMLButtonElement>, entry: Entry) => void;
  }) {
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
            onContextMenu={(event) => props.onContextMenu(event, entry)}
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
  > & {
      onContextMenu: (
        event: MouseEvent<HTMLButtonElement>,
        entry: Entry,
      ) => void;
    },
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
  const [context, setContext] = useState<{
    entry: Entry;
    anchor: MenuAnchor;
  } | null>(null);
  const tags = [...new Set(props.entries.flatMap((entry) => entry.tags))].sort(
    (a, b) => a.localeCompare(b),
  );
  return (
    <aside className="sidebar">
      <div className="workspace-picker">
        <span style={{ color: props.workspace?.color ?? "var(--purple)" }}>
          <WorkspaceIcon icon={props.workspace?.icon ?? "book"} />
        </span>
        <MenuButton
          label="Workspace"
          className="workspace-menu"
          actions={[
            ...props.workspaces.map((workspace) => ({
              id: workspace.id,
              label: workspace.name,
              selected: workspace.id === props.workspace?.id,
              icon: (
                <span style={{ color: workspace.color }}>
                  <WorkspaceIcon icon={workspace.icon} size={16} />
                </span>
              ),
              onSelect: () => props.onWorkspace(workspace.id),
            })),
            {
              id: "open-folder",
              label: "Open another folder…",
              icon: <FolderOpen size={16} />,
              onSelect: props.onAddWorkspace,
            },
          ]}
        >
          {props.workspace?.name ?? "Choose a workspace"}
        </MenuButton>
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
            onContextMenu={(event, entry) => {
              event.preventDefault();
              const trigger = event.currentTarget;
              const box = trigger.getBoundingClientRect();
              setContext({
                entry,
                anchor: {
                  x: event.clientX || box.left + 16,
                  y: event.clientY || box.bottom,
                  trigger,
                },
              });
            }}
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
      {context && (
        <PopupMenu
          label="File actions"
          anchor={context.anchor}
          onClose={() => setContext(null)}
          actions={[
            {
              id: "open",
              label: "Open",
              icon: <FileText size={15} />,
              onSelect: () => props.onOpen(context.entry.path),
            },
            {
              id: "split",
              label: "Open in split pane",
              icon: <PanelsLeftRight size={15} />,
              onSelect: () => props.onOpenSplit(context.entry.path),
            },
            ...(context.entry.kind === "note"
              ? [
                  {
                    id: "rename",
                    label: "Rename or move…",
                    icon: <PencilLine size={15} />,
                    onSelect: () => props.onRename(context.entry.path),
                  },
                ]
              : []),
            {
              id: "copy",
              label: "Copy path",
              icon: <Copy size={15} />,
              onSelect: () =>
                run(
                  copyText(
                    props.workspace
                      ? `${props.workspace.path}/${context.entry.path}`
                      : context.entry.path,
                  ),
                ),
            },
          ]}
        />
      )}
      <div className="workspace-path" title={props.workspace?.path}>
        {props.workspace?.path ?? "Local Markdown notes"}
      </div>
    </aside>
  );
}
