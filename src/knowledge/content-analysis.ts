import type { SearchEntry } from "../domain/contracts";
import { analyzeNote, type IndexedNote } from "./model";

export type AnalysisScope =
  | { kind: "workspace"; workspaceId?: string }
  | { kind: "note"; workspaceId: string; path: string };
export type AnalysisSnapshot = {
  notes: IndexedNote[];
  loading: boolean;
  errors: string[];
};
type LiveSource = {
  readonly content: string;
  subscribeContent: (listener: () => void) => () => void;
};
type ContentState =
  | { kind: "empty" }
  | { kind: "ready"; note: IndexedNote; source: LiveSource | undefined }
  | { kind: "failed"; message: string };
type Request = {
  promise: Promise<IndexedNote>;
  resolve: (note: IndexedNote) => void;
  reject: (error: Error) => void;
};
type AnalysisRecord = {
  entry: SearchEntry;
  content: ContentState;
  request?: Request;
  directConsumers: number;
};
type Watcher = { scope: AnalysisScope; listener: () => void };
const key = (workspaceId: string, path: string) => `${workspaceId}\0${path}`;
const scopeKey = (scope: AnalysisScope) =>
  scope.kind === "note"
    ? `note\0${key(scope.workspaceId, scope.path)}`
    : `workspace\0${scope.workspaceId ?? ""}`;
const includes = (scope: AnalysisScope, entry: SearchEntry) =>
  scope.kind === "note"
    ? scope.workspaceId === entry.workspaceId && scope.path === entry.path
    : !scope.workspaceId || scope.workspaceId === entry.workspaceId;

/** Owns optional analysis, its consumers and one shared disk-read schedule. */
export class ContentAnalysis {
  private records = new Map<string, AnalysisRecord>();
  private queue: AnalysisRecord[] = [];
  private watchers = new Set<Watcher>();
  private snapshots = new Map<string, AnalysisSnapshot>();
  private liveSubscriptions = new Map<
    string,
    { source: LiveSource; record: AnalysisRecord; stop: () => void }
  >();
  private activeReads = 0;
  private scheduled = false;
  private pumping = false;
  private lastYield = performance.now();

  constructor(
    private readonly source: {
      readNote: (
        workspaceId: string,
        path: string,
      ) => Promise<{ content: string }>;
      getLiveDocument: (
        workspaceId: string,
        path: string,
      ) => LiveSource | undefined;
    },
  ) {}

  synchronize(entries: SearchEntry[]): void {
    const remaining = new Set(
      entries.map((entry) => key(entry.workspaceId, entry.path)),
    );
    for (const [id, record] of this.records) {
      if (!remaining.has(id)) {
        this.invalidate(record);
        this.records.delete(id);
      }
    }
    for (const entry of entries) {
      const id = key(entry.workspaceId, entry.path);
      const existing = this.records.get(id);
      if (existing && existing.entry.modified === entry.modified) {
        existing.entry = entry;
        if (existing.content.kind === "ready")
          existing.content.note = { ...existing.content.note, ...entry };
      } else {
        if (existing) this.invalidate(existing);
        this.records.set(id, {
          entry,
          content: { kind: "empty" },
          directConsumers: 0,
        });
      }
    }
    this.loadWatched();
    this.bindLiveNotes();
    this.publish();
  }

  async getNote(workspaceId: string, path: string): Promise<IndexedNote> {
    const record = this.records.get(key(workspaceId, path));
    if (!record) throw new Error("Note not found.");
    record.directConsumers++;
    try {
      return await this.load(record);
    } finally {
      record.directConsumers--;
    }
  }

