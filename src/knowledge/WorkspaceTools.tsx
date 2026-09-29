import {
  Command,
  Search,
  ListTodo,
  Columns3,
  Inbox,
  CalendarDays,
  Star,
  FilePlus2,
} from "lucide-react";
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
  | "templates";
export function WorkspaceTools({
  onTool,
}: {
  onTool: (tool: WorkspaceTool) => void;
}) {
  const favorites = useLibrary((s) => s.favorites),
    error = useLibrary((s) => s.error),
    entries = useApp((s) => s.entries),
    id = useApp((s) => s.activeWorkspaceId);
  const pins = favorites.filter((f) => f.workspaceId === id);
  return (
    <>
      <div className="workspace-tools" aria-label="Workspace tools">
        <button
          title="Search contents (Ctrl+Shift+P)"
          aria-label="Search contents"
          onClick={() => onTool("contents")}
        >
          <Search size={15} />
        </button>
        <button
          title="Commands (Ctrl+K)"
          aria-label="Commands"
          onClick={() => onTool("commands")}
        >
          <Command size={15} />
        </button>
        <button
          title="Quick capture (Ctrl+Shift+N)"
          aria-label="Quick capture"
          onClick={() => onTool("capture")}
        >
          <Inbox size={15} />
        </button>
        <button
          title="Open today's note (Ctrl+Shift+D)"
          aria-label="Open today's note"
          onClick={() => onTool("daily")}
        >
          <CalendarDays size={15} />
        </button>
        <button
          title="New from template"
          aria-label="New from template"
          disabled={!id}
          onClick={() => onTool("templates")}
        >
          <FilePlus2 size={15} />
        </button>
        <button
          title="Workspace tasks"
          aria-label="Workspace tasks"
          disabled={!id}
          onClick={() => onTool("tasks")}
        >
          <ListTodo size={15} />
        </button>
        <button
          title="Projects and assignments"
          aria-label="Projects and assignments"
          disabled={!id}
          onClick={() => onTool("projects")}
        >
          <Columns3 size={15} />
        </button>
      </div>
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
