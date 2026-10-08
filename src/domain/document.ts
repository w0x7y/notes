import type { NoteFile, SaveResult } from "./contracts";
import { errorMessage, noteTitle } from "./notes";

const conflictMessage =
  "This file changed on disk. Your text is kept. Choose Reload, Keep mine, or Save a copy.";
export type SaveStatus =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "conflict"; message: string };
type DocumentSnapshot = {
  editable: boolean;
  path: string;
  title: string;
  status: SaveStatus;
  autoRename: boolean;
  externalVersion: number;
};
type DiskContent = { content: string; revision: string };
type ReadNote = (path: string) => Promise<NoteFile>;

/** One document owns its save and recovery queue, even when its tab is not mounted. */
export class NoteDocument {
  readonly id: string;
  content: string;
  selection = { anchor: 0, head: 0 };
  scrollTop = 0;
  private savedContent: string;
  private revision: string;
  private snapshot: DocumentSnapshot;
  private listeners = new Set<() => void>();
  private contentListeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;
  private held: Promise<void> | null = null;
  private disposed = false;
  private editHolds = 0;
  private editSerial = 0;
  private conflict: DiskContent | null = null;
  private writing = false;
  private observedDuringWrite: DiskContent | null = null;

  constructor(
    readonly workspaceId: string,
    note: NoteFile,
    private readonly write: (note: NoteFile) => Promise<SaveResult>,
    private readonly onSaved: (
      document: NoteDocument,
      previousPath: string,
      result: SaveResult,
    ) => void,
    private delay = 600,
    private readonly read?: ReadNote,
  ) {
    this.id = `${workspaceId}:${note.path}:${Date.now()}`;
    this.content = this.savedContent = note.content;
    this.revision = note.revision;
    this.snapshot = {
      editable: true,
      path: note.path,
      title: noteTitle(note.path, note.content),
      status: { kind: "saved" },
      autoRename: note.autoRename,
      externalVersion: 0,
    };
  }

  getSnapshot = (): DocumentSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  subscribeContent = (listener: () => void) => {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  };
  get dirty(): boolean {
    return this.content !== this.savedContent || this.conflict !== null;
  }
  get hasConflict(): boolean {
    return this.conflict !== null;
  }
  get editVersion(): number {
    return this.editSerial;
  }
  get hasPendingOperation(): boolean {
    return this.pending !== null;
  }
  get file(): NoteFile {
    return {
      path: this.snapshot.path,
      content: this.content,
      revision: this.revision,
      autoRename: this.snapshot.autoRename,
    };
  }

