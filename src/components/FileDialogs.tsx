import { useState, type FormEvent } from "react";
import type { Appearance } from "../domain/contracts";
import { errorMessage } from "../domain/notes";
import { AppearanceFields } from "./AppearanceFields";
import { Dialog } from "./Dialog";

export function AppearanceDialog({
  path,
  initial,
  onSubmit,
  onClose,
}: {
  path: string;
  initial: Appearance;
  onSubmit: (appearance: Appearance) => Promise<void>;
  onClose: () => void;
}) {
  const [appearance, setAppearance] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(appearance);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Icon and color"
      onClose={onClose}
      busy={busy}
      dismissible={!busy}
    >
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <p className="muted" dir="auto">
          {path}
        </p>
        <fieldset disabled={busy} className="appearance-fieldset">
          <AppearanceFields
            icon={appearance.icon}
            color={appearance.color}
            onIconChange={(icon) =>
              setAppearance((value) => ({ ...value, icon }))
            }
            onColorChange={(color) =>
              setAppearance((value) => ({ ...value, color }))
            }
          />
        </fieldset>
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
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  detail,
  submitLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  detail?: string;
  submitLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose} busy={busy} dismissible={!busy}>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <p>{description}</p>
        {detail && (
          <p className="muted" dir="auto">
            {detail}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            data-dialog-focus
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="button danger" disabled={busy}>
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
