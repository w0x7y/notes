import { expect, it, vi } from "vitest";
import type { NoteFile, SaveResult } from "./contracts";
import { NoteDocument } from "./document";

const note: NoteFile = {
  path: "Untitled.md",
  content: "",
  revision: "0",
  autoRename: true,
};
it("serializes saves and drains the newest edit made during an in-flight write", async () => {
  const writes: NoteFile[] = [];
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const doc = new NoteDocument(
    "work",
    note,
    async (payload) => {
      writes.push(payload);
      if (writes.length === 1) await barrier;
      return {
        ...payload,
        revision: String(writes.length),
        rewritten: [],
        warnings: [],
      };
    },
    () => {},
    60_000,
  );
  doc.edit("first");
  const saving = doc.flush();
  doc.edit("second");
  release?.();
  await saving;
  expect(writes.map((write) => [write.content, write.revision])).toEqual([
    ["first", "0"],
    ["second", "1"],
  ]);
  expect(doc.content).toBe("second");
  expect(doc.getSnapshot().status.kind).toBe("saved");
  doc.dispose();
});
it("keeps unsaved text after failure and retries it", async () => {
  let fail = true;
  const doc = new NoteDocument(
    "work",
    note,
    async (payload): Promise<SaveResult> => {
      if (fail) throw new Error("Disk full");
      return { ...payload, revision: "1", rewritten: [], warnings: [] };
    },
    () => {},
    60_000,
  );
  doc.edit("important");
  await expect(doc.flush()).rejects.toThrow("Disk full");
  expect(doc.content).toBe("important");
  expect(doc.getSnapshot().status.kind).toBe("failed");
  fail = false;
  await doc.flush();
  expect(doc.getSnapshot().status.kind).toBe("saved");
  doc.dispose();
});

it("queues edits behind a rename and saves them to the new path", async () => {
  const writes: NoteFile[] = [];
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const doc = new NoteDocument(
    "work",
    note,
    async (payload) => {
      writes.push(payload);
      return { ...payload, revision: "saved", rewritten: [], warnings: [] };
    },
    () => {},
    60_000,
  );
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const renaming = doc.rename(async (payload) => {
    started?.();
    await barrier;
    return {
      ...payload,
      path: "Custom.md",
      autoRename: false,
      revision: "renamed",
      rewritten: [],
      warnings: [],
    };
  });
  await ready;
  doc.edit("Typed while renaming");
  const saving = doc.flush();
  expect(writes).toHaveLength(0);
  release?.();
  await Promise.all([renaming, saving]);
  expect(doc.content).toBe("Typed while renaming");
  expect(
    writes.map((write) => [write.path, write.content, write.revision]),
  ).toEqual([["Custom.md", "Typed while renaming", "renamed"]]);
  expect(doc.getSnapshot().status.kind).toBe("saved");
  doc.dispose();
});

it("reschedules a pending autosave when its delay changes", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async (payload: NoteFile): Promise<SaveResult> => ({
    ...payload,
    revision: "1",
    rewritten: [],
    warnings: [],
  }));
  const doc = new NoteDocument("work", note, write, () => {});
  try {
    doc.edit("Keep these edits");
    doc.setAutosaveDelay(2000);
    await vi.advanceTimersByTimeAsync(600);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(doc.dirty).toBe(false);
  } finally {
    doc.dispose();
    vi.useRealTimers();
  }
});
