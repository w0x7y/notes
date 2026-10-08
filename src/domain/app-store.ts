import { forgetFavorites } from "./library";
import {
  defaultPreferences,
  preferencesSchema,
  type Preferences,
} from "./preferences";
import { create } from "zustand";
import type {
  Appearance,
  Entry,
  SearchEntry,
  Session,
  Settings,
  Workspace,
} from "./contracts";
import { NoteDocument } from "./document";
import { DocumentLifetime } from "./document-lifetime";
import {
  emptySession,
  normalizeSession,
  transitionSession,
  type Pane,
  type SessionAction,
} from "./workspace-session";
export { emptySession } from "./workspace-session";
import { errorMessage } from "./notes";
import { Relocations } from "./relocation";
import { WorkspaceRefresh } from "./workspace-refresh";
import { files } from "../platform";

export type AppState = Settings & {
  selectedFolder: string;
  navigation: {
    workspaceId: string;
    path: string;
    offset: number;
    serial: number;
  } | null;
  ready: boolean;
  entries: Record<string, Entry[]>;
  notice: string | null;
  focusedPane: "primary" | "secondary";
};

export const useApp = create<AppState>(() => ({
  preferences: { ...defaultPreferences },
  workspaces: [],
  activeWorkspaceId: null,
  sessions: {},
  appearances: {},
  toolbarVisible: false,
  navigation: null,
  selectedFolder: "",
  ready: false,
  entries: {},
  notice: null,
  focusedPane: "primary",
}));
let navigationSerial = 0;
const lifetime = new DocumentLifetime(
  (id, note) =>
    new NoteDocument(
      id,
      note,
      (payload) => files.saveNote(id, payload),
      (document, previousPath, result) =>
        relocations.saved(document, previousPath, result),
      useApp.getState().preferences.autosaveDelayMs,
      (path) => files.readNote(id, path),
    ),
);

function activateWorkspace(id: string): void {
  lifetime.activate(id);
  workspaceRefresh.register(id);
}
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persisting: Promise<void> = Promise.resolve();
const relocations = new Relocations({
  setState: (update) => useApp.setState(update),
  lifetime,
  files,
  persist: persistNow,
  persistSoon,
  refresh: (id) => workspaceRefresh.refresh(id, { duringRelocation: true }),
  report: (error) => showError(error),
});
const workspaceRefresh = new WorkspaceRefresh({
  files,
  lifetime,
  relocations,
  entries: (id) => useApp.getState().entries[id] ?? [],
  publish: (id, entries) =>
    useApp.setState((state) => ({
      entries: { ...state.entries, [id]: entries },
    })),
  report: (error) => showError(error),
});
export const showError = (error: unknown) =>
  useApp.setState({ notice: errorMessage(error) });
export const run = (operation: Promise<unknown>) => {
  void operation.catch(showError);
};

export async function persistNow(): Promise<void> {
  clearTimeout(persistTimer);
  const { sessions, activeWorkspaceId, toolbarVisible } = useApp.getState();
  const save = persisting
    .catch(() => {})
    .then(() =>
      files.saveSessions({ sessions, activeWorkspaceId, toolbarVisible }),
    );
  persisting = save;
  await save;
}
function persistSoon(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => run(persistNow()), 250);
}

let initialization: Promise<void> | undefined;
/** Share startup work across overlapping mounts, while allowing explicit reload. */
export function initialize(): Promise<void> {
  if (initialization) return initialization;
  initialization = initializeOnce().finally(() => {
    initialization = undefined;
  });
  return initialization;
}

