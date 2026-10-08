import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceRefresh } from "./workspace-refresh";
import { DocumentLifetime } from "./document-lifetime";
import { NoteDocument } from "./document";
import { createDemoFiles } from "../platform/demo";
import type { Entry, WorkspaceSnapshot } from "./contracts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const files = createDemoFiles();
  const initial = await files.scanWorkspace("algebra");
  const indexes: Record<string, Entry[]> = { algebra: initial.entries };
  const lifetime = new DocumentLifetime(
    (id, note) =>
      new NoteDocument(
        id,
        note,
        (payload) => files.saveNote(id, payload),
        () => {},
        600,
        (path) => files.readNote(id, path),
      ),
  );
  lifetime.activate("algebra");
  let version = 0;
  const relocations = {
    get version() {
      return version;
    },
    whenIdle: vi.fn(async () => {}),
  };
  const report = vi.fn(),
    publish = vi.fn((id: string, entries: Entry[]) => {
      indexes[id] = entries;
    });
  const refresh = new WorkspaceRefresh({
    files,
    lifetime,
    relocations,
    entries: (id) => indexes[id] ?? [],
    publish,
    report,
  });
  refresh.register("algebra");
  cleanup.push(() => {
    refresh.reset();
    lifetime.documents().forEach((document) => document.dispose());
  });
  return {
    files,
    initial,
    indexes,
    lifetime,
    refresh,
    report,
    publish,
    relocations,
    relocated: () => {
      version++;
    },
    load: async (path = "Practice problems.md") =>
      lifetime.register("algebra", await files.readNote("algebra", path)),
    editDisk: async (path = "Practice problems.md", content = "# External") => {
      const note = await files.readNote("algebra", path);
      return files.saveNote("algebra", { ...note, content });
    },
  };
}
function pausedScan(
  f: Awaited<ReturnType<typeof fixture>>,
  snapshot?: WorkspaceSnapshot,
) {
  const started = barrier(),
    release = barrier();
  const scan = f.files.scanWorkspace.bind(f.files);
  const spy = vi
    .spyOn(f.files, "scanWorkspace")
    .mockImplementationOnce(async (id) => {
      const result = snapshot ?? (await scan(id));
      started.resolve();
      await release.promise;
      return result;
    });
  return { started, release, spy };
}
function pausedRead(f: Awaited<ReturnType<typeof fixture>>, fail = false) {
  const started = barrier(),
    release = barrier();
  const read = f.files.readNote.bind(f.files);
  vi.spyOn(f.files, "readNote").mockImplementationOnce(async (...args) => {
    const result = await read(...args);
    started.resolve();
    await release.promise;
    if (fail) throw new Error("late read failure");
    return result;
  });
  return { started, release };
}

it("coalesces overlapping refreshes and keeps unchanged entries and index identity", async () => {
  const f = await fixture();
  const previous = f.indexes.algebra!;
  const paused = pausedScan(f);
  const first = f.refresh.refresh("algebra"),
    second = f.refresh.refresh("algebra");
  expect(second).toBe(first);
  await paused.started.promise;
  paused.release.resolve();
  await first;
  expect(paused.spy).toHaveBeenCalledOnce();
  expect(f.indexes.algebra).toBe(previous);
  expect(f.publish).not.toHaveBeenCalled();
});

it("debounces events, ignores unknown roots, and catches up current registrations", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  f.refresh.register("web");
  const scan = vi.spyOn(f.files, "scanWorkspace");
  f.refresh.invalidate({ workspaceIds: ["algebra", "algebra", "unknown"] });
  await vi.advanceTimersByTimeAsync(30);
  f.refresh.invalidate();
  await vi.advanceTimersByTimeAsync(49);
  expect(scan).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(scan.mock.calls).toEqual([["algebra"], ["web"]]);
});