  getSnapshot(scope: AnalysisScope): AnalysisSnapshot {
    const id = scopeKey(scope);
    const previous = this.snapshots.get(id);
    if (previous) return previous;
    const snapshot: AnalysisSnapshot = {
      notes: [],
      loading: false,
      errors: [],
    };
    for (const record of this.records.values()) {
      if (!includes(scope, record.entry)) continue;
      switch (record.content.kind) {
        case "ready":
          snapshot.notes.push(record.content.note);
          break;
        case "empty":
          snapshot.loading = true;
          break;
        case "failed":
          snapshot.errors.push(record.content.message);
          break;
      }
    }
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  watch(scope: AnalysisScope, listener: () => void): () => void {
    const watcher = { scope, listener };
    this.watchers.add(watcher);
    for (const record of this.records.values()) {
      if (includes(scope, record.entry) && record.content.kind === "failed")
        record.content = { kind: "empty" };
    }
    this.loadWatched();
    this.bindLiveNotes();
    this.publish();
    return () => {
      this.watchers.delete(watcher);
      for (const record of this.records.values()) {
        if (
          record.request &&
          !record.directConsumers &&
          !this.isWatched(record)
        )
          this.invalidate(record);
      }
      this.bindLiveNotes();
      // Release cancelled queued records even if their underlying I/O is still running.
      this.queue = this.queue.filter((record) => record.request);
      this.snapshots.clear();
    };
  }

  private isWatched(record: AnalysisRecord): boolean {
    return [...this.watchers].some(({ scope }) =>
      includes(scope, record.entry),
    );
  }

  private loadWatched(): void {
    for (const record of this.records.values()) {
      if (record.content.kind === "failed") continue;
      let mode: "immediate" | "scheduled" | undefined;
      for (const { scope } of this.watchers) {
        if (!includes(scope, record.entry)) continue;
        mode = scope.kind === "note" ? "immediate" : "scheduled";
        if (mode === "immediate") break;
      }
      if (mode) void this.load(record, mode).catch(() => {});
    }
  }

  private liveNote(record: AnalysisRecord): IndexedNote | undefined {
    const { entry } = record;
    const live = this.source.getLiveDocument(entry.workspaceId, entry.path);
    if (live) {
      if (
        record.content.kind !== "ready" ||
        record.content.source !== live ||
        record.content.note.content !== live.content
      ) {
        record.content = {
          kind: "ready",
          note: analyzeNote(entry, live.content),
          source: live,
        };
        this.publish();
      }
      return record.content.note;
    }
    // A closed buffer is no longer evidence of what is on disk, even if scan metadata stayed equal.
    if (record.content.kind === "ready" && record.content.source)
      record.content = { kind: "empty" };
    return undefined;
  }

  private load(
    record: AnalysisRecord,
    mode: "immediate" | "scheduled" = "immediate",
  ): Promise<IndexedNote> {
    if (mode === "immediate") {
      const live = this.liveNote(record);
      if (live) return Promise.resolve(live);
      if (record.content.kind === "ready")
        return Promise.resolve(record.content.note);
    } else {
      const live = this.source.getLiveDocument(
        record.entry.workspaceId,
        record.entry.path,
      );
      if (
        record.content.kind === "ready" &&
        record.content.source === live &&
        (!live || record.content.note.content === live.content)
      )
        return Promise.resolve(record.content.note);
      // Bulk subscribers enqueue stale live content as well as disk work. The queue
      // rechecks the source when it executes, after giving input/paint its turn.
      record.content = { kind: "empty" };
    }
    if (record.request) return record.request.promise;
    let resolve!: Request["resolve"];
    let reject!: Request["reject"];
    const promise = new Promise<IndexedNote>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    record.content = { kind: "empty" };
    record.request = { promise, resolve, reject };
    this.queue.push(record);
    this.pump();
    return promise;
  }

  private invalidate(record: AnalysisRecord): void {
    record.request?.reject(
      new Error("Note changed while its contents were loading."),
    );
    record.request = undefined;
    record.content = { kind: "empty" };
  }

  private bindLiveNotes(): void {
    const wanted = new Map<
      string,
      { record: AnalysisRecord; source: LiveSource }
    >();
    for (const { scope } of this.watchers) {
      if (scope.kind !== "note") continue;
      const id = key(scope.workspaceId, scope.path);
      const record = this.records.get(id);
      const source = this.source.getLiveDocument(scope.workspaceId, scope.path);
      if (record && source) wanted.set(id, { record, source });
    }
    for (const [id, binding] of this.liveSubscriptions) {
      const next = wanted.get(id);
      if (next?.source !== binding.source || next?.record !== binding.record) {
        binding.stop();
        this.liveSubscriptions.delete(id);
      }
    }
    for (const [id, { record, source }] of wanted) {
      if (!this.liveSubscriptions.has(id))
        this.liveSubscriptions.set(id, {
          source,
          record,
          stop: source.subscribeContent(() => {
            this.liveNote(record);
          }),
        });
    }
  }

  private publish(): void {
    this.snapshots.clear();
    for (const { listener } of this.watchers) listener();
  }

  private pump(): void {
    if (this.pumping || this.scheduled || !this.queue.length) return;
    this.pumping = true;
    try {
      while (this.activeReads < 4 && this.queue.length) {
        if (performance.now() - this.lastYield >= 8) {
          this.scheduled = true;
          setTimeout(() => {
            this.scheduled = false;
            this.lastYield = performance.now();
            this.pump();
          }, 0);
          break;
        }
        const record = this.queue.shift();
        if (!record?.request) continue;
        this.activeReads++;
        void this.read(record, record.request);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async read(record: AnalysisRecord, request: Request): Promise<void> {
    try {
      const { entry } = record;
      const live = this.source.getLiveDocument(entry.workspaceId, entry.path);
      const content =
        live?.content ??
        (await this.source.readNote(entry.workspaceId, entry.path)).content;
      if (record.request !== request) return;
      const current = this.liveNote(record);
      const note = current ?? analyzeNote(record.entry, content);
      if (!current) record.content = { kind: "ready", note, source: undefined };
      request.resolve(note);
      this.bindLiveNotes();
    } catch (error) {
      if (record.request === request) {
        const live = this.liveNote(record);
        if (live) {
          request.resolve(live);
          this.bindLiveNotes();
        } else {
          const reason =
            error instanceof Error ? error : new Error(String(error));
          record.content = {
            kind: "failed",
            message: `${record.entry.workspaceName}/${record.entry.path}: ${reason.message}`,
          };
          request.reject(reason);
        }
      }
    } finally {
      if (record.request === request) {
        record.request = undefined;
        this.publish();
      }
      this.activeReads--;
      this.pump();
    }
  }
}
