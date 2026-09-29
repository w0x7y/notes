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
  PencilRuler,
  Pin,
  PanelRight,
} from "lucide-react";
import type { NoteDocument } from "../domain/document";
import {
  loadDocument,
  navigateTo,
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
import { editorFontFamily } from "../domain/preferences";
import { toggleFavorite, useLibrary } from "../knowledge/library";
import "../knowledge/note-details.css";
const NoteDetails = lazy(() =>
  import("../knowledge/NoteDetails").then((module) => ({
    default: module.NoteDetails,
  })),
);

const LivePreview = lazy(() =>
  import("../editor/LivePreview").then((module) => ({
    default: module.LivePreview,
  })),
);
const DrawingDialog = lazy(() =>
  import("../drawing/DrawingDialog").then((module) => ({
    default: module.DrawingDialog,
  })),
);

async function followLink(
  document: NoteDocument,
  target: string,
): Promise<void> {
  const result = resolveNoteLink(
    target,
    document.workspaceId,
    document.getSnapshot().path,
    useApp.getState().entries,
  );
  if (result.kind !== "found") {
    showError(
      result.kind === "ambiguous"
        ? "More than one note has that name. Use search to choose the note."
        : `No note found for “${target}”.`,
    );
    return;
  }
  const hash = target.indexOf("#");
  if (hash < 0) {
    navigateTo(result.workspaceId, result.path);
    return;
  }
  const fragment = target.slice(hash + 1);
  if (!fragment) {
    navigateTo(result.workspaceId, result.path, 0);
    return;
  }
  const [{ getKnowledgeNote }, { headingOffset }] = await Promise.all([
    import("../knowledge"),
    import("../knowledge/model"),
  ]);
  const note = await getKnowledgeNote(result.workspaceId, result.path);
  const offset = headingOffset(note, fragment);
  navigateTo(result.workspaceId, result.path, offset ?? undefined);
  if (offset === null)
    showError(`Heading “${fragment}” was not found in this note.`);
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
  const navigation = useApp((state) => state.navigation);
  const favorite = useLibrary((state) =>
    state.favorites.some(
      (item) =>
        item.workspaceId === document.workspaceId &&
        item.path === snapshot.path,
    ),
  );
  const [details, setDetails] = useState(false);
  const preferences = useApp((state) => state.preferences);
  const [drawing, setDrawing] = useState<{ source?: string } | null>(null);
  const [previewVersion, refreshPreview] = useState(0);
  const openDrawing = useCallback(
    (source: string) => setDrawing({ source }),
    [],
  );
  const [preview, setPreview] = useState(
    () => useApp.getState().preferences.defaultPreview,
  );
  const onLink = useCallback(
    (target: string) => {
      void followLink(document, target).catch(showError);
    },
    [document],
  );
  const editor = useRef<EditorHandle>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const pendingFormat = useRef<Format | null>(null);
  const body = splitNote(document.content).body;
  const handledNavigation = useRef<number | null>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = document.scrollTop;
    if (!document.content) titleInput.current?.focus();
  }, [document]);

  useEffect(() => {
    if (
      !navigation ||
      navigation.workspaceId !== document.workspaceId ||
      navigation.path !== snapshot.path ||
      handledNavigation.current === navigation.serial
    )
      return;
    if (preview) {
      setPreview(false);
      return;
    }
    const bodyStart =
      document.content.length - splitNote(document.content).body.length;
    if (navigation.offset < bodyStart) {
      titleInput.current?.focus();
      titleInput.current?.scrollIntoView({ block: "center" });
    } else editor.current?.jumpTo(navigation.offset - bodyStart);
    handledNavigation.current = navigation.serial;
  }, [navigation, preview, document, snapshot.path]);
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
            title={favorite ? "Unpin note" : "Pin note"}
            aria-label={favorite ? "Unpin note" : "Pin note"}
            aria-pressed={favorite}
            onClick={() => toggleFavorite(document.workspaceId, snapshot.path)}
          >
            <Pin size={15} />
          </button>
          <button
            className="view-button"
            title="Outline, backlinks, and properties"
            aria-label="Toggle note details"
            aria-pressed={details}
            onClick={() => setDetails((value) => !value)}
          >
            <PanelRight size={15} />
          </button>
          <button
            className="view-button"
            title="Open or create a drawing in this note"
            onClick={() => setDrawing({})}
          >
            <PencilRuler size={15} />
            <span>Drawing</span>
          </button>
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
      <div className="note-workarea">
        <div
          className="document-scroll"
          ref={scroll}
          onScroll={(event) => {
            document.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <article
            className="document"
            style={{
              maxWidth: preferences.readableWidth
                ? preferences.noteWidth
                : "none",
              fontFamily: editorFontFamily(preferences),
              fontSize: preferences.fontSize,
              fontWeight: preferences.fontWeight,
              letterSpacing: `${preferences.letterSpacing}px`,
              lineHeight: preferences.lineHeight,
            }}
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
                  key={previewVersion}
                  document={document}
                  externalVersion={snapshot.externalVersion}
                  editorRef={editor}
                  onLink={onLink}
                  onDrawing={openDrawing}
                />
              </Suspense>
            ) : (
              <CodeEditor
                ref={editor}
                value={body}
                note={{
                  workspaceId: document.workspaceId,
                  path: snapshot.path,
                }}
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
        {details && (
          <Suspense
            fallback={
              <aside className="note-details">Loading note details…</aside>
            }
          >
            <NoteDetails
              document={document}
              onClose={() => setDetails(false)}
            />
          </Suspense>
        )}
      </div>
      {drawing && (
        <Suspense fallback={null}>
          <DrawingDialog
            document={document}
            source={drawing.source}
            onClose={() => {
              setDrawing(null);
              refreshPreview((version) => version + 1);
            }}
          />
        </Suspense>
      )}
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