async function initializeOnce(): Promise<void> {
  try {
    const settings = await files.loadSettings();
    workspaceRefresh.reset();
    for (const workspace of settings.workspaces)
      activateWorkspace(workspace.id);
    const activeWorkspaceId = settings.workspaces.some(
      (item) => item.id === settings.activeWorkspaceId,
    )
      ? settings.activeWorkspaceId
      : (settings.workspaces[0]?.id ?? null);
    useApp.setState({
      ...settings,
      activeWorkspaceId,
      selectedFolder: "",
      sessions: settings.preferences.restoreSession
        ? Object.fromEntries(
            Object.entries(settings.sessions).map(([id, session]) => [
              id,
              normalizeSession(session),
            ]),
          )
        : {},
    });
    // Read the active workspace first, before background work can occupy disk workers.
    const scan = async (workspace: Workspace) => {
      try {
        await workspaceRefresh.refresh(workspace.id);
      } catch (error) {
        showError(`Could not open ${workspace.name}: ${errorMessage(error)}`);
      }
    };
    const active = settings.workspaces.find(
      (workspace) => workspace.id === activeWorkspaceId,
    );
    if (active) await scan(active);
    useApp.setState({ ready: true });
    await Promise.allSettled(
      settings.workspaces
        .filter((workspace) => workspace.id !== activeWorkspaceId)
        .map(scan),
    );
    useApp.setState({ ready: true });
  } catch (error) {
    showError(error);
    useApp.setState({ ready: true });
  }
}

export async function addWorkspace(path: string): Promise<void> {
  return lifetime.admitRegistration(async () => {
    const snapshot = await files.addWorkspace(path);
    lifetime.activate(snapshot.workspace.id);
    useApp.setState((state) => ({
      workspaces: [
        ...state.workspaces.filter((item) => item.id !== snapshot.workspace.id),
        snapshot.workspace,
      ],
      activeWorkspaceId: snapshot.workspace.id,
      selectedFolder: "",
      focusedPane: "primary",
    }));
    workspaceRefresh.register(snapshot.workspace.id, snapshot);
    persistSoon();
  });
}

export function switchWorkspace(id: string): void {
  useApp.setState((state) => ({
    activeWorkspaceId: id,
    focusedPane: "primary",
    selectedFolder: state.activeWorkspaceId === id ? state.selectedFolder : "",
  }));
  persistSoon();
}
export function currentSession(): Session {
  const state = useApp.getState();
  return state.sessions[state.activeWorkspaceId ?? ""] ?? emptySession();
}
function updateSession(id: string, action: SessionAction): void {
  let changedSession = false;
  useApp.setState((state) => {
    const previous = state.sessions[id] ?? emptySession();
    const result = transitionSession(
      previous,
      state.activeWorkspaceId === id ? state.focusedPane : "primary",
      action,
    );
    changedSession = result.session !== previous;
    if (
      !changedSession &&
      (state.activeWorkspaceId !== id ||
        state.focusedPane === result.focusedPane)
    )
      return state;
    return {
      ...(changedSession
        ? { sessions: { ...state.sessions, [id]: result.session } }
        : {}),
      ...(state.activeWorkspaceId === id
        ? { focusedPane: result.focusedPane }
        : {}),
    };
  });
  if (changedSession) persistSoon();
}
export function openFile(
  id: string,
  path: string,
  pane?: "primary" | "secondary",
): void {
  const previousId = useApp.getState().activeWorkspaceId;
  useApp.setState({
    activeWorkspaceId: id,
    navigation: null,
    ...(previousId === id
      ? {}
      : { focusedPane: "primary", selectedFolder: "" }),
  });
  updateSession(id, { kind: "open", path, pane });
}

export function toggleSplit(): void {
  const id = useApp.getState().activeWorkspaceId;
  if (id) updateSession(id, { kind: "toggle-split" });
}
export function openInSplit(id: string, path: string): void {
  const previousId = useApp.getState().activeWorkspaceId;
  useApp.setState({
    activeWorkspaceId: id,
    navigation: null,
    ...(previousId === id
      ? {}
      : { focusedPane: "primary", selectedFolder: "" }),
  });
  updateSession(id, { kind: "open-split", path });
}
export function cycleTab(backward = false): void {
  const id = useApp.getState().activeWorkspaceId;
  if (id) {
    useApp.setState({ navigation: null });
    updateSession(id, { kind: "cycle", backward });
  }
}
export function focusPane(pane: Pane): void {
  const id = useApp.getState().activeWorkspaceId;
  if (id) updateSession(id, { kind: "focus", pane });
}

export async function closeFile(id: string, path: string): Promise<void> {
  return lifetime.retirePath(id, path, async () => {
    const requestedPath = path;
    path = await relocations.afterMoves(id, path);
    const document = await lifetime.findForRetirement(id, requestedPath, path);
    if (document)
      await lifetime.retire(
        document,
        async () => {},
        async () => {
          removeTab(id, document.getSnapshot().path);
        },
      );
    else removeTab(id, path);
  });
}

