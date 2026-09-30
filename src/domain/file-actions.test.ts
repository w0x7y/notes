import { afterEach, beforeEach, expect, it, vi } from "vitest";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("clears heading navigation when cycling tabs", async () => {
  const app = await import("./app-store");
  await app.initialize();
  app.openFile("algebra", "Practice problems.md");
  app.navigateTo("algebra", "Lectures/Eigenvalues.md", 120);
  app.cycleTab();
  expect(app.currentSession().primary).toBe("Practice problems.md");
  expect(app.useApp.getState().navigation).toBeNull();
});

it("opens beside the destination workspace primary when switching from secondary focus", async () => {
  const app = await import("./app-store");
  await app.initialize();
  app.openFile("algebra", "Practice problems.md");
  app.openFile("algebra", "Lectures/Eigenvalues.md", "secondary");
  app.openFile("web", "React.md");
  app.openInSplit("web", "Components.md");
  app.openFile("algebra", "Lectures/Eigenvalues.md");
  app.openInSplit("web", "New.md");
  expect(app.currentSession().primary).toBe("React.md");
  expect(app.currentSession().secondary).toBe("New.md");
  expect(app.useApp.getState().focusedPane).toBe("secondary");
});

it("preserves the session reference on repeated pane focus", async () => {
  const app = await import("./app-store");
  await app.initialize();
  app.openFile("algebra", "Practice problems.md");
  const sessions = app.useApp.getState().sessions;
  const state = app.useApp.getState();
  app.focusPane("primary");
  expect(app.useApp.getState()).toBe(state);
  expect(app.useApp.getState().sessions).toBe(sessions);
});

it("rejects new document loads while workspace removal waits for an accepted load", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const read = files.readNote.bind(files);
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "readNote").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return read(...args);
  });
  const accepted = app.loadDocument("algebra", "Practice problems.md");
  await started.promise;
  const removing = app.removeWorkspace("algebra");
  const late = app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const outcome = late.then(
    () => "loaded",
    () => "rejected",
  );
  release.resolve();
  const document = await accepted;
  await removing;
  expect(await outcome).toBe("rejected");
  expect(
    app.peekDocument("algebra", document.getSnapshot().path),
  ).toBeUndefined();
  expect(
    app.peekDocument("algebra", "Lectures/Eigenvalues.md"),
  ).toBeUndefined();
});

it("saves edits accepted during removal preparation and restores editing when unregistering fails", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "saveSessions").mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
  });
  vi.spyOn(files, "removeWorkspace").mockRejectedValueOnce(
    new Error("Config full"),
  );
  const removing = app.removeWorkspace("algebra");
  const outcome = removing.catch((error: unknown) => error);
  await started.promise;
  document.edit("# Text accepted during preparation");
  release.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(document.dirty).toBe(false);
  expect(
    (await files.readNote("algebra", document.getSnapshot().path)).content,
  ).toBe("# Text accepted during preparation");
  document.edit("# Editing works after failure");
  expect(document.content).toBe("# Editing works after failure");
  expect(
    app.useApp.getState().workspaces.some((item) => item.id === "algebra"),
  ).toBe(true);
});

it("makes deletion read-only only during its final commit and restores editing on failure", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  const started = barrier();
  const release = barrier();
  vi.spyOn(files, "deleteFile").mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    throw new Error("Trash unavailable");
  });
  const deleting = app.deleteEntry(
    "algebra",
    "Practice problems.md",
    "note",
    document,
  );
  const outcome = deleting.catch((error: unknown) => error);
  await started.promise;
  expect(app.hasUnsavedChanges()).toBe(true);
  expect(document.getSnapshot().editable).toBe(false);
  expect(() =>
    document.edit("Must not be accepted after deletion starts"),
  ).toThrow();
  release.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(document.getSnapshot().editable).toBe(true);
  document.edit("Editing restored");
  expect(document.content).toBe("Editing restored");
});

it("includes accepted note creation in the before-unload warning before it registers a buffer", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const create = files.createNote.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "createNote").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return create(...args);
  });
  const creating = app.newNote("algebra");
  await started.promise;
  expect(app.hasUnsavedChanges()).toBe(true);
  release.resolve();
  await creating;
  expect(app.hasUnsavedChanges()).toBe(false);
});

