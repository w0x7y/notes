import { useMemo, useRef, useState } from "react";
import { Dialog } from "../components/Dialog";
import { MenuButton } from "../components/PopupMenu";
import { loadDocument, navigateTo } from "../domain/app-store";
import { errorMessage } from "../domain/notes";
import { useKnowledge } from "./index";
import { toggleTask, type IndexedNote } from "./model";
import "./workspace-views.css";

type TaskFilter = "open" | "done" | "all";
const filters: { id: TaskFilter; label: string }[] = [
  { id: "open", label: "Open tasks" },
  { id: "done", label: "Completed tasks" },
  { id: "all", label: "All tasks" },
];

export function TasksDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { notes, loading, errors } = useKnowledge(workspaceId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const tasks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => !/^templates\//i.test(note.path))
      .flatMap((note) =>
        note.tasks
          .filter(
            (task) =>
              (filter === "all" || task.checked === (filter === "done")) &&
              `${task.text} ${note.title} ${note.path}`
                .toLocaleLowerCase()
                .includes(needle),
          )
          .map((task) => ({ note, task })),
      );
  }, [notes, query, filter]);

  async function check(
    note: IndexedNote,
    task: IndexedNote["tasks"][number],
    checked: boolean,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(`${note.path}:${task.offset}`);
    setError("");
    try {
      const document = await loadDocument(note.workspaceId, note.path);
      document.editFromAction(toggleTask(document.content, task, checked));
      await document.flush();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <Dialog
      title="Workspace tasks"
      onClose={onClose}
      className="knowledge-dialog"
      dismissible={!busy}
      busy={!!busy}
    >
      <div className="knowledge-filters">
        <input
          autoFocus
          aria-label="Filter tasks"
          placeholder="Filter tasks or notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <MenuButton
          label="Task completion filter"
          actions={filters.map((item) => ({
            ...item,
            selected: filter === item.id,
            onSelect: () => setFilter(item.id),
          }))}
        >
          {filters.find((item) => item.id === filter)?.label}
        </MenuButton>
      </div>
      {error && (
        <p className="knowledge-error" role="alert">
          {error}
        </p>
      )}
      {errors.length > 0 && (
        <p className="knowledge-error" role="alert">
          Some notes could not be read: {errors.join("; ")}
        </p>
      )}
      <div className="knowledge-task-list" aria-busy={loading}>
        {tasks.map(({ note, task }) => {
          const key = `${note.path}:${task.offset}`;
          return (
            <div
              className={`knowledge-task ${task.checked ? "is-complete" : ""}`}
              key={key}
            >
              <input
                type="checkbox"
                checked={task.checked}
                disabled={!!busy}
                aria-label={`Mark ${task.text} ${task.checked ? "incomplete" : "complete"}`}
                onChange={(event) =>
                  void check(note, task, event.target.checked)
                }
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  navigateTo(note.workspaceId, note.path, task.offset);
                  onClose();
                }}
              >
                <span dir="auto">{task.text || "Untitled task"}</span>
                <small>
                  {note.path}
                  {busy === key ? " · Saving…" : ""}
                </small>
              </button>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <p className="knowledge-empty">
            {loading
              ? "Reading workspace…"
              : query
                ? "No matching tasks."
                : filter === "open"
                  ? "No open tasks. Add a checklist to any note."
                  : "No tasks in this view."}
          </p>
        )}
      </div>
      <div className="dialog-footer">
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"} · Changes are
        saved to the original note.
      </div>
    </Dialog>
  );
}
