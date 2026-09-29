import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
  expect((await files.readNote("algebra", moved)).content).toBe(document.content);
  await expect(files.readNote("algebra", "Lectures/Eigenvalues.md")).rejects.toThrow();
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
