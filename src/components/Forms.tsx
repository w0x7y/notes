import { useState, type FormEvent } from "react";
import type { Workspace } from "../domain/contracts";
import { errorMessage } from "../domain/notes";
import { Dialog } from "./Dialog";

export function TextDialog({
  title,
  label,
  initial = "",
  hint,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  hint?: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <label>
          {label}
          <input
            autoFocus
            required
            value={value}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {hint && <p className="muted">{hint}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !value.trim()}>
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function WorkspaceDialog({
  workspace,
  onSubmit,
  onClose,
}: {
  workspace: Workspace;
  onSubmit: (workspace: Workspace) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState(workspace.color);
  const [icon, setIcon] = useState(workspace.icon);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Workspace settings" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onSubmit({ ...workspace, name: name.trim(), color, icon })
            .then(onClose)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Name
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="workspace-customize">
          <label>
            Color
            <input
              type="color"
              aria-label="Workspace color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <label>
            Icon
            <select
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            >
              <option value="book">Book</option>
              <option value="code">Code</option>
              <option value="work">Briefcase</option>
            </select>
          </label>
        </div>
        <p className="muted">{workspace.path}</p>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button className="button primary" disabled={busy || !name.trim()}>
            Save changes
          </button>
        </div>
      </form>
    </Dialog>
  );
}
