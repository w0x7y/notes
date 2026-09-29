import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelsLeftRight,
  Plus,
  X,
} from "lucide-react";
import { Sidebar } from "./components/Sidebar";
const SearchDialog = lazy(() =>
  import("./components/SearchDialog").then((module) => ({
    default: module.SearchDialog,
  })),
);
const TextDialog = lazy(() =>
  import("./components/Forms").then((module) => ({
    default: module.TextDialog,
  })),
);
const WorkspaceDialog = lazy(() =>
  import("./components/Forms").then((module) => ({
    default: module.WorkspaceDialog,
  })),
);
const AppearanceDialog = lazy(() =>
  import("./components/FileDialogs").then((module) => ({
    default: module.AppearanceDialog,
  })),
);
const ConfirmDialog = lazy(() =>
  import("./components/FileDialogs").then((module) => ({
    default: module.ConfirmDialog,
  })),
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
import { ItemIcon } from "./components/ItemIcon";
import { entryColor } from "./domain/appearance";
const NotePane = lazy(() =>
  import("./components/NotePane").then((module) => ({
    default: module.NotePane,
  })),
);
import { SaveStatus } from "./components/SaveStatus";
import { ImagePane } from "./components/ImagePane";
import type { NoteDocument } from "./domain/document";
import {
  addWorkspace,
  changeSession,
  closeFile,
  deleteEntry,
  renameImage,
  removeWorkspace,
  setEntryAppearance,
  currentSession,
  emptySession,
  flushAll,
  hasUnsavedChanges,
  initialize,
  loadDocument,
  newNote,
  openFile,
  refreshWorkspace,
  renameNote,
  run,
  showError,
  switchWorkspace,
  updateWorkspace,
  useApp,
} from "./domain/app-store";
import { basename } from "./domain/notes";
import { chooseWorkspaceFolder, files } from "./platform";

type Modal =
  | { kind: "search"; query: string }
  | { kind: "folder" }
  | { kind: "workspace" }
  | { kind: "settings" }
  | { kind: "rename"; document: NoteDocument }
  | { kind: "rename-image"; id: string; path: string }
  | { kind: "appearance"; id: string; path: string; document?: NoteDocument }
  | {
      kind: "delete";
      id: string;
      path: string;
      entryKind: "note" | "image";
      document?: NoteDocument;
    }
  | { kind: "remove-workspace"; id: string; name: string; path: string }
  | null;

export default function App() {
  const state = useApp();
  const [modal, setModal] = useState<Modal>(null);
  const [sidebar, setSidebar] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState("");
  const workspace = state.workspaces.find(
    (item) => item.id === state.activeWorkspaceId,
  );
  const entries = state.entries[workspace?.id ?? ""] ?? [];
  const session = state.sessions[workspace?.id ?? ""] ?? emptySession();
  const focusedPath =
    state.focusedPane === "secondary" && session.split
      ? session.secondary
      : session.primary;
  const appearances = state.appearances[workspace?.id ?? ""] ?? {};
  const closeModal = () => setModal(null);
  const openRename = useCallback(
    (document: NoteDocument) => setModal({ kind: "rename", document }),
    [],
  );

  const openFolder = useCallback(async () => {
    const path = await chooseWorkspaceFolder();
    if (path) {
      await addWorkspace(path);
      setSelectedFolder("");
    }
  }, []);
  const toggleSplit = useCallback(() => {
    const current = useApp.getState();
    if (!current.activeWorkspaceId) return;
    changeSession(current.activeWorkspaceId, (value) => ({
      ...value,
      split: !value.split,
      secondary:
        value.secondary ??
        value.tabs.find((path) => path !== value.primary) ??
        null,
    }));
    useApp.setState({ focusedPane: "primary" });
  }, []);

  useEffect(() => {
    if (!useApp.getState().ready) void initialize();
  }, []);
  useEffect(() => {
    setSelectedFolder("");
  }, [state.activeWorkspaceId]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (document.querySelector(".drawing-dialog[open]")) {
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          run(flushAll());
        } else if (
          ["w", "n", "p", ",", "tab", "\\"].includes(event.key.toLowerCase())
        )
          event.preventDefault();
        return;
      }
      if (document.querySelector('dialog[aria-busy="true"]')) {
        event.preventDefault();
        return;
      }
      const current = useApp.getState();
      const id = current.activeWorkspaceId;
      const value = currentSession();
      const key = event.key.toLowerCase();
      if (key === ",") {
        event.preventDefault();
        setModal({ kind: "settings" });
      }
      if (key === "p") {
        event.preventDefault();
        setModal({ kind: "search", query: "" });
      }
      if (key === "s") {
        event.preventDefault();
        run(flushAll());
      }
      if (key === "n" && id && !modal) {
        event.preventDefault();
        run(newNote(id, selectedFolder));
      }
      if (key === "w" && id && !modal) {
        event.preventDefault();
        const path =
          current.focusedPane === "secondary" && value.split
            ? value.secondary
            : value.primary;
        if (path) run(closeFile(id, path));
      }
      if (key === "\\" && !modal) {
        event.preventDefault();
        toggleSplit();
      }
      if (key === "tab" && id && !modal) {
        event.preventDefault();
        const active =
          current.focusedPane === "secondary" && value.split
            ? value.secondary
            : value.primary;
        const index = value.tabs.indexOf(active ?? "");
        const next =
          value.tabs[
            (index + (event.shiftKey ? -1 : 1) + value.tabs.length) %
              value.tabs.length
          ];
        if (next) openFile(id, next);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [modal, selectedFolder, toggleSplit]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const focus = () => {
      const id = useApp.getState().activeWorkspaceId;
      if (id && useApp.getState().preferences.refreshOnFocus)
        run(refreshWorkspace(id));
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("focus", focus);
    let dispose: (() => void) | undefined;
    let cancelled = false;
    if (files.kind === "native")
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const nativeWindow = getCurrentWindow();
          const unlisten = await nativeWindow.onCloseRequested(
            async (event) => {
              event.preventDefault();
              try {
                await flushAll();
                await nativeWindow.destroy();
              } catch (error) {
                showError(error);
              }
            },
          );
          if (cancelled) unlisten();
          else dispose = unlisten;
        })
        .catch(showError);
    return () => {
      cancelled = true;
      dispose?.();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("focus", focus);
    };
  }, []);

  function renderPane(path: string | null, pane: "primary" | "secondary") {
    if (!workspace) return null;
    const entry = entries.find((item) => item.path === path);
    return (
      <section
        className={`editor-pane ${state.focusedPane === pane ? "focused-pane" : ""}`}
        aria-label={pane === "primary" ? "Primary pane" : "Secondary pane"}
        onFocusCapture={() => {
          if (useApp.getState().focusedPane !== pane)
            useApp.setState({ focusedPane: pane });
        }}
        onPointerDown={() => {
          if (useApp.getState().focusedPane !== pane)
            useApp.setState({ focusedPane: pane });
        }}
      >
        {path ? (
          entry?.kind === "image" ? (
            <ImagePane workspaceId={workspace.id} path={path} />
          ) : (
            <Suspense
              fallback={<div className="pane-message">Opening editor…</div>}
            >
              <NotePane
                workspaceId={workspace.id}
                path={path}
                onRename={openRename}
              />
            </Suspense>
          )
        ) : (
          <div className="pane-empty">
            <FileText size={26} strokeWidth={1.2} />
            <h2>
              {pane === "secondary"
                ? "Open a note beside your work"
                : "Room for your next thought"}
            </h2>
            <p>
              {pane === "secondary"
                ? "Select this pane, then choose a note from the sidebar."
                : "Choose a note, search your workspaces, or start writing."}
            </p>
            <button
              className="button"
              onClick={() => run(newNote(workspace.id, selectedFolder))}
            >
              <Plus size={15} />
              New note <kbd>Ctrl N</kbd>
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <div
      className={`app-shell ${sidebar ? "" : "sidebar-hidden"}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {sidebar && (
        <Sidebar
          workspaces={state.workspaces}
          workspace={workspace}
          entries={entries}
          appearances={appearances}
          active={focusedPath}
          selectedFolder={selectedFolder}
          onFolder={setSelectedFolder}
          onOpen={(path) => {
            if (workspace) openFile(workspace.id, path);
          }}
          onOpenSplit={(path) => {
            if (!workspace) return;
            const other =
              focusedPath === path
                ? (session.tabs.find((item) => item !== path) ?? null)
                : focusedPath;
            changeSession(workspace.id, (value) => ({
              ...value,
              primary: other,
              secondary: path,
              split: true,
              tabs: value.tabs.includes(path)
                ? value.tabs
                : [...value.tabs, path],
            }));
            useApp.setState({ focusedPane: "secondary" });
          }}
          onRename={(path) => {
            if (
              workspace &&
              entries.find((entry) => entry.path === path)?.kind === "image"
            ) {
              setModal({ kind: "rename-image", id: workspace.id, path });
              return;
            }
            if (workspace)
              run(
                loadDocument(workspace.id, path).then((document) =>
                  setModal({ kind: "rename", document }),
                ),
              );
          }}
          onAppearance={(path) => {
            if (!workspace) return;
            const entry = entries.find((entry) => entry.path === path);
            if (entry?.kind === "note")
              run(
                loadDocument(workspace.id, path).then((document) =>
                  setModal({
                    kind: "appearance",
                    id: workspace.id,
                    path,
                    document,
                  }),
                ),
              );
            else setModal({ kind: "appearance", id: workspace.id, path });
          }}
          onDelete={(path) => {
            if (!workspace) return;
            const entry = entries.find((entry) => entry.path === path);
            if (entry?.kind === "note")
              run(
                loadDocument(workspace.id, path).then((document) =>
                  setModal({
                    kind: "delete",
                    id: workspace.id,
                    path,
                    entryKind: "note",
                    document,
                  }),
                ),
              );
            else if (entry?.kind === "image")
              setModal({
                kind: "delete",
                id: workspace.id,
                path,
                entryKind: "image",
              });
          }}
          onWorkspace={switchWorkspace}
          onAddWorkspace={() => run(openFolder())}
          onSettings={() => setModal({ kind: "workspace" })}
          onAppSettings={() => setModal({ kind: "settings" })}
          onSearch={(query = "") => setModal({ kind: "search", query })}
          onNewNote={() => {
            if (workspace) run(newNote(workspace.id, selectedFolder));
          }}
          onNewFolder={() => setModal({ kind: "folder" })}
        />
      )}
      <main className="main-shell">
        <div className="tabbar">
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebar((value) => !value)}
          >
            {sidebar ? (
              <PanelLeftClose size={15} />
            ) : (
              <PanelLeftOpen size={15} />
            )}
          </button>
          <div className="tabs" role="tablist" aria-label="Open notes">
            {session.tabs.map((path) => (
              <div
                className={`tab ${focusedPath === path ? "active" : ""}`}
                key={path}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    if (workspace) run(closeFile(workspace.id, path));
                  }
                }}
              >
                <button
                  className="tab-label"
                  style={{ color: entryColor(path, appearances) }}
                  role="tab"
                  aria-selected={focusedPath === path}
                  onClick={() => {
                    if (workspace) openFile(workspace.id, path);
                  }}
                >
                  <ItemIcon
                    name={appearances[path]?.icon}
                    size={14}
                    fallback={
                      entries.find((entry) => entry.path === path)?.kind ===
                      "image"
                        ? "image"
                        : "file"
                    }
                  />
                  <span dir="auto">{basename(path)}</span>
                </button>
                <button
                  className="close-tab"
                  aria-label={`Close ${basename(path)}`}
                  onClick={() => {
                    if (workspace) run(closeFile(workspace.id, path));
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="tab-actions">
            {workspace && (
              <>
                <button
                  className="icon-button"
                  aria-label="Create note"
                  title="New note (Ctrl+N)"
                  onClick={() => run(newNote(workspace.id, selectedFolder))}
                >
                  <Plus size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Toggle split pane"
                  aria-pressed={session.split}
                  title="Split pane (Ctrl+\)"
                  onClick={toggleSplit}
                >
                  {session.split ? (
                    <PanelRightClose size={16} />
                  ) : (
                    <PanelsLeftRight size={16} />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
        {state.notice && (
          <div className="notice" role="alert">
            <span>{state.notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => useApp.setState({ notice: null })}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!state.ready ? (
          <div className="pane-empty">Opening your workspaces…</div>
        ) : !workspace ? (
          <div className="welcome">
            <BookOpen size={36} strokeWidth={1.2} />
            <h1>A place to think.</h1>
            <p>
              Open a folder of Markdown notes.
              <br />
              Your files stay exactly where they are.
            </p>
            <button
              className="button primary"
              onClick={() => run(openFolder())}
            >
              <FolderOpen size={17} />
              Open a workspace
            </button>
            <span>Existing Obsidian folders work too.</span>
          </div>
        ) : (
          <div className={`panes ${session.split ? "split" : ""}`}>
            {renderPane(session.primary, "primary")}
            {session.split && renderPane(session.secondary, "secondary")}
          </div>
        )}
      </main>
      <footer className="statusbar">
        <span>
          {files.kind === "demo"
            ? "Demo changes stay in this tab"
            : "Local files"}
        </span>
        <span className="status-workspace">{workspace?.name}</span>
        {workspace &&
          focusedPath &&
          entries.find((entry) => entry.path === focusedPath)?.kind !==
            "image" && (
            <SaveStatus workspaceId={workspace.id} path={focusedPath} />
          )}
        <span className="flex-1" />
        <span>Markdown</span>
        <span className="status-encoding">UTF-8</span>
        <span>Auto direction</span>
      </footer>
      <Suspense fallback={null}>
        {modal?.kind === "settings" && <SettingsDialog onClose={closeModal} />}
        {modal?.kind === "search" && (
          <SearchDialog onClose={closeModal} initial={modal.query} />
        )}
        {modal?.kind === "workspace" && workspace && (
          <WorkspaceDialog
            workspace={workspace}
            onSubmit={updateWorkspace}
            onRemove={() =>
              setModal({
                kind: "remove-workspace",
                id: workspace.id,
                name: workspace.name,
                path: workspace.path,
              })
            }
            onClose={closeModal}
          />
        )}
        {modal?.kind === "folder" && workspace && (
          <TextDialog
            title="New folder"
            label="Folder name"
            hint={`Inside ${selectedFolder || workspace.name}`}
            submitLabel="Create folder"
            onClose={closeModal}
            onSubmit={async (name) => {
              await files.createFolder(workspace.id, selectedFolder, name);
              await refreshWorkspace(workspace.id);
            }}
          />
        )}
        {modal?.kind === "appearance" && (
          <AppearanceDialog
            path={modal.path}
            initial={
              state.appearances[modal.id]?.[
                modal.document?.getSnapshot().path ?? modal.path
              ] ?? {
                icon: null,
                color: null,
              }
            }
            onSubmit={(appearance) =>
              setEntryAppearance(
                modal.id,
                modal.path,
                appearance,
                modal.document,
              )
            }
            onClose={closeModal}
          />
        )}
        {modal?.kind === "rename-image" && (
          <TextDialog
            title="Rename or move image"
            label="Path inside this workspace"
            initial={modal.path}
            hint="Use an existing folder to move this image. Keep the image extension; existing image links will be updated where they can be resolved."
            submitLabel="Rename image"
            onClose={closeModal}
            onSubmit={(name) => renameImage(modal.id, modal.path, name)}
          />
        )}
        {modal?.kind === "delete" && (
          <ConfirmDialog
            title="Delete file?"
            description={
              files.kind === "demo"
                ? "Remove this file from the demo?"
                : "Move this file to Trash? You can restore it using your file manager."
            }
            detail={modal.path}
            submitLabel="Delete file"
            onClose={closeModal}
            onConfirm={() =>
              deleteEntry(modal.id, modal.path, modal.entryKind, modal.document)
            }
          />
        )}
        {modal?.kind === "remove-workspace" && (
          <ConfirmDialog
            title={`Remove ${modal.name}?`}
            description="Remove this workspace from the app. Its folder and files will stay on disk, and you can open it again later."
            detail={modal.path}
            submitLabel="Remove workspace"
            onClose={closeModal}
            onConfirm={() => removeWorkspace(modal.id)}
          />
        )}
        {modal?.kind === "rename" && (
          <TextDialog
            title="Rename or move note"
            label="Path inside this workspace"
            initial={modal.document.getSnapshot().path}
            hint="The filename will no longer follow the note title. Existing links will be updated where they can be resolved."
            submitLabel="Rename note"
            onClose={closeModal}
            onSubmit={(name) => renameNote(modal.document, name)}
          />
        )}
      </Suspense>
    </div>
  );
}
