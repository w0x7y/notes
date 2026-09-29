import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { NoteDocument } from "../domain/document";
import { showError } from "../domain/app-store";
import { errorMessage } from "../domain/notes";
import { propertyKeys, readProperties, updateProperty } from "./properties";
import "./workspace-views.css";

export const propertyLabels: Record<string, string> = {
  status: "Status",
  due: "Due date",
  subject: "Subject",
  priority: "Priority",
};

/** Local drafts avoid rewriting frontmatter for every input keystroke. */
export function PropertyInput({
  name,
  value,
  onCommit,
  context,
}: {
  name: string;
  value: string;
  onCommit: (value: string) => Promise<void>;
  context?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const focused = useRef(false);
  const mounted = useRef(false);
  const committed = useRef(value);
  const attempted = useRef<string | null>(null);
  const label = `${propertyLabels[name] ?? name}${context ? ` · ${context}` : ""}`;
  const current = useRef({ commit: async () => {}, draft, error, label });
  useEffect(() => {
    committed.current = value;
    if (!focused.current && !submitting.current && !current.current.error)
      setDraft(value);
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Escape, filters and view switches can unmount an input without blur.
      // Keep the draft and errors alive through the document's save queue.
      const latest = current.current;
      if (latest.error && attempted.current === latest.draft.trim())
        showError(`${latest.label}: ${latest.error}`);
      else void latest.commit();
    };
  }, []);

  async function commit() {
    const next = draft.trim();
    if (submitting.current || (next === committed.current && !error)) return;
    submitting.current = true;
    attempted.current = next;
    if (mounted.current) {
      setBusy(true);
      setError("");
    }
    try {
      await onCommit(next);
      committed.current = next;
    } catch (reason) {
      const message = errorMessage(reason);
      if (mounted.current) setError(message);
      else showError(`${label}: ${message}`);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  current.current = { commit, draft, error, label };

  return (
    <div className="knowledge-property-input">
      <input
        aria-label={label}
        type={name === "due" ? "date" : "text"}
        placeholder={
          name === "status"
            ? "Todo"
            : name === "priority"
              ? "Low / Medium / High"
              : "—"
        }
        value={draft}
        readOnly={busy}
        aria-busy={busy}
        aria-invalid={!!error}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {error && (
        <div className="knowledge-field-error" role="alert">
          {error}
          <button type="button" onClick={() => void commit()} disabled={busy}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function PropertiesFields({ document }: { document: NoteDocument }) {
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  let properties: Record<string, string> = {};
  let error = "";
  try {
    properties = readProperties(document.content);
  } catch (reason) {
    error = errorMessage(reason);
  }
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );

  return (
    <div className="knowledge-properties">
      {propertyKeys.map((key) => (
        <label key={key}>
          <span>{propertyLabels[key]}</span>
          <PropertyInput
            name={key}
            context={snapshot.path}
            value={properties[key] ?? ""}
            onCommit={async (value) => {
              document.editFromAction(
                updateProperty(document.content, key, value),
              );
              await document.flush();
            }}
          />
        </label>
      ))}
      <p className="muted knowledge-properties-hint">
        Stored in this note. Enter or leave a field to save. Clear a field to
        remove it.
      </p>
    </div>
  );
}
