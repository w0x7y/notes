import {
  defaultPreferences,
  preferencesSchema,
  type Preferences,
} from "./preferences";
import { create } from "zustand";
import type {
  Appearance,
  Entry,
  SaveResult,
  SearchEntry,
  Session,
  Settings,
  Workspace,
} from "./contracts";
import { NoteDocument } from "./document";
import { errorMessage, extractTags, noteTitle } from "./notes";
import { files } from "../platform";

export const emptySession = (): Session => ({
  tabs: [],
  primary: null,
  secondary: null,
  split: false,
});
type AppState = Settings & {
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
  ready: false,
  entries: {},
  notice: null,
  focusedPane: "primary",
}));
const documents = new Map<string, NoteDocument>();
const loading = new Map<string, Promise<NoteDocument>>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persisting: Promise<void> = Promise.resolve();
const key = (id: string, path: string) => `${id}\0${path}`;
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

export async function initialize(): Promise<void> {
  try {
    const settings = await files.loadSettings();
    const activeWorkspaceId = settings.workspaces.some(
      (item) => item.id === settings.activeWorkspaceId,
    )
      ? settings.activeWorkspaceId
      : (settings.workspaces[0]?.id ?? null);
    useApp.setState({
      ...settings,
      activeWorkspaceId,
      sessions: settings.preferences.restoreSession ? settings.sessions : {},
    });
    // Read the active workspace first, before background work can occupy disk workers.
    const scan = async (workspace: Workspace) => {
      try {
        const snapshot = await files.scanWorkspace(workspace.id);
        if (
          !useApp.getState().workspaces.some((item) => item.id === workspace.id)
        )
          return;
        useApp.setState((state) => ({
          entries: { ...state.entries, [workspace.id]: snapshot.entries },
        }));
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
  const snapshot = await files.addWorkspace(path);
  useApp.setState((state) => ({
    workspaces: [
      ...state.workspaces.filter((item) => item.id !== snapshot.workspace.id),
      snapshot.workspace,
    ],
    entries: { ...state.entries, [snapshot.workspace.id]: snapshot.entries },
    activeWorkspaceId: snapshot.workspace.id,
  }));
  persistSoon();
}

export function switchWorkspace(id: string): void {
  useApp.setState({ activeWorkspaceId: id, focusedPane: "primary" });
  persistSoon();
}
export function currentSession(): Session {
  const state = useApp.getState();
  return state.sessions[state.activeWorkspaceId ?? ""] ?? emptySession();
}
export function changeSession(
  id: string,
  update: (session: Session) => Session,
): void {
  useApp.setState((state) => ({
    sessions: {
      ...state.sessions,
      [id]: update(state.sessions[id] ?? emptySession()),
    },
  }));
  persistSoon();
}
export function openFile(
  id: string,
  path: string,
  pane?: "primary" | "secondary",
): void {
  const state = useApp.getState();
  const session = state.sessions[id] ?? emptySession();
  const requested =
    pane ?? (state.activeWorkspaceId === id ? state.focusedPane : "primary");
  const target =
    session.split && session.primary === path
      ? "primary"
      : session.split && session.secondary === path
        ? "secondary"
        : requested;
  useApp.setState({ activeWorkspaceId: id, focusedPane: target });
  changeSession(id, (session) => ({
    ...session,
    tabs: session.tabs.includes(path) ? session.tabs : [...session.tabs, path],
    [target]: path,
    split: target === "secondary" || session.split,
  }));
}

export async function closeFile(id: string, path: string): Promise<void> {
  const document =
    documents.get(key(id, path)) ?? (await loading.get(key(id, path)));
  await document?.flush();
  const currentPath = document?.getSnapshot().path ?? path;
  removeTab(id, currentPath);
  // Closed, saved buffers do not need to retain their text and subscriptions.
  if (document && !document.dirty && !document.hasPendingOperation) {
    document.dispose();
    documents.delete(key(id, currentPath));
  }
}

function removeTab(id: string, currentPath: string): void {
  changeSession(id, (session) => {
    const tabs = session.tabs.filter((item) => item !== currentPath);
    return {
      ...session,
      tabs,
      primary:
        session.primary === currentPath
          ? (tabs.find((item) => item !== session.secondary) ?? null)
          : session.primary,
      secondary:
        session.secondary === currentPath
          ? (tabs.find((item) => item !== session.primary) ?? null)
          : session.secondary,
    };
  });
}

function remapAppearance(id: string, previousPath: string, path: string): void {
  useApp.setState((state) => {
    const entries = { ...state.appearances[id] };
    const appearance = entries[previousPath];
    if (!appearance) return state;
    delete entries[previousPath];
    entries[path] = appearance;
    return { appearances: { ...state.appearances, [id]: entries } };
  });
}

export async function setEntryAppearance(
  id: string,
  path: string,
  appearance: Appearance,
  note?: NoteDocument,
): Promise<void> {
  const document =
    note ?? documents.get(key(id, path)) ?? (await loading.get(key(id, path)));
  await document?.flush();
  const currentPath = document?.getSnapshot().path ?? path;
  const updated = await files.setEntryAppearance(id, currentPath, appearance);
  useApp.setState((state) => ({
    appearances: {
      ...state.appearances,
      [id]: { ...state.appearances[id], [currentPath]: updated },
    },
  }));
}

export async function renameImage(
  id: string,
  path: string,
  name: string,
): Promise<void> {
  // Incoming image links can live in any open workspace. Save pending edits
  // before the backend rewrites them so their revisions stay in sync.
  await flushAll();
  const result = await files.renameImage(id, path, name);
  remapAppearance(id, path, result.path);
  changeSession(id, (session) => ({
    ...session,
    tabs: session.tabs.map((tab) => (tab === path ? result.path : tab)),
    primary: session.primary === path ? result.path : session.primary,
    secondary: session.secondary === path ? result.path : session.secondary,
  }));
  useApp.setState((state) => ({
    entries: {
      ...state.entries,
      [id]: (state.entries[id] ?? []).map((entry) =>
        entry.path === path
          ? {
              ...entry,
              path: result.path,
              title: result.path.split("/").at(-1) ?? result.path,
            }
          : entry,
      ),
    },
  }));
  for (const rewrite of result.rewritten) {
    documents
      .get(key(rewrite.workspaceId, rewrite.path))
      ?.receiveExternal(rewrite.content, rewrite.revision);
  }
  if (result.warnings.length) showError(result.warnings.join("\n"));
}

export async function deleteEntry(
  id: string,
  path: string,
  kind: "note" | "image",
  note?: NoteDocument,
): Promise<void> {
  const document =
    kind === "note" ? (note ?? (await loadDocument(id, path))) : undefined;
  await document?.flush();
  const currentPath = document?.getSnapshot().path ?? path;
  await persistNow();
  const result = await files.deleteFile(
    id,
    currentPath,
    document?.file.revision ?? null,
  );
  document?.dispose();
  documents.delete(key(id, currentPath));
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
}

export async function removeWorkspace(id: string): Promise<void> {
  await Promise.allSettled(
    [...loading.entries()]
      .filter(([entryKey]) => entryKey.startsWith(id + "\0"))
      .map(([, request]) => request),
  );
  const workspaceDocuments = [...documents.values()].filter(
    (document) => document.workspaceId === id,
  );
  await Promise.all(workspaceDocuments.map((document) => document.flush()));
  await persistNow();
  const settings = await files.removeWorkspace(id);
  for (const document of workspaceDocuments) {
    document.dispose();
    documents.delete(key(id, document.getSnapshot().path));
  }
  useApp.setState((state) => {
    const entries = { ...state.entries };
    delete entries[id];
    return { ...settings, entries, focusedPane: "primary" };
  });
}

function saved(
  document: NoteDocument,
  previousPath: string,
  result: SaveResult,
): void {
  const id = document.workspaceId;
  if (previousPath !== result.path) {
    remapAppearance(id, previousPath, result.path);
    documents.delete(key(id, previousPath));
    documents.set(key(id, result.path), document);
    changeSession(id, (session) => ({
      ...session,
      tabs: session.tabs.map((path) =>
        path === previousPath ? result.path : path,
      ),
      primary: session.primary === previousPath ? result.path : session.primary,
      secondary:
        session.secondary === previousPath ? result.path : session.secondary,
    }));
  }
  useApp.setState((state) => {
    const entries = (state.entries[id] ?? []).filter(
      (entry) => entry.path !== previousPath && entry.path !== result.path,
    );
    entries.push({
      path: result.path,
      kind: "note",
      title: noteTitle(result.path, result.content),
      tags: extractTags(result.content),
      modified: Date.now(),
    });
    return { entries: { ...state.entries, [id]: entries } };
  });
  for (const rewrite of result.rewritten) {
    documents
      .get(key(rewrite.workspaceId, rewrite.path))
      ?.receiveExternal(rewrite.content, rewrite.revision);
  }
  if (result.warnings.length) showError(result.warnings.join("\n"));
}

function registerDocument(
  id: string,
  note: Parameters<typeof files.saveNote>[1],
): NoteDocument {
  const document = new NoteDocument(
    id,
    note,
    (payload) => files.saveNote(id, payload),
    saved,
    useApp.getState().preferences.autosaveDelayMs,
  );
  documents.set(key(id, note.path), document);
  return document;
}

export async function loadDocument(
  id: string,
  path: string,
): Promise<NoteDocument> {
  const cached = documents.get(key(id, path));
  if (cached) return cached;
  const pending = loading.get(key(id, path));
  if (pending) return pending;
  const request = files
    .readNote(id, path)
    .then((note) => registerDocument(id, note))
    .finally(() => loading.delete(key(id, path)));
  loading.set(key(id, path), request);
  return request;
}

export async function newNote(id: string, folder = ""): Promise<void> {
  const note = await files.createNote(id, folder);
  const document = registerDocument(id, note);
  saved(document, note.path, { ...note, rewritten: [], warnings: [] });
  openFile(id, note.path);
}

export async function renameNote(
  document: NoteDocument,
  name: string,
): Promise<void> {
  await document.rename((note) =>
    files.renameNote(document.workspaceId, note, name),
  );
}

export async function saveCopy(document: NoteDocument): Promise<void> {
  const content = document.content;
  const note = await files.createNote(document.workspaceId, "");
  const copy = registerDocument(document.workspaceId, note);
  copy.edit(content);
  await copy.flush();
  // Once the recovery copy is durable, retire the failed buffer so it no
  // longer prevents closing the app. Never retire newer edits or active I/O.
  if (
    document.content === content &&
    document.getSnapshot().status.kind === "failed" &&
    !document.hasPendingOperation
  ) {
    const path = document.getSnapshot().path;
    documents.delete(key(document.workspaceId, path));
    document.dispose();
    removeTab(document.workspaceId, path);
  }
  openFile(document.workspaceId, copy.getSnapshot().path);
}

const refreshing = new Map<string, Promise<void>>();
export function refreshWorkspace(id: string): Promise<void> {
  const pending = refreshing.get(id);
  if (pending) return pending;
  const request = refresh(id).finally(() => refreshing.delete(id));
  refreshing.set(id, request);
  return request;
}
function sameEntries(a: Entry[], b: Entry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return (
        other &&
        entry.path === other.path &&
        entry.kind === other.kind &&
        entry.title === other.title &&
        entry.modified === other.modified &&
        entry.tags.length === other.tags.length &&
        entry.tags.every((tag, i) => tag === other.tags[i])
      );
    })
  );
}
async function refresh(id: string): Promise<void> {
  const snapshot = await files.scanWorkspace(id);
  if (!useApp.getState().workspaces.some((workspace) => workspace.id === id))
    return;
  if (!sameEntries(useApp.getState().entries[id] ?? [], snapshot.entries)) {
    useApp.setState((state) => ({
      entries: { ...state.entries, [id]: snapshot.entries },
    }));
  }
  const openDocuments = [...documents.values()].filter(
    (document) => document.workspaceId === id && !document.dirty,
  );
  await Promise.all(
    openDocuments.map(async (document) => {
      try {
        const current = await files.readNote(id, document.getSnapshot().path);
        document.receiveExternal(current.content, current.revision);
      } catch {
        /* A removed open note remains available in memory. */
      }
    }),
  );
}

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
  await Promise.all(
    [...documents.values()].map((document) => document.flush()),
  );
  await persistNow();
}
export function hasUnsavedChanges(): boolean {
  return [...documents.values()].some((document) => document.dirty);
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
  for (const document of documents.values())
    document.setAutosaveDelay(updated.autosaveDelayMs);
}
