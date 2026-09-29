import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog";
import { useApp } from "../domain/app-store";
import { errorMessage } from "../domain/notes";
import { createFromTemplate, ensureTemplates } from "./templates";
import "./knowledge.css";
export function TemplateDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const entries = useApp((s) => s.entries[workspaceId]);
  const [title, setTitle] = useState(""),
    [chosen, setChosen] = useState("Templates/Lecture.md"),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void ensureTemplates(workspaceId)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  const templates = (entries ?? []).filter(
    (e) => e.kind === "note" && e.path.startsWith("Templates/"),
  );
  return (
    <Dialog
      title="New note from template"
      onClose={onClose}
      busy={busy}
      dismissible={!busy}
      className="knowledge-dialog template-dialog"
    >
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void createFromTemplate(
            workspaceId,
            chosen,
            title.trim() ||
              chosen.split("/").at(-1)?.replace(/\.md$/i, "") ||
              "Note",
          )
            .then(onClose)
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Note title
          <input
            autoFocus
            value={title}
            placeholder="Lecture, assignment, or project title"
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <div
          className="template-options"
          role="radiogroup"
          aria-label="Template"
        >
          {templates.map((t) => (
            <label key={t.path}>
              <input
                type="radio"
                name="template"
                value={t.path}
                checked={chosen === t.path}
                onChange={() => setChosen(t.path)}
                disabled={busy}
              />
              <span>{t.path.slice("Templates/".length)}</span>
            </label>
          ))}
        </div>
        <p className="muted">
          Edit or add Markdown files in Templates/. Use {"{{title}}"},{" "}
          {"{{date}}"}, and {"{{time}}"} placeholders.
        </p>
        {!ready && !error && <p role="status">Preparing templates…</p>}
        {error && <p role="alert">{error}</p>}
        <button
          className="button primary"
          type="submit"
          disabled={!ready || busy || !templates.some((t) => t.path === chosen)}
        >
          {busy ? "Creating…" : "Create note"}
        </button>
      </form>
    </Dialog>
  );
}