it.each(["manual", "event"])(
  "retains events arriving during a %s refresh",
  async (kind) => {
    vi.useFakeTimers();
    const f = await fixture();
    const paused = pausedScan(f);
    let request: Promise<void> | undefined;
    if (kind === "manual") request = f.refresh.refresh("algebra");
    else {
      f.refresh.invalidate({ workspaceIds: ["algebra"] });
      await vi.advanceTimersByTimeAsync(50);
    }
    await paused.started.promise;
    f.refresh.invalidate({ workspaceIds: ["algebra", "algebra"] });
    await vi.advanceTimersByTimeAsync(100);
    expect(paused.spy).toHaveBeenCalledOnce();
    await f.files.createFolder("algebra", "", "External folder");
    paused.release.resolve();
    if (request) await request;
    await vi.advanceTimersByTimeAsync(49);
    expect(paused.spy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(paused.spy).toHaveBeenCalledTimes(2);
    expect(
      f.indexes.algebra!.some((entry) => entry.path === "External folder"),
    ).toBe(true);
  },
);

it("consumes a queued event when an immediate refresh covers it", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const scan = vi.spyOn(f.files, "scanWorkspace");
  f.refresh.invalidate({ workspaceIds: ["algebra"] });
  await f.refresh.refresh("algebra");
  await vi.advanceTimersByTimeAsync(100);
  expect(scan).toHaveBeenCalledOnce();
});

it("removes queued work with its registration, including reset", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const scan = vi.spyOn(f.files, "scanWorkspace");
  f.refresh.invalidate({ workspaceIds: ["algebra"] });
  f.refresh.unregister("algebra");
  await f.refresh.refresh("algebra");
  await vi.advanceTimersByTimeAsync(100);
  f.refresh.register("algebra");
  f.refresh.invalidate();
  f.refresh.reset();
  await vi.advanceTimersByTimeAsync(100);
  expect(scan).not.toHaveBeenCalled();
});

it("ignores stale scans and warnings after removal and re-add without joining the old request", async () => {
  const f = await fixture();
  const paused = pausedScan(f, { ...f.initial, warnings: ["retired warning"] });
  const old = f.refresh.refresh("algebra");
  await paused.started.promise;
  f.refresh.unregister("algebra");
  await f.files.createFolder("algebra", "", "Fresh folder");
  f.refresh.register("algebra");
  await f.refresh.refresh("algebra");
  const current = f.indexes.algebra!;
  paused.release.resolve();
  await old;
  expect(f.indexes.algebra).toBe(current);
  expect(current.some((entry) => entry.path === "Fresh folder")).toBe(true);
  expect(f.report).not.toHaveBeenCalled();
});

it("does not publish late rejected scans or schedule retired follow-up events", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const started = barrier(),
    release = barrier();
  const scan = vi
    .spyOn(f.files, "scanWorkspace")
    .mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      throw new Error("late scan failure");
    });
  const request = f.refresh.refresh("algebra");
  await started.promise;
  f.refresh.invalidate();
  f.refresh.unregister("algebra");
  release.resolve();
  await request;
  await vi.advanceTimersByTimeAsync(100);
  expect(scan).toHaveBeenCalledOnce();
  expect(f.report).not.toHaveBeenCalled();
});

