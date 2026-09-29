import { useCallback, useEffect, useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { MenuButton } from "../components/PopupMenu";
import { openFile, useApp } from "../domain/app-store";
import { entryColor } from "../domain/appearance";
import { useKnowledge } from "../knowledge";
import {
  matchesGraphQuery,
  noteId,
  type GraphNote,
  type GraphScope,
} from "./model";
import type { GraphRequest, GraphResult } from "./graph.worker";
import { GraphView } from "./GraphView";
import "./graph.css";

type LayoutState =
  | { kind: "loading" }
  | { kind: "ready"; result: GraphResult }
  | { kind: "error" };
export function GraphDialog({
  workspaceId,
  currentPath,
  onClose,
}: {
  workspaceId: string;
  currentPath: string | null;
  onClose: () => void;
}) {
  const { notes, loading, errors } = useKnowledge();
  const entries = useApp((state) => state.entries);
  const appearances = useApp((state) => state.appearances);
  const currentId = currentPath ? noteId(workspaceId, currentPath) : null;
  const [scope, setScope] = useState<GraphScope>({
    kind: "workspace",
    workspaceId,
  });
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [includeTemplates, setIncludeTemplates] = useState(false);
  const [labels, setLabels] = useState(true);
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const graphNotes = useMemo<GraphNote[]>(
    () =>
      notes
        .map((note) => ({
          id: noteId(note.workspaceId, note.path),
          workspaceId: note.workspaceId,
          workspaceName: note.workspaceName,
          path: note.path,
          title: note.title,
          tags: note.tags,
          color:
            entryColor(note.path, appearances[note.workspaceId] ?? {}) ??
            note.color,
          links: note.links.map((link) => link.target),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [notes, appearances],
  );
  useEffect(() => {
    setLayout({ kind: "loading" });
    if (loading) return;
    let dispose: (() => void) | undefined;
    try {
      const worker = new Worker(new URL("./graph.worker.ts", import.meta.url), {
        type: "module",
      });
      dispose = () => worker.terminate();
      worker.onmessage = (event: MessageEvent<GraphResult>) => {
        setLayout({ kind: "ready", result: event.data });
        worker.terminate();
      };
      worker.onerror = () => {
        setLayout({ kind: "error" });
        worker.terminate();
      };
      worker.postMessage({
        notes: graphNotes,
        entries,
        options: { scope, showUnlinked, includeTemplates },
      } satisfies GraphRequest);
    } catch {
      dispose?.();
      setLayout({ kind: "error" });
      return;
    }
    return dispose;
  }, [
    graphNotes,
    loading,
    scope,
    showUnlinked,
    includeTemplates,
    retry,
    entries,
  ]);
  const visibleNotes = useMemo(
    () =>
      layout.kind === "ready"
        ? layout.result.graph.nodes
            .filter((note) => matchesGraphQuery(note, query))
            .sort((a, b) => a.title.localeCompare(b.title))
        : [],
    [layout, query],
  );
  const matches = useMemo(
    () => (query.trim() ? new Set(visibleNotes.map((note) => note.id)) : null),
    [query, visibleNotes],
  );
  const open = useCallback(
    (note: GraphNote) => {
      onClose();
      openFile(note.workspaceId, note.path);
    },
    [onClose],
  );
  const currentExists = graphNotes.some((note) => note.id === currentId);
  const workspaceName =
    graphNotes.find((note) => note.workspaceId === workspaceId)
      ?.workspaceName ?? "Workspace";
  return (
    <Dialog title="Note graph" onClose={onClose} className="graph-dialog">
      <div className="graph-toolbar">
        <label className="graph-search">
          <Search size={15} />
          <input
            aria-label="Find in graph"
            placeholder="Find a note or #tag…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && visibleNotes[0]) {
                event.preventDefault();
                open(visibleNotes[0]);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                document
                  .querySelector<HTMLButtonElement>(".graph-note-list button")
                  ?.focus();
              }
            }}
          />
        </label>
        <MenuButton
          label="Graph scope"
          actions={[
            {
              id: "workspace",
              label: "Current workspace",
              selected: scope.kind === "workspace",
              onSelect: () => setScope({ kind: "workspace", workspaceId }),
            },
            {
              id: "all",
              label: "All workspaces",
              selected: scope.kind === "all",
              onSelect: () => setScope({ kind: "all" }),
            },
            ...(currentId && currentExists
              ? [
                  {
                    id: "local",
                    label: "Current note",
                    selected: scope.kind === "local",
                    onSelect: () =>
                      setScope({ kind: "local", noteId: currentId, depth: 1 }),
                  },
                ]
              : []),
          ]}
        >
          {scope.kind === "workspace"
            ? "Current workspace"
            : scope.kind === "all"
              ? "All workspaces"
              : "Current note"}
        </MenuButton>
        {scope.kind === "local" && (
          <MenuButton
            label="Connection depth"
            actions={([1, 2] as const).map((depth) => ({
              id: String(depth),
              label: `${depth} ${depth === 1 ? "step" : "steps"} away`,
              selected: scope.depth === depth,
              onSelect: () => setScope({ ...scope, depth }),
            }))}
          >
            {scope.depth === 1 ? "1 step" : "2 steps"}
          </MenuButton>
        )}
        <MenuButton
          label="Graph display options"
          actions={[
            {
              id: "unlinked",
              label: "Show unlinked notes",
              selected: showUnlinked,
              onSelect: () => setShowUnlinked((value) => !value),
            },
            {
              id: "labels",
              label: "Show titles",
              selected: labels,
              onSelect: () => setLabels((value) => !value),
            },
            {
              id: "templates",
              label: "Include templates",
              selected: includeTemplates,
              onSelect: () => setIncludeTemplates((value) => !value),
            },
          ]}
        >
          Display
        </MenuButton>
      </div>
      {errors.length > 0 && (
        <div className="index-errors" role="alert">
          Some notes could not be read. Their connections may be missing.
          <br />
          {errors.join(" · ")}
        </div>
      )}
      <div className="graph-content" aria-busy={layout.kind === "loading"}>
        {layout.kind === "loading" ? (
          <div className="graph-empty" role="status">
            <Network size={28} />
            <p>{loading ? "Reading note links…" : "Arranging notes…"}</p>
          </div>
        ) : layout.kind === "error" ? (
          <div className="graph-empty" role="alert">
            <p>The graph could not be arranged.</p>
            <button onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : layout.result.graph.nodes.length === 0 ? (
          <div className="graph-empty">
            <Network size={28} />
            <p>No notes to show with these settings.</p>
            <span>Try showing unlinked notes or including templates.</span>
          </div>
        ) : (
          <>
            <GraphView
              result={layout.result}
              currentId={currentId}
              matches={matches}
              focusedId={focusedId}
              labels={labels}
              onOpen={open}
            />
            <aside className="graph-note-list" aria-label="Notes in graph">
              <div className="graph-list-heading">
                {query.trim() ? "Matches" : "Notes"}
                <span>{visibleNotes.length}</span>
              </div>
              {visibleNotes.length === 0 && (
                <p className="graph-no-matches">No matching notes.</p>
              )}
              {visibleNotes.map((note) => (
                <button
                  key={note.id}
                  title={`${note.workspaceName} / ${note.path}`}
                  onFocus={() => setFocusedId(note.id)}
                  onBlur={() => setFocusedId(null)}
                  onMouseEnter={() => setFocusedId(note.id)}
                  onMouseLeave={() => setFocusedId(null)}
                  onClick={() => open(note)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "ArrowDown"
                        ? event.currentTarget.nextElementSibling
                        : event.currentTarget.previousElementSibling;
                    if (next instanceof HTMLButtonElement) next.focus();
                  }}
                >
                  <span
                    className="graph-note-dot"
                    style={{ background: note.color }}
                  />
                  <span>
                    <strong dir="auto">{note.title}</strong>
                    <small dir="auto">
                      {note.workspaceName} / {note.path}
                    </small>
                  </span>
                </button>
              ))}
            </aside>
          </>
        )}
      </div>
      <footer className="graph-footer">
        <span>
          {scope.kind === "workspace"
            ? workspaceName
            : scope.kind === "all"
              ? "All workspaces"
              : "Current note’s neighborhood"}
        </span>
        <span role="status">
          {layout.kind === "ready"
            ? `${layout.result.graph.nodes.length} ${layout.result.graph.nodes.length === 1 ? "note" : "notes"} · ${layout.result.graph.edges.length} ${layout.result.graph.edges.length === 1 ? "connection" : "connections"}`
            : ""}
        </span>
      </footer>
    </Dialog>
  );
}
