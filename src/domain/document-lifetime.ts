import type { NoteFile } from "./contracts";
import type { NoteDocument } from "./document";

const key = (id: string, path: string) => `${id}\0${path}`;

/** Owns admission, registration and retirement of open document buffers. */
export class DocumentLifetime {
  private readonly loaded = new Map<string, NoteDocument>();
  private readonly loading = new Map<string, Promise<NoteDocument>>();
  private readonly reads = new Map<string, Promise<NoteDocument>>();
  private readonly accepted = new Map<Promise<unknown>, string>();
  private readonly retiring = new Set<string>();
  private readonly retirements = new Map<string, Promise<unknown>>();
  private readonly closingPaths = new Set<{ id: string; path: string }>();

  constructor(
    private readonly create: (id: string, note: NoteFile) => NoteDocument,
  ) {}

  activate(id: string): void {
    if (!this.retirements.has(id)) this.retiring.delete(id);
  }

  /** Registration has no workspace ID yet, but shutdown must still await it. */
  admitRegistration<T>(operation: () => Promise<T>): Promise<T> {
    const existingRetirements = [...this.retirements.values()];
    return this.track("", async () => {
      await Promise.all(existingRetirements);
      return operation();
    });
  }

  admit<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.retiring.has(id))
      return Promise.reject(
        new Error(
          "This workspace is being removed. Try again after reopening it.",
        ),
      );
    return this.track(id, operation);
  }

  private track<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = Promise.resolve().then(operation);
    this.accepted.set(result, id);
    void result.then(
      () => this.accepted.delete(result),
      () => this.accepted.delete(result),
    );
    return result;
  }

  register(id: string, note: NoteFile): NoteDocument {
    const document = this.create(id, note);
    this.loaded.set(key(id, note.path), document);
    return document;
  }

  peek(id: string, path: string): NoteDocument | undefined {
    return this.loaded.get(key(id, path));
  }

  documents(id?: string): NoteDocument[] {
    return [...this.loaded.values()].filter(
      (document) => !id || document.workspaceId === id,
    );
  }

  hasPendingWork(): boolean {
    return (
      this.accepted.size > 0 ||
      this.retirements.size > 0 ||
      this.loading.size > 0 ||
      this.documents().some(
        (document) => document.dirty || document.hasPendingOperation,
      )
    );
  }

  load(
    id: string,
    path: string,
    resolvePath: () => Promise<string>,
    read: (path: string) => Promise<NoteFile>,
  ): Promise<NoteDocument> {
    if (
      [...this.closingPaths].some(
        (location) => location.id === id && location.path === path,
      )
    )
      return Promise.reject(
        new Error(
          "This note is being closed or removed. Reopen it when the operation finishes.",
        ),
      );
    return this.admit(id, () => this.loadAccepted(id, path, resolvePath, read));
  }

  retirePath<T>(
    id: string,
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (
      [...this.closingPaths].some(
        (location) => location.id === id && location.path === path,
      )
    )
      return Promise.reject(
        new Error("This note is already being closed or removed."),
      );
    const location = { id, path };
    this.closingPaths.add(location);
    const result = this.admit(id, operation);
    void result.then(
      () => this.closingPaths.delete(location),
      () => this.closingPaths.delete(location),
    );
    return result;
  }

  async findForRetirement(
    id: string,
    requestedPath: string,
    currentPath: string,
  ): Promise<NoteDocument | undefined> {
    const pending =
      this.loading.get(key(id, requestedPath)) ??
      this.loading.get(key(id, currentPath));
    if (pending) return pending;
    return this.peek(id, currentPath) ?? this.peek(id, requestedPath);
  }

  /** Internal steps of an already admitted workflow retain its admission. */
  loadAccepted(
    id: string,
    path: string,
    resolvePath: () => Promise<string>,
    read: (path: string) => Promise<NoteFile>,
  ): Promise<NoteDocument> {
    const cached = this.peek(id, path);
    if (cached) return Promise.resolve(cached);
    const pending = this.loading.get(key(id, path));
    if (pending) return pending;
    const request = (async () => {
      const currentPath = await resolvePath();
      const current = this.peek(id, currentPath);
      if (current) return current;
      const pendingRead = this.reads.get(key(id, currentPath));
      if (pendingRead) return pendingRead;
      const reading = read(currentPath)
        .then((note) => this.peek(id, note.path) ?? this.register(id, note))
        .finally(() => this.reads.delete(key(id, currentPath)));
      this.reads.set(key(id, currentPath), reading);
      return reading;
    })().finally(() => this.loading.delete(key(id, path)));
    this.loading.set(key(id, path), request);
    return request;
  }

  async settleLoads(): Promise<void> {
    while (this.reads.size) await Promise.all([...this.reads.values()]);
  }

  remap(id: string, mapPath: (path: string) => string): NoteDocument[] {
    for (const location of this.closingPaths)
      if (location.id === id) location.path = mapPath(location.path);
    const moved: NoteDocument[] = [];
    for (const [oldKey, document] of [...this.loaded]) {
      if (document.workspaceId !== id) continue;
      const oldPath = oldKey.slice(id.length + 1);
      const path = mapPath(oldPath);
      if (path === oldPath) continue;
      this.loaded.delete(oldKey);
      this.loaded.set(key(id, path), document);
      if (document.getSnapshot().path !== path) {
        document.relocatePath(path);
        moved.push(document);
      }
    }
    return moved;
  }

  release(document: NoteDocument): boolean {
    if (document.dirty || document.hasPendingOperation) return false;
    this.dispose(document);
    return true;
  }

  releaseRecovered(document: NoteDocument, durableContent: string): boolean {
    if (
      document.content !== durableContent ||
      document.hasPendingOperation ||
      document.getSnapshot().status.kind !== "failed"
    )
      return false;
    this.dispose(document);
    return true;
  }

  private dispose(document: NoteDocument): void {
    for (const [entryKey, current] of this.loaded)
      if (current === document) this.loaded.delete(entryKey);
    document.dispose();
  }

  async withHeldSaves(
    operation: () => Promise<void>,
    except?: NoteDocument,
  ): Promise<void> {
    await this.settleLoads();
    const documents = this.documents().filter(
      (document) => document !== except,
    );
    const held = await Promise.allSettled(
      documents.map((document) => document.holdSaves()),
    );
    try {
      for (const result of held)
        if (result.status === "rejected") throw result.reason;
      await operation();
    } finally {
      for (const result of held)
        if (result.status === "fulfilled") result.value();
    }
    const saves = await Promise.allSettled(
      documents
        .filter((document) => document.dirty)
        .map((document) => document.flush()),
    );
    const failure = saves.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  async retire<T>(
    document: NoteDocument,
    prepare: () => Promise<void>,
    commit: () => Promise<T>,
  ): Promise<T> {
    await document.flush();
    await prepare();
    const unlock = document.holdEdits();
    try {
      await document.flush();
      const result = await commit();
      while (document.hasPendingOperation) await document.flush();
      this.release(document);
      return result;
    } finally {
      unlock();
    }
  }

  retireWorkspace<T>(
    id: string,
    prepare: () => Promise<void>,
    commit: () => Promise<T>,
  ): Promise<T> {
    if (this.retiring.has(id))
      return Promise.reject(
        new Error("This workspace is already being removed."),
      );
    this.retiring.add(id);
    const registrations = [...this.accepted]
      .filter(([, workspaceId]) => workspaceId === "")
      .map(([operation]) => operation);
    const result = this.finishWorkspaceRetirement(
      id,
      registrations,
      prepare,
      commit,
    );
    this.retirements.set(id, result);
    void result.then(
      () => this.retirements.delete(id),
      () => this.retirements.delete(id),
    );
    return result;
  }

  private async finishWorkspaceRetirement<T>(
    id: string,
    registrations: Promise<unknown>[],
    prepare: () => Promise<void>,
    commit: () => Promise<T>,
  ): Promise<T> {
    const unlocks: (() => void)[] = [];
    try {
      await Promise.all(registrations);
      await this.settleAccepted(id);
      await prepare();
      const documents = this.documents(id);
      unlocks.push(...documents.map((document) => document.holdEdits()));
      await Promise.all(documents.map((document) => document.flush()));
      const result = await commit();
      for (const document of documents) {
        while (document.hasPendingOperation) await document.flush();
        this.release(document);
      }
      return result;
    } catch (error) {
      this.retiring.delete(id);
      throw error;
    } finally {
      unlocks.forEach((unlock) => unlock());
    }
  }

  async drain(
    whenIdle: () => Promise<void>,
    persist: () => Promise<void>,
  ): Promise<void> {
    do {
      await Promise.all([...this.retirements.values()]);
      await this.settleAccepted();
      await whenIdle();
      await this.settleLoads();
      await Promise.all(this.documents().map((document) => document.flush()));
      await persist();
      await whenIdle();
    } while (
      this.retirements.size ||
      this.accepted.size ||
      this.loading.size ||
      this.documents().some((document) => document.dirty)
    );
  }

  private async settleAccepted(id?: string): Promise<void> {
    let pending: Promise<unknown>[];
    do {
      pending = [...this.accepted]
        .filter(([, workspaceId]) => !id || workspaceId === id)
        .map(([operation]) => operation);
      if (pending.length) {
        const results = await Promise.allSettled(pending);
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
    } while (pending.length);
  }
}
