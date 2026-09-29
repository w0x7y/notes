import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NoteFile, SearchEntry } from "../domain/contracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const noteFile = (path: string, content: string): NoteFile => ({
  path,
  content,
  revision: "test",
  autoRename: false,
});
const entry = (path: string, modified = 1): SearchEntry => ({
  workspaceId: "algebra",
  workspaceName: "Algebra",
  color: "blue",
  path,
  kind: "note",
  title: path,
  tags: [],
  modified,
});

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const { createDemoFiles } = await import("../platform/demo");
  vi.doMock("../platform", () => ({ files: createDemoFiles() }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Removing the shared scheduler lets parallel direct heading lookups exceed the file-read limit.
it("limits simultaneous direct heading lookups to four file reads", async () => {
  const app = await import("../domain/app-store");
  const { files } = await import("../platform");
  const { getKnowledgeNote } = await import("./index");
  await app.initialize();
  const paths = Array.from({ length: 9 }, (_, i) => `note-${i}.md`);
  app.useApp.setState({
    entries: { algebra: paths.map((path) => entry(path)) },
  });
  let active = 0;
  let maximum = 0;
  vi.spyOn(files, "readNote").mockImplementation(async (_id, path) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    active--;
    return noteFile(path, `# ${path}`);
  });
  const requests = Promise.all(
    paths.map((path) => getKnowledgeNote("algebra", path)),
  );
  await vi.runAllTimersAsync();
  expect(await requests).toHaveLength(9);
  expect(maximum).toBeLessThanOrEqual(4);
});

// Capturing the buffer before awaiting disk would hide a document opened and edited during that read.
it("uses the latest live buffer when it appears during a disk read", async () => {
  const app = await import("../domain/app-store");
  const { files } = await import("../platform");
  const { getKnowledgeNote } = await import("./index");
  await app.initialize();
  const path = "Practice problems.md";
  const delayed = deferred<NoteFile>();
  vi.spyOn(files, "readNote").mockImplementationOnce(() => delayed.promise);
  const request = getKnowledgeNote("algebra", path);
  const document = await app.loadDocument("algebra", path);
  document.edit("# Practice\n## First unsaved heading\n");
  document.edit("# Practice\n## Latest unsaved heading\n");
  delayed.resolve(noteFile(path, "# Obsolete disk heading"));
  expect((await request).headings.map((heading) => heading.text)).toEqual([
    "Practice",
    "Latest unsaved heading",
  ]);
  document.dispose();
});

// Reusing a closed-buffer cache after a tab closes hides an external edit with unchanged scan metadata.
it("reads fresh disk text after a previously indexed live document closes", async () => {
  const app = await import("../domain/app-store");
  const { files } = await import("../platform");
  const { getKnowledgeNote } = await import("./index");
  await app.initialize();
  const path = "Practice problems.md";
  await app.loadDocument("algebra", path);
  await getKnowledgeNote("algebra", path);
  await app.closeFile("algebra", path);
  vi.spyOn(files, "readNote").mockResolvedValueOnce(
    noteFile(path, "# External replacement"),
  );
  expect(
    (await getKnowledgeNote("algebra", path)).headings.map(
      (heading) => heading.text,
    ),
  ).toEqual(["External replacement"]);
});

// Pruning only from mounted hooks leaves removed notes available when the same path is registered again.
it("invalidates direct lookup caches when a workspace is removed and reopened", async () => {
  const app = await import("../domain/app-store");
  const { files } = await import("../platform");
  const { getKnowledgeNote } = await import("./index");
  await app.initialize();
  const state = app.useApp.getState();
  const path = "Practice problems.md";
  await getKnowledgeNote("algebra", path);
  app.useApp.setState({ workspaces: [] });
  app.useApp.setState({ workspaces: state.workspaces });
  vi.spyOn(files, "readNote").mockResolvedValueOnce(
    noteFile(path, "# Reopened external text"),
  );
  expect((await getKnowledgeNote("algebra", path)).headings[0]?.text).toBe(
    "Reopened external text",
  );
});

// Per-consumer scheduling breaks this even when every individual consumer honors four reads.
it("shares the read limit and pending reads across subscribed and direct consumers", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const paths = Array.from({ length: 10 }, (_, i) => `shared-${i}.md`);
  let active = 0;
  let maximum = 0;
  const reads: string[] = [];
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async (_id, path) => {
      reads.push(path);
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active--;
      return noteFile(path, `# ${path}`);
    },
  });
  analysis.synchronize(paths.map((path) => entry(path)));
  const scope = {
    kind: "workspace",
    workspaceId: "algebra",
  } satisfies import("./content-analysis").AnalysisScope;
  const stopFirst = analysis.watch(scope, () => {});
  const stopSecond = analysis.watch(scope, () => {});
  const direct = analysis.getNote("algebra", paths[8]!);
  stopFirst();
  await vi.runAllTimersAsync();
  expect((await direct).headings[0]?.text).toBe("shared-8.md");
  expect(analysis.getSnapshot(scope).notes).toHaveLength(10);
  expect(analysis.getSnapshot(scope).loading).toBe(false);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(reads).toHaveLength(10);
  stopSecond();
});

