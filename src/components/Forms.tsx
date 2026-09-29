import { useState, type FormEvent } from "react";
import type { Workspace } from "../domain/contracts";
import { errorMessage } from "../domain/notes";
import { Dialog } from "./Dialog";
import { AppearanceFields } from "./AppearanceFields";

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
    if (busy) return;
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
    <Dialog title={title} onClose={onClose} dismissible={!busy} busy={busy}>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <label>
          {label}
          <input
            autoFocus
            required
            disabled={busy}
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
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
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
  onRemove,
  onSubmit,
  onClose,
}: {
  workspace: Workspace;
  onRemove: () => void;
  onSubmit: (workspace: Workspace) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState(workspace.color);
  const [icon, setIcon] = useState(workspace.icon);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Workspace settings"
      onClose={onClose}
      dismissible={!busy}
      busy={busy}
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
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
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <AppearanceFields
          icon={icon}
          color={color}
          allowDefault={false}
          onIconChange={(value) => {
            if (value) setIcon(value);
          }}
          onColorChange={(value) => {
            if (value) setColor(value);
          }}
        />
        <p className="muted">{workspace.path}</p>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button
            type="button"
            className="button danger remove-workspace"
            disabled={busy}
            onClick={onRemove}
          >
            Remove workspace…
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            Save changes
          </button>
        </div>
      </form>
    </Dialog>
  );
}