it("rejects current immediate failures and reports scheduled failures while allowing retries", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const scan = vi
    .spyOn(f.files, "scanWorkspace")
    .mockRejectedValueOnce(new Error("immediate failure"));
  await expect(f.refresh.refresh("algebra")).rejects.toThrow(
    "immediate failure",
  );
  scan.mockRejectedValueOnce(new Error("scheduled failure"));
  f.refresh.invalidate({
    workspaceIds: ["algebra"],
    warnings: ["watch limit"],
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(f.report.mock.calls).toEqual([
    ["watch limit"],
    [expect.objectContaining({ message: "scheduled failure" })],
  ]);
  f.refresh.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  expect(scan).toHaveBeenCalledTimes(3);
});

it("waits for relocations on external refreshes but allows their internal refresh to finish", async () => {
  const f = await fixture();
  const moving = barrier();
  f.relocations.whenIdle.mockImplementationOnce(() => moving.promise);
  const external = f.refresh.refresh("algebra");
  const scan = vi.spyOn(f.files, "scanWorkspace");
  expect(scan).not.toHaveBeenCalled();
  f.relocated();
  await f.files.createFolder("algebra", "", "Moved");
  await f.refresh.refresh("algebra", { duringRelocation: true });
  expect(f.indexes.algebra!.some((entry) => entry.path === "Moved")).toBe(true);
  moving.resolve();
  await external;
  expect(scan).toHaveBeenCalledOnce();
});

it("discards stale relocation scans and takes a new scan after an accepted mutation", async () => {
  const f = await fixture();
  const paused = pausedScan(f, {
    ...f.initial,
    warnings: ["stale relocation warning"],
  });
  const old = f.refresh.refresh("algebra");
  await paused.started.promise;
  await f.files.createFolder("algebra", "", "Committed");
  f.relocated();
  await f.refresh.refresh("algebra", { afterMutation: true });
  const current = f.indexes.algebra!;
  paused.release.resolve();
  await old;
  expect(f.indexes.algebra).toBe(current);
  expect(current.some((entry) => entry.path === "Committed")).toBe(true);
  expect(f.report).not.toHaveBeenCalled();
});

it("forces a post-mutation scan even when no relocation version changed", async () => {
  const f = await fixture();
  const paused = pausedScan(f);
  const old = f.refresh.refresh("algebra");
  await paused.started.promise;
  await f.files.createFolder("algebra", "", "Created");
  await f.refresh.refresh("algebra", { afterMutation: true });
  paused.release.resolve();
  await old;
  expect(f.indexes.algebra!.some((entry) => entry.path === "Created")).toBe(
    true,
  );
  expect(paused.spy).toHaveBeenCalledTimes(2);
});

it("rejects relocation-stale document deliveries and read warnings", async () => {
  const f = await fixture();
  const document = await f.load(),
    content = document.content;
  await f.editDisk();
  const paused = pausedRead(f, true);
  const request = f.refresh.refresh("algebra");
  await paused.started.promise;
  f.relocated();
  paused.release.resolve();
  await request;
  expect(document.content).toBe(content);
  expect(f.report).not.toHaveBeenCalled();
});

it("retains partial-scan entries and skips rereading omitted open documents", async () => {
  const f = await fixture();
  const document = await f.load("Lectures/Eigenvalues.md");
  const previous = f.indexes.algebra!;
  const available = previous.find(
    (entry) => entry.path === "Practice problems.md",
  )!;
  document.edit("# Unsaved");
  vi.spyOn(f.files, "scanWorkspace").mockResolvedValueOnce({
    ...f.initial,
    entries: [
      { ...available, title: "Available update" },
      { ...available, path: "New.md" },
    ],
    incomplete: true,
    warnings: ["Lectures unavailable"],
  });
  const read = vi.spyOn(f.files, "readNote");
  await f.refresh.refresh("algebra");
  expect(f.indexes.algebra).toHaveLength(previous.length + 1);
  expect(
    f.indexes.algebra!.find((entry) => entry.path === document.file.path),
  ).toBe(previous.find((entry) => entry.path === document.file.path));
  expect(
    f.indexes.algebra!.find((entry) => entry.path === available.path)?.title,
  ).toBe("Available update");
  expect(read).not.toHaveBeenCalled();
  expect(document.content).toBe("# Unsaved");
  expect(f.report).toHaveBeenCalledWith("Lectures unavailable");
  await f.refresh.refresh("algebra");
  expect(f.indexes.algebra).toHaveLength(previous.length);
  expect(f.indexes.algebra!.some((entry) => entry.path === "New.md")).toBe(
    false,
  );
});

it("retains index identity on an unavailable root and publishes registration-snapshot warnings", async () => {
  const f = await fixture();
  const previous = f.indexes.algebra!;
  f.refresh.register("algebra", {
    ...f.initial,
    entries: [],
    incomplete: true,
    warnings: ["Root unavailable"],
  });
  expect(f.indexes.algebra).toBe(previous);
  expect(f.report).toHaveBeenCalledWith("Root unavailable");
});

it("keeps unchanged individual entries when another entry changed", async () => {
  const f = await fixture();
  const previous = f.indexes.algebra!;
  await f.editDisk();
  await f.refresh.refresh("algebra");
  const unchanged = previous.find(
    (entry) => entry.path === "Lectures/Eigenvalues.md",
  )!;
  expect(f.indexes.algebra).not.toBe(previous);
  expect(
    f.indexes.algebra!.find((entry) => entry.path === unchanged.path),
  ).toBe(unchanged);
});

it.each([false, true])(
  "discards reads and warnings belonging to a closed and reopened document, failure=%s",
  async (fail) => {
    const f = await fixture();
    const old = await f.load(),
      previous = old.content;
    await f.editDisk();
    const paused = pausedRead(f, fail);
    const request = f.refresh.refresh("algebra");
    await paused.started.promise;
    f.lifetime.release(old);
    const reopened = await f.load();
    paused.release.resolve();
    await request;
    expect(old.content).toBe(previous);
    expect(reopened.content).toBe("# External");
    expect(f.report).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "does not deliver a stale saved revision or its late read failure, failure=%s",
  async (fail) => {
    const f = await fixture();
    const document = await f.load();
    const paused = pausedRead(f, fail);
    const request = f.refresh.refresh("algebra");
    await paused.started.promise;
    document.edit("# Saved during reread");
    await document.flush();
    const revision = document.file.revision;
    paused.release.resolve();
    await request;
    expect(document.content).toBe("# Saved during reread");
    expect(document.file.revision).toBe(revision);
    expect(document.hasConflict).toBe(false);
    expect(f.report).not.toHaveBeenCalled();
  },
);

it("lets Document retain typing during a reread and decide its conflict", async () => {
  const f = await fixture();
  const document = await f.load();
  await f.editDisk();
  const paused = pausedRead(f);
  const request = f.refresh.refresh("algebra");
  await paused.started.promise;
  document.edit("# Typed during reread");
  paused.release.resolve();
  await request;
  expect(document.content).toBe("# Typed during reread");
  expect(document.hasConflict).toBe(true);
});

it("suppresses document results and warnings after registration removal", async () => {
  const f = await fixture();
  const document = await f.load(),
    previous = document.content;
  await f.editDisk();
  const paused = pausedRead(f, true);
  const request = f.refresh.refresh("algebra");
  await paused.started.promise;
  f.refresh.unregister("algebra");
  delete f.indexes.algebra;
  paused.release.resolve();
  await request;
  expect(document.content).toBe(previous);
  expect(f.indexes.algebra).toBeUndefined();
  expect(f.report).not.toHaveBeenCalled();
});

it("reports current open-document read failures without discarding its buffer", async () => {
  const f = await fixture(),
    document = await f.load();
  const previous = document.content;
  vi.spyOn(f.files, "readNote").mockRejectedValueOnce(new Error("unreadable"));
  await f.refresh.refresh("algebra");
  expect(document.content).toBe(previous);
  expect(f.report.mock.calls).toEqual([
    ["Could not refresh Practice problems.md: unreadable"],
  ]);
});

it("stopping an invalidation listener cancels its timers and ignores later events", async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    observer = f.refresh.observeInvalidations();
  const scan = vi.spyOn(f.files, "scanWorkspace");
  observer.invalidate();
  observer.dispose();
  observer.dispose();
  observer.invalidate({
    workspaceIds: ["algebra"],
    warnings: ["late warning"],
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(scan).not.toHaveBeenCalled();
  expect(f.report).not.toHaveBeenCalled();
});

it("stopping an invalidation listener suppresses its in-flight warning and follow-up", async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    observer = f.refresh.observeInvalidations();
  const paused = pausedScan(f, {
    ...f.initial,
    warnings: ["late scan warning"],
  });
  observer.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  await paused.started.promise;
  observer.invalidate();
  observer.dispose();
  paused.release.resolve();
  await vi.advanceTimersByTimeAsync(100);
  expect(paused.spy).toHaveBeenCalledOnce();
  expect(f.report).not.toHaveBeenCalled();
});

it("stopping an invalidation listener suppresses its in-flight scan failure", async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    observer = f.refresh.observeInvalidations();
  const started = barrier(),
    release = barrier();
  const scan = vi
    .spyOn(f.files, "scanWorkspace")
    .mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      throw new Error("late failure");
    });
  observer.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  await started.promise;
  observer.dispose();
  release.resolve();
  await vi.advanceTimersByTimeAsync(100);
  expect(scan).toHaveBeenCalledOnce();
  expect(f.report).not.toHaveBeenCalled();
});

