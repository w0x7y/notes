import { afterEach, beforeEach, expect, it, vi } from "vitest";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("waits for an accepted folder move before saving for close", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const move = files.moveFolder.bind(files);
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "moveFolder").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return move(...args);
  });
  const moving = app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  let closed = false;
  const closing = app.flushAll().then(() => {
    closed = true;
  });
  await started.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(closed).toBe(false);
  document.edit("# Keep typing while moving\n");
  release.resolve();
  await Promise.all([moving, closing]);
  expect(document.dirty).toBe(false);
  expect(
    (await files.readNote("algebra", "Assignments/Lectures/Eigenvalues.md"))
      .content,
  ).toBe(document.content);
});

it("reports a follow-up save failure separately from a committed note rename", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const rename = files.renameNote.bind(files);
  const committed = barrier();
  const release = barrier();
  vi.spyOn(files, "renameNote").mockImplementationOnce(async (...args) => {
    const result = await rename(...args);
    committed.resolve();
    await release.promise;
    return result;
  });
  const renaming = app.renameNote(document, "Lectures/Renamed.md");
  const outcome = renaming.then(
    () => null,
    (error: unknown) => error,
  );
  await committed.promise;
  document.edit("# Typed after rename\n\nKeep this buffer.");
  vi.spyOn(files, "saveNote").mockRejectedValue(
    new Error("Disk full after rename"),
  );
  release.resolve();
  expect(await outcome).toBeNull();
  expect(app.peekDocument("algebra", "Lectures/Renamed.md")).toBe(document);
  expect(
    app.peekDocument("algebra", "Lectures/Eigenvalues.md"),
  ).toBeUndefined();
  expect(document.content).toBe("# Typed after rename\n\nKeep this buffer.");
  expect(document.dirty).toBe(true);
  expect(document.getSnapshot().status.kind).toBe("failed");
  expect(app.useApp.getState().notice).toContain("Disk full after rename");
  await expect(
    files.readNote("algebra", "Lectures/Renamed.md"),
  ).resolves.toMatchObject({ path: "Lectures/Renamed.md" });
  await expect(app.flushAll()).rejects.toThrow("Disk full after rename");
});

it("waits for an accepted generated note to be registered and saved before close", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const create = files.createNote.bind(files);
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "createNote").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return create(...args);
  });
  const creating = app.createContentNote(
    "algebra",
    "Lectures",
    "# Generated\n\nKeep this note.",
  );
  let closed = false;
  const closing = app.flushAll().then(() => {
    closed = true;
  });
  await started.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(closed).toBe(false);
  release.resolve();
  const document = await creating;
  await closing;
  expect(app.peekDocument("algebra", document.getSnapshot().path)).toBe(
    document,
  );
  expect(document.dirty).toBe(false);
  expect(
    (await files.readNote("algebra", document.getSnapshot().path)).content,
  ).toBe("# Generated\n\nKeep this note.");
});

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const { createDemoFiles } = await import("../platform/demo");
  const files = createDemoFiles();
  vi.doMock("../platform", () => ({ files }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("deletes the saved path after a title-driven rename and removes its session and appearance", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  await app.newNote("algebra");
  const doc = await app.loadDocument("algebra", "Untitled.md");
  await app.setEntryAppearance("algebra", "Untitled.md", {
    icon: "star",
    color: "#e5c07b",
  });
  doc.edit("# New name\n\nText");
  await app.deleteEntry("algebra", "Untitled.md", "note");
  expect(app.useApp.getState().sessions.algebra?.tabs).not.toContain(
    "New name.md",
  );
  expect(
    app.useApp.getState().appearances.algebra?.["New name.md"],
  ).toBeUndefined();
  await expect(files.readNote("algebra", "New name.md")).rejects.toThrow();
  await expect(app.flushAll()).resolves.toBeUndefined();
});

it("keeps the workspace and buffer when saving before removal fails", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const doc = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  doc.edit("Unsaved");
  vi.spyOn(files, "saveNote").mockRejectedValueOnce(new Error("Disk full"));
  await expect(app.removeWorkspace("algebra")).rejects.toThrow("Disk full");
  expect(app.useApp.getState().workspaces.some((w) => w.id === "algebra")).toBe(
    true,
  );
  expect(doc.content).toBe("Unsaved");
  doc.dispose();
});

