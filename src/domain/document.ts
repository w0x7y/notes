import type { NoteFile, SaveResult } from "./contracts";
import { errorMessage, splitNote } from "./notes";

export type SaveStatus =
  { kind: "saved" } | { kind: "saving" } | { kind: "failed"; message: string };
type DocumentSnapshot = {
  path: string;
  title: string;
  status: SaveStatus;
  autoRename: boolean;
  externalVersion: number;
};

/** One document owns its save queue, including while its tab is not mounted. */
export class NoteDocument {
  readonly id: string;
  content: string;
  selection = { anchor: 0, head: 0 };
  scrollTop = 0;
  private savedContent: string;
  private revision: string;
  private snapshot: DocumentSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;

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
  ) {
    this.id = `${workspaceId}:${note.path}:${Date.now()}`;
    this.content = this.savedContent = note.content;
    this.revision = note.revision;
    this.snapshot = {
      path: note.path,
      title: splitNote(note.content).title,
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
  get dirty(): boolean {
    return this.content !== this.savedContent;
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

  setAutosaveDelay(delay: number): void {
    this.delay = delay;
    if (this.timer && this.dirty) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, delay);
    }
  }

  edit(content: string): void {
    if (content === this.content) return;
    this.content = content;
    const title = splitNote(content).title;
    if (this.snapshot.status.kind !== "saving" || title !== this.snapshot.title)
      this.publish({ title, status: { kind: "saving" } });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.delay);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    return this.track(this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.publish({ status: { kind: "saving" } });
        const payload = this.file;
        const result = await this.write(payload);
        this.savedContent = payload.content;
        this.revision = result.revision;
        this.publish({ path: result.path, autoRename: result.autoRename });
        this.onSaved(this, payload.path, result);
      }
      this.publish({ status: { kind: "saved" } });
    } catch (error) {
      this.publish({
        status: { kind: "failed", message: errorMessage(error) },
      });
      throw error;
    }
  }

  rename(renameFile: (note: NoteFile) => Promise<SaveResult>): Promise<void> {
    clearTimeout(this.timer);
    const operation = (this.pending ?? Promise.resolve())
      .then(async () => {
        await this.drain();
        const payload = this.file;
        this.publish({ status: { kind: "saving" } });
        const result = await renameFile(payload);
        this.revision = result.revision;
        this.savedContent = result.content;
        // Typing continues while the filesystem operation runs. Keep those edits
        // and drain them against the new path and revision before reporting saved.
        const unchanged = this.content === payload.content;
        if (unchanged) this.content = result.content;
        this.publish({
          path: result.path,
          autoRename: result.autoRename,
          title: splitNote(this.content).title,
          externalVersion:
            this.snapshot.externalVersion +
            (unchanged && payload.content !== result.content ? 1 : 0),
        });
        this.onSaved(this, payload.path, result);
        await this.drain();
      })
      .catch((error) => {
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

  receiveExternal(content: string, revision: string): void {
    if (revision === this.revision) return;
    if (this.dirty || this.pending) {
      this.publish({
        status: {
          kind: "failed",
          message:
            "This file changed outside this editor. Your unsaved text is kept. Save a copy before reloading.",
        },
      });
      return;
    }
    this.content = this.savedContent = content;
    this.revision = revision;
    this.publish({
      title: splitNote(content).title,
      externalVersion: this.snapshot.externalVersion + 1,
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  private publish(update: Partial<DocumentSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }
}
