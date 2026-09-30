import { WorkspaceTools, PinnedNotes } from "../knowledge/WorkspaceTools";
import { useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Copy,
  PanelsLeftRight,
  PencilLine,
  FileText,
  FolderPlus,
  FolderOpen,
  Hash,
  Palette,
  Trash2,
  Search,
  Settings,
  CalendarDays,
  SquarePen,
} from "lucide-react";
import { ItemIcon } from "./ItemIcon";
import { BrandMark } from "./BrandMark";
import type { Appearance, Entry, Workspace } from "../domain/contracts";
import { MenuButton, PopupMenu, type MenuAnchor } from "./PopupMenu";
import { buildFileTree } from "../domain/file-tree";
import { run, useApp } from "../domain/app-store";
import { copyText } from "../platform";
import { basename } from "../domain/notes";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "../domain/workspace-commands";
import { entryColor } from "../domain/appearance";

export function WorkspaceIcon({
  icon,
  size = 19,
}: {
  icon: string;
  size?: number;
}) {
  return <ItemIcon name={icon} fallback="workspace" size={size} />;
}

type Props = {
  workspaces: Workspace[];
  workspace: Workspace | undefined;
  entries: Entry[];
  appearances: Record<string, Appearance>;
  active: string | null;
  selectedFolder: string;
  onFolder: (path: string) => void;
  onOpen: (path: string) => void;
  onOpenSplit: (path: string) => void;
  onRename: (path: string) => void;
  onMove: (path: string, folder: string) => void;
  onAppearance: (path: string) => void;
  onDelete: (path: string) => void;
  onWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onAppSettings: () => void;
  onSearch: (tag?: string) => void;
  commands: WorkspaceCommand[];
  onCommand: (id: WorkspaceCommandId) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
};

const dragType = "application/x-notes-entry";
type DragProps = {
  workspaceId?: string;
  dropTarget: string | null;
  setDropTarget: (path: string | null) => void;
  onMove: Props["onMove"];
};
function startDrag(
  event: DragEvent<HTMLButtonElement>,
  path: string,
  workspaceId?: string,
) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(dragType, JSON.stringify({ path, workspaceId }));
  event.dataTransfer.setData("text/plain", path);
}
function canDrop(event: DragEvent, folder: string, workspaceId?: string) {
  if (!workspaceId || !event.dataTransfer.types.includes(dragType))
    return false;
  const source = event.dataTransfer.getData(dragType);
  if (!source) return true;
  try {
    const item = JSON.parse(source) as { path: string; workspaceId: string };
    return (
      item.workspaceId === workspaceId &&
      item.path !== folder &&
      !folder.startsWith(item.path + "/")
    );
  } catch {
    return false;
  }
}
function drop(event: DragEvent, folder: string, props: DragProps) {
  event.preventDefault();
  props.setDropTarget(null);
  try {
    const item = JSON.parse(event.dataTransfer.getData(dragType)) as {
      path: string;
      workspaceId: string;
    };
    if (
      item.workspaceId === props.workspaceId &&
      item.path !== folder &&
      !folder.startsWith(item.path + "/")
    )
      props.onMove(item.path, folder);
  } catch {
    /* Ignore other drag sources. */
  }
}

function FolderNode({
  path,
  tree,
  ...props
}: { path: string; tree: ReadonlyMap<string, Entry[]> } & Pick<
  Props,
  "active" | "selectedFolder" | "onFolder" | "onOpen" | "appearances"
> &
  DragProps & {
    onContextMenu: (event: MouseEvent<HTMLButtonElement>, entry: Entry) => void;
  }) {
  const children = tree.get(path) ?? [];
  return (
    <div className={path ? "tree-nested" : "tree-root"}>
      {children.map((entry) =>
        entry.kind === "folder" ? (
          <FolderBranch
            key={entry.path}
            path={entry.path}
            entry={entry}
            tree={tree}
            {...props}
          />
        ) : (
          <button
            key={entry.path}
            draggable
            onDragStart={(event) =>
              startDrag(event, entry.path, props.workspaceId)
            }
            className={`tree-row ${props.active === entry.path ? "active" : ""}`}
            onClick={() => props.onOpen(entry.path)}
            onContextMenu={(event) => props.onContextMenu(event, entry)}
            title={entry.path}
            style={{ color: entryColor(entry.path, props.appearances) }}
            aria-current={props.active === entry.path ? "page" : undefined}
          >
            <ItemIcon
              name={props.appearances[entry.path]?.icon}
              fallback={entry.kind === "image" ? "image" : "file"}
              size={16}
            />
            <span dir="auto">{basename(entry.path)}</span>
          </button>
        ),
      )}
    </div>
  );
}

