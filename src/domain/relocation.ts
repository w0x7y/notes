import { remapFavorites } from "../knowledge/library";
import type { AppState } from "./app-store";
import type { Entry, FileService, NoteFile, SaveResult } from "./contracts";
import type { NoteDocument } from "./document";
import { errorMessage, extractTags, noteTitle } from "./notes";

type Host = {
  setState: (
    update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ) => void;
  documents: Map<string, NoteDocument>;
  loading: Map<string, Promise<NoteDocument>>;
  files: FileService;
  persist: () => Promise<void>;
  persistSoon: () => void;
  refresh: (workspaceId: string) => Promise<void>;
  report: (error: unknown) => void;
  register: (workspaceId: string, note: NoteFile) => NoteDocument;
};
const key = (workspaceId: string, path: string) => `${workspaceId}\0${path}`;

/** Owns relocation ordering and every in-memory consequence of a path change. */
export class Relocations {
  private pending: Promise<void> = Promise.resolve();
  private waitingPaths = new Set<{ workspaceId: string; path: string }>();
  private changes = 0;

  constructor(private readonly host: Host) {}

  get version(): number {
    return this.changes;
  }

  async whenIdle(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
  }

  async afterMoves(workspaceId: string, path: string): Promise<string> {
    const location = { workspaceId, path };
    this.waitingPaths.add(location);
    try {
      await this.whenIdle();
      return location.path;
    } finally {
      this.waitingPaths.delete(location);
    }
  }

  createNote(workspaceId: string, folder: string): Promise<NoteDocument> {
    return this.atPath(workspaceId, folder, async (currentFolder) => {
      const note = await this.host.files.createNote(workspaceId, currentFolder);
      const document = this.host.register(workspaceId, note);
      this.saved(document, note.path, { ...note, rewritten: [], warnings: [] });
      return document;
    });
  }

  renameNote(document: NoteDocument, destination: string): Promise<void> {
    return this.enqueue(() =>
      this.withHeldDocuments(async () => {
        let committed = false;
        try {
          await document.rename(async (note) => {
            const result = await this.host.files.renameNote(
              document.workspaceId,
              note,
              destination,
            );
            committed = true;
            return result;
          });
        } catch (error) {
          if (!committed) throw error;
          this.reportWarnings([
            `Note renamed, but subsequent edits could not be saved: ${errorMessage(error)}`,
          ]);
        }
      }, document),
    );
  }

  renameImage(
    workspaceId: string,
    path: string,
    destination: string,
  ): Promise<void> {
    return this.atPath(workspaceId, path, (currentPath) =>
      this.withHeldDocuments(async () => {
        const result = await this.host.files.renameImage(
          workspaceId,
          currentPath,
          destination,
        );
        this.remap(workspaceId, currentPath, result.path, "image");
        this.applyRewrites(result.rewritten);
        this.reportWarnings(result.warnings);
      }),
    );
  }

  moveFolder(
    workspaceId: string,
    path: string,
    destination: string,
  ): Promise<void> {
    return this.atPath(workspaceId, path, (currentPath) =>
      this.withHeldDocuments(async () => {
        const result = await this.host.files.moveFolder(
          workspaceId,
          currentPath,
          destination,
        );
        if (result.path === currentPath) return;
        // Commit all paths before follow-up reads. One unreadable destination must
        // never strand this or another buffer under its previous path.
        const moved = this.remap(
          workspaceId,
          currentPath,
          result.path,
          "folder",
        );
        const warnings = [...result.warnings];
        this.applyRewrites(result.rewritten);
        await Promise.all(
          moved.map(async (document) => {
            try {
              const note = await this.host.files.readNote(
                workspaceId,
                document.getSnapshot().path,
              );
              document.receiveExternal(note.content, note.revision);
            } catch (error) {
              warnings.push(
                `Folder moved, but ${document.getSnapshot().path} could not be reread: ${errorMessage(error)}`,
              );
            }
          }),
        );
        try {
          await this.host.refresh(workspaceId);
        } catch (error) {
          warnings.push(
            `Folder moved, but the workspace could not be refreshed: ${errorMessage(error)}`,
          );
        }
        this.reportWarnings(warnings);
      }),
    );
  }