it.each(["manual started first", "manual joined event"])(
  "listener disposal keeps independent work when %s",
  async (kind) => {
    vi.useFakeTimers();
    const f = await fixture(),
      observer = f.refresh.observeInvalidations();
    const paused = pausedScan(f, {
      ...f.initial,
      entries: [{ ...f.initial.entries[0]!, title: "Accepted" }],
      warnings: ["accepted warning"],
    });
    let manual: Promise<void>;
    if (kind === "manual started first") manual = f.refresh.refresh("algebra");
    else {
      observer.invalidate();
      await vi.advanceTimersByTimeAsync(50);
      manual = f.refresh.refresh("algebra");
    }
    await paused.started.promise;
    observer.invalidate();
    observer.dispose();
    paused.release.resolve();
    await manual;
    await vi.advanceTimersByTimeAsync(100);
    expect(paused.spy).toHaveBeenCalledOnce();
    expect(f.indexes.algebra![0]?.title).toBe("Accepted");
    expect(f.report).toHaveBeenCalledWith("accepted warning");
  },
);

it("one listener's disposal preserves another listener's follow-up invalidation", async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    first = f.refresh.observeInvalidations(),
    second = f.refresh.observeInvalidations();
  const paused = pausedScan(f);
  first.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  await paused.started.promise;
  second.invalidate();
  first.dispose();
  await vi.advanceTimersByTimeAsync(50);
  expect(paused.spy).toHaveBeenCalledTimes(2);
  paused.release.resolve();
  await vi.advanceTimersByTimeAsync(0);
  second.dispose();
});

