import { useState } from "react";
import { Command } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { showError } from "../domain/app-store";
import "./knowledge.css";
export type AppCommand = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};
export function CommandDialog({
  commands,
  onClose,
}: {
  commands: AppCommand[];
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
    if (command) {
      onClose();
      try {
        void Promise.resolve(command.run()).catch(showError);
      } catch (error) {
        showError(error);
      }
    }
  };
  return (
    <Dialog title="Commands" onClose={onClose} className="search-dialog">
      <div className="search-field">
        <Command size={19} />
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
            <span className="flex-1">{c.label}</span>
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