function removeTab(id: string, currentPath: string): void {
  updateSession(id, { kind: "close", path: currentPath });
}

export async function setEntryAppearance(
  id: string,
  path: string,
  appearance: Appearance,
  note?: NoteDocument,
): Promise<void> {
  return lifetime.admit(id, async () => {
    path = await relocations.afterMoves(id, path);
    await lifetime.settleLoads();
    const document = note ?? lifetime.peek(id, path);
    await document?.flush();
    const currentPath = document?.getSnapshot().path ?? path;
    const updated = await files.setEntryAppearance(id, currentPath, appearance);
    useApp.setState((state) => ({
      appearances: {
        ...state.appearances,
        [id]: { ...state.appearances[id], [currentPath]: updated },
      },
    }));
  });
}

export const renameImage = (id: string, path: string, destination: string) =>
  lifetime.admit(id, () => relocations.renameImage(id, path, destination));

export async function deleteEntry(
  id: string,
  path: string,
  kind: Entry["kind"],
  note?: NoteDocument,
): Promise<void> {
  if (kind === "folder") {
    const resolvedPath = relocations.afterMoves(id, path);
    const contains = (candidate: string) =>
      candidate === path || candidate.startsWith(path + "/");
    const result = await lifetime.retireFolder(
      id,
      async () => {
        path = await resolvedPath;
        await Promise.all(
          lifetime
            .documents(id)
            .filter((document) => contains(document.getSnapshot().path))
            .map((document) => document.flush()),
        );
        await persistNow();
      },
      async () => {
        const result = await files.deleteFile(id, path, null);
        relocations.invalidateReads();
        return result;
      },
      contains,
    );
    for (const tab of useApp.getState().sessions[id]?.tabs ?? [])
      if (contains(tab)) removeTab(id, tab);
    forgetFavorites(id, path, true);
    useApp.setState((state) => ({
      entries: {
        ...state.entries,
        [id]: (state.entries[id] ?? []).filter(
          (entry) => !contains(entry.path),
        ),
      },
      appearances: {
        ...state.appearances,
        [id]: Object.fromEntries(
          Object.entries(state.appearances[id] ?? {}).filter(
            ([entryPath]) => !contains(entryPath),
          ),
        ),
      },
      selectedFolder:
        state.activeWorkspaceId === id && contains(state.selectedFolder)
          ? ""
          : state.selectedFolder,
      navigation:
        state.navigation?.workspaceId === id && contains(state.navigation.path)
          ? null
          : state.navigation,
    }));
    if (result.warnings.length) showError(result.warnings.join("\n"));
    return;
  }
  return lifetime.retirePath(id, path, async () => {
    path = await relocations.afterMoves(id, path);
    const document =
      kind === "note"
        ? (note ?? (await loadDocumentAccepted(id, path)))
        : undefined;
    const commit = async () => {
      const currentPath = document?.getSnapshot().path ?? path;
      const result = await files.deleteFile(
        id,
        currentPath,
        document?.file.revision ?? null,
      );
      relocations.invalidateReads();
      forgetFavorites(id, currentPath);
      removeTab(id, currentPath);
      useApp.setState((state) => {
        const appearances = { ...state.appearances[id] };
        delete appearances[currentPath];
        return {
          entries: {
            ...state.entries,
            [id]: (state.entries[id] ?? []).filter(
              (entry) => entry.path !== currentPath,
            ),
          },
          appearances: { ...state.appearances, [id]: appearances },
        };
      });
      if (result.warnings.length) showError(result.warnings.join("\n"));
    };
    if (document) await lifetime.retire(document, persistNow, commit);
    else {
      await persistNow();
      await commit();
    }
  });
}

