import { remapFavorites } from "./library";
import type { AppState } from "./app-store";
import type { Entry, FileService, SaveResult } from "./contracts";
import type { NoteDocument } from "./document";
import type { DocumentLifetime } from "./document-lifetime";
import { transitionSession } from "./workspace-session";
import { errorMessage, extractAliases, extractTags, noteTitle } from "./notes";

type Host = {
  setState: (
    update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ) => void;
  lifetime: DocumentLifetime;
  files: FileService;
  persist: () => Promise<void>;
  persistSoon: () => void;
  refresh: (workspaceId: string) => Promise<void>;
  report: (error: unknown) => void;
};

/** Owns relocation ordering and every in-memory consequence of a path change. */
export class Relocations {
  private pending: Promise<void> = Promise.resolve();
  private waitingPaths = new Set<{ workspaceId: string; path: string }>();
  private changes = 0;

  constructor(private readonly host: Host) {}

  get version(): number {
    return this.changes;
  }

  invalidateReads(): void {
    this.changes++;
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
      const document = this.host.lifetime.register(workspaceId, note);
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
      const entries = state.entries[workspaceId] ?? [];
      const previous = entries.find((entry) => entry.path === result.path);
      const title = noteTitle(result.path, result.content);
      const tags = extractTags(result.content);
      const aliases = extractAliases(result.content);
      // Autosave updates live buffers directly. Leave metadata and the tree
      // unchanged for body edits; explicit scans refresh filesystem timestamps.
      if (
        previous?.kind === "note" &&
        previous.title === title &&
        previous.tags.length === tags.length &&
        previous.tags.every((tag, index) => tag === tags[index]) &&
        (previous.aliases ?? []).length === aliases.length &&
        (previous.aliases ?? []).every(
          (alias, index) => alias === aliases[index],
        )
      )
        return state;
      const updated: Entry = {
        path: result.path,
        kind: "note",
        title,
        tags,
        aliases,
        modified: Math.max(Date.now(), (previous?.modified ?? 0) + 1),
      };
      return {
        entries: {
          ...state.entries,
          [workspaceId]: previous
            ? entries.map((entry) => (entry === previous ? updated : entry))
            : [...entries, updated],
        },
      };
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
    let committed = false;
    try {
      await this.host.lifetime.withHeldSaves(async () => {
        await this.host.persist();
        await operation();
        committed = true;
      }, except);
    } catch (error) {
      if (!committed) throw error;
      this.reportWarnings([errorMessage(error)]);
    }
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
    const moved = this.host.lifetime.remap(workspaceId, map);
    for (const location of this.waitingPaths) {
      if (location.workspaceId === workspaceId)
        location.path = map(location.path);
    }
    remapFavorites(workspaceId, map);
    this.host.setState((state) => {
      const session = state.sessions[workspaceId];
      const navigation = state.navigation;
      const view = session
        ? transitionSession(
            session,
            state.activeWorkspaceId === workspaceId
              ? state.focusedPane
              : "primary",
            { kind: "remap", mapPath: map },
          )
        : null;
      return {
        sessions: session
          ? {
              ...state.sessions,
              [workspaceId]: view?.session ?? session,
            }
          : state.sessions,
        ...(view && state.activeWorkspaceId === workspaceId
          ? { focusedPane: view.focusedPane }
          : {}),
        entries: {
          ...state.entries,
          [workspaceId]: (state.entries[workspaceId] ?? []).map((entry) => {
            const path = map(entry.path);
            return path === entry.path
              ? entry
              : {
                  ...entry,
                  path,
                  title:
                    entry.kind === "note"
                      ? entry.title
                      : (path.split("/").at(-1) ?? entry.title),
                };
          }),
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
      this.host.lifetime
        .peek(rewrite.workspaceId, rewrite.path)
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
