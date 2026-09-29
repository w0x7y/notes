import {
  Command,
  Search,
  ListTodo,
  Columns3,
  Inbox,
  CalendarDays,
  Star,
  FilePlus2,
  Ellipsis,
  Settings2,
  Network,
} from "lucide-react";
import { MenuButton } from "../components/PopupMenu";
import { openFile, useApp } from "../domain/app-store";
import { useLibrary, toggleFavorite } from "./library";
import "./knowledge.css";
export type WorkspaceTool =
  | "contents"
  | "commands"
  | "tasks"
  | "projects"
  | "capture"
  | "daily"
  | "templates"
  | "graph";
export function WorkspaceTools({
  onTool,
  onSettings,
}: {
  onTool: (tool: WorkspaceTool) => void;
  onSettings?: () => void;
}) {
  const workspaceId = useApp((state) => state.activeWorkspaceId);
  return (
    <MenuButton
      label="Workspace tools"
      className="workspace-tools-menu"
      actions={[
        {
          id: "commands",
          label: "Commands",
          shortcut: "Ctrl K",
          icon: <Command size={15} />,
          onSelect: () => onTool("commands"),
        },
        {
          id: "contents",
          label: "Search contents",
          shortcut: "Ctrl Shift P",
          icon: <Search size={15} />,
          onSelect: () => onTool("contents"),
        },
        {
          id: "capture",
          label: "Quick capture",
          shortcut: "Ctrl Shift N",
          separatorBefore: true,
          icon: <Inbox size={15} />,
          onSelect: () => onTool("capture"),
        },
        {
          id: "daily",
          label: "Today's note",
          shortcut: "Ctrl Shift D",
          icon: <CalendarDays size={15} />,
          onSelect: () => onTool("daily"),
        },
        ...(workspaceId
          ? [
              {
                id: "templates",
                label: "New from template…",
                icon: <FilePlus2 size={15} />,
                onSelect: () => onTool("templates"),
              },
              {
                id: "graph",
                label: "Note graph",
                icon: <Network size={15} />,
                onSelect: () => onTool("graph"),
              },
              {
                id: "tasks",
                label: "Workspace tasks",
                separatorBefore: true,
                icon: <ListTodo size={15} />,
                onSelect: () => onTool("tasks"),
              },
              {
                id: "projects",
                label: "Projects and assignments",
                icon: <Columns3 size={15} />,
                onSelect: () => onTool("projects"),
              },
            ]
          : []),
        ...(onSettings
          ? [
              {
                id: "settings",
                label: "Workspace settings…",
                separatorBefore: true,
                icon: <Settings2 size={15} />,
                onSelect: onSettings,
              },
            ]
          : []),
      ]}
    >
      <Ellipsis size={17} />
    </MenuButton>
  );
}

export function PinnedNotes() {
  const favorites = useLibrary((s) => s.favorites),
    error = useLibrary((s) => s.error),
    entries = useApp((s) => s.entries),
    id = useApp((s) => s.activeWorkspaceId);
  const pins = favorites.filter((f) => f.workspaceId === id);
  return (
    <>
      {!!pins.length && (
        <div className="favorite-notes">
          <div className="section-name">Pinned</div>
          {pins.map((f) => (
            <div key={f.path}>
              <button
                className="favorite-note"
                title={f.path}
                onClick={() => openFile(f.workspaceId, f.path)}
              >
                <Star size={13} />
                <span dir="auto">
                  {entries[f.workspaceId]?.find((e) => e.path === f.path)
                    ?.title ?? f.path.split("/").at(-1)}
                </span>
              </button>
              <button
                className="unpin"
                aria-label={`Unpin ${f.path}`}
                onClick={() => toggleFavorite(f.workspaceId, f.path)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="index-errors">
          {error}
        </p>
      )}
    </>
  );
}
