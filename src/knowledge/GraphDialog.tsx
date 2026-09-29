import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Network, Settings2 } from "lucide-react";
import { Dialog } from "../components/Dialog";
import { MenuButton } from "../components/PopupMenu";
import { openFile, useApp } from "../domain/app-store";
import { GraphCanvas } from "./GraphCanvas";
import {
  buildGraphLayout,
  connectGraph,
  graphNoteId,
  type GraphNode,
} from "./graph";
import { useKnowledge } from "./index";
import "./graph.css";

export function GraphDialog({
  workspaceId,
  initialPath,
  onClose,
  onSettings,
}: {
  workspaceId: string;
  initialPath: string | null;
  onClose: () => void;
  onSettings: () => void;
}) {
  const workspaces = useApp((s) => s.workspaces);
  const entries = useApp((s) => s.entries);
  const strength = useApp((s) => s.preferences.graphBundling);
  const [scope, setScope] = useState<"current" | "all">("current");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialPath ? graphNoteId(workspaceId, initialPath) : null,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const { notes, loading, errors } = useKnowledge(
    scope === "all" ? undefined : workspaceId,
  );
  const analyzed = useDeferredValue(notes);
  const search = useDeferredValue(query)
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase();
  const layout = useMemo(
    () =>
      buildGraphLayout({
        workspaces,
        entries,
        workspaceId: scope === "all" ? undefined : workspaceId,
      }),
    [workspaces, entries, scope, workspaceId],
  );
  const graph = useMemo(
    () => connectGraph(layout, analyzed),
    [layout, analyzed],
  );
  const matching = useMemo(
    () =>
      layout.nodes.filter((n) =>
        `${n.note.title} ${n.note.path} ${n.note.workspaceName}`
          .normalize("NFC")
          .toLocaleLowerCase()
          .includes(search),
      ),
    [layout, search],
  );
  const matches = useMemo(() => new Set(matching.map((n) => n.id)), [matching]);
  const selected =
    (selectedId && matches.has(selectedId)
      ? layout.byId.get(selectedId)
      : undefined) ?? matching[0];
  const incoming = useMemo(
    () =>
      graph.links
        .filter((e) => e.target.id === selected?.id)
        .map((e) => e.source),
    [graph.links, selected],
  );
  const outgoing = useMemo(
    () =>
      graph.links
        .filter((e) => e.source.id === selected?.id)
        .map((e) => e.target),
    [graph.links, selected],
  );
  const open = (node: GraphNode) => {
    openFile(node.note.workspaceId, node.note.path);
    onClose();
  };
  const workspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? "Current workspace";
  const noteButton = (node: GraphNode, openDirectly = false) => (
    <button
      key={node.id}
      type="button"
      className={`graph-note-item ${node.id === selected?.id ? "is-selected" : ""}`}
      aria-pressed={node.id === selected?.id}
      onFocus={openDirectly ? undefined : () => setSelectedId(node.id)}
      onClick={() => (openDirectly ? open(node) : setSelectedId(node.id))}
      onDoubleClick={openDirectly ? undefined : () => open(node)}
    >
      <span dir="auto">{node.note.title || node.note.path}</span>
      <small dir="auto">
        {node.note.workspaceName} / {node.note.path}
      </small>
    </button>
  );
  return (
    <Dialog title="Note graph" onClose={onClose} className="graph-dialog">
      <div className="graph-toolbar">
        <input
          autoFocus
          aria-label="Find a note in graph"
          placeholder="Find a note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus();
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const first = matching[0];
              if (first) open(first);
            }
          }}
        />
        <MenuButton
          label="Graph scope"
          actions={[
            {
              id: "current",
              label: workspaceName,
              selected: scope === "current",
              onSelect: () => {
                setScope("current");
                setSelectedId(null);
              },
            },
            {
              id: "all",
              label: "All workspaces",
              selected: scope === "all",
              onSelect: () => {
                setScope("all");
                setSelectedId(null);
              },
            },
          ]}
        >
          {scope === "all" ? "All workspaces" : workspaceName}
        </MenuButton>
        <button
          className="icon-button"
          aria-label="Graph settings"
          title="Change bundling strength in Settings"
          onClick={onSettings}
        >
          <Settings2 size={17} />
        </button>
      </div>
      <div className="graph-workspace-key" aria-label="Workspace colors">
        {workspaces
          .filter((w) => scope === "all" || w.id === workspaceId)
          .map((w) => (
            <span key={w.id}>
              <i style={{ background: w.color }} />
              {w.name}
            </span>
          ))}
        <span className="graph-strength">
          Bundling {Math.round(strength * 100)}%
        </span>
      </div>
      {(errors.length > 0 || graph.unresolved > 0) && (
        <div className="graph-warning" role="status">
          {errors.length > 0 && (
            <span title={errors.join("; ")}>
              {errors.length}{" "}
              {errors.length === 1 ? "note could" : "notes could"} not be read.
              Connections may be incomplete.{" "}
            </span>
          )}
          {graph.unresolved > 0 && (
            <span>
              {graph.unresolved} unresolved note{" "}
              {graph.unresolved === 1 ? "link" : "links"}.
            </span>
          )}
        </div>
      )}
      <div className="graph-layout" aria-busy={loading}>
        {layout.nodes.length > 0 ? (
          <GraphCanvas
            key={scope}
            layout={layout}
            links={graph.links}
            strength={strength}
            selected={selected}
            matches={matches}
            onSelect={setSelectedId}
            onOpen={open}
          />
        ) : (
          <div className="graph-empty">
            <Network size={30} strokeWidth={1.25} />
            <h3>No notes to map yet</h3>
            <p>Create Markdown notes and link them with [[note name]].</p>
          </div>
        )}
        <aside
          className="graph-details"
          aria-label="Graph notes and connections"
        >
          <h3>
            Notes <span>{matching.length}</span>
          </h3>
          <div
            className="graph-note-list"
            ref={listRef}
            onKeyDown={(e) => {
              if (!(e.target instanceof HTMLButtonElement)) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const sibling =
                  e.key === "ArrowDown"
                    ? e.target.nextElementSibling
                    : e.target.previousElementSibling;
                if (sibling instanceof HTMLButtonElement) {
                  sibling.focus();
                  sibling.scrollIntoView({ block: "nearest" });
                }
              }
              if (e.key === "Enter" && selected) {
                e.preventDefault();
                open(selected);
              }
            }}
          >
            {matching.map((node) => noteButton(node))}
            {layout.nodes.length > 0 && !matching.length && (
              <p className="graph-hint">No matching notes.</p>
            )}
          </div>
          {selected && (
            <div className="graph-selection">
              <h3 dir="auto">{selected.note.title || selected.note.path}</h3>
              <p className="graph-hint" dir="auto">
                {selected.note.workspaceName} / {selected.note.path}
              </p>
              <button className="button" onClick={() => open(selected)}>
                Open note
              </button>
              <section aria-label="Incoming graph links">
                <h4 className="graph-incoming">
                  Incoming <span>{incoming.length}</span>
                </h4>
                {incoming.map((node) => noteButton(node, true))}
              </section>
              <section aria-label="Outgoing graph links">
                <h4 className="graph-outgoing">
                  Outgoing <span>{outgoing.length}</span>
                </h4>
                {outgoing.map((node) => noteButton(node, true))}
              </section>
              {!loading && !incoming.length && !outgoing.length && (
                <p className="graph-hint">
                  No connections in this scope. Add a [[note link]] to connect
                  it.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
      <footer className="dialog-footer graph-footer">
        <span>
          {layout.nodes.length} notes · {graph.links.length} connections
          {loading ? " · Reading notes…" : ""}
        </span>
        <span>Select to inspect · Enter or double-click to open</span>
      </footer>
    </Dialog>
  );
}
