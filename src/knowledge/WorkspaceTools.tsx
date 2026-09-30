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
  type LucideIcon,
} from "lucide-react";
import { MenuButton } from "../components/PopupMenu";
import { openFile, useApp } from "../domain/app-store";
import { useLibrary, toggleFavorite } from "./library";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "../domain/workspace-commands";
import "./knowledge.css";
const toolIcons: Partial<Record<WorkspaceCommandId, LucideIcon>> = {
  commands: Command,
  contents: Search,
  capture: Inbox,
  daily: CalendarDays,
  templates: FilePlus2,
  graph: Network,
  tasks: ListTodo,
  projects: Columns3,
  "workspace-settings": Settings2,
};
function ToolIcon({ id }: { id: WorkspaceCommandId }) {
  const Icon = toolIcons[id] ?? Command;
  return <Icon size={15} />;
}
export function WorkspaceTools({
  commands,
  onCommand,
}: {
  commands: WorkspaceCommand[];
  onCommand: (id: WorkspaceCommandId) => void;
}) {
  return (
    <MenuButton
      label="Workspace tools"
      className="workspace-tools-menu"
      actions={commands.map((command) => ({
        id: command.id,
        label: command.tool?.label ?? command.label,
        shortcut: command.shortcut,
        separatorBefore: command.tool?.separatorBefore,
        icon: <ToolIcon id={command.id} />,
        onSelect: () => onCommand(command.id),
      }))}
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
