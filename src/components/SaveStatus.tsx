import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { Check, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import type { NoteDocument } from "../domain/document";
import {
  keepDocument,
  reloadDocument,
  run,
  saveCopy,
  showError,
} from "../domain/app-store";

const ConflictDialog = lazy(() =>
  import("./ConflictDialog").then((module) => ({
    default: module.ConflictDialog,
  })),
);

function DocumentStatus({ document }: { document: NoteDocument }) {
  const [reload, setReload] = useState(false);
  const [busy, setBusy] = useState(false);
  const { status } = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  async function recover(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className={`save-status ${status.kind}`}
        role="status"
        aria-live="polite"
      >
        {status.kind === "saved" ? (
          <>
            <Check size={12} />
            <span>Saved</span>
          </>
        ) : status.kind === "saving" ? (
          <>
            <LoaderCircle size={12} className="spin" />
            <span>Saving…</span>
          </>
        ) : status.kind === "conflict" ? (
          <>
            <TriangleAlert size={12} />
            <span title={status.message}>Changed on disk</span>
            <button disabled={busy} onClick={() => setReload(true)}>
              Reload
            </button>
            <button
              disabled={busy}
              onClick={() => void recover(() => keepDocument(document))}
            >
              Keep mine
            </button>
            <button
              disabled={busy}
              onClick={() => void recover(() => saveCopy(document))}
            >
              Save a copy
            </button>
          </>
        ) : (
          <>
            <TriangleAlert size={12} />
            <button
              title={status.message}
              onClick={() => showError(status.message)}
            >
              Save failed
            </button>
            <button onClick={() => run(document.flush())}>
              <RefreshCw size={11} />
              Retry
            </button>
            <button onClick={() => run(saveCopy(document))}>Save a copy</button>
          </>
        )}
      </div>
      {reload && (
        <Suspense fallback={null}>
          <ConflictDialog
            path={document.getSnapshot().path}
            onReload={() => reloadDocument(document)}
            onClose={() => setReload(false)}
          />
        </Suspense>
      )}
    </>
  );
}

export function SaveStatus({ document }: { document: NoteDocument | null }) {
  if (!document) return null;
  return <DocumentStatus key={document.id} document={document} />;
}
