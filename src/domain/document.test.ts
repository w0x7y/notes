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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const original: NoteFile = {
  path: "Existing.md",
  content: "# Original",
  revision: "base",
  autoRename: false,
};
function result(file: NoteFile, revision = "written"): SaveResult {
  return { ...file, revision, rewritten: [], warnings: [] };
}

it("keeps conflict visible while editing and stops all autosave attempts until resolution", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async (file: NoteFile) => result(file));
  const doc = new NoteDocument("work", original, write, () => {});
  try {
    doc.edit("# Local");
    doc.receiveExternal("# Disk", "disk");
    doc.edit("# Newest local");
    doc.setAutosaveDelay(50);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).not.toHaveBeenCalled();
    expect(doc.content).toBe("# Newest local");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    await expect(doc.flush()).rejects.toThrow("changed on disk");
    expect(doc.dirty).toBe(true);
  } finally {
    doc.dispose();
    vi.useRealTimers();
  }
});

it("classifies generic write failures by disk revision without depending on their message", async () => {
  const read = vi.fn(async () => ({
    ...original,
    revision: "disk",
    content: "# External",
  }));
  const write = vi.fn(async () => {
    throw new Error("Operation rejected");
  });
  const doc = new NoteDocument("work", original, write, () => {}, 60_000, read);
  try {
    doc.edit("# Local");
    await expect(doc.flush()).rejects.toThrow("changed on disk");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(doc.file.revision).toBe("base");
    expect(doc.content).toBe("# Local");
    await expect(doc.flush()).rejects.toThrow("changed on disk");
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    doc.dispose();
  }
});

it("keeps ordinary disk errors as save failures when the file revision is unchanged", async () => {
  const doc = new NoteDocument(
    "work",
    original,
    async () => {
      throw new Error("Disk full");
    },
    () => {},
    60_000,
    async () => original,
  );
  try {
    doc.edit("# Local");
    await expect(doc.flush()).rejects.toThrow("Disk full");
    expect(doc.getSnapshot().status).toEqual({
      kind: "failed",
      message: "Disk full",
    });
    expect(doc.hasConflict).toBe(false);
    expect(doc.content).toBe("# Local");
  } finally {
    doc.dispose();
  }
});

it("accepts its own observed write revision without inventing an external conflict", async () => {
  const release = deferred<SaveResult>();
  const doc = new NoteDocument(
    "work",
    original,
    () => release.promise,
    () => {},
    60_000,
  );
  try {
    doc.edit("# Local");
    const saving = doc.flush();
    doc.receiveExternal("# Local", "written", "base");
    release.resolve(result(doc.file));
    await saving;
    expect(doc.getSnapshot().status.kind).toBe("saved");
    expect(doc.hasConflict).toBe(false);
    expect(doc.content).toBe("# Local");
  } finally {
    doc.dispose();
  }
});

it("does not erase a foreign revision observed during a successful in-flight write", async () => {
  const release = deferred<SaveResult>();
  const write = vi.fn(() => release.promise);
  const doc = new NoteDocument("work", original, write, () => {}, 60_000);
  try {
    doc.edit("# Sent");
    const sent = doc.file;
    const saving = doc.flush();
    doc.edit("# Newest local");
    doc.receiveExternal("# Foreign", "foreign", "base");
    release.resolve(result(sent));
    await expect(saving).rejects.toThrow("changed on disk");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(doc.content).toBe("# Newest local");
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    doc.dispose();
  }
});

it("rejects a stale refresh observation after a newer save has committed", async () => {
  const doc = new NoteDocument(
    "work",
    original,
    async (file) => result(file),
    () => {},
    60_000,
  );
  try {
    doc.edit("# Local");
    await doc.flush();
    doc.receiveExternal("# Stale read", "older-disk", "base");
    expect(doc.content).toBe("# Local");
    expect(doc.getSnapshot().status.kind).toBe("saved");
  } finally {
    doc.dispose();
  }
});

