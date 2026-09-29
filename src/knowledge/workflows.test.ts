import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 29, 9, 5));
  const { createDemoFiles } = await import("../platform/demo");
  vi.doMock("../platform", () => ({ files: createDemoFiles() }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("captures in a separate workspace without adding folders to the current project", async () => {
  const app = await import("../domain/app-store");
  const { quickCapture } = await import("./templates");
  await app.initialize();
  await quickCapture();
  const state = app.useApp.getState(),
    id = state.activeWorkspaceId!;
  expect(id).not.toBe("algebra");
  expect(state.workspaces.find((w) => w.id === id)?.name).toBe("Quick Notes");
  expect(state.sessions[id]?.primary).toBe("Inbox/Untitled.md");
  expect(state.entries.algebra?.some((e) => e.path === "Inbox")).toBe(false);
});
it("reopens today’s note and preserves edits, even with simultaneous daily commands", async () => {
  const app = await import("../domain/app-store");
  const { openDaily } = await import("./templates");
  await app.initialize();
  await Promise.all([openDaily(), openDaily()]);
  const id = app.useApp.getState().activeWorkspaceId!;
  const doc = await app.loadDocument(id, "Daily/2026-09-29.md");
  doc.editFromAction(doc.content + "Keep my reflection.");
  await doc.flush();
  await openDaily();
  expect(
    app.useApp
      .getState()
      .entries[id]?.filter(
        (e) => e.path.startsWith("Daily/") && e.kind === "note",
      ),
  ).toHaveLength(1);
  expect((await app.loadDocument(id, "Daily/2026-09-29.md")).content).toContain(
    "Keep my reflection.",
  );
});
it("uses customized Markdown templates without replacing them when seeding again", async () => {
  const app = await import("../domain/app-store");
  const templates = await import("./templates");
  await app.initialize();
  await templates.ensureTemplates("algebra");
  const custom = await app.loadDocument("algebra", "Templates/Lecture.md");
  custom.editFromAction("# {{title}}\n\nMy custom lecture on {{date}}.");
  await custom.flush();
  await templates.newLecture("algebra");
  const path = app.useApp.getState().sessions.algebra!.primary!;
  expect((await app.loadDocument("algebra", path)).content).toBe(
    "# Lecture 2026-09-29\n\nMy custom lecture on 2026-09-29.",
  );
  expect(custom.content).toContain("{{title}}");
});
it("updates a live document through tasks and refreshes its index after a save", async () => {
  const app = await import("../domain/app-store");
  const { getKnowledgeNote } = await import("./index");
  const { toggleTask } = await import("./model");
  await app.initialize();
  const note = await getKnowledgeNote("algebra", "Lectures/Eigenvalues.md");
  const doc = await app.loadDocument("algebra", note.path);
  const version = doc.getSnapshot().externalVersion;
  const task = note.tasks.find((t) => !t.checked)!;
  doc.editFromAction(toggleTask(doc.content, task, true));
  await doc.flush();
  const updated = await getKnowledgeNote("algebra", note.path);
  expect(updated.tasks.find((t) => t.offset === task.offset)?.checked).toBe(
    true,
  );
  expect(doc.getSnapshot().externalVersion).toBeGreaterThan(version);
  expect(doc.content).toContain("וקטור עצמי");
});
it("returns unsaved headings from an already cached note", async () => {
  const app = await import("../domain/app-store");
  const { getKnowledgeNote } = await import("./index");
  await app.initialize();
  await getKnowledgeNote("algebra", "Practice problems.md");
  const doc = await app.loadDocument("algebra", "Practice problems.md");
  doc.edit(doc.content + "\n## Fresh heading\n");
  expect(
    (await getKnowledgeNote("algebra", "Practice problems.md")).headings.some(
      (h) => h.text === "Fresh heading",
    ),
  ).toBe(true);
  doc.dispose();
});

it("invalidates content for unopened notes rewritten by a rename", async () => {
  const app = await import("../domain/app-store");
  const { getKnowledgeNote } = await import("./index");
  const { files } = await import("../platform");
  await app.initialize();
  const source = "Lectures/Eigenvalues.md";
  await getKnowledgeNote("algebra", source);
  const target = await app.loadDocument("algebra", "Lectures/Vector spaces.md");
  const rename = files.renameNote.bind(files);
  vi.spyOn(files, "renameNote").mockImplementationOnce(
    async (id, note, name) => {
      const incoming = await files.readNote(id, source);
      const changed = await files.saveNote(id, {
        ...incoming,
        content: incoming.content.replace("[[Vector spaces]]", "[[Renamed]]"),
      });
      const result = await rename(id, note, name);
      return {
        ...result,
        rewritten: [
          {
            workspaceId: id,
            path: source,
            content: changed.content,
            revision: changed.revision,
          },
        ],
      };
    },
  );
  await app.renameNote(target, "Lectures/Renamed.md");
  expect(
    (await getKnowledgeNote("algebra", source)).links.some(
      (l) => l.target === "Renamed",
    ),
  ).toBe(true);
});
