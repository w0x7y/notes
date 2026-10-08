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

it("matches aliases alongside title terms and nested tags", () => {
  const source = {
    ...entries[0]!,
    aliases: ["Alternative title", "כינוי עברי"],
    tags: ["עברית/לימוד"],
  };
  expect(searchNotes([source], "alternative #עברית/לימוד", null)).toEqual([
    source,
  ]);
  expect(searchNotes([source], "כינוי", null)).toEqual([source]);
  expect(searchNotes([source], "vector alternative", null)).toEqual([source]);
});
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

it("supports workspace scope and disabling workspace priority", () => {
  expect(
    searchNotes(entries, "vec", "current", { scope: "current" }).map(
      (e) => e.path,
    ),
  ).toEqual(["Vector spaces.md"]);
  expect(
    searchNotes(entries, "vec", "current", {
      currentWorkspaceFirst: false,
    }).map((e) => e.path),
  ).toEqual(["Vector.md", "Vector spaces.md"]);
});

it("limited ranking returns the same ordered prefix as a complete search", () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({
    ...entries[i % entries.length]!,
    title: `${entries[i % entries.length]?.title} ${i}`,
    path: `${i}.md`,
    modified: (i * 37) % 79,
  }));
  for (const query of ["", "vec", "#math", "vct #לחזרה"]) {
    for (const currentWorkspaceFirst of [true, false]) {
      const all = searchNotes(many, query, "current", {
        currentWorkspaceFirst,
      });
      for (const limit of [1, 20, 60, 200])
        expect(
          searchNotes(many, query, "current", { limit, currentWorkspaceFirst }),
        ).toEqual(all.slice(0, limit));
    }
  }
});
