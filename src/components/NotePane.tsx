import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronRight,
  Eye,
  PencilLine,
  TriangleAlert,
  Type,
} from "lucide-react";
import type { NoteDocument } from "../domain/document";
import {
  loadDocument,
  openFile,
  showError,
  toggleToolbar,
  useApp,
} from "../domain/app-store";
import {
  basename,
  errorMessage,
  parentFolder,
  splitNote,
  withBody,
  withTitle,
} from "../domain/notes";
import { resolveNoteLink } from "../domain/links";
import {
  CodeEditor,
  type EditorHandle,
  type Format,
} from "../editor/CodeEditor";
import { FormattingToolbar } from "./FormattingToolbar";

const LivePreview = lazy(() =>
  import("../editor/LivePreview").then((module) => ({
    default: module.LivePreview,
  })),
);

function followLink(document: NoteDocument, target: string): void {
  const raw = target.split("#")[0] ?? "";
  if (!raw) return;
  const result = resolveNoteLink(
    target,
    document.workspaceId,
    document.getSnapshot().path,
    useApp.getState().entries,
  );
  if (result.kind === "found") openFile(result.workspaceId, result.path);
  else
    showError(
      result.kind === "ambiguous"
        ? "More than one note has that name. Use search to choose the note."
        : `No note found for “${raw}”.`,
    );
}

function NoteView({
  document,
  onRename,
}: {
  document: NoteDocument;
  onRename: (document: NoteDocument) => void;
}) {
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
  );
  const toolbar = useApp((state) => state.toolbarVisible);
  const readableWidth = useApp((state) => state.preferences.readableWidth);
  const [preview, setPreview] = useState(
    () => useApp.getState().preferences.defaultPreview,
  );
  const onLink = useCallback(
    (target: string) => followLink(document, target),
    [document],
  );
  const editor = useRef<EditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const pendingFormat = useRef<Format | null>(null);
  const body = splitNote(document.content).body;
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = document.scrollTop;
    if (!document.content) titleInput.current?.focus();
  }, [document]);
  useEffect(() => {
    if (!preview && pendingFormat.current) {
      editor.current?.format(pendingFormat.current);
      pendingFormat.current = null;
    }
  }, [preview]);
  const format = (command: Format) => {
    if (editor.current) editor.current.format(command);
    else {
      pendingFormat.current = command;
      setPreview(false);
    }
  };
  return (
    <>
      <div className="document-bar">
        <div className="breadcrumbs">
          <span>{parentFolder(snapshot.path) || "Notes"}</span>
          <ChevronRight size={12} />
          <button
            title="Rename or move file"
            onClick={() => onRename(document)}
          >
            <span dir="auto">{basename(snapshot.path)}</span>
            <PencilLine size={11} />
          </button>
        </div>
        <div className="view-controls">
          <button
            className="view-button"
            title="Toggle formatting toolbar"
            aria-label="Toggle formatting toolbar"
            aria-pressed={toolbar}
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleToolbar}
          >
            <Type size={17} />
          </button>
          <button
            className="view-button"
            aria-pressed={preview}
            onClick={() => setPreview((value) => !value)}
          >
            <Eye size={15} />
            <span>{preview ? "Markdown" : "Preview"}</span>
          </button>
        </div>
      </div>
      {toolbar && <FormattingToolbar onFormat={format} />}
      <div
        className="document-scroll"
        ref={scroll}
        onScroll={(event) => {
          document.scrollTop = event.currentTarget.scrollTop;
        }}
      >
        <article
          className="document"
          style={{ maxWidth: readableWidth ? 940 : "none" }}
        >
          <input
            ref={titleInput}
            className="note-title"
            aria-label="Note title"
            placeholder="Untitled"
            dir="auto"
            value={snapshot.title}
            onChange={(event) =>
              document.edit(withTitle(document.content, event.target.value))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor.current?.focus();
              }
            }}
          />
          {preview ? (
            <Suspense fallback={<p className="muted">Loading preview…</p>}>
              <LivePreview
                document={document}
                externalVersion={snapshot.externalVersion}
                editorRef={editor}
                onLink={onLink}
              />
            </Suspense>
          ) : (
            <CodeEditor
              ref={editor}
              value={body}
              selection={document.selection}
              scrollTop={document.scrollTop}
              onSelection={(selection) => {
                document.selection = {
                  anchor: selection.anchor,
                  head: selection.head,
                };
              }}
              onChange={(text) =>
                document.edit(withBody(document.content, text))
              }
            />
          )}
        </article>
      </div>
    </>
  );
}

export function NotePane({
  workspaceId,
  path,
  onRename,
}: {
  workspaceId: string;
  path: string;
  onRename: (document: NoteDocument) => void;
}) {
  const [loaded, setLoaded] = useState<NoteDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadDocument(workspaceId, path)
      .then((document) => {
        if (!cancelled) setLoaded(document);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path]);
  if (error)
    return (
      <div className="pane-message">
        <TriangleAlert size={20} />
        <p>{error}</p>
      </div>
    );
  if (
    !loaded ||
    loaded.workspaceId !== workspaceId ||
    loaded.getSnapshot().path !== path
  )
    return <div className="pane-message">Opening note…</div>;
  return <NoteView key={loaded.id} document={loaded} onRename={onRename} />;
}