export async function removeWorkspace(id: string): Promise<void> {
  return lifetime.retireWorkspace(
    id,
    async () => {
      await relocations.whenIdle();
      const workspaceDocuments = lifetime.documents(id);
      await Promise.all(workspaceDocuments.map((document) => document.flush()));
      await persistNow();
    },
    async () => {
      const settings = await files.removeWorkspace(id);
      workspaceRefresh.unregister(id);
      forgetFavorites(id);
      useApp.setState((state) => {
        const entries = { ...state.entries };
        delete entries[id];
        return {
          ...settings,
          entries,
          focusedPane: "primary",
          selectedFolder:
            settings.activeWorkspaceId === state.activeWorkspaceId
              ? state.selectedFolder
              : "",
        };
      });
    },
  );
}

export async function loadDocument(
  id: string,
  path: string,
): Promise<NoteDocument> {
  return lifetime.load(
    id,
    path,
    () => relocations.afterMoves(id, path),
    (currentPath) => files.readNote(id, currentPath),
  );
}

function loadDocumentAccepted(id: string, path: string): Promise<NoteDocument> {
  return lifetime.loadAccepted(
    id,
    path,
    () => relocations.afterMoves(id, path),
    (currentPath) => files.readNote(id, currentPath),
  );
}

export async function newNote(id: string, folder = ""): Promise<void> {
  return lifetime.admit(id, () => newNoteAccepted(id, folder));
}

export function createFolder(
  id: string,
  parent: string,
  name: string,
): Promise<void> {
  return lifetime.admit(id, () => createFolderAccepted(id, parent, name));
}

async function createFolderAccepted(
  id: string,
  parent: string,
  name: string,
): Promise<void> {
  const currentParent = await relocations.afterMoves(id, parent);
  await files.createFolder(id, currentParent, name);
  await workspaceRefresh.refresh(id, { afterMutation: true });
}

async function newNoteAccepted(id: string, folder = ""): Promise<void> {
  const document = await relocations.createNote(id, folder);
  openFile(id, document.getSnapshot().path);
}

export const renameNote = (document: NoteDocument, destination: string) =>
  lifetime.admit(document.workspaceId, () =>
    relocations.renameNote(document, destination),
  );

export async function moveEntry(
  id: string,
  path: string,
  kind: Entry["kind"],
  folder: string,
): Promise<void> {
  return lifetime.admit(id, async () => {
    const destination = [folder, path.split("/").at(-1)]
      .filter(Boolean)
      .join("/");
    if (destination === path) return;
    if (kind === "folder" && (folder === path || folder.startsWith(path + "/")))
      throw new Error("Cannot move a folder into itself.");
    if (kind === "note") {
      const document = await loadDocumentAccepted(id, path);
      await relocations.renameNote(document, destination);
    } else if (kind === "image") {
      await relocations.renameImage(id, path, destination);
    } else {
      await relocations.moveFolder(id, path, destination);
    }
  });
}

export const moveFolder = (id: string, path: string, destination: string) =>
  lifetime.admit(id, () => relocations.moveFolder(id, path, destination));

export function reloadDocument(document: NoteDocument): Promise<void> {
  return lifetime.admit(document.workspaceId, async () => {
    await relocations.whenIdle();
    await document.reloadFromDisk((path) =>
      files.readNote(document.workspaceId, path),
    );
    await workspaceRefresh
      .refresh(document.workspaceId, { afterMutation: true })
      .catch(showError);
  });
}

export function keepDocument(document: NoteDocument): Promise<void> {
  return lifetime.admit(document.workspaceId, async () => {
    await relocations.whenIdle();
    await document.keepMine((path) =>
      files.readNote(document.workspaceId, path),
    );
  });
}

export async function saveCopy(document: NoteDocument): Promise<void> {
  return lifetime.admit(document.workspaceId, async () => {
    const content = document.content;
    const editVersion = document.editVersion;
    const copy = await relocations.createNote(document.workspaceId, "");
    copy.edit(content);
    await copy.flush();
    // Once the recovery copy is durable, retire the failed buffer so it no
    // longer prevents closing the app. Never retire newer edits or active I/O.
    const path = document.getSnapshot().path;
    if (lifetime.releaseRecovered(document, content, editVersion))
      removeTab(document.workspaceId, path);
    openFile(document.workspaceId, copy.getSnapshot().path);
  });
}

export function refreshWorkspace(id: string): Promise<void> {
  return workspaceRefresh.refresh(id);
}