it("keeps a foreign final-write observation unresolved even without another local edit", async () => {
  const release = deferred<SaveResult>();
  const write = vi.fn(() => release.promise);
  const doc = new NoteDocument("work", original, write, () => {}, 60_000);
  try {
    doc.edit("# Local final write");
    const payload = doc.file;
    const saving = doc.flush();
    doc.receiveExternal("# Third disk revision", "third", "base");
    release.resolve(result(payload, "second"));
    await expect(saving).rejects.toThrow("changed on disk");
    expect(doc.content).toBe("# Local final write");
    expect(doc.file.revision).toBe("second");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(doc.hasConflict).toBe(true);
    expect(doc.dirty).toBe(true);
    await expect(doc.flush()).rejects.toThrow("changed on disk");
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    doc.dispose();
  }
});

it("Keep mine intentionally saves the local baseline when edits returned to previously saved text", async () => {
  const write = vi.fn(async (file: NoteFile) => result(file));
  const doc = new NoteDocument(
    "work",
    original,
    write,
    () => {},
    60_000,
    async () => ({
      ...original,
      content: "# Latest disk version",
      revision: "latest",
    }),
  );
  try {
    doc.edit("# Temporary local edit");
    doc.receiveExternal("# Disk changed", "observed");
    doc.edit(original.content);
    expect(doc.dirty).toBe(true);
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    await doc.keepMine();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      content: original.content,
      revision: "latest",
    });
    expect(doc.content).toBe(original.content);
    expect(doc.getSnapshot().status.kind).toBe("saved");
    expect(doc.hasConflict).toBe(false);
    expect(doc.dirty).toBe(false);
  } finally {
    doc.dispose();
  }
});

it("Keep mine rereads disk and drains edits accepted during recovery against successive optimistic revisions", async () => {
  const releaseRead = deferred<NoteFile>();
  const readStarted = deferred<void>();
  const releaseWrite = deferred<SaveResult>();
  const writeStarted = deferred<void>();
  const writes: NoteFile[] = [];
  const doc = new NoteDocument(
    "work",
    original,
    async (file) => {
      writes.push(file);
      if (writes.length === 1) {
        writeStarted.resolve();
        return releaseWrite.promise;
      }
      return result(file, "second-save");
    },
    () => {},
    60_000,
    async () => {
      readStarted.resolve();
      return releaseRead.promise;
    },
  );
  try {
    doc.edit("# Before recovery");
    doc.receiveExternal("# Observed disk", "observed");
    const keeping = doc.keepMine();
    await readStarted.promise;
    doc.edit("# During read");
    releaseRead.resolve({
      ...original,
      content: "# Latest disk",
      revision: "latest-disk",
    });
    await writeStarted.promise;
    doc.edit("# During write");
    releaseWrite.resolve(result(writes[0]!, "first-save"));
    await keeping;
    expect(writes.map((file) => [file.content, file.revision])).toEqual([
      ["# During read", "latest-disk"],
      ["# During write", "first-save"],
    ]);
    expect(doc.content).toBe("# During write");
    expect(doc.file.revision).toBe("second-save");
    expect(doc.getSnapshot().status.kind).toBe("saved");
  } finally {
    doc.dispose();
  }
});

it.each(["latest-disk", "written", "newer-external"])(
  "classifies a %s observation during Keep mine against its optimistic write",
  async (observedRevision) => {
    const started = deferred<void>();
    const release = deferred<SaveResult>();
    const writes: NoteFile[] = [];
    const doc = new NoteDocument(
      "work",
      original,
      async (file) => {
        writes.push(file);
        if (writes.length === 1) {
          started.resolve();
          return release.promise;
        }
        return result(file, "next-write");
      },
      () => {},
      60_000,
      async () => ({
        ...original,
        content: "# Latest disk",
        revision: "latest-disk",
      }),
    );
    try {
      doc.edit("# Mine");
      doc.receiveExternal("# Latest disk", "latest-disk");
      const keeping = doc.keepMine();
      await started.promise;
      doc.edit("# Newer local text");
      doc.receiveExternal("# Observed disk", observedRevision, "base");
      release.resolve(result(writes[0]!, "written"));
      if (observedRevision === "newer-external") {
        await expect(keeping).rejects.toThrow("changed on disk");
        expect(doc.hasConflict).toBe(true);
        expect(writes).toHaveLength(1);
      } else {
        await keeping;
        expect(doc.getSnapshot().status.kind).toBe("saved");
        expect(doc.hasConflict).toBe(false);
        expect(writes.map((file) => file.revision)).toEqual([
          "latest-disk",
          "written",
        ]);
      }
      expect(doc.content).toBe("# Newer local text");
    } finally {
      doc.dispose();
    }
  },
);