// Cancellation must discard an in-flight result rather than planting obsolete text for the next consumer.
it("discards cancelled-only reads and gives a later subscriber fresh contents", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const reads: ReturnType<typeof deferred<NoteFile>>[] = [];
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async () => {
      const read = deferred<NoteFile>();
      reads.push(read);
      return read.promise;
    },
  });
  analysis.synchronize([entry("a.md")]);
  const scope = {
    kind: "workspace",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  stop();
  const stopAgain = analysis.watch(scope, () => {});
  reads[1]?.resolve(noteFile("a.md", "# Current"));
  await Promise.resolve();
  await Promise.resolve();
  reads[0]?.resolve(noteFile("a.md", "# Cancelled obsolete read"));
  await vi.runAllTimersAsync();
  expect(analysis.getSnapshot(scope).notes[0]?.headings[0]?.text).toBe(
    "Current",
  );
  expect((await analysis.getNote("algebra", "a.md")).headings[0]?.text).toBe(
    "Current",
  );
  stopAgain();
});

// An old completion cannot reinsert a removed path or overwrite the newer generation of that path.
it("rejects removed pending lookups and preserves a newer entry when old disk work completes", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const reads: ReturnType<typeof deferred<NoteFile>>[] = [];
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async () => {
      const read = deferred<NoteFile>();
      reads.push(read);
      return read.promise;
    },
  });
  analysis.synchronize([entry("a.md")]);
  const old = analysis.getNote("algebra", "a.md");
  const rejection = expect(old).rejects.toThrow("changed");
  analysis.synchronize([]);
  analysis.synchronize([entry("a.md", 2)]);
  const current = analysis.getNote("algebra", "a.md");
  reads[1]?.resolve(noteFile("a.md", "# New registration"));
  expect((await current).headings[0]?.text).toBe("New registration");
  reads[0]?.resolve(noteFile("a.md", "# Removed registration"));
  await rejection;
  await vi.runAllTimersAsync();
  expect((await analysis.getNote("algebra", "a.md")).headings[0]?.text).toBe(
    "New registration",
  );
});

// Starting the next load inline after an exhausted budget prevents browser input/paint from running.
it("yields to a timer before continuing disk loading after the analysis budget", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const order: string[] = [];
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async (_id, path) => {
      order.push(path);
      now += 9;
      return noteFile(path, `# ${path}`);
    },
  });
  analysis.synchronize([entry("a.md"), entry("b.md")]);
  const first = analysis.getNote("algebra", "a.md");
  setTimeout(() => order.push("input"), 0);
  const second = analysis.getNote("algebra", "b.md");
  await first;
  expect(order).toEqual(["a.md"]);
  await vi.runAllTimersAsync();
  await second;
  expect(order).toEqual(["a.md", "input", "b.md"]);
});

// Watching only metadata loses second and subsequent edits while saving; a narrow content signal must refresh the outline.
it("updates a subscribed live outline across edits that do not publish metadata", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const { NoteDocument } = await import("../domain/document");
  const document = new NoteDocument(
    "algebra",
    noteFile("a.md", "# Title"),
    async (note) => ({ ...note, rewritten: [], warnings: [] }),
    () => {},
  );
  const analysis = new ContentAnalysis({
    getLiveDocument: () => document,
    readNote: async () => noteFile("a.md", "# Disk"),
  });
  analysis.synchronize([entry("a.md"), entry("b.md")]);
  const scope = {
    kind: "note",
    workspaceId: "algebra",
    path: "a.md",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  document.edit("# Title\n## First");
  const metadata = document.getSnapshot();
  document.edit("# Title\n## Second");
  expect(document.getSnapshot()).toBe(metadata);
  expect(
    analysis
      .getSnapshot(scope)
      .notes[0]?.headings.map((heading) => heading.text),
  ).toEqual(["Title", "Second"]);
  stop();
  document.dispose();
});

