import { useState } from "react";
import {
  CalendarDays,
  Command,
  FilePlus2,
  FolderOpen,
  LayoutList,
  Network,
  PanelLeft,
  PanelsLeftRight,
  RotateCw,
  Save,
  Search,
  Settings,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { Dialog } from "../components/Dialog";
import { BrandMark } from "../components/BrandMark";
import type {
  WorkspaceCommand,
  WorkspaceCommandId,
} from "../domain/workspace-commands";
import "./knowledge.css";
const commandIcons: Partial<Record<WorkspaceCommandId, LucideIcon>> = {
  titles: Search,
  contents: Search,
  capture: SquarePen,
  daily: CalendarDays,
  workspace: FolderOpen,
  settings: Settings,
  save: Save,
  sidebar: PanelLeft,
  split: PanelsLeftRight,
  refresh: RotateCw,
  graph: Network,
  tasks: LayoutList,
  projects: LayoutList,
  new: FilePlus2,
  lecture: FilePlus2,
  templates: FilePlus2,
};

function CommandIcon({ id }: { id: WorkspaceCommandId }) {
  const Icon = commandIcons[id] ?? Command;
  return <Icon size={16} />;
}
export function CommandDialog({
  commands,
  onChoose,
  onClose,
}: {
  commands: WorkspaceCommand[];
  onChoose: (id: WorkspaceCommandId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = commands.filter((c) =>
    terms.every((t) => c.label.toLocaleLowerCase().includes(t)),
  );
  const choose = (i: number) => {
    const command = results[i];
    if (command) onChoose(command.id);
  };
  return (
    <Dialog
      title="Commands"
      onClose={onClose}
      className="search-dialog command-dialog"
    >
      <div className="search-field">
        <BrandMark size={24} />
        <input
          autoFocus
          placeholder="Find an action…"
          aria-label="Search commands"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.max(
                0,
                Math.min(
                  results.length - 1,
                  selected + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
              setSelected(next);
              document
                .getElementById(`command-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(selected);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={
            results[selected] ? `command-${selected}` : undefined
          }
        />
      </div>
      <div
        className="search-results"
        id="command-results"
        role="listbox"
        aria-label="Available commands"
      >
        {results.map((c, i) => (
          <button
            id={`command-${i}`}
            key={c.id}
            role="option"
            aria-selected={selected === i}
            className={`search-result ${selected === i ? "selected" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(i)}
          >
            <span className="command-icon">
              <CommandIcon id={c.id} />
            </span>
            <span className="command-label">{c.label}</span>
            {c.shortcut && <kbd>{c.shortcut}</kbd>}
          </button>
        ))}
        {!results.length && (
          <p className="empty-search">No matching commands.</p>
        )}
      </div>
      <footer className="dialog-footer">
        <span>Type to find an action</span>
        <span>↑↓ select · Enter run · Esc close</span>
      </footer>
    </Dialog>
  );
}