it("a second disk change during Keep mine cannot advance the original revision or discard newer text", async () => {
  let reads = 0;
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const write = vi.fn(async () => {
    writeStarted.resolve();
    await releaseWrite.promise;
    throw new Error("Save rejected");
  });
  const doc = new NoteDocument(
    "work",
    original,
    write,
    () => {},
    60_000,
    async () => ({
      ...original,
      revision: ++reads === 1 ? "latest" : "changed-again",
      content: "# Disk",
    }),
  );
  try {
    doc.edit("# Local");
    doc.receiveExternal("# Disk", "observed");
    const keeping = doc.keepMine();
    await writeStarted.promise;
    doc.edit("# Newer local");
    releaseWrite.resolve();
    await expect(keeping).rejects.toThrow("changed on disk");
    expect(doc.file.revision).toBe("base");
    expect(doc.content).toBe("# Newer local");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    doc.dispose();
  }
});

it("Reload rereads the latest file and holds editing only until replacement is ready", async () => {
  const readStarted = deferred<void>();
  const releaseRead = deferred<NoteFile>();
  const write = vi.fn(async (file: NoteFile) => result(file));
  const doc = new NoteDocument(
    "work",
    original,
    write,
    () => {},
    60_000,
    async () => {
      readStarted.resolve();
      return releaseRead.promise;
    },
  );
  try {
    doc.edit("# Local");
    doc.receiveExternal("# Old observation", "observed");
    const reloading = doc.reloadFromDisk();
    await readStarted.promise;
    expect(doc.getSnapshot().editable).toBe(false);
    expect(() => doc.edit("# Attempt while held")).toThrow("busy");
    expect(doc.content).toBe("# Local");
    releaseRead.resolve({
      ...original,
      content: "# Latest disk",
      revision: "latest",
    });
    await reloading;
    expect(doc.content).toBe("# Latest disk");
    expect(doc.file.revision).toBe("latest");
    expect(doc.getSnapshot().editable).toBe(true);
    expect(doc.getSnapshot().status.kind).toBe("saved");
    expect(doc.dirty).toBe(false);
    expect(write).not.toHaveBeenCalled();
  } finally {
    doc.dispose();
  }
});

it("failed Reload preserves the buffer and releases its edit hold", async () => {
  const doc = new NoteDocument(
    "work",
    original,
    async (file) => result(file),
    () => {},
    60_000,
    async () => {
      throw new Error("Read unavailable");
    },
  );
  try {
    doc.edit("# Local");
    doc.receiveExternal("# Disk", "disk");
    await expect(doc.reloadFromDisk()).rejects.toThrow("Read unavailable");
    expect(doc.content).toBe("# Local");
    expect(doc.getSnapshot().editable).toBe(true);
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(doc.file.revision).toBe("base");
    doc.edit("# Still editable");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
  } finally {
    doc.dispose();
  }
});

it("Reload cannot discard edits accepted while it waits for an earlier save", async () => {
  const releaseWrite = deferred<void>();
  const doc = new NoteDocument(
    "work",
    original,
    async () => {
      await releaseWrite.promise;
      throw new Error("Rejected");
    },
    () => {},
    60_000,
    async () => ({ ...original, content: "# Disk", revision: "disk" }),
  );
  try {
    doc.edit("# Before click");
    const saving = doc.flush();
    const reloading = doc.reloadFromDisk();
    doc.edit("# Typed after click");
    releaseWrite.resolve();
    await expect(saving).rejects.toThrow("changed on disk");
    await expect(reloading).rejects.toThrow(
      "changed while preparing to reload",
    );
    expect(doc.content).toBe("# Typed after click");
    expect(doc.getSnapshot().status.kind).toBe("conflict");
    expect(doc.getSnapshot().editable).toBe(true);
  } finally {
    doc.dispose();
  }
});