// Saving replaces an entry generation even when the same open document survives; listeners must target its new cache record.
it("keeps a live outline fresh after save-driven entry invalidation", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const { NoteDocument } = await import("../domain/document");
  const document = new NoteDocument(
    "algebra",
    noteFile("a.md", "# Title"),
    async (note) => ({ ...note, rewritten: [], warnings: [] }),
    () => {},
  );
  const analysis = new ContentAnalysis({
    getLiveDocument: () => document,
    readNote: async () => noteFile("a.md", "# Disk"),
  });
  analysis.synchronize([entry("a.md")]);
  const scope = {
    kind: "note",
    workspaceId: "algebra",
    path: "a.md",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  analysis.synchronize([entry("a.md", 2)]);
  document.edit("# Title\n## After save");
  expect(
    analysis
      .getSnapshot(scope)
      .notes[0]?.headings.map((heading) => heading.text),
  ).toEqual(["Title", "After save"]);
  stop();
  document.dispose();
});

// A consumer closing must not cancel I/O that an outstanding direct lookup still owns.
it("keeps a direct lookup alive when the last subscribed consumer cancels", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const disk = deferred<NoteFile>();
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: () => disk.promise,
  });
  analysis.synchronize([entry("a.md")]);
  const scope = {
    kind: "workspace",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  const direct = analysis.getNote("algebra", "a.md");
  stop();
  disk.resolve(noteFile("a.md", "# Surviving direct lookup"));
  expect((await direct).headings[0]?.text).toBe("Surviving direct lookup");
});

// A transient read failure should not become a permanent cached failure across reopened consumers.
it("reports read failures and retries when the failed consumer is reopened", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  let fail = true;
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async () => {
      if (fail) throw new Error("Unavailable");
      return noteFile("a.md", "# Available again");
    },
  });
  analysis.synchronize([entry("a.md")]);
  const scope = {
    kind: "workspace",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  await vi.runAllTimersAsync();
  expect(analysis.getSnapshot(scope)).toMatchObject({
    loading: false,
    notes: [],
    errors: ["Algebra/a.md: Unavailable"],
  });
  stop();
  fail = false;
  const stopAgain = analysis.watch(scope, () => {});
  await vi.runAllTimersAsync();
  expect(analysis.getSnapshot(scope).notes[0]?.headings[0]?.text).toBe(
    "Available again",
  );
  expect(analysis.getSnapshot(scope).errors).toEqual([]);
  stopAgain();
});

// Disk may disappear after a document opens; the live buffer remains the usable source even when that old disk read fails.
it("uses an available live buffer when an earlier disk read fails", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const { NoteDocument } = await import("../domain/document");
  let live: InstanceType<typeof NoteDocument> | undefined;
  const disk = deferred<NoteFile>();
  const analysis = new ContentAnalysis({
    getLiveDocument: () => live,
    readNote: () => disk.promise,
  });
  analysis.synchronize([entry("a.md")]);
  const pending = analysis.getNote("algebra", "a.md");
  live = new NoteDocument(
    "algebra",
    noteFile("a.md", "# Live text survives"),
    async (note) => ({ ...note, rewritten: [], warnings: [] }),
    () => {},
  );
  disk.reject(new Error("Old disk read failed"));
  expect((await pending).headings[0]?.text).toBe("Live text survives");
  live.dispose();
});

// Cancellation cannot free a semaphore slot until uncancellable native I/O settles, or reopening starts more than four real reads.
it("counts cancelled native reads against the limit until they settle", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const pending: ReturnType<typeof deferred<NoteFile>>[] = [];
  let active = 0;
  let maximum = 0;
  const analysis = new ContentAnalysis({
    getLiveDocument: () => undefined,
    readNote: async (_id, path) => {
      maximum = Math.max(maximum, ++active);
      const read = deferred<NoteFile>();
      pending.push(read);
      const result = await read.promise;
      active--;
      return { ...result, path };
    },
  });
  analysis.synchronize([
    entry("a.md"),
    entry("b.md"),
    entry("c.md"),
    entry("d.md"),
  ]);
  const scope = {
    kind: "workspace",
  } satisfies import("./content-analysis").AnalysisScope;
  const stop = analysis.watch(scope, () => {});
  stop();
  const stopAgain = analysis.watch(scope, () => {});
  expect(pending).toHaveLength(4);
  for (const read of pending.slice()) read.resolve(noteFile("", "# Cancelled"));
  await vi.runAllTimersAsync();
  for (const read of pending.slice(4)) read.resolve(noteFile("", "# Current"));
  await vi.runAllTimersAsync();
  expect(
    analysis.getSnapshot(scope).notes.map((note) => note.headings[0]?.text),
  ).toEqual(["Current", "Current", "Current", "Current"]);
  expect(maximum).toBeLessThanOrEqual(4);
  stopAgain();
});

