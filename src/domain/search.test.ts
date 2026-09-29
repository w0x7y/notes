import { expect, it } from "vitest";
import type { SearchEntry } from "./contracts";
import { searchNotes } from "./search";

const entries: SearchEntry[] = [
  {
    workspaceId: "other",
    workspaceName: "Other",
    color: "#61afef",
    path: "Vector.md",
    title: "Vector",
    tags: ["math"],
    kind: "note",
    modified: 1,
  },
  {
    workspaceId: "current",
    workspaceName: "Current",
    color: "#c678dd",
    path: "Vector spaces.md",
    title: "Vector spaces",
    tags: ["math", "לחזרה"],
    kind: "note",
    modified: 2,
  },
  {
    workspaceId: "current",
    workspaceName: "Current",
    color: "#c678dd",
    path: "Intro.md",
    title: "Intro",
    tags: ["exam"],
    kind: "note",
    modified: 3,
  },
];
it("prioritizes current-workspace fuzzy matches before stronger matches elsewhere", () => {
  expect(
    searchNotes(entries, "vctr", "current").map((result) => result.path),
  ).toEqual(["Vector spaces.md", "Vector.md"]);
});
it("combines title terms and Hebrew tag filters", () => {
  expect(
    searchNotes(entries, "vec #לחזרה", "current").map((result) => result.path),
  ).toEqual(["Vector spaces.md"]);
  expect(
    searchNotes(entries, "#exam", "current").map((result) => result.path),
  ).toEqual(["Intro.md"]);
});
it("does not match folder names as note titles", () => {
  expect(searchNotes(entries, "other", "current")).toEqual([]);
});