it("waits for capture registration and folder preparation before shutdown finishes", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { quickCapture } = await import("../knowledge/templates");
  await app.initialize();
  const ensure = files.ensureCaptureWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "ensureCaptureWorkspace").mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return ensure();
  });
  const capturing = quickCapture();
  await started.promise;
  let finished = false;
  const closing = app.flushAll().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(finished).toBe(false);
  release.resolve();
  await Promise.all([capturing, closing]);
  const id = app.useApp.getState().activeWorkspaceId!;
  expect(app.useApp.getState().sessions[id]?.primary).toBe("Inbox/Untitled.md");
});

it("finishes an accepted capture registration before removal without reopening its admission gate", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { quickCapture } = await import("../knowledge/templates");
  await app.initialize();
  await quickCapture();
  const id = app.useApp.getState().activeWorkspaceId!;
  const ensure = files.ensureCaptureWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "ensureCaptureWorkspace").mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return ensure();
  });
  const capturing = quickCapture();
  await started.promise;
  const removing = app.removeWorkspace(id);
  const late = app.newNote(id).then(
    () => "created",
    () => "rejected",
  );
  release.resolve();
  await Promise.all([capturing, removing]);
  expect(await late).toBe("rejected");
  expect(
    app.useApp.getState().workspaces.some((workspace) => workspace.id === id),
  ).toBe(false);
  expect(app.peekDocument(id, "Inbox/Untitled 2.md")).toBeUndefined();
  expect((await files.readNote(id, "Inbox/Untitled 2.md")).content).toBe("");
});

it("queues capture requested during removal until unregistering finishes", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { quickCapture } = await import("../knowledge/templates");
  await app.initialize();
  await quickCapture();
  const id = app.useApp.getState().activeWorkspaceId!;
  const remove = files.removeWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "removeWorkspace").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return remove(...args);
  });
  const removing = app.removeWorkspace(id);
  await started.promise;
  const capturing = quickCapture();
  release.resolve();
  await Promise.all([removing, capturing]);
  expect(
    app.useApp.getState().workspaces.some((workspace) => workspace.id === id),
  ).toBe(true);
  expect(app.currentSession().primary).toBe("Inbox/Untitled 2.md");
  const reopened = await app.loadDocument(id, "Inbox/Untitled 2.md");
  expect(reopened.getSnapshot().editable).toBe(true);
});

it("waits for admitted folder creation before removing its workspace", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const create = files.createFolder.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "createFolder").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return create(...args);
  });
  const creating = app.createFolder("algebra", "", "Accepted folder");
  await started.promise;
  const removing = app.removeWorkspace("algebra");
  release.resolve();
  await Promise.all([creating, removing]);
  expect(app.useApp.getState().entries.algebra).toBeUndefined();
  expect(
    app.useApp
      .getState()
      .workspaces.some((workspace) => workspace.id === "algebra"),
  ).toBe(false);
});

it("includes pending workspace registration in shutdown and activates primary focus", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  app.openFile("algebra", "Lectures/Eigenvalues.md", "secondary");
  const started = barrier(),
    release = barrier();
  // Browser folder selection is unsupported; retain actual demo registration behind it.
  vi.spyOn(files, "addWorkspace").mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return files.ensureCaptureWorkspace();
  });
  const adding = app.addWorkspace("/temporary/new-workspace");
  await started.promise;
  let finished = false;
  const closing = app.flushAll().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(finished).toBe(false);
  release.resolve();
  await Promise.all([adding, closing]);
  expect(app.useApp.getState().focusedPane).toBe("primary");
  expect(
    app.useApp
      .getState()
      .workspaces.find(
        (workspace) => workspace.id === app.useApp.getState().activeWorkspaceId,
      )?.name,
  ).toBe("Quick Notes");
});

