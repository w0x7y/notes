import { useDeferredValue, useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { MenuButton } from "../components/PopupMenu";
import { parentFolder } from "../domain/notes";
import { navigateTo, useApp } from "../domain/app-store";
import { useKnowledge } from "./index";
import { emptyFilters, searchContent, type ContentFilters } from "./model";
import { removeSearch, saveSearch, useLibrary } from "../domain/library";
import "./knowledge.css";
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const parts = text.split(new RegExp(`(${escaped})`, "giu"));
  return (
    <>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>
  );
}
export function ContentSearchDialog({ onClose }: { onClose: () => void }) {
  const [filters, setFilters] = useState<ContentFilters>({ ...emptyFilters });
  const [selected, setSelected] = useState(0),
    [name, setName] = useState("");
  const deferred = useDeferredValue(filters);
  const { notes, loading, errors } = useKnowledge();
  const workspaces = useApp((s) => s.workspaces),
    current = useApp((s) => s.activeWorkspaceId);
  const saved = useLibrary((s) => s.savedSearches),
    storageError = useLibrary((s) => s.error);
  const results = useMemo(
    () => searchContent(notes, deferred, current),
    [notes, deferred, current],
  );
  const choose = (position: number) => {
    const result = results[position];
    if (result) {
      navigateTo(result.note.workspaceId, result.note.path, result.offset);
      onClose();
    }
  };
  const change = (key: keyof ContentFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSelected(0);
  };
  const folders = [
    ...new Set(
      notes
        .filter(
          (n) => !filters.workspace || n.workspaceId === filters.workspace,
        )
        .map((n) => parentFolder(n.path))
        .filter(Boolean),
    ),
  ].sort();
  const tags = [...new Set(notes.flatMap((n) => n.tags))].sort();
  return (
    <Dialog
      title="Search note contents"
      onClose={onClose}
      className="search-dialog content-search-dialog"
    >
      <div className="search-field">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search note contents"
          placeholder="Find words in your notes…"
          value={filters.query}
          onChange={(e) => change("query", e.target.value)}
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
                .getElementById(`content-result-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(Math.min(selected, results.length - 1));
            }
          }}
          role="combobox"
          aria-controls="content-results"
          aria-expanded="true"
          aria-activedescendant={
            results[selected] ? `content-result-${selected}` : undefined
          }
        />
      </div>
      <div className="content-filters">
        <MenuButton
          label="Filter workspace"
          className="button"
          actions={[
            {
              id: "all",
              label: "All workspaces",
              onSelect: () => change("workspace", ""),
            },
            ...workspaces.map((w) => ({
              id: w.id,
              label: w.name,
              onSelect: () => change("workspace", w.id),
            })),
          ]}
        >
          {workspaces.find((w) => w.id === filters.workspace)?.name ??
            "All workspaces"}
        </MenuButton>
        <label>
          Folder
          <input
            aria-label="Filter folder"
            list="search-folders"
            placeholder="Any folder"
            value={filters.folder}
            onChange={(e) => change("folder", e.target.value)}
          />
        </label>
        <label>
          Tag
          <input
            aria-label="Filter tag"
            list="search-tags"
            placeholder="#tag"
            value={filters.tag}
            onChange={(e) => change("tag", e.target.value)}
          />
        </label>
        <datalist id="search-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <datalist id="search-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {!!saved.length && (
        <div className="saved-searches">
          {saved.map((s) => (
            <span key={s.id}>
              <button
                onClick={() => {
                  setFilters(s.filters);
                  setSelected(0);
                }}
              >
                {s.name}
              </button>
              <button
                aria-label={`Delete saved search ${s.name}`}
                onClick={() => removeSearch(s.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className="search-results"
        id="content-results"
        role="listbox"
        aria-label="Content matches"
        aria-busy={loading}
      >
        {results.map((r, i) => (
          <button
            id={`content-result-${i}`}
            key={`${r.note.workspaceId}:${r.note.path}`}
            role="option"
            aria-selected={i === selected}
            className={`search-result content-result ${i === selected ? "selected" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(i)}
          >
            <span className="result-title" dir="auto">
              {r.note.title}
            </span>
            <small>
              {r.note.workspaceName} / {r.note.path}
            </small>
            <span className="result-snippet" dir="auto">
              <Highlight text={r.snippet} terms={r.terms} />
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="empty-search">
            {loading ? "Reading notes…" : "No matching note contents."}
          </p>
        )}
      </div>
      {!!errors.length && (
        <details className="index-errors">
          <summary>{errors.length} files could not be indexed</summary>
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </details>
      )}
      {storageError && <p role="alert">{storageError}</p>}
      <footer className="dialog-footer">
        <span>
          {loading
            ? "Updating index…"
            : `${results.length}${results.length === 150 ? "+" : ""} matching notes · current workspace first`}
        </span>
        <form
          className="save-search"
          onSubmit={(e) => {
            e.preventDefault();
            saveSearch(name, filters);
            setName("");
          }}
        >
          <input
            aria-label="Saved search name"
            value={name}
            placeholder="Name this search"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="icon-button"
            title="Save search"
            aria-label="Save search"
          >
            <Star size={15} />
          </button>
        </form>
      </footer>
    </Dialog>
  );
}