it("updates image tabs and appearance on rename and unregisters a workspace without deleting its files", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  app.openFile("algebra", "Example.svg");
  await app.setEntryAppearance("algebra", "Example.svg", {
    icon: "image",
    color: "#98c379",
  });
  await app.renameImage("algebra", "Example.svg", "Renamed.svg");
  expect(app.useApp.getState().sessions.algebra?.primary).toBe("Renamed.svg");
  expect(
    app.useApp.getState().appearances.algebra?.["Renamed.svg"]?.color,
  ).toBe("#98c379");
  await app.removeWorkspace("algebra");
  expect(app.useApp.getState().activeWorkspaceId).toBe("web");
  expect(app.useApp.getState().sessions.algebra).toBeUndefined();
  expect((await files.readImage("algebra", "Renamed.svg")).mime).toBe(
    "image/svg+xml",
  );
});

it("keeps a dialog target attached to a document after autosave renames it", async () => {
  const app = await import("./app-store");
  await app.initialize();
  await app.newNote("algebra");
  const doc = await app.loadDocument("algebra", "Untitled.md");
  doc.edit("# Renamed while confirming");
  await doc.flush();
  await app.setEntryAppearance(
    "algebra",
    "Untitled.md",
    { icon: "star", color: null },
    doc,
  );
  expect(
    app.useApp.getState().appearances.algebra?.["Renamed while confirming.md"]
      ?.icon,
  ).toBe("star");
  await app.deleteEntry("algebra", "Untitled.md", "note", doc);
  expect(
    app.useApp
      .getState()
      .entries.algebra?.some(
        (entry) => entry.path === "Renamed while confirming.md",
      ),
  ).toBe(false);
});

it("flushes pending note edits before renaming an image and applying rewritten links", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const doc = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  doc.edit("# Changed\n\n![diagram](../Example.svg)");
  const rename = vi
    .spyOn(files, "renameImage")
    .mockImplementationOnce(async () => {
      expect(doc.dirty).toBe(false);
      expect(doc.hasPendingOperation).toBe(false);
      return {
        path: "New.svg",
        rewritten: [
          {
            workspaceId: "algebra",
            path: "Lectures/Eigenvalues.md",
            content: "# Changed\n\n![diagram](../New.svg)",
            revision: "rewritten",
          },
        ],
        warnings: [],
      };
    });
  await app.renameImage("algebra", "Example.svg", "New.svg");
  expect(rename).toHaveBeenCalled();
  expect(doc.content).toContain("../New.svg");
  expect(doc.dirty).toBe(false);
});

it("moves a folder with its open note, tab, and appearance", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  await app.setEntryAppearance("algebra", "Lectures/Eigenvalues.md", {
    icon: "star",
    color: null,
  });
  document.edit("# Edited before moving\n");
  await app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  const moved = "Assignments/Lectures/Eigenvalues.md";
  expect(document.getSnapshot().path).toBe(moved);
  expect(document.content).toBe("# Edited before moving\n");
  expect(app.useApp.getState().sessions.algebra?.primary).toBe(moved);
  expect(app.useApp.getState().appearances.algebra?.[moved]?.icon).toBe("star");
  expect((await files.readNote("algebra", moved)).content).toBe(
    document.content,
  );
  await expect(
    files.readNote("algebra", "Lectures/Eigenvalues.md"),
  ).rejects.toThrow();
});

it("flushes incoming-link documents before a manual note rename", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const incoming = await app.loadDocument("algebra", "Practice problems.md");
  const target = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  incoming.edit("# Practice\n\n[[Eigenvalues]]\nKeep this edit.");
  const rename = files.renameNote.bind(files);
  vi.spyOn(files, "renameNote").mockImplementationOnce(
    async (id, note, name) => {
      const source = await files.readNote(id, "Practice problems.md");
      const rewritten = await files.saveNote(id, {
        ...source,
        content: source.content.replace("[[Eigenvalues]]", "[[Renamed]]"),
      });
      const result = await rename(id, note, name);
      return { ...result, rewritten: [{ workspaceId: id, ...rewritten }] };
    },
  );
  await app.renameNote(target, "Lectures/Renamed.md");
  expect(incoming.content).toBe("# Practice\n\n[[Renamed]]\nKeep this edit.");
  expect(incoming.dirty).toBe(false);
  expect(incoming.getSnapshot().status.kind).toBe("saved");
});

