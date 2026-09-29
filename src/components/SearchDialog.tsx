import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { openFile, useApp } from "../domain/app-store";
import { searchNotes } from "../domain/search";
import { Dialog } from "./Dialog";

export function SearchDialog({
  onClose,
  initial = "",
}: {
  onClose: () => void;
  initial?: string;
}) {
  const [query, setQuery] = useState(initial);
  const [selected, setSelected] = useState(0);
  const entries = useApp((state) => state.entries);
  const workspaces = useApp((state) => state.workspaces);
  const current = useApp((state) => state.activeWorkspaceId);
  const index = useMemo(
    () =>
      workspaces.flatMap((workspace) =>
        (entries[workspace.id] ?? []).map((entry) => ({
          ...entry,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          color: workspace.color,
        })),
      ),
    [entries, workspaces],
  );
  const results = useMemo(
    () => searchNotes(index, query, current).slice(0, 60),
    [index, query, current],
  );
  function choose(position: number) {
    const result = results[position];
    if (result) {
      openFile(result.workspaceId, result.path);
      onClose();
    }
  }
  return (
    <Dialog
      title="Search all notes"
      className="search-dialog"
      onClose={onClose}
    >
      <div className="search-field">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search titles and tags"
          placeholder="Search titles or #tags…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => {
                const next = Math.max(
                  0,
                  Math.min(
                    results.length - 1,
                    value + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
                document
                  .getElementById(`result-${next}`)
                  ?.scrollIntoView({ block: "nearest" });
                return next;
              });
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(selected);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={
            results[selected] ? `result-${selected}` : undefined
          }
          autoComplete="off"
        />
      </div>
      <div
        className="search-results"
        id="search-results"
        role="listbox"
        aria-label="Matching notes"
      >
        {results.map((result, i) => (
          <button
            key={`${result.workspaceId}:${result.path}`}
            id={`result-${i}`}
            role="option"
            aria-selected={selected === i}
            className={`search-result ${selected === i ? "selected" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(i)}
          >
            <FileText size={18} style={{ color: result.color }} />
            <span className="min-w-0 flex-1">
              <span className="result-title" dir="auto">
                {result.title}
              </span>
              <small>
                {result.workspaceName} / {result.path}
              </small>
            </span>
            {result.workspaceId === current && (
              <span className="current-label">Current</span>
            )}
          </button>
        ))}
        {!results.length && (
          <p className="empty-search">No matching titles or tags.</p>
        )}
      </div>
      <footer className="dialog-footer">
        <span>Current workspace first</span>
        <span>
          <kbd>↑↓</kbd> navigate <kbd>Enter</kbd> open <kbd>Esc</kbd> close
        </span>
      </footer>
    </Dialog>
  );
}
