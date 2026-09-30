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
  MoreHorizontal,
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
import { MenuButton } from "./PopupMenu";
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
    if (!document.getSnapshot().editable) return;
    if (editor.current) editor.current.format(command);
    else {
      pendingFormat.current = command;
      setPreview(false);
    }
  };
  return (
    <>
      <div className="document-bar" inert={!snapshot.editable}>
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
          <div className="note-view-switch" role="group" aria-label="Note view">
            <button
              className="view-button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              <PencilLine size={14} />
              <span>Edit</span>
            </button>
            <button
              className="view-button"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              <Eye size={14} />
              <span>Read</span>
            </button>
          </div>
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
          <MenuButton
            className="note-tools-menu"
            label="More note actions"
            actions={[
              {
                id: "drawing",
                label: "Open or create a drawing…",
                icon: <PencilRuler size={15} />,
                onSelect: () => setDrawing({}),
              },
              {
                id: "formatting",
                label: toolbar
                  ? "Hide formatting toolbar"
                  : "Show formatting toolbar",
                icon: <Type size={15} />,
                onSelect: toggleToolbar,
              },
              {
                id: "rename",
                label: "Rename or move note…",
                icon: <PencilLine size={15} />,
                separatorBefore: true,
                onSelect: () => onRename(document),
              },
            ]}
          >
            <MoreHorizontal size={17} />
          </MenuButton>
        </div>
      </div>
      {toolbar && <FormattingToolbar onFormat={format} />}
      {!snapshot.editable && (
        <span role="status" className="muted">
          Finishing file operation…
        </span>
      )}
      <div className="note-workarea" inert={!snapshot.editable}>
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
              readOnly={!snapshot.editable}
              onChange={(event) =>
                document.getSnapshot().editable &&
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
                  editable={snapshot.editable}
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
                editable={snapshot.editable}
                canEdit={() => document.getSnapshot().editable}
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