function FolderBranch(
  props: {
    path: string;
    tree: ReadonlyMap<string, Entry[]>;
    entry: Entry;
  } & Pick<
    Props,
    "active" | "selectedFolder" | "onFolder" | "onOpen" | "appearances"
  > &
    DragProps & {
      onContextMenu: (
        event: MouseEvent<HTMLButtonElement>,
        entry: Entry,
      ) => void;
    },
) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className={`tree-row folder-row ${props.selectedFolder === props.path ? "folder-selected" : ""} ${props.dropTarget === props.path ? "drop-target" : ""}`}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          startDrag(event, props.path, props.workspaceId);
        }}
        onDragOver={(event) => {
          if (canDrop(event, props.path, props.workspaceId)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            props.setDropTarget(props.path);
          }
        }}
        onDragLeave={() => props.setDropTarget(null)}
        onDrop={(event) => {
          event.stopPropagation();
          drop(event, props.path, props);
        }}
        onClick={() => {
          setOpen(!open);
          props.onFolder(props.path);
        }}
        aria-expanded={open}
        style={{ color: entryColor(props.path, props.appearances) }}
        onContextMenu={(event) => props.onContextMenu(event, props.entry)}
      >
        <span className="chevron">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <ItemIcon
          name={props.appearances[props.path]?.icon}
          fallback={open ? "folder-open" : "folder"}
          size={16}
        />
        <span dir="auto">{basename(props.path)}</span>
      </button>
      {open && <FolderNode {...props} />}
    </div>
  );
}

export function Sidebar(props: Props) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [context, setContext] = useState<{
    entry: Entry;
    anchor: MenuAnchor;
  } | null>(null);
  const searchScope = useApp((state) => state.preferences.searchScope);
  const sort = useApp((state) => state.preferences.sortFilesBy);
  const tree = useMemo(
    () => buildFileTree(props.entries, sort),
    [props.entries, sort],
  );
  const tags = useMemo(
    () =>
      [...new Set(props.entries.flatMap((entry) => entry.tags))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [props.entries],
  );
  return (
    <aside className="sidebar">
      <div className="workspace-picker">
        <BrandMark size={28} />
        <MenuButton
          label="Workspace"
          className="workspace-menu"
          actions={[
            ...props.workspaces.map((workspace) => ({
              id: workspace.id,
              label: workspace.name,
              color: workspace.color,
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
          <span className="workspace-identity">
            <span className="workspace-app-name">Notes</span>
            <span
              className="workspace-current"
              style={{ color: props.workspace?.color ?? undefined }}
            >
              {props.workspace && (
                <WorkspaceIcon icon={props.workspace.icon} size={13} />
              )}
              <span dir="auto">
                {props.workspace?.name ?? "Choose a workspace"}
              </span>
            </span>
          </span>
        </MenuButton>
        <WorkspaceTools commands={props.commands} onCommand={props.onCommand} />
      </div>
      <button className="sidebar-search" onClick={() => props.onSearch()}>
        <Search size={15} />
        <span>
          {searchScope === "current"
            ? "Search this workspace"
            : "Search all notes"}
        </span>
        <kbd>Ctrl P</kbd>
      </button>
      <div className="sidebar-quick-actions" aria-label="Quick notes">
        <button
          onClick={() => props.onCommand("capture")}
          title="Quick capture (Ctrl+Shift+N)"
        >
          <SquarePen size={15} />
          <span>Capture</span>
        </button>
        <button
          onClick={() => props.onCommand("daily")}
          title="Today's note (Ctrl+Shift+D)"
        >
          <CalendarDays size={15} />
          <span>Today</span>
        </button>
      </div>
      <PinnedNotes />
      <div className="sidebar-section">
        <button
          className={`section-name ${!props.selectedFolder ? "selected-root" : ""} ${dropTarget === "" ? "drop-target" : ""}`}
          onDragOver={(event) => {
            if (canDrop(event, "", props.workspace?.id)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget("");
            }
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) =>
            drop(event, "", {
              workspaceId: props.workspace?.id,
              dropTarget,
              setDropTarget,
              onMove: props.onMove,
            })
          }
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
            tree={tree}
            appearances={props.appearances}
            active={props.active}
            selectedFolder={props.selectedFolder}
            onFolder={props.onFolder}
            onOpen={props.onOpen}
            workspaceId={props.workspace?.id}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onMove={props.onMove}
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
            <BrandMark size={22} />
            <span>Your workspace is ready.</span>
            <button onClick={props.onNewNote}>
              Create your first note <kbd>Ctrl N</kbd>
            </button>
          </div>
        )}
      </div>
      {context && (
        <PopupMenu
          label="File actions"
          anchor={context.anchor}
          onClose={() => setContext(null)}
          actions={[
            ...(context.entry.kind !== "folder"
              ? [
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
                  {
                    id: "rename",
                    label: "Rename or move…",
                    icon: <PencilLine size={15} />,
                    onSelect: () => props.onRename(context.entry.path),
                  },
                ]
              : [
                  {
                    id: "rename",
                    label: "Rename or move…",
                    icon: <PencilLine size={15} />,
                    onSelect: () => props.onRename(context.entry.path),
                  },
                ]),
            {
              id: "appearance",
              label: "Icon and color…",
              icon: <Palette size={15} />,
              onSelect: () => props.onAppearance(context.entry.path),
            },
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
            {
              id: "delete",
              label: "Delete…",
              danger: true,
              icon: <Trash2 size={15} />,
              onSelect: () => props.onDelete(context.entry.path),
            },
          ]}
        />
      )}
      <div className="workspace-path" title={props.workspace?.path}>
        {props.workspace?.path ?? "Local Markdown notes"}
      </div>
      <button
        className="app-settings-button"
        onClick={props.onAppSettings}
        aria-label="App settings"
        title="App settings (Ctrl+,)"
      >
        <Settings size={15} />
        <span>Settings</span>
        <kbd>Ctrl ,</kbd>
      </button>
    </aside>
  );
}