  private scheduleAutosave(): void {
    clearTimeout(this.timer);
    if (this.disposed || this.conflict || !this.dirty) return;
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.delay);
  }
  setAutosaveDelay(delay: number): void {
    this.delay = delay;
    if (this.timer) this.scheduleAutosave();
  }

  edit(content: string): void {
    if (content === this.content) return;
    if (!this.snapshot.editable)
      throw new Error(
        "This note is temporarily busy. Wait for the operation to finish.",
      );
    this.content = content;
    this.editSerial++;
    const title = noteTitle(this.snapshot.path, content);
    if (this.conflict) this.publish({ title });
    else if (
      this.snapshot.status.kind !== "saving" ||
      title !== this.snapshot.title
    )
      this.publish({ title, status: { kind: "saving" } });
    this.contentListeners.forEach((listener) => listener());
    this.scheduleAutosave();
  }

  /** Programmatic edits must refresh mounted source and preview editors. */
  editFromAction(content: string): void {
    if (content === this.content) return;
    this.edit(content);
    this.publish({ externalVersion: this.snapshot.externalVersion + 1 });
  }

  flush(): Promise<void> {
    if (this.disposed)
      return Promise.reject(
        new Error("This note is closed. Reopen it before saving."),
      );
    clearTimeout(this.timer);
    if (this.held) return this.held.then(() => this.flush());
    if (this.pending) return this.pending;
    if (this.conflict) return Promise.reject(new Error(conflictMessage));
    return this.track(this.drain());
  }

  /** Drain existing writes, then reserve the path while a relocation runs. */
  async holdSaves(): Promise<() => void> {
    await this.flush();
    let release = () => {};
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = null;
      release();
      this.scheduleAutosave();
    };
  }

  private markConflict(disk: DiskContent): void {
    this.conflict = disk;
    clearTimeout(this.timer);
    this.publish({ status: { kind: "conflict", message: conflictMessage } });
  }

  /** Revision comparison classifies failed writes without matching native error prose. */
  private async writeChecked(
    payload: NoteFile,
    write = this.write,
  ): Promise<SaveResult> {
    this.writing = true;
    this.observedDuringWrite = null;
    try {
      return await write(payload);
    } catch (error) {
      let changed = false;
      if (this.read) {
        try {
          const disk = await this.read(payload.path);
          if (disk.revision !== payload.revision) {
            this.markConflict(disk);
            changed = true;
          }
        } catch {
          // An unreadable/missing file is an I/O failure, not proof of a revision conflict.
        }
      }
      const observed = this.observation();
      if (observed && observed.revision !== payload.revision) {
        this.markConflict(observed);
        changed = true;
      }
      if (changed) throw new Error(conflictMessage, { cause: error });
      throw error;
    } finally {
      this.writing = false;
    }
  }

  private observation(): DiskContent | null {
    return this.observedDuringWrite;
  }

  private async drain(
    firstRevision?: string,
    recovering = false,
  ): Promise<void> {
    try {
      let expected = firstRevision;
      while (this.dirty) {
        if (this.conflict && !recovering) throw new Error(conflictMessage);
        if (!this.conflict) this.publish({ status: { kind: "saving" } });
        const payload = { ...this.file, revision: expected ?? this.revision };
        const result = await this.writeChecked(payload);
        expected = undefined;
        this.savedContent = payload.content;
        this.revision = result.revision;
        if (recovering) this.conflict = null;
        recovering = false;
        this.publish({
          path: result.path,
          autoRename: result.autoRename,
          title: noteTitle(result.path, this.content),
        });
        this.onSaved(this, payload.path, result);
        const observed = this.observedDuringWrite;
        this.observedDuringWrite = null;
        // A watcher can see our own atomic write before its response arrives.
        // Recovery also expects the freshly read disk revision, which a
        // concurrent refresh can observe before our write commits.
        if (
          observed &&
          observed.revision !== payload.revision &&
          observed.revision !== result.revision
        )
          this.markConflict(observed);
      }
      if (this.conflict) throw new Error(conflictMessage);
      this.publish({ status: { kind: "saved" } });
    } catch (error) {
      if (!this.conflict)
        this.publish({
          status: { kind: "failed", message: errorMessage(error) },
        });
      throw error;
    }
  }

  rename(renameFile: (note: NoteFile) => Promise<SaveResult>): Promise<void> {
    if (!this.snapshot.editable || this.disposed)
      return Promise.reject(
        new Error(
          "This note is being closed or removed. Reopen it before renaming.",
        ),
      );
    clearTimeout(this.timer);
    if (this.held) return this.held.then(() => this.rename(renameFile));
    const operation = (this.pending ?? Promise.resolve())
      .then(async () => {
        if (!this.snapshot.editable)
          throw new Error(
            "This note is being closed or removed. Reopen it before renaming.",
          );
        await this.drain();
        const payload = this.file;
        this.publish({ status: { kind: "saving" } });
        const result = await this.writeChecked(payload, renameFile);
        this.revision = result.revision;
        this.savedContent = result.content;
        const unchanged = this.content === payload.content;
        if (unchanged && this.content !== result.content) {
          this.content = result.content;
          this.contentListeners.forEach((listener) => listener());
        }
        this.publish({
          path: result.path,
          autoRename: result.autoRename,
          title: noteTitle(result.path, this.content),
          externalVersion:
            this.snapshot.externalVersion +
            (unchanged && payload.content !== result.content ? 1 : 0),
        });
        this.onSaved(this, payload.path, result);
        const observed = this.observedDuringWrite;
        this.observedDuringWrite = null;
        if (observed && observed.revision !== result.revision)
          this.markConflict(observed);
        await this.drain();
      })
      .catch((error) => {
        if (!this.conflict)
          this.publish({
            status: { kind: "failed", message: errorMessage(error) },
          });
        throw error;
      });
    return this.track(operation);
  }

  private track(operation: Promise<void>): Promise<void> {
    const pending = operation.finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  receiveExternal(
    content: string,
    revision: string,
    basedOnRevision = this.revision,
  ): void {
    if (
      this.disposed ||
      basedOnRevision !== this.revision ||
      revision === this.revision
    )
      return;
    const disk = { content, revision };
    if (this.writing) {
      this.observedDuringWrite = disk;
      return;
    }
    if (this.dirty) {
      this.markConflict(disk);
      return;
    }
    this.replaceFromDisk(disk);
  }

  private replaceFromDisk(disk: DiskContent): void {
    this.content = this.savedContent = disk.content;
    this.revision = disk.revision;
    this.conflict = null;
    clearTimeout(this.timer);
    this.publish({
      title: noteTitle(this.snapshot.path, disk.content),
      status: { kind: "saved" },
      externalVersion: this.snapshot.externalVersion + 1,
    });
    this.contentListeners.forEach((listener) => listener());
  }

  /** Reload is an explicit discard; hold input only while reading its replacement. */
  reloadFromDisk(read = this.read): Promise<void> {
    return this.recover("reload", read);
  }
  /** Keep mine adopts a freshly read revision only after an optimistic write succeeds. */
  keepMine(read = this.read): Promise<void> {
    return this.recover("keep", read);
  }
  private recover(choice: "reload" | "keep", read?: ReadNote): Promise<void> {
    if (this.disposed || !this.snapshot.editable)
      return Promise.reject(new Error("This note is busy or closed."));
    if (!read)
      return Promise.reject(new Error("This note cannot read its file."));
    if (this.held) return this.held.then(() => this.recover(choice, read));
    const editVersion = this.editVersion;
    const operation = (this.pending ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.disposed || !this.snapshot.editable)
          throw new Error("This note is busy or closed.");
        if (!this.conflict) return;
        if (choice === "reload" && editVersion !== this.editVersion)
          throw new Error(
            "Your note changed while preparing to reload. Review your edits and choose Reload again.",
          );
        const unlock = choice === "reload" ? this.holdEdits() : () => {};
        try {
          const disk = await read(this.snapshot.path);
          if (choice === "reload") this.replaceFromDisk(disk);
          else await this.drain(disk.revision, true);
        } finally {
          unlock();
        }
      });
    return this.track(operation);
  }

  relocatePath(path: string): void {
    this.publish({
      path,
      title: noteTitle(path, this.content),
      externalVersion: this.snapshot.externalVersion + 1,
    });
  }

  holdEdits(): () => void {
    this.editHolds++;
    this.publish({ editable: false });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.editHolds--;
      if (!this.disposed && this.editHolds === 0)
        this.publish({ editable: true });
    };
  }

  dispose(): void {
    this.disposed = true;
    this.publish({ editable: false });
    clearTimeout(this.timer);
    this.listeners.clear();
    this.contentListeners.clear();
  }
  private publish(update: Partial<DocumentSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }
}
