import { afterEach, expect, it, vi } from "vitest";
import { createDemoFiles } from "../platform/demo";
import { NoteDocument } from "./document";
import { DocumentLifetime } from "./document-lifetime";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const files = createDemoFiles();
  const lifetime = new DocumentLifetime(
    (id, note) =>
      new NoteDocument(
        id,
        note,
        (payload) => files.saveNote(id, payload),
        (document, previousPath, result) =>
          lifetime.remap(document.workspaceId, (path) =>
            path === previousPath ? result.path : path,
          ),
        60_000,
      ),
  );
  const load = (path: string) =>
    lifetime.load(
      "algebra",
      path,
      async () => path,
      (currentPath) => files.readNote("algebra", currentPath),
    );
  return { files, lifetime, load };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("shares a pending read and tracks its relocated document identity", async () => {
  const { files, lifetime, load } = fixture();
  const started = barrier(),
    release = barrier();
  const read = files.readNote.bind(files);
  let reads = 0;
  vi.spyOn(files, "readNote").mockImplementation(async (...args) => {
    reads++;
    started.resolve();
    await release.promise;
    return read(...args);
  });
  const first = load("Practice problems.md"),
    second = load("Practice problems.md");
  await started.promise;
  release.resolve();
  const [one, two] = await Promise.all([first, second]);
  expect(one).toBe(two);
  expect(reads).toBe(1);
  lifetime.remap("algebra", (path) =>
    path === "Practice problems.md" ? "Moved.md" : path,
  );
  expect(lifetime.peek("algebra", "Practice problems.md")).toBeUndefined();
  expect(lifetime.peek("algebra", "Moved.md")).toBe(one);
  expect(one.getSnapshot().path).toBe("Moved.md");
  lifetime.release(one);
  expect(() => one.edit("Stale editor callback")).toThrow();
});

it("waits for the whole accepted creation workflow before unregistering its workspace", async () => {
  const { files, lifetime } = fixture();
  const created = barrier(),
    finish = barrier();
  const creation = lifetime.admit("algebra", async () => {
    const document = lifetime.register(
      "algebra",
      await files.createNote("algebra", ""),
    );
    created.resolve();
    await finish.promise;
    document.edit("# Generated after removal was requested");
    await document.flush();
    return document;
  });
  await created.promise;
  let removed = false;
  const removing = lifetime.retireWorkspace(
    "algebra",
    async () => {},
    async () => {
      const result = await files.removeWorkspace("algebra");
      removed = true;
      return result;
    },
  );
  await expect(
    lifetime.admit("algebra", async () => files.createNote("algebra", "")),
  ).rejects.toThrow();
  expect(removed).toBe(false);
  finish.resolve();
  const document = await creation;
  await removing;
  expect(
    (await files.readNote("algebra", document.getSnapshot().path)).content,
  ).toBe("# Generated after removal was requested");
  expect(lifetime.documents("algebra")).toEqual([]);
  expect(document.getSnapshot().editable).toBe(false);
  expect(() => document.edit("Stale callback after unregister")).toThrow();
});

it("waits for a workspace retirement commit before declaring shutdown drained", async () => {
  const { files, lifetime, load } = fixture();
  await load("Practice problems.md");
  const started = barrier(),
    release = barrier();
  const removing = lifetime.retireWorkspace(
    "algebra",
    async () => {},
    async () => {
      started.resolve();
      await release.promise;
      return files.removeWorkspace("algebra");
    },
  );
  await started.promise;
  let drained = false;
  const draining = lifetime
    .drain(
      async () => {},
      async () => {},
    )
    .then(() => {
      drained = true;
    });
  await Promise.resolve();
  expect(drained).toBe(false);
  release.resolve();
  await Promise.all([removing, draining]);
  expect(lifetime.documents()).toEqual([]);
  expect(drained).toBe(true);
});

it("keeps the latest text when a retirement save fails and restores editing", async () => {
  const { files, lifetime, load } = fixture();
  const document = await load("Practice problems.md");
  vi.spyOn(files, "saveNote").mockRejectedValueOnce(new Error("Disk full"));
  document.edit("# Preserve this text");
  await expect(
    lifetime.retire(
      document,
      async () => {},
      async () =>
        files.deleteFile("algebra", document.file.path, document.file.revision),
    ),
  ).rejects.toThrow("Disk full");
  expect(lifetime.peek("algebra", "Practice problems.md")).toBe(document);
  expect(document.content).toBe("# Preserve this text");
  expect(document.getSnapshot().editable).toBe(true);
  document.edit("# Newer recoverable text");
  expect(document.content).toBe("# Newer recoverable text");
  document.dispose();
});

it("finishes a clean concurrent flush before retiring the document permanently", async () => {
  const { lifetime, load } = fixture();
  const document = await load("Practice problems.md");
  await lifetime.retire(
    document,
    async () => {},
    async () => {
      queueMicrotask(() => {
        void document.flush();
      });
    },
  );
  expect(lifetime.peek("algebra", "Practice problems.md")).toBeUndefined();
  expect(document.getSnapshot().editable).toBe(false);
  expect(() => document.edit("Stale cleanup input")).toThrow();
});