it("saves typing during a folder move only at the committed destination", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const move = files.moveFolder.bind(files);
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "moveFolder").mockImplementationOnce(async (...args) => {
    const result = await move(...args);
    started.resolve();
    await release.promise;
    return result;
  });
  const moving = app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  await started.promise;
  document.edit("# Typed during move\n\nKeep this text.");
  const saving = document.flush();
  // Observe the rejection without producing an unhandled rejection in the old implementation.
  const outcome = saving.then(
    () => null,
    (error: unknown) => error,
  );
  release.resolve();
  await expect(moving).resolves.toBeUndefined();
  expect(await outcome).toBeNull();
  expect(document.getSnapshot().path).toBe(
    "Assignments/Lectures/Eigenvalues.md",
  );
  expect(document.content).toBe("# Typed during move\n\nKeep this text.");
  expect(
    (await files.readNote("algebra", "Assignments/Lectures/Eigenvalues.md"))
      .content,
  ).toBe("# Typed during move\n\nKeep this text.");
});

it("keeps all moved documents reachable after one destination reread fails", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const first = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const second = await app.loadDocument("algebra", "Lectures/Vector spaces.md");
  app.openFile("algebra", "Lectures/Eigenvalues.md");
  app.openFile("algebra", "Lectures/Vector spaces.md", "secondary");
  const read = files.readNote.bind(files);
  vi.spyOn(files, "readNote").mockImplementation(async (id, path) => {
    if (path === "Assignments/Lectures/Eigenvalues.md")
      throw new Error("Temporarily unreadable");
    return read(id, path);
  });
  await expect(
    app.moveFolder("algebra", "Lectures", "Assignments/Lectures"),
  ).resolves.toBeUndefined();
  expect(
    app.peekDocument("algebra", "Assignments/Lectures/Eigenvalues.md"),
  ).toBe(first);
  expect(
    app.peekDocument("algebra", "Assignments/Lectures/Vector spaces.md"),
  ).toBe(second);
  expect(
    app.peekDocument("algebra", "Lectures/Eigenvalues.md"),
  ).toBeUndefined();
  expect(app.useApp.getState().sessions.algebra?.tabs).toEqual([
    "Assignments/Lectures/Eigenvalues.md",
    "Practice problems.md",
    "Assignments/Lectures/Vector spaces.md",
  ]);
  expect(app.useApp.getState().notice).toContain("Temporarily unreadable");
});

it("remaps folder selection and heading navigation together with document paths", async () => {
  const app = await import("./app-store");
  await app.initialize();
  app.navigateTo("algebra", "Lectures/Eigenvalues.md", 24);
  app.useApp.setState({ selectedFolder: "Lectures" });
  await app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  expect(app.useApp.getState().selectedFolder).toBe("Assignments/Lectures");
  expect(app.useApp.getState().navigation).toMatchObject({
    path: "Assignments/Lectures/Eigenvalues.md",
    offset: 24,
  });
});

it("uses the reconciled source for overlapping queued folder moves and carries its pins", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { toggleFavorite, useLibrary } = await import("../knowledge/library");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  toggleFavorite("algebra", "Lectures/Eigenvalues.md");
  await app.setEntryAppearance("algebra", "Lectures/Eigenvalues.md", {
    icon: "star",
    color: null,
  });
  const move = files.moveFolder.bind(files);
  const started = barrier();
  const release = barrier();
  const calls = vi
    .spyOn(files, "moveFolder")
    .mockImplementationOnce(async (...args) => {
      const result = await move(...args);
      started.resolve();
      await release.promise;
      return result;
    });
  const first = app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  await started.promise;
  const second = app.moveFolder("algebra", "Lectures", "RenamedLectures");
  release.resolve();
  await Promise.all([first, second]);
  expect(calls.mock.calls.map((args) => args[1])).toEqual([
    "Lectures",
    "Assignments/Lectures",
  ]);
  const finalPath = "RenamedLectures/Eigenvalues.md";
  expect(app.peekDocument("algebra", finalPath)).toBe(document);
  expect(app.useApp.getState().sessions.algebra?.primary).toBe(finalPath);
  expect(app.useApp.getState().appearances.algebra?.[finalPath]?.icon).toBe(
    "star",
  );
  expect(useLibrary.getState().favorites).toEqual([
    { workspaceId: "algebra", path: finalPath },
  ]);
  expect((await files.readNote("algebra", finalPath)).content).toBe(
    document.content,
  );
});

