import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  FileText,
  FolderOpen,
  Image,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelsLeftRight,
  Plus,
  X,
} from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { SearchDialog } from "./components/SearchDialog";
import { TextDialog, WorkspaceDialog } from "./components/Forms";
import { NotePane } from "./components/NotePane";
import { SaveStatus } from "./components/SaveStatus";
import { ImagePane } from "./components/ImagePane";
import type { NoteDocument } from "./domain/document";
import {
  addWorkspace,
  changeSession,
  closeFile,
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
  | { kind: "rename"; document: NoteDocument }
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
  const closeModal = () => setModal(null);

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
      const current = useApp.getState();
      const id = current.activeWorkspaceId;
      const value = currentSession();
      const key = event.key.toLowerCase();
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
      if (id) run(refreshWorkspace(id));
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
            <NotePane
              workspaceId={workspace.id}
              path={path}
              onRename={(document) => setModal({ kind: "rename", document })}
            />
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
            if (workspace)
              run(
                loadDocument(workspace.id, path).then((document) =>
                  setModal({ kind: "rename", document }),
                ),
              );
          }}
          onWorkspace={switchWorkspace}
          onAddWorkspace={() => run(openFolder())}
          onSettings={() => setModal({ kind: "workspace" })}
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
              >
                <button
                  className="tab-label"
                  role="tab"
                  aria-selected={focusedPath === path}
                  onClick={() => {
                    if (workspace) openFile(workspace.id, path);
                  }}
                >
                  {entries.find((entry) => entry.path === path)?.kind ===
                  "image" ? (
                    <Image size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
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
      {modal?.kind === "search" && (
        <SearchDialog onClose={closeModal} initial={modal.query} />
      )}
      {modal?.kind === "workspace" && workspace && (
        <WorkspaceDialog
          workspace={workspace}
          onSubmit={updateWorkspace}
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
    </div>
  );
}
