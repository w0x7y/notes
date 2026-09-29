import { expect, it } from "vitest";
import { buildFileTree } from "./file-tree";
import type { Entry } from "./contracts";

it("groups direct children once and keeps folders before files with either order", () => {
  const entries: Entry[] = [
    { path: "a.md", kind: "note", title: "A", tags: [], modified: 1 },
    { path: "z.md", kind: "note", title: "Z", tags: [], modified: 5 },
    { path: "Folder", kind: "folder", title: "Folder", tags: [], modified: 0 },
    {
      path: "Folder/nested.md",
      kind: "note",
      title: "Nested",
      tags: [],
      modified: 2,
    },
  ];
  expect(
    buildFileTree(entries)
      .get("")
      ?.map((entry) => entry.path),
  ).toEqual(["Folder", "a.md", "z.md"]);
  expect(
    buildFileTree(entries, "modified")
      .get("")
      ?.map((entry) => entry.path),
  ).toEqual(["Folder", "z.md", "a.md"]);
  expect(
    buildFileTree(entries)
      .get("Folder")
      ?.map((entry) => entry.path),
  ).toEqual(["Folder/nested.md"]);
  expect(entries[0]?.path).toBe("a.md");
});