/** Each platform listener owns a scoped stream of refresh invalidations. */
export const observeWorkspaceInvalidations = () =>
  workspaceRefresh.observeInvalidations();

export function searchEntries(): SearchEntry[] {
  const state = useApp.getState();
  return state.workspaces.flatMap((workspace) =>
    (state.entries[workspace.id] ?? []).map((entry) => ({
      ...entry,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      color: workspace.color,
    })),
  );
}

export async function updateWorkspace(workspace: Workspace): Promise<void> {
  const updated = await files.updateWorkspace(workspace);
  useApp.setState((state) => ({
    workspaces: state.workspaces.map((item) =>
      item.id === updated.id ? updated : item,
    ),
  }));
}
export async function flushAll(): Promise<void> {
  return lifetime.drain(() => relocations.whenIdle(), persistNow);
}
export function hasUnsavedChanges(): boolean {
  return lifetime.hasPendingWork();
}
export function toggleToolbar(): void {
  useApp.setState((state) => ({ toolbarVisible: !state.toolbarVisible }));
  persistSoon();
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  const updated = await files.savePreferences(
    preferencesSchema.parse(preferences),
  );
  useApp.setState({ preferences: updated });
  for (const document of lifetime.documents())
    document.setAutosaveDelay(updated.autosaveDelayMs);
}

export function peekDocument(
  id: string,
  path: string,
): NoteDocument | undefined {
  return lifetime.peek(id, path);
}
export function navigateTo(id: string, path: string, offset = 0): void {
  openFile(id, path);
  useApp.setState({
    navigation: {
      workspaceId: id,
      path,
      offset,
      serial: ++navigationSerial,
    },
  });
}
/** All generated notes share the normal document/save lifecycle. */
export async function createContentNote(
  id: string,
  folder: string,
  content: string,
  fixedPath?: string,
  open = true,
): Promise<NoteDocument> {
  return lifetime.admit(id, () =>
    createContentNoteAccepted(id, folder, content, fixedPath, open),
  );
}

async function createContentNoteAccepted(
  id: string,
  folder: string,
  content: string,
  fixedPath?: string,
  open = true,
): Promise<NoteDocument> {
  const document = await relocations.createNote(id, folder);
  // Keep a failed generated note reachable; never discard its unsaved buffer.
  try {
    if (fixedPath) await relocations.renameNote(document, fixedPath);
    document.editFromAction(content);
    await document.flush();
  } catch (error) {
    openFile(id, document.getSnapshot().path);
    throw error;
  }
  if (open) openFile(id, document.getSnapshot().path);
  return document;
}
async function registerCaptureWorkspace(): Promise<string> {
  const snapshot = await files.ensureCaptureWorkspace();
  lifetime.activate(snapshot.workspace.id);
  useApp.setState((state) => ({
    workspaces: [
      ...state.workspaces.filter((w) => w.id !== snapshot.workspace.id),
      snapshot.workspace,
    ],
  }));
  workspaceRefresh.register(snapshot.workspace.id, snapshot);
  return snapshot.workspace.id;
}

/** Bound operations retain the admission of a complete multi-step note workflow. */
function workspaceDocuments(id: string) {
  return {
    id,
    load: (path: string) => loadDocumentAccepted(id, path),
    create: (folder = "") => newNoteAccepted(id, folder),
    createFolder: (parent: string, name: string) =>
      createFolderAccepted(id, parent, name),
    createContent: (
      folder: string,
      content: string,
      fixedPath?: string,
      open = true,
    ) => createContentNoteAccepted(id, folder, content, fixedPath, open),
  };
}
export type WorkspaceDocuments = ReturnType<typeof workspaceDocuments>;
export function withWorkspaceDocuments<T>(
  id: string,
  operation: (documents: WorkspaceDocuments) => Promise<T>,
): Promise<T> {
  return lifetime.admit(id, () => operation(workspaceDocuments(id)));
}
export function withCaptureDocuments<T>(
  operation: (documents: WorkspaceDocuments) => Promise<T>,
): Promise<T> {
  return lifetime.admitRegistration(async () =>
    operation(workspaceDocuments(await registerCaptureWorkspace())),
  );
}
