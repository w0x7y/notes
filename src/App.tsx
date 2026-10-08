import { newLecture, openDaily, quickCapture } from "./knowledge/templates";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelsLeftRight,
  Plus,
  X,
} from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { useShallow } from "zustand/react/shallow";
import { TabBar, tabId, tabPanelId } from "./components/TabBar";
import { BrandMark } from "./components/BrandMark";
const ContentSearchDialog = lazy(() =>
  import("./knowledge/ContentSearchDialog").then((m) => ({
    default: m.ContentSearchDialog,
  })),
);
const CommandDialog = lazy(() =>
  import("./knowledge/CommandDialog").then((m) => ({
    default: m.CommandDialog,
  })),
);
const TemplateDialog = lazy(() =>
  import("./knowledge/TemplateDialog").then((m) => ({
    default: m.TemplateDialog,
  })),
);
const TasksDialog = lazy(() =>
  import("./knowledge/TasksDialog").then((m) => ({ default: m.TasksDialog })),
);
const ProjectsDialog = lazy(() =>
  import("./knowledge/ProjectsDialog").then((m) => ({
    default: m.ProjectsDialog,
  })),
);
const GraphDialog = lazy(() =>
  import("./knowledge/GraphDialog").then((module) => ({
    default: module.GraphDialog,
  })),
);
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
  closeFile,
  createFolder,
  deleteEntry,
  renameImage,
  moveEntry,
  moveFolder,
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
  openInSplit,
  toggleSplit,
  cycleTab,
  focusPane,
  refreshWorkspace,
  observeWorkspaceInvalidations,
  renameNote,
  run,
  showError,
  switchWorkspace,
  updateWorkspace,
  useApp,
} from "./domain/app-store";
import { sessionFocusedPath } from "./domain/workspace-session";
import {
  commandForShortcut,
  createWorkspaceCommands,
  type CommandContext,
} from "./domain/workspace-commands";
import { chooseWorkspaceFolder, files } from "./platform";
import { listenWorkspaceChanges } from "./platform/workspace-events";
import { startWorkspaceWatch } from "./domain/workspace-watch";

type Modal =
  | { kind: "search"; query: string }
  | {
      kind:
        "contents" | "commands" | "templates" | "tasks" | "projects" | "graph";
    }
  | { kind: "folder" }
  | { kind: "workspace" }
  | { kind: "settings"; section?: "Graph" }
  | { kind: "rename"; document: NoteDocument }
  | { kind: "rename-image"; id: string; path: string }
  | { kind: "rename-folder"; id: string; path: string }
  | { kind: "appearance"; id: string; path: string; document?: NoteDocument }
  | {
      kind: "delete";
      id: string;
      path: string;
      entryKind: "note" | "image" | "folder";
      document?: NoteDocument;
    }
  | { kind: "remove-workspace"; id: string; name: string; path: string }
  | null;

const noEntries: import("./domain/contracts").Entry[] = [];
const noSession = emptySession();
const noAppearances: Record<string, import("./domain/contracts").Appearance> =
  {};

function commandContext(
  modal: Modal,
  purpose: "availability" | "execution",
): CommandContext {
  const current = useApp.getState();
  const id = current.activeWorkspaceId;
  return {
    workspace: id
      ? {
          id,
          selectedFolder: current.selectedFolder,
          focusedPath: sessionFocusedPath(
            currentSession(),
            current.focusedPane,
          ),
        }
      : null,
    modal:
      purpose === "execution" &&
      document.querySelector('dialog[open][aria-busy="true"]')
        ? "busy"
        : purpose === "execution" &&
            document.querySelector(".drawing-dialog[open]")
          ? "drawing"
          : modal?.kind === "commands"
            ? "palette"
            : modal ||
                (purpose === "execution" &&
                  document.querySelector("dialog[open]"))
              ? "dialog"
              : "none",
  };
}

function commitFocusedDraft() {
  const active = document.activeElement;
  if (
    (active instanceof HTMLInputElement &&
      active.closest(".knowledge-property-input")) ||
    (active instanceof HTMLTextAreaElement &&
      active.closest(".drawing-text-editor"))
  )
    active.blur();
}