it("waits for an earlier requested load before closing and disposing its buffer", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  app.openFile("algebra", "Practice problems.md");
  const read = files.readNote.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "readNote").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return read(...args);
  });
  const loading = app.loadDocument("algebra", "Practice problems.md");
  let finished = false;
  const closing = app.closeFile("algebra", "Practice problems.md").then(() => {
    finished = true;
  });
  await started.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(finished).toBe(false);
  release.resolve();
  const document = await loading;
  await closing;
  expect(document.getSnapshot().editable).toBe(false);
  expect(app.peekDocument("algebra", "Practice problems.md")).toBeUndefined();
});

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

it("rejects a stale rename after close without changing the disk file", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  await app.closeFile("algebra", "Practice problems.md");
  await expect(app.renameNote(document, "Retired.md")).rejects.toThrow();
  expect(
    (await files.readNote("algebra", "Practice problems.md")).content,
  ).toBe(document.content);
  expect(app.peekDocument("algebra", "Retired.md")).toBeUndefined();
});

it("rejects a new load admitted after close begins instead of registering it after retirement", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  app.openFile("algebra", "Practice problems.md");
  const read = files.readNote.bind(files);
  const release = barrier();
  vi.spyOn(files, "readNote").mockImplementationOnce(async (...args) => {
    await release.promise;
    return read(...args);
  });
  const closing = app.closeFile("algebra", "Practice problems.md");
  const loading = app.loadDocument("algebra", "Practice problems.md");
  const outcome = loading.then(
    () => "loaded",
    () => "rejected",
  );
  release.resolve();
  await closing;
  expect(await outcome).toBe("rejected");
  expect(app.peekDocument("algebra", "Practice problems.md")).toBeUndefined();
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

it("ignores a refresh read that finishes after workspace removal", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  const content = document.content;
  const read = files.readNote.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "readNote").mockImplementationOnce(async (...args) => {
    const note = await read(...args);
    started.resolve();
    await release.promise;
    return { ...note, content: "# Stale refresh", revision: "external" };
  });
  const refreshing = app.refreshWorkspace("algebra");
  await started.promise;
  await app.removeWorkspace("algebra");
  expect(app.useApp.getState().entries.algebra).toBeUndefined();
  release.resolve();
  await refreshing;
  expect(app.useApp.getState().entries.algebra).toBeUndefined();
  expect(document.content).toBe(content);
});

it("does not feed a closed document with a pending refresh result", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  const content = document.content;
  const read = files.readNote.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "readNote").mockImplementationOnce(async (...args) => {
    const note = await read(...args);
    started.resolve();
    await release.promise;
    return { ...note, content: "# Stale refresh", revision: "external" };
  });
  const refreshing = app.refreshWorkspace("algebra");
  await started.promise;
  await app.closeFile("algebra", "Practice problems.md");
  release.resolve();
  await refreshing;
  expect(document.content).toBe(content);
  expect(document.getSnapshot().editable).toBe(false);
  expect(app.peekDocument("algebra", "Practice problems.md")).toBeUndefined();
});

it("keeps a reopened workspace index when an earlier registration refresh finishes", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const previous = await files.scanWorkspace("algebra");
  const freshEntries = [
    {
      path: "Fresh.md",
      title: "Fresh",
      tags: [],
      kind: "note" as const,
      modified: 1,
    },
  ];
  const scan = files.scanWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "scanWorkspace").mockImplementationOnce(async (...args) => {
    const snapshot = await scan(...args);
    started.resolve();
    await release.promise;
    return snapshot;
  });
  const refreshing = app.refreshWorkspace("algebra");
  await started.promise;
  await app.removeWorkspace("algebra");
  vi.spyOn(files, "addWorkspace").mockResolvedValueOnce({
    workspace: previous.workspace,
    entries: freshEntries,
  });
  await app.addWorkspace(previous.workspace.path);
  release.resolve();
  await refreshing;
  expect(app.useApp.getState().entries.algebra).toEqual(freshEntries);
});