  saved(
    document: NoteDocument,
    previousPath: string,
    result: SaveResult,
  ): void {
    this.changes++;
    const workspaceId = document.workspaceId;
    this.remap(workspaceId, previousPath, result.path, "note");
    this.host.setState((state) => {
      const previous = state.entries[workspaceId]?.find(
        (entry) => entry.path === result.path,
      );
      const entries = (state.entries[workspaceId] ?? []).filter(
        (entry) => entry.path !== result.path,
      );
      entries.push({
        path: result.path,
        kind: "note",
        title: noteTitle(result.path, result.content),
        tags: extractTags(result.content),
        modified: Math.max(Date.now(), (previous?.modified ?? 0) + 1),
      });
      return { entries: { ...state.entries, [workspaceId]: entries } };
    });
    this.applyRewrites(result.rewritten);
    this.reportWarnings(result.warnings);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private atPath<T>(
    workspaceId: string,
    path: string,
    operation: (currentPath: string) => Promise<T>,
  ): Promise<T> {
    const location = { workspaceId, path };
    this.waitingPaths.add(location);
    return this.enqueue(() => operation(location.path)).finally(() => {
      this.waitingPaths.delete(location);
    });
  }

  private async withHeldDocuments(
    operation: () => Promise<void>,
    except?: NoteDocument,
  ): Promise<void> {
    await Promise.all([...this.host.loading.values()]);
    const documents = [...this.host.documents.values()].filter(
      (document) => document !== except,
    );
    const held = await Promise.allSettled(
      documents.map((document) => document.holdSaves()),
    );
    try {
      for (const result of held)
        if (result.status === "rejected") throw result.reason;
      await this.host.persist();
      await operation();
    } finally {
      for (const result of held)
        if (result.status === "fulfilled") result.value();
    }
    // Edits made while held use the reconciled path and revision. Failed saves
    // retain the buffer and are reported separately from the committed move.
    const saves = await Promise.allSettled(
      documents
        .filter((document) => document.dirty)
        .map((document) => document.flush()),
    );
    this.reportWarnings(
      saves.flatMap((result) =>
        result.status === "rejected" ? [errorMessage(result.reason)] : [],
      ),
    );
  }

  private remap(
    workspaceId: string,
    from: string,
    to: string,
    kind: Entry["kind"],
  ): NoteDocument[] {
    if (from === to) return [];
    this.changes++;
    const map = (path: string) =>
      path === from || (kind === "folder" && path.startsWith(from + "/"))
        ? to + path.slice(from.length)
        : path;
    const moved: NoteDocument[] = [];
    for (const location of this.waitingPaths) {
      if (location.workspaceId === workspaceId)
        location.path = map(location.path);
    }
    for (const [oldKey, document] of [...this.host.documents]) {
      if (document.workspaceId !== workspaceId) continue;
      const current = document.getSnapshot().path;
      // A note save publishes its new path before this callback.
      if (
        current === to &&
        kind === "note" &&
        oldKey === key(workspaceId, from)
      ) {
        this.host.documents.delete(oldKey);
        this.host.documents.set(key(workspaceId, to), document);
      } else if (map(current) !== current) {
        const updated = map(current);
        this.host.documents.delete(oldKey);
        this.host.documents.set(key(workspaceId, updated), document);
        document.relocatePath(updated);
        moved.push(document);
      }
    }
    remapFavorites(workspaceId, map);
    this.host.setState((state) => {
      const session = state.sessions[workspaceId];
      const navigation = state.navigation;
      return {
        sessions: session
          ? {
              ...state.sessions,
              [workspaceId]: {
                ...session,
                tabs: session.tabs.map(map),
                primary: session.primary ? map(session.primary) : null,
                secondary: session.secondary ? map(session.secondary) : null,
              },
            }
          : state.sessions,
        entries: {
          ...state.entries,
          [workspaceId]: (state.entries[workspaceId] ?? []).map((entry) => ({
            ...entry,
            path: map(entry.path),
            title:
              entry.kind === "note"
                ? entry.title
                : (map(entry.path).split("/").at(-1) ?? entry.title),
          })),
        },
        appearances: {
          ...state.appearances,
          [workspaceId]: Object.fromEntries(
            Object.entries(state.appearances[workspaceId] ?? {}).map(
              ([path, appearance]) => [map(path), appearance],
            ),
          ),
        },
        selectedFolder:
          state.activeWorkspaceId === workspaceId
            ? map(state.selectedFolder)
            : state.selectedFolder,
        navigation:
          navigation?.workspaceId === workspaceId
            ? { ...navigation, path: map(navigation.path) }
            : navigation,
      };
    });
    this.host.persistSoon();
    return moved;
  }

  private applyRewrites(rewrites: SaveResult["rewritten"]): void {
    if (!rewrites.length) return;
    this.changes++;
    for (const rewrite of rewrites) {
      this.host.documents
        .get(key(rewrite.workspaceId, rewrite.path))
        ?.receiveExternal(rewrite.content, rewrite.revision);
    }
    this.host.setState((state) => {
      const entries = { ...state.entries };
      for (const rewrite of rewrites) {
        entries[rewrite.workspaceId] = (entries[rewrite.workspaceId] ?? []).map(
          (entry) =>
            entry.path === rewrite.path
              ? {
                  ...entry,
                  title: noteTitle(rewrite.path, rewrite.content),
                  tags: extractTags(rewrite.content),
                  modified: Math.max(Date.now(), entry.modified + 1),
                }
              : entry,
        );
      }
      return { entries };
    });
  }

  private reportWarnings(warnings: string[]): void {
    if (warnings.length) this.host.report(warnings.join("\n"));
  }
}