// Bulk live parsing must honor the same input/paint budget as disk analysis and use text at execution time.
it.each([
  { state: "uncached", primeCache: false },
  { state: "stale", primeCache: true },
])(
  "yields while analyzing $state bulk live buffers and reads queued edits",
  async ({ primeCache }) => {
    const { ContentAnalysis } = await import("./content-analysis");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const texts = new Map(
      Array.from({ length: 8 }, (_, i) => [`live-${i}.md`, `# Original ${i}`]),
    );
    const live = new Map(
      [...texts.keys()].map((path) => [
        path,
        {
          get content() {
            // Represent an expensive single-note analysis without replacing the real Markdown parser.
            now += 9;
            return texts.get(path) ?? "";
          },
          subscribeContent: () => () => {},
        },
      ]),
    );
    const analysis = new ContentAnalysis({
      getLiveDocument: (_id, path) => live.get(path),
      readNote: async () => {
        throw new Error("Live notes must not read disk");
      },
    });
    analysis.synchronize([...texts.keys()].map((path) => entry(path)));
    if (primeCache) {
      for (const path of texts.keys()) await analysis.getNote("algebra", path);
      for (const [path, text] of texts)
        texts.set(path, text + "\n## Stale cache update");
    }
    now = 0;
    const scope = {
      kind: "workspace",
    } satisfies import("./content-analysis").AnalysisScope;
    let notesWhenInputRan = -1;
    setTimeout(() => {
      notesWhenInputRan = analysis.getSnapshot(scope).notes.length;
    }, 0);
    const stop = analysis.watch(scope, () => {});
    expect(analysis.getSnapshot(scope).notes.length).toBeLessThan(8);
    expect(analysis.getSnapshot(scope).loading).toBe(true);
    texts.set("live-7.md", "# Edited while queued");
    await vi.runAllTimersAsync();
    expect(notesWhenInputRan).toBeLessThan(8);
    expect(analysis.getSnapshot(scope).loading).toBe(false);
    expect(analysis.getSnapshot(scope).errors).toEqual([]);
    expect(analysis.getSnapshot(scope).notes).toHaveLength(8);
    expect(
      analysis
        .getSnapshot(scope)
        .notes.find((note) => note.path === "live-7.md")?.headings[0]?.text,
    ).toBe("Edited while queued");
    stop();
  },
);

// The bulk queue's exhausted budget must not defer the requested heading lookup or the active outline.
it("keeps direct live headings and one active outline immediate while bulk work waits", async () => {
  const { ContentAnalysis } = await import("./content-analysis");
  const { NoteDocument } = await import("../domain/document");
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const document = new NoteDocument(
    "algebra",
    noteFile("a.md", "# Current outline"),
    async (note) => ({ ...note, rewritten: [], warnings: [] }),
    () => {},
  );
  const analysis = new ContentAnalysis({
    getLiveDocument: () => document,
    readNote: async () => {
      throw new Error("No disk expected");
    },
  });
  analysis.synchronize([entry("a.md"), entry("b.md")]);
  now = 9;
  const bulk = {
    kind: "workspace",
  } satisfies import("./content-analysis").AnalysisScope;
  const stopBulk = analysis.watch(bulk, () => {});
  expect(analysis.getSnapshot(bulk).notes).toEqual([]);
  expect((await analysis.getNote("algebra", "b.md")).headings[0]?.text).toBe(
    "Current outline",
  );
  const outline = {
    kind: "note",
    workspaceId: "algebra",
    path: "a.md",
  } satisfies import("./content-analysis").AnalysisScope;
  const stopOutline = analysis.watch(outline, () => {});
  expect(analysis.getSnapshot(outline).notes[0]?.headings[0]?.text).toBe(
    "Current outline",
  );
  document.edit("# Current outline\n## Immediate edit");
  expect(
    analysis
      .getSnapshot(outline)
      .notes[0]?.headings.map((heading) => heading.text),
  ).toEqual(["Current outline", "Immediate edit"]);
  await vi.runAllTimersAsync();
  stopOutline();
  stopBulk();
  document.dispose();
});
