import type { Entry, FileService, WorkspaceSnapshot } from "./contracts";
import type { DocumentLifetime } from "./document-lifetime";
import { errorMessage } from "./notes";
import type { Relocations } from "./relocation";
import type { WorkspaceChange } from "../platform/workspace-events";

type Host = {
  files: Pick<FileService, "scanWorkspace" | "readNote">;
  lifetime: Pick<DocumentLifetime, "documents" | "peek">;
  relocations: Pick<Relocations, "version" | "whenIdle">;
  entries: (id: string) => Entry[];
  publish: (id: string, entries: Entry[]) => void;
  report: (error: unknown) => void;
};
type Source = { active: boolean };
type RefreshOptions = { duringRelocation?: boolean; afterMutation?: boolean };
type Request = {
  promise: Promise<void>;
  version: number | null;
  independent: boolean;
  sources: Set<Source>;
};
type Registration = {
  request?: Request;
  timer?: ReturnType<typeof setTimeout>;
  invalidations: Set<Source>;
};

/** Reconcile registered file indexes and open Documents with current disk state. */
export class WorkspaceRefresh {
  private registrations = new Map<string, Registration>();
  private unscoped: Source = { active: true };

  constructor(
    private readonly host: Host,
    private readonly delay = 50,
  ) {}

  register(id: string, snapshot?: WorkspaceSnapshot): void {
    this.unregister(id);
    this.registrations.set(id, { invalidations: new Set() });
    if (snapshot) this.publishSnapshot(id, snapshot);
  }

  unregister(id: string): void {
    clearTimeout(this.registrations.get(id)?.timer);
    this.registrations.delete(id);
  }

  reset(): void {
    for (const id of this.registrations.keys()) this.unregister(id);
  }

  /** A listener owns only the invalidations it delivered, never manual work. */
  observeInvalidations(): {
    invalidate: (change?: WorkspaceChange) => void;
    dispose: () => void;
  } {
    const source: Source = { active: true };
    return {
      invalidate: (change) => this.invalidateFrom(source, change),
      dispose: () => {
        if (!source.active) return;
        source.active = false;
        for (const [id, registration] of this.registrations) {
          registration.invalidations.delete(source);
          if (!registration.invalidations.size) {
            clearTimeout(registration.timer);
            registration.timer = undefined;
          }
          const request = registration.request;
          if (!request) continue;
          request.sources.delete(source);
          if (!request.independent && !request.sources.size) {
            registration.request = undefined;
            if (registration.invalidations.size)
              this.schedule(id, registration);
          }
        }
      },
    };
  }

  invalidate(change?: WorkspaceChange): void {
    this.invalidateFrom(this.unscoped, change);
  }

  private invalidateFrom(source: Source, change?: WorkspaceChange): void {
    if (!source.active) return;
    if (change?.warnings?.length) this.host.report(change.warnings.join("\n"));
    for (const id of new Set(
      change?.workspaceIds ?? this.registrations.keys(),
    )) {
      const registration = this.registrations.get(id);
      if (!registration) continue;
      registration.invalidations.add(source);
      if (!registration.request) this.schedule(id, registration);
    }
  }

  refresh(id: string, options: RefreshOptions = {}): Promise<void> {
    return this.start(id, options, true);
  }

  private start(
    id: string,
    options: RefreshOptions,
    independent: boolean,
  ): Promise<void> {
    const registration = this.registrations.get(id);
    if (!registration) return Promise.resolve();
    const previous = registration.request;
    // A relocation must not join a request waiting for that relocation to finish.
    // Mutation follow-ups must take a snapshot after their file commit.
    if (previous && !options.duringRelocation && !options.afterMutation) {
      previous.independent ||= independent;
      return previous.promise;
    }
    clearTimeout(registration.timer);
    registration.timer = undefined;
    const request: Request = {
      promise: Promise.resolve(),
      version: null,
      independent,
      sources: new Set(registration.invalidations),
    };
    registration.invalidations.clear();
    registration.request = request;
    request.promise = this.reconcile(
      id,
      registration,
      request,
      options,
    ).finally(() => {
      if (!this.current(id, registration, request)) return;
      registration.request = undefined;
      if (registration.invalidations.size) this.schedule(id, registration);
    });
    return request.promise;
  }

