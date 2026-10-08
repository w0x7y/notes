import { useState } from "react";
import { Dialog } from "./Dialog";
import { errorMessage } from "../domain/notes";

export function ConflictDialog({
  path,
  onReload,
  onClose,
}: {
  path: string;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onReload();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Reload changed note?"
      busy={busy}
      dismissible={!busy}
      onClose={onClose}
    >
      <div className="dialog-form">
        <p>
          Reload the latest file from disk and discard your unsaved text in this
          note.
        </p>
        <p className="muted" dir="auto">
          {path}
        </p>
        <p className="muted">
          Choose Save a copy first if you want to keep both versions.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="button"
            data-dialog-focus
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => void reload()}
          >
            {busy ? "Reloading…" : "Reload and discard"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