it("waits for an admitted drawing export before shutdown saves its preview link", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { DrawingBinding } = await import("../drawing/storage");
  const { drawingPreviewLink } = await import("../drawing/preview-link");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Practice problems.md");
  const binding = new DrawingBinding(document.content);
  const write = files.writeDrawingSvg.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "writeDrawingSvg").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return write(...args);
  });
  const exporting = app.withWorkspaceDocuments("algebra", async () => {
    const path = await files.writeDrawingSvg(
      "algebra",
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    document.edit(
      binding.update(
        document.content,
        [],
        drawingPreviewLink(document.file.path, path),
      ),
    );
    await document.flush();
  });
  await started.promise;
  expect(app.hasUnsavedChanges()).toBe(true);
  let finished = false;
  const closing = app.flushAll().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(finished).toBe(false);
  release.resolve();
  await Promise.all([exporting, closing]);
  expect(
    (await files.readNote("algebra", document.file.path)).content,
  ).toContain('"notes-drawing-preview"');
  expect(document.dirty).toBe(false);
  expect(finished).toBe(true);
});

it("refreshes a new registration without joining the removed registration's pending scan", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const previous = await files.scanWorkspace("algebra");
  const scan = files.scanWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "scanWorkspace").mockImplementationOnce(async (...args) => {
    const snapshot = await scan(...args);
    started.resolve();
    await release.promise;
    return snapshot;
  });
  const oldRefresh = app.refreshWorkspace("algebra");
  await started.promise;
  await app.removeWorkspace("algebra");
  vi.spyOn(files, "addWorkspace").mockResolvedValueOnce(previous);
  await app.addWorkspace(previous.workspace.path);
  vi.mocked(files.scanWorkspace).mockResolvedValueOnce(previous);
  let finished = false;
  const freshRefresh = app.refreshWorkspace("algebra").then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  const completedBeforeOldRead = finished;
  release.resolve();
  await Promise.all([oldRefresh, freshRefresh]);
  expect(completedBeforeOldRead).toBe(true);
});

it("deletes a folder after saving descendants and clears only its tree state", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  const { toggleFavorite, useLibrary } = await import("../knowledge/library");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  const outside = await app.loadDocument("algebra", "Practice problems.md");
  await app.createFolder("algebra", "", "Lectures extra");
  app.openInSplit("algebra", outside.file.path);
  app.useApp.setState({
    selectedFolder: "Lectures",
    navigation: {
      workspaceId: "algebra",
      path: document.file.path,
      offset: 0,
      serial: 1,
    },
  });
  await app.setEntryAppearance("algebra", document.file.path, {
    icon: "book",
    color: null,
  });
  toggleFavorite("algebra", document.file.path);
  document.edit("# Saved before deleting");
  const remove = files.deleteFile.bind(files);
  const trash = vi
    .spyOn(files, "deleteFile")
    .mockImplementationOnce(async (...args) => {
      expect(
        (await files.readNote("algebra", document.file.path)).content,
      ).toBe("# Saved before deleting");
      expect(document.getSnapshot().editable).toBe(false);
      return remove(...args);
    });
  await app.deleteEntry("algebra", "Lectures", "folder");
  expect(trash).toHaveBeenCalledWith("algebra", "Lectures", null);
  expect(app.peekDocument("algebra", document.file.path)).toBeUndefined();
  expect(app.peekDocument("algebra", outside.file.path)).toBe(outside);
  const state = app.useApp.getState();
  expect(
    (state.entries.algebra ?? []).some(
      (entry) =>
        entry.path === "Lectures" || entry.path.startsWith("Lectures/"),
    ),
  ).toBe(false);
  expect(
    (state.entries.algebra ?? []).some(
      (entry) => entry.path === "Lectures extra",
    ),
  ).toBe(true);
  expect(state.sessions.algebra?.tabs).toEqual([outside.file.path]);
  expect(state.appearances.algebra?.[document.file.path]).toBeUndefined();
  expect(state.selectedFolder).toBe("");
  expect(state.navigation).toBeNull();
  expect(
    useLibrary
      .getState()
      .favorites.some((item) => item.path === document.file.path),
  ).toBe(false);
  expect(
    (await files.scanWorkspace("algebra")).entries.some((entry) =>
      entry.path.startsWith("Lectures/"),
    ),
  ).toBe(false);
  await app.loadDocument("algebra", outside.file.path);
});