  private current(
    id: string,
    registration: Registration,
    request?: Request,
  ): boolean {
    return (
      this.registrations.get(id) === registration &&
      (!request || registration.request === request)
    );
  }

  private schedule(id: string, registration: Registration): void {
    clearTimeout(registration.timer);
    registration.timer = setTimeout(() => {
      registration.timer = undefined;
      if (!this.current(id, registration)) return;
      void this.start(id, {}, false).catch(() => {});
    }, this.delay);
  }

  private publishSnapshot(id: string, snapshot: WorkspaceSnapshot): void {
    const previous = this.host.entries(id);
    const entries = reconcileEntries(previous, snapshot);
    if (entries !== previous) this.host.publish(id, entries);
    if (snapshot.warnings?.length)
      this.host.report(snapshot.warnings.join("\n"));
  }

  private async reconcile(
    id: string,
    registration: Registration,
    request: Request,
    options: RefreshOptions,
  ): Promise<void> {
    const current = () =>
      this.current(id, registration, request) &&
      request.version === this.host.relocations.version;
    try {
      if (!options.duringRelocation) await this.host.relocations.whenIdle();
      if (!this.current(id, registration, request)) return;
      request.version = this.host.relocations.version;
      const snapshot = await this.host.files.scanWorkspace(id);
      if (!current()) return;
      const warnings = new Set(snapshot.warnings ?? []);
      const readWarnings: (() => string | null)[] = [];
      const scanned = new Set(snapshot.entries.map((entry) => entry.path));
      await Promise.all(
        this.host.lifetime.documents(id).map(async (document) => {
          const baseline = document.file;
          if (snapshot.incomplete && !scanned.has(baseline.path)) return;
          const documentCurrent = () =>
            current() &&
            document.file.path === baseline.path &&
            this.host.lifetime.peek(id, baseline.path) === document;
          try {
            const note = await this.host.files.readNote(id, baseline.path);
            if (documentCurrent())
              document.receiveExternal(
                note.content,
                note.revision,
                baseline.revision,
              );
          } catch (error) {
            readWarnings.push(() =>
              documentCurrent() && document.file.revision === baseline.revision
                ? `Could not refresh ${baseline.path}: ${errorMessage(error)}`
                : null,
            );
          }
        }),
      );
      if (!current()) return;
      this.publishSnapshot(id, { ...snapshot, warnings: [] });
      for (const warning of readWarnings) {
        const message = warning();
        if (message) warnings.add(message);
      }
      if (warnings.size) this.host.report([...warnings].join("\n"));
    } catch (error) {
      if (!current()) return;
      if (options.afterMutation)
        this.host.report(
          `Workspace changed, but could not be refreshed: ${errorMessage(error)}`,
        );
      else if (!request.independent) this.host.report(error);
      else throw error;
    }
  }
}

function sameEntry(entry: Entry, other: Entry): boolean {
  return (
    entry.path === other.path &&
    entry.kind === other.kind &&
    entry.title === other.title &&
    entry.modified === other.modified &&
    entry.tags.length === other.tags.length &&
    entry.tags.every((tag, i) => tag === other.tags[i]) &&
    (entry.aliases ?? []).length === (other.aliases ?? []).length &&
    (entry.aliases ?? []).every((alias, i) => alias === other.aliases?.[i])
  );
}

function reconcileEntries(
  previous: Entry[],
  snapshot: WorkspaceSnapshot,
): Entry[] {
  const existing = new Map(previous.map((entry) => [entry.path, entry]));
  const scanned = new Map(
    snapshot.entries.map((entry) => {
      const old = existing.get(entry.path);
      return [entry.path, old && sameEntry(old, entry) ? old : entry];
    }),
  );
  const entries = snapshot.incomplete
    ? [
        ...previous.map((entry) => {
          const next = scanned.get(entry.path);
          scanned.delete(entry.path);
          return next ?? entry;
        }),
        ...scanned.values(),
      ]
    : [...scanned.values()];
  return entries.length === previous.length &&
    entries.every((entry, i) => entry === previous[i])
    ? previous
    : entries;
}
