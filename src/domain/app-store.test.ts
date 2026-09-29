import { afterEach, expect, it, vi } from "vitest";
import type { NoteFile } from "./contracts";

const fixture = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  onCopy: undefined as (() => void) | undefined,
}));

vi.mock("../platform", () => ({
  files: {
    createNote: async (id: string) => {
      const count = (fixture.counts.get(id) ?? 0) + 1;
      fixture.counts.set(id, count);
      return {
        path: count === 1 ? "Untitled.md" : `Untitled ${count}.md`,
        content: "",
        revision: "0",
        autoRename: true,
      };
    },
    readNote: async () => {
      throw new Error("Read from disk");
    },
    saveNote: async (id: string, note: NoteFile) => {
      if (id.startsWith("recovery") && note.path === "Untitled.md")
        throw new Error("External conflict");
      if (id.startsWith("recovery")) fixture.onCopy?.();
      return {
        ...note,
        path: "New title.md",
        revision: "1",
        rewritten: [],
        warnings: [],
      };
    },
    saveSessions: async () => {},
  },
}));
import {
  closeFile,
  flushAll,
  loadDocument,
  newNote,
  saveCopy,
  useApp,
} from "./app-store";

afterEach(() => vi.useRealTimers());
it("closes the same document when flushing it changes its filename", async () => {
  vi.useFakeTimers();
  await newNote("close-test");
  const document = await loadDocument("close-test", "Untitled.md");
  document.edit("# New title\n\nText");
  await closeFile("close-test", "Untitled.md");
  expect(document.getSnapshot().path).toBe("New title.md");
  expect(useApp.getState().sessions["close-test"]?.tabs).toEqual([]);
  document.dispose();
});

it("releases a conflicted original after its text is durably saved as a copy", async () => {
  vi.useFakeTimers();
  await newNote("recovery");
  const document = await loadDocument("recovery", "Untitled.md");
  document.edit("Important text");
  await expect(document.flush()).rejects.toThrow("External conflict");
  await saveCopy(document);
  expect(useApp.getState().sessions["recovery"]?.tabs).toEqual([
    "New title.md",
  ]);
  expect((await loadDocument("recovery", "New title.md")).content).toBe(
    "Important text",
  );
  await expect(loadDocument("recovery", "Untitled.md")).rejects.toThrow(
    "Read from disk",
  );
  await expect(flushAll()).resolves.toBeUndefined();
});

it("keeps edits made while saving a recovery copy", async () => {
  vi.useFakeTimers();
  await newNote("recovery-edit");
  const document = await loadDocument("recovery-edit", "Untitled.md");
  document.edit("Copied version");
  await expect(document.flush()).rejects.toThrow("External conflict");
  fixture.onCopy = () => document.edit("Newer text");
  await saveCopy(document);
  fixture.onCopy = undefined;
  expect(document.content).toBe("Newer text");
  expect(useApp.getState().sessions["recovery-edit"]?.tabs).toContain(
    "Untitled.md",
  );
  expect((await loadDocument("recovery-edit", "New title.md")).content).toBe(
    "Copied version",
  );
  document.dispose();
});