it("preserves newer incoming-link edits instead of overwriting a committed rewrite", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  document.edit("# Practice\n\n![diagram](Example.svg)");
  await document.flush();
  const started = barrier(),
    release = barrier();
  const rename = files.renameImage.bind(files);
  vi.spyOn(files, "renameImage").mockImplementationOnce(async (...args) => {
    const result = await rename(...args);
    const source = await files.readNote("algebra", "Practice problems.md");
    const rewritten = await files.saveNote("algebra", {
      ...source,
      content: "# Practice\n\n![diagram](Renamed.svg)",
    });
    started.resolve();
    await release.promise;
    return { ...result, rewritten: [{ workspaceId: "algebra", ...rewritten }] };
  });
  const moving = app.renameImage("algebra", "Example.svg", "Renamed.svg");
  await started.promise;
  document.edit("# Practice\n\n![diagram](Example.svg)\nNewer typing.");
  release.resolve();
  await moving;
  expect(document.content).toContain("Newer typing.");
  expect(document.dirty).toBe(true);
  expect(document.getSnapshot().status.kind).toBe("failed");
  expect(
    (await files.readNote("algebra", "Practice problems.md")).content,
  ).toBe("# Practice\n\n![diagram](Renamed.svg)");
  document.dispose();
});

it("opens an uncached document at its new path when requested during a folder move", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const move = files.moveFolder.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "moveFolder").mockImplementationOnce(async (...args) => {
    const result = await move(...args);
    started.resolve();
    await release.promise;
    return result;
  });
  const moving = app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  await started.promise;
  const opening = app.loadDocument("algebra", "Lectures/Vector spaces.md");
  release.resolve();
  await moving;
  const document = await opening;
  expect(document.getSnapshot().path).toBe(
    "Assignments/Lectures/Vector spaces.md",
  );
  expect(
    app.peekDocument("algebra", "Assignments/Lectures/Vector spaces.md"),
  ).toBe(document);
});

it("ignores a pre-move scan that finishes after relocation reconciliation", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const scan = files.scanWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "scanWorkspace").mockImplementationOnce(async (id) => {
    const snapshot = await scan(id);
    started.resolve();
    await release.promise;
    return snapshot;
  });
  const refreshing = app.refreshWorkspace("algebra");
  await started.promise;
  await app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  release.resolve();
  await refreshing;
  expect(
    app.useApp
      .getState()
      .entries.algebra?.some(
        (entry) => entry.path === "Lectures/Eigenvalues.md",
      ),
  ).toBe(false);
  expect(
    app.useApp
      .getState()
      .entries.algebra?.some(
        (entry) => entry.path === "Assignments/Lectures/Eigenvalues.md",
      ),
  ).toBe(true);
});

it("registers a note being created before moving its containing folder", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const create = files.createNote.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "createNote").mockImplementationOnce(async (...args) => {
    const note = await create(...args);
    started.resolve();
    await release.promise;
    return note;
  });
  const creating = app.newNote("algebra", "Lectures");
  await started.promise;
  const moving = app.moveFolder("algebra", "Lectures", "Assignments/Lectures");
  // Give an uncoordinated move a chance to commit before registration finishes.
  await vi.advanceTimersByTimeAsync(0);
  release.resolve();
  await Promise.all([creating, moving]);
  const document = app.peekDocument(
    "algebra",
    "Assignments/Lectures/Untitled.md",
  );
  expect(document).toBeDefined();
  expect(app.peekDocument("algebra", "Lectures/Untitled.md")).toBeUndefined();
  expect(app.useApp.getState().sessions.algebra?.tabs).not.toContain(
    "Lectures/Untitled.md",
  );
});

it("releases a closed saved document and reloads its current disk contents on reopening", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const original = await app.loadDocument("algebra", "Practice problems.md");
  await app.closeFile("algebra", "Practice problems.md");
  const note = await files.readNote("algebra", "Practice problems.md");
  await files.saveNote("algebra", { ...note, content: "# Edited elsewhere" });
  const reopened = await app.loadDocument("algebra", "Practice problems.md");
  expect(reopened).not.toBe(original);
  expect(reopened.content).toBe("# Edited elsewhere");
});

it("applies preferences only after successful persistence and can disable session restore", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const current = app.useApp.getState().preferences;
  vi.spyOn(files, "savePreferences").mockRejectedValueOnce(
    new Error("Disk full"),
  );
  await expect(
    app.savePreferences({ ...current, fontSize: 20 }),
  ).rejects.toThrow("Disk full");
  expect(app.useApp.getState().preferences.fontSize).toBe(current.fontSize);
  await app.savePreferences({ ...current, restoreSession: false });
  await app.initialize();
  expect(app.useApp.getState().sessions).toEqual({});
});

it("coalesces concurrent refreshes and preserves the file index when nothing changed", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const entries = app.useApp.getState().entries.algebra;
  const scan = vi.spyOn(files, "scanWorkspace");
  await Promise.all([
    app.refreshWorkspace("algebra"),
    app.refreshWorkspace("algebra"),
  ]);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(app.useApp.getState().entries.algebra).toBe(entries);
});