export default function App() {
  const state = useApp(
    useShallow((state) => ({
      workspaces: state.workspaces,
      activeWorkspaceId: state.activeWorkspaceId,
      entries: state.entries[state.activeWorkspaceId ?? ""] ?? noEntries,
      session: state.sessions[state.activeWorkspaceId ?? ""] ?? noSession,
      appearances:
        state.appearances[state.activeWorkspaceId ?? ""] ?? noAppearances,
      selectedFolder: state.selectedFolder,
      focusedPane: state.focusedPane,
      ready: state.ready,
      notice: state.notice,
    })),
  );
  const [modal, setModal] = useState<Modal>(null);
  const [sidebar, setSidebar] = useState(true);
  const [paneDocuments, setPaneDocuments] = useState<{
    primary: NoteDocument | null;
    secondary: NoteDocument | null;
  }>({ primary: null, secondary: null });
  const primaryDocumentChanged = useCallback(
    (document: NoteDocument | null) => {
      setPaneDocuments((previous) =>
        previous.primary === document
          ? previous
          : { ...previous, primary: document },
      );
    },
    [],
  );
  const secondaryDocumentChanged = useCallback(
    (document: NoteDocument | null) => {
      setPaneDocuments((previous) =>
        previous.secondary === document
          ? previous
          : { ...previous, secondary: document },
      );
    },
    [],
  );
  const selectedFolder = state.selectedFolder;
  const setSelectedFolder = useCallback((path: string) => {
    useApp.setState({ selectedFolder: path });
  }, []);
  const workspace = state.workspaces.find(
    (item) => item.id === state.activeWorkspaceId,
  );
  const entries = state.entries;
  const session = state.session;
  const focusedPath = sessionFocusedPath(session, state.focusedPane);
  const paneDocument = paneDocuments[state.focusedPane];
  const focusedDocument =
    paneDocument?.workspaceId === workspace?.id &&
    paneDocument?.getSnapshot().path === focusedPath
      ? paneDocument
      : null;
  const appearances = state.appearances;
  const closeModal = useCallback(() => setModal(null), []);
  const openRename = useCallback(
    (document: NoteDocument) => setModal({ kind: "rename", document }),
    [],
  );

  const openFolder = useCallback(async () => {
    const path = await chooseWorkspaceFolder();
    if (path) await addWorkspace(path);
  }, []);
  const committedModal = useRef(modal);
  useLayoutEffect(() => {
    committedModal.current = modal;
  }, [modal]);
  const availableContext = useMemo<CommandContext>(
    () => ({
      workspace: workspace
        ? { id: workspace.id, selectedFolder, focusedPath }
        : null,
      modal: modal?.kind === "commands" ? "palette" : modal ? "dialog" : "none",
    }),
    [workspace, selectedFolder, focusedPath, modal],
  );
  const workspaceCommands = useMemo(
    () =>
      createWorkspaceCommands({
        context: (purpose) => commandContext(committedModal.current, purpose),
        global: {
          titles: (query = "") => setModal({ kind: "search", query }),
          contents: () => setModal({ kind: "contents" }),
          commands: () => setModal({ kind: "commands" }),
          capture: quickCapture,
          daily: openDaily,
          workspace: openFolder,
          settings: () => setModal({ kind: "settings" }),
          save: flushAll,
          sidebar: () => setSidebar((value) => !value),
        },
        workspace: {
          new: ({ id, selectedFolder }) => newNote(id, selectedFolder),
          lecture: ({ id }) => newLecture(id),
          templates: () => setModal({ kind: "templates" }),
          graph: () => setModal({ kind: "graph" }),
          tasks: () => setModal({ kind: "tasks" }),
          projects: () => setModal({ kind: "projects" }),
          split: toggleSplit,
          refresh: ({ id }) => refreshWorkspace(id),
          close: ({ id, focusedPath }) =>
            focusedPath ? closeFile(id, focusedPath) : undefined,
          "next-tab": () => cycleTab(),
          "previous-tab": () => cycleTab(true),
          folder: () => setModal({ kind: "folder" }),
          "workspace-settings": () => setModal({ kind: "workspace" }),
        },
        beforeExecute: commitFocusedDraft,
        dismissPalette: () => setModal(null),
        reportError: showError,
      }),
    [openFolder],
  );

  useEffect(() => {
    if (!useApp.getState().ready) void initialize();
  }, []);
  useEffect(() => {
    if (files.kind !== "native") return;
    const invalidations = observeWorkspaceInvalidations();
    return startWorkspaceWatch({
      invalidate: invalidations.invalidate,
      disposeInvalidations: invalidations.dispose,
      report: showError,
      subscribe: listenWorkspaceChanges,
    });
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const command = commandForShortcut(event);
      if (!command) return;
      event.preventDefault();
      void workspaceCommands.dispatch(command, "keyboard");
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [workspaceCommands]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      commitFocusedDraft();
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
                commitFocusedDraft();
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

  const openTab = useCallback(
    (path: string) => {
      if (workspace) openFile(workspace.id, path);
    },
    [workspace],
  );
  const closeTab = useCallback(
    (path: string) => {
      if (workspace) {
        commitFocusedDraft();
        run(closeFile(workspace.id, path));
      }
    },
    [workspace],
  );

  const availableTools = useMemo(
    () => workspaceCommands.available("tools", availableContext),
    [workspaceCommands, availableContext],
  );
  const sidebarView = useMemo(
    () =>
      sidebar ? (
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
            if (workspace) openInSplit(workspace.id, path);
          }}
          onRename={(path) => {
            if (
              workspace &&
              entries.find((entry) => entry.path === path)?.kind === "folder"
            ) {
              setModal({ kind: "rename-folder", id: workspace.id, path });
              return;
            }
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
          onMove={(path, folder) => {
            if (!workspace) return;
            const entry = entries.find((item) => item.path === path);
            if (!entry) return;
            run(moveEntry(workspace.id, path, entry.kind, folder));
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
            else if (entry)
              setModal({
                kind: "delete",
                id: workspace.id,
                path,
                entryKind: entry.kind,
              });
          }}
          onWorkspace={switchWorkspace}
          commands={availableTools}
          onCommand={(id) => {
            void workspaceCommands.dispatch(id, "tools");
          }}
          onAddWorkspace={() => {
            void workspaceCommands.dispatch("workspace", "button");
          }}
          onAppSettings={() => {
            void workspaceCommands.dispatch("settings", "button");
          }}
          onSearch={(query = "") => {
            void workspaceCommands.dispatch("titles", "button", query);
          }}
          onNewNote={() => {
            void workspaceCommands.dispatch("new", "button");
          }}
          onNewFolder={() => {
            void workspaceCommands.dispatch("folder", "button");
          }}
        />
      ) : null,
    [
      sidebar,
      state.workspaces,
      workspace,
      entries,
      appearances,
      focusedPath,
      selectedFolder,
      setSelectedFolder,
      workspaceCommands,
      availableTools,
    ],
  );

  function renderPane(path: string | null, pane: "primary" | "secondary") {
    if (!workspace) return null;
    const entry = entries.find((item) => item.path === path);
    return (
      <section
        className={`editor-pane ${state.focusedPane === pane ? "focused-pane" : ""}`}
        role={path ? "tabpanel" : undefined}
        id={path ? tabPanelId(workspace.id, path) : undefined}
        aria-labelledby={path ? tabId(workspace.id, path) : undefined}
        aria-label={
          path
            ? undefined
            : pane === "primary"
              ? "Primary pane"
              : "Secondary pane"
        }
        onFocusCapture={() => {
          focusPane(pane);
        }}
        onPointerDown={() => {
          focusPane(pane);
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
                onDocumentChange={
                  pane === "primary"
                    ? primaryDocumentChanged
                    : secondaryDocumentChanged
                }
              />
            </Suspense>
          )
        ) : (
          <div className="pane-empty">
            <BrandMark size={36} />
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
              onClick={() => {
                void workspaceCommands.dispatch("new", "button");
              }}
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
    <div className={`app-shell ${sidebar ? "" : "sidebar-hidden"}`}>
      {sidebarView}
      <main className="main-shell">
        <TabBar
          workspaceId={workspace?.id ?? ""}
          paths={session.tabs}
          focusedPath={focusedPath}
          entries={entries}
          appearances={appearances}
          onOpen={openTab}
          onClose={closeTab}
          leading={
            <>
              <button
                className="icon-button sidebar-toggle"
                aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
                onClick={() => {
                  void workspaceCommands.dispatch("sidebar", "button");
                }}
              >
                {sidebar ? (
                  <PanelLeftClose size={15} />
                ) : (
                  <PanelLeftOpen size={15} />
                )}
              </button>
            </>
          }
          actions={
            <>
              {workspace && (
                <>
                  <button
                    className="icon-button"
                    aria-label="Create note"
                    title="New note (Ctrl+N)"
                    onClick={() => {
                      void workspaceCommands.dispatch("new", "button");
                    }}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Toggle split pane"
                    aria-pressed={session.split}
                    title="Split pane (Ctrl+\)"
                    onClick={() => {
                      void workspaceCommands.dispatch("split", "button");
                    }}
                  >
                    {session.split ? (
                      <PanelRightClose size={16} />
                    ) : (
                      <PanelsLeftRight size={16} />
                    )}
                  </button>
                </>
              )}
            </>
          }
        />
        {session.tabs
          .filter(
            (path) =>
              !state.ready ||
              !workspace ||
              (path !== session.primary &&
                (!session.split || path !== session.secondary)),
          )
          .map((path) => (
            <section
              key={path}
              hidden
              role="tabpanel"
              id={tabPanelId(workspace?.id ?? "", path)}
              aria-labelledby={tabId(workspace?.id ?? "", path)}
            />
          ))}
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
            <BrandMark size={52} />
            <h1>A place to think.</h1>
            <p>
              Open a folder of Markdown notes.
              <br />
              Your files stay exactly where they are.
            </p>
            <button
              className="button primary"
              onClick={() => {
                void workspaceCommands.dispatch("workspace", "button");
              }}
            >
              <FolderOpen size={17} />
              Open a workspace
            </button>
            <span>
              Open Markdown files from Obsidian. Plugin features and some syntax
              are not supported.
            </span>
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
            "image" && <SaveStatus document={focusedDocument} />}
        <span className="flex-1" />
        <span>Markdown</span>
        <span className="status-encoding">UTF-8</span>
        <span>Auto direction</span>
      </footer>
      <Suspense fallback={null}>
        {modal?.kind === "contents" && (
          <ContentSearchDialog onClose={closeModal} />
        )}
        {modal?.kind === "commands" && (
          <CommandDialog
            commands={workspaceCommands.available("palette", availableContext)}
            onChoose={(id) => {
              void workspaceCommands.dispatch(id, "palette");
            }}
            onClose={closeModal}
          />
        )}
        {modal?.kind === "templates" && workspace && (
          <TemplateDialog workspaceId={workspace.id} onClose={closeModal} />
        )}
        {modal?.kind === "tasks" && workspace && (
          <TasksDialog workspaceId={workspace.id} onClose={closeModal} />
        )}
        {modal?.kind === "projects" && workspace && (
          <ProjectsDialog workspaceId={workspace.id} onClose={closeModal} />
        )}
        {modal?.kind === "graph" && workspace && (
          <GraphDialog
            workspaceId={workspace.id}
            initialPath={focusedPath}
            onClose={closeModal}
            onSettings={() => setModal({ kind: "settings", section: "Graph" })}
          />
        )}
        {modal?.kind === "settings" && (
          <SettingsDialog initialSection={modal.section} onClose={closeModal} />
        )}
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
            onSubmit={(name) =>
              createFolder(workspace.id, selectedFolder, name)
            }
          />
        )}
        {modal?.kind === "appearance" && (
          <AppearanceDialog
            path={modal.path}
            initial={
              useApp.getState().appearances[modal.id]?.[
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
        {modal?.kind === "rename-folder" && (
          <TextDialog
            title="Rename or move folder"
            label="Path inside this workspace"
            initial={modal.path}
            hint="Enter a new name or a path inside an existing folder."
            submitLabel="Rename folder"
            onClose={closeModal}
            onSubmit={(destination) =>
              moveFolder(modal.id, modal.path, destination)
            }
          />
        )}
        {modal?.kind === "delete" && (
          <ConfirmDialog
            title={
              modal.entryKind === "folder" ? "Delete folder?" : "Delete file?"
            }
            description={
              modal.entryKind === "folder"
                ? files.kind === "demo"
                  ? "Remove this folder and all its contents from the demo?"
                  : "Move this folder and all its contents to Trash? You can restore them using your file manager."
                : files.kind === "demo"
                  ? "Remove this file from the demo?"
                  : "Move this file to Trash? You can restore it using your file manager."
            }
            detail={modal.path}
            submitLabel={
              modal.entryKind === "folder" ? "Delete folder" : "Delete file"
            }
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
