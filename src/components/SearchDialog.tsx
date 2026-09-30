import { useMemo, useState } from "react";
import { openFile, useApp } from "../domain/app-store";
import { searchNotes } from "../domain/search";
import { Dialog } from "./Dialog";
import { BrandMark } from "./BrandMark";
import { ItemIcon } from "./ItemIcon";

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
  const preferences = useApp((state) => state.preferences);
  const current = useApp((state) => state.activeWorkspaceId);
  const appearances = useApp((state) => state.appearances);
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
    () =>
      searchNotes(index, query, current, {
        scope: preferences.searchScope,
        currentWorkspaceFirst: preferences.currentWorkspaceFirst,
        limit: preferences.searchLimit,
      }),
    [
      index,
      query,
      current,
      preferences.searchScope,
      preferences.currentWorkspaceFirst,
      preferences.searchLimit,
    ],
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
      title={
        preferences.searchScope === "current"
          ? "Search this workspace"
          : "Search all notes"
      }
      className="search-dialog note-search-dialog"
      onClose={onClose}
    >
      <div className="search-field">
        <BrandMark size={24} />
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
            <span
              className="result-note-icon"
              style={{
                color:
                  appearances[result.workspaceId]?.[result.path]?.color ??
                  result.color,
              }}
            >
              <ItemIcon
                name={appearances[result.workspaceId]?.[result.path]?.icon}
                fallback="file"
                size={17}
              />
            </span>
            <span className="result-content">
              <span className="result-title" dir="auto">
                {result.title}
              </span>
              <small className="result-location">
                <span className="result-workspace">
                  <span
                    className="workspace-dot"
                    style={{ background: result.color }}
                  />
                  {result.workspaceName}
                </span>
                <span className="result-path" dir="auto">
                  {result.path}
                </span>
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
        <span>
          {results.length} {results.length === 1 ? "note" : "notes"} ·{" "}
          {preferences.searchScope === "current"
            ? "Current workspace only"
            : preferences.currentWorkspaceFirst
              ? "Current workspace first"
              : "All workspaces"}
        </span>
        <span>
          <kbd>↑↓</kbd> navigate <kbd>Enter</kbd> open <kbd>Esc</kbd> close
        </span>
      </footer>
    </Dialog>
  );
}
