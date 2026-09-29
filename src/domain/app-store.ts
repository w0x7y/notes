import { create } from "zustand";
import type {
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
  workspaces: [],
  activeWorkspaceId: null,
  sessions: {},
  toolbarVisible: false,
  ready: false,
  entries: {},
  notice: null,
  focusedPane: "primary",
}));
const documents = new Map<string, NoteDocument>();
const loading = new Map<string, Promise<NoteDocument>>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const key = (id: string, path: string) => `${id}\0${path}`;
export const showError = (error: unknown) =>
  useApp.setState({ notice: errorMessage(error) });
export const run = (operation: Promise<unknown>) => {
  void operation.catch(showError);
};

export async function persistNow(): Promise<void> {
  clearTimeout(persistTimer);
  const { sessions, activeWorkspaceId, toolbarVisible } = useApp.getState();
  await files.saveSessions({ sessions, activeWorkspaceId, toolbarVisible });
}
function persistSoon(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => run(persistNow()), 250);
}

export async function initialize(): Promise<void> {
  try {
    const settings = await files.loadSettings();
    useApp.setState(settings);
    const results = await Promise.allSettled(
      settings.workspaces.map((workspace) => files.scanWorkspace(workspace.id)),
    );
    const entries: Record<string, Entry[]> = {};
    results.forEach((result, i) => {
      if (result.status === "fulfilled")
        entries[result.value.workspace.id] = result.value.entries;
      else
        showError(
          `Could not open ${settings.workspaces[i]?.name}: ${errorMessage(result.reason)}`,
        );
    });
    const activeWorkspaceId = settings.workspaces.some(
      (item) => item.id === settings.activeWorkspaceId,
    )
      ? settings.activeWorkspaceId
      : (settings.workspaces[0]?.id ?? null);
    useApp.setState({ entries, activeWorkspaceId, ready: true });
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
  const document = documents.get(key(id, path));
  await document?.flush();
  const currentPath = document?.getSnapshot().path ?? path;
  removeTab(id, currentPath);
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

function saved(
  document: NoteDocument,
  previousPath: string,
  result: SaveResult,
): void {
  const id = document.workspaceId;
  if (previousPath !== result.path) {
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

export async function refreshWorkspace(id: string): Promise<void> {
  const snapshot = await files.scanWorkspace(id);
  useApp.setState((state) => ({
    entries: { ...state.entries, [id]: snapshot.entries },
  }));
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