it("preserves folder buffers and restores editing when Trash fails", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  document.edit("# Keep this text");
  vi.spyOn(files, "deleteFile").mockRejectedValueOnce(
    new Error("Trash unavailable"),
  );
  await expect(
    app.deleteEntry("algebra", "Lectures", "folder"),
  ).rejects.toThrow("Trash unavailable");
  expect(app.peekDocument("algebra", document.file.path)).toBe(document);
  expect(document.getSnapshot().editable).toBe(true);
  expect(app.currentSession().tabs).toContain(document.file.path);
  expect((await files.readNote("algebra", document.file.path)).content).toBe(
    "# Keep this text",
  );
  document.edit("Editing restored");
});

it("retains unsaved descendants and skips Trash when a folder save fails", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const document = await app.loadDocument("algebra", "Lectures/Eigenvalues.md");
  document.edit("# Unsaved text");
  vi.spyOn(files, "saveNote").mockRejectedValueOnce(new Error("Disk full"));
  const trash = vi.spyOn(files, "deleteFile");
  await expect(
    app.deleteEntry("algebra", "Lectures", "folder"),
  ).rejects.toThrow("Disk full");
  expect(trash).not.toHaveBeenCalled();
  expect(document.content).toBe("# Unsaved text");
  expect(document.dirty).toBe(true);
  expect(document.getSnapshot().editable).toBe(true);
  expect(app.peekDocument("algebra", document.file.path)).toBe(document);
});

it("waits for accepted creation and follows a queued move before deleting a folder", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const move = files.moveFolder.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "moveFolder").mockImplementationOnce(async (...args) => {
    started.resolve();
    await release.promise;
    return move(...args);
  });
  const moving = app.moveFolder("algebra", "Lectures", "Renamed");
  await started.promise;
  const creating = app.newNote("algebra", "Lectures");
  const deleting = app.deleteEntry("algebra", "Lectures", "folder");
  await expect(
    app.loadDocument("algebra", "Lectures/Eigenvalues.md"),
  ).rejects.toThrow("workspace is being changed");
  release.resolve();
  await Promise.all([moving, creating, deleting]);
  expect(
    app.currentSession().tabs.every((path) => !path.startsWith("Renamed/")),
  ).toBe(true);
  expect(
    app.useApp
      .getState()
      .entries.algebra?.some(
        (entry) =>
          entry.path === "Renamed" || entry.path.startsWith("Renamed/"),
      ),
  ).toBe(false);
  expect(
    (await files.scanWorkspace("algebra")).entries.some(
      (entry) => entry.path === "Renamed",
    ),
  ).toBe(false);
});

it("ignores a stale workspace refresh after folder deletion", async () => {
  const app = await import("./app-store");
  const { files } = await import("../platform");
  await app.initialize();
  const scan = files.scanWorkspace.bind(files);
  const started = barrier(),
    release = barrier();
  vi.spyOn(files, "scanWorkspace").mockImplementationOnce(async (...args) => {
    const snapshot = await scan(...args);
    started.resolve();
    await release.promise;
    return snapshot;
  });
  const refreshing = app.refreshWorkspace("algebra");
  await started.promise;
  await app.deleteEntry("algebra", "Lectures", "folder");
  release.resolve();
  await refreshing;
  expect(
    app.useApp
      .getState()
      .entries.algebra?.some(
        (entry) =>
          entry.path === "Lectures" || entry.path.startsWith("Lectures/"),
      ),
  ).toBe(false);
});

it("allows loading the remaining pane as soon as deleted folder tabs disappear", async () => {
  const app = await import("./app-store");
  await app.initialize();
  let loading: Promise<unknown> | undefined;
  const unsubscribe = app.useApp.subscribe((state) => {
    if (!state.entries.algebra?.some((entry) => entry.path === "Lectures"))
      loading ??= app.loadDocument("algebra", "Practice problems.md").then(
        () => "loaded",
        () => "rejected",
      );
  });
  try {
    await app.deleteEntry("algebra", "Lectures", "folder");
    expect(await loading).toBe("loaded");
  } finally {
    unsubscribe();
  }
});
