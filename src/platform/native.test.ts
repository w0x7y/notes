import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { nativeFiles } from "./native";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const sessions = {
  sessions: {},
  activeWorkspaceId: null,
  toolbarVisible: true,
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("native unit command contracts", () => {
  const commands = [
    {
      name: "saveSessions",
      command: "save_sessions",
      args: sessions,
      run: () => nativeFiles.saveSessions(sessions),
    },
    {
      name: "createFolder",
      command: "create_folder",
      args: { workspaceId: "workspace", parent: "parent", name: "Notes" },
      run: () => nativeFiles.createFolder("workspace", "parent", "Notes"),
    },
  ];

  for (const { name, command, args, run } of commands) {
    it(`${name} validates JSON null and returns undefined`, async () => {
      mockedInvoke.mockResolvedValue(null);
      await expect(run()).resolves.toBeUndefined();
      expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith(command, args);
    });

    it.each([undefined, false, "ok", {}, []])(
      `${name} rejects an invalid success response %j`,
      async (response) => {
        mockedInvoke.mockResolvedValue(response);
        await expect(run()).rejects.toThrow();
      },
    );

    it(`${name} preserves native errors`, async () => {
      const error = new Error("Settings write failed");
      mockedInvoke.mockRejectedValue(error);
      await expect(run()).rejects.toBe(error);
    });
  }
});

it("rejects malformed typed command responses", async () => {
  mockedInvoke.mockResolvedValue({ path: "note.md", content: "# Note" });
  await expect(nativeFiles.readNote("workspace", "note.md")).rejects.toThrow();
});

describe("workspace scan metadata contracts", () => {
  const snapshot = {
    workspace: {
      id: "workspace",
      name: "Notes",
      path: "/temporary/notes",
      color: "#ffffff",
      icon: "folder",
    },
    entries: [
      {
        path: "Note.md",
        kind: "note",
        title: "Note",
        tags: ["study/שלום"],
        aliases: ["Alternate name"],
        modified: 1,
      },
    ],
    warnings: ["Could not scan an unreadable folder"],
    incomplete: true,
  };

  it("preserves partial-scan warnings and aliases at the IPC boundary", async () => {
    mockedInvoke.mockResolvedValue(snapshot);
    await expect(nativeFiles.scanWorkspace("workspace")).resolves.toEqual(
      snapshot,
    );
  });

  it.each([
    { ...snapshot, warnings: "Scan failed" },
    { ...snapshot, incomplete: "true" },
    {
      ...snapshot,
      entries: [{ ...snapshot.entries[0], aliases: [123] }],
    },
  ])("rejects malformed scan metadata", async (response) => {
    mockedInvoke.mockResolvedValue(response);
    await expect(nativeFiles.scanWorkspace("workspace")).rejects.toThrow();
  });
});
