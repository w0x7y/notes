import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import type { NoteDocument } from "../domain/document";
import { loadDocument, run, saveCopy, showError } from "../domain/app-store";

function DocumentStatus({ document }: { document: NoteDocument }) {
  const { status } = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  return (
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
  );
}

export function SaveStatus({
  workspaceId,
  path,
}: {
  workspaceId: string;
  path: string;
}) {
  const [document, setDocument] = useState<NoteDocument | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDocument(workspaceId, path)
      .then((value) => {
        if (!cancelled) setDocument(value);
      })
      .catch(() => {
        if (!cancelled) setDocument(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path]);
  if (
    !document ||
    document.workspaceId !== workspaceId ||
    document.getSnapshot().path !== path
  )
    return null;
  return <DocumentStatus document={document} />;
}