it("publishes a follow-up failure as a warning after a committed mutation", async () => {
  const f = await fixture();
  vi.spyOn(f.files, "scanWorkspace").mockRejectedValueOnce(
    new Error("scan unavailable"),
  );
  await expect(
    f.refresh.refresh("algebra", { afterMutation: true }),
  ).resolves.toBeUndefined();
  expect(f.report).toHaveBeenCalledWith(
    "Workspace changed, but could not be refreshed: scan unavailable",
  );
});

it("listener disposal suppresses document delivery and late reread warnings", async () => {
  vi.useFakeTimers();
  const f = await fixture(),
    document = await f.load(),
    observer = f.refresh.observeInvalidations();
  const original = document.content;
  await f.editDisk();
  const paused = pausedRead(f, true);
  observer.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  await paused.started.promise;
  observer.dispose();
  paused.release.resolve();
  await vi.advanceTimersByTimeAsync(100);
  expect(document.content).toBe(original);
  expect(f.report).not.toHaveBeenCalled();
});

it("rejects a scan invalidated by relocation without publishing its metadata or warnings", async () => {
  const f = await fixture(),
    previous = f.indexes.algebra;
  const paused = pausedScan(f, {
    ...f.initial,
    entries: [],
    warnings: ["stale scan"],
  });
  const request = f.refresh.refresh("algebra");
  await paused.started.promise;
  f.relocated();
  paused.release.resolve();
  await request;
  expect(f.indexes.algebra).toBe(previous);
  expect(f.report).not.toHaveBeenCalled();
});

it("drops a reread warning if its Document closes before the refresh publishes", async () => {
  const f = await fixture(),
    closed = await f.load();
  await f.load("Lectures/Eigenvalues.md");
  const started = barrier(),
    release = barrier(),
    read = f.files.readNote.bind(f.files);
  vi.spyOn(f.files, "readNote").mockImplementation(async (id, path) => {
    if (path === closed.file.path) throw new Error("closed document failure");
    started.resolve();
    await release.promise;
    return read(id, path);
  });
  const request = f.refresh.refresh("algebra");
  await started.promise;
  f.lifetime.release(closed);
  release.resolve();
  await request;
  expect(f.report).not.toHaveBeenCalled();
});
