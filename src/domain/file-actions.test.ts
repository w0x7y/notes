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
